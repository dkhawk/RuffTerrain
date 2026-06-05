/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Key schema for Gemini output formatting
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    stations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          name: { type: "STRING" },
          type: { type: "STRING", enum: ["segmenting", "informational"] },
          subtype: { type: "STRING", enum: ["aid_station", "water_source", "navigation", "scenic", "campground", "refuge", "summit"] },
          coordinate_override: {
            type: "OBJECT",
            properties: {
              lat: { type: "NUMBER" },
              lon: { type: "NUMBER" }
            },
            required: ["lat", "lon"]
          },
          passes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                num: { type: "INTEGER" },
                dist_m: { type: "NUMBER" },
                label: { type: "STRING" },
                cutoff_clock: { type: "STRING" },
                cutoff_elapsed: { type: "STRING" }
              },
              required: ["num", "dist_m"]
            }
          },
          accessibility: {
            type: "OBJECT",
            properties: {
              crew_allowed: { type: "BOOLEAN" },
              pacer_allowed: { type: "BOOLEAN" },
              vehicle_tier: { type: "STRING", enum: ["none", "hike_only", "foot_bike", "auto", "4wd"] },
              drop_bag_allowed: { type: "BOOLEAN" }
            }
          },
          services: {
            type: "OBJECT",
            properties: {
              water: { type: "BOOLEAN" },
              unmanaged_water: { type: "BOOLEAN" },
              food: { type: "BOOLEAN" },
              hot_food: { type: "BOOLEAN" },
              toilets: { type: "BOOLEAN" },
              medical: { type: "BOOLEAN" },
              sleep_area: { type: "BOOLEAN" }
            }
          },
          navigation_alert: {
            type: "OBJECT",
            properties: {
              severity: { type: "STRING", enum: ["critical", "warning", "info"] },
              turn_type: { type: "STRING", enum: ["sharp_right", "sharp_left", "fork_right", "fork_left", "straight"] },
              prompt: { type: "STRING" }
            }
          }
        },
        required: ["id", "name", "type", "passes"]
      }
    }
  },
  required: ["stations"]
};

const SYSTEM_INSTRUCTION = `
You are an expert geospatial spatial analyst and legendary endurance trail-running director.
Your goal is to ingest messy, unstructured race website text, tables, or notes, and output a clean, structured JSON payload in metric units (meters) that resolves, validates, and enhances course milestones against a target course distance.

CORE HEURISTICS & RULES:
1. METRIC CONVERSION (CRITICAL):
   - All distances MUST be converted to meters. If the source text specifies miles, multiply by 1609.344 and round to the nearest integer.
   - The attribute name in JSON must be "dist_m" (explicitly indicating meters).

2. COMPACTION & MERGING (Out-and-Back / Loops):
   - Identify physical locations visited multiple times under slightly different names (e.g., "Dry Fork Outbound" at Mile 13.5 and "Dry Fork Inbound" at Mile 82.5).
   - Collapse these matches into a single station entity with multiple entries in the "passes" array.
   - Do NOT duplicate waypoints (avoid "ghosting").

3. AMALGAM SPLITTING:
   - Identify cells containing multiple distinct geographic names grouped together (e.g., "Right Hand Fork / Temple Fork" at Miles 38/46).
   - If they represent separate geographic points, split them into distinct station objects. Do not bundle different geographic features into one ID.

4. CUTOFF ELAPSED TIME INFERENCE:
   - Convert clock cutoffs (e.g., "1:15 PM") into ISO 8601 durations relative to the race start time (e.g., "PT7H15M").
   - If the race spans multiple days (e.g., 100-mile events), infer if a cutoff belongs to Day 1 or Day 2 based on cumulative distance and a typical target average pace.

5. METADATA & CUSTOM ICONS CLASSIFICATION:
   - Classify each location as type "segmenting" (major aid station that divides the course) or "informational" (a water source, summit, view, or landmark).
   - Map text services to Boolean flags (water, food, toilets, medical, sleep_area).
   - Assign subtype correctly:
     - "aid_station"
     - "water_source"
     - "scenic"
     - "refuge"
     - "summit"
     - "campground"
     - "navigation" (tricky turns/alerts)

6. NAVIGATION ALERTS:
   - Pay close attention to warnings about tricky turns, forks, or turnaround points.
   - Extract these as "informational" type with a "navigation" subtype and populated "navigation_alert" parameters. Always label turnarounds with the word "Turnaround" in the pass label to trigger turnaround snapping.

7. INTERACTIVE CHAT EDITS:
   - The user may send follow-up instructions to add, remove, or modify waypoints (e.g., "Change the cutoff at dry-fork to 4:00 PM" or "Add a scenic overlook at mile 15").
   - Adjust the JSON payload accordingly to reflect these changes in the list of stations.
`;

/**
 * Sends a prompt along with the current route context to the Gemini API.
 * @param {string} userPrompt User request (unstructured table, text, or edit command)
 * @param {Object} currentRoute Context route containing trackpoints and existing waypoints
 * @param {string} apiKey User's Gemini API key
 * @param {Array} chatHistory List of past message objects { role, parts: [{ text }] }
 * @param {string} modelName The model to use (default: models/gemini-2.0-flash)
 * @returns {Promise<Object>} The parsed stations JSON output and raw textual explanation
 */
export async function sendToGemini(userPrompt, currentRoute, apiKey, chatHistory = [], modelName = "models/gemini-2.0-flash", signal = null) {
  if (!apiKey) {
    throw new Error("Gemini API key is required. Please set it in the Settings panel.");
  }

  const cleanModelName = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${cleanModelName}:generateContent?key=${apiKey}`;

  // Condense the current route context to save tokens and provide focused context
  const condensedRoute = currentRoute ? {
    name: currentRoute.name,
    totalDistanceM: currentRoute.totalDistance,
    totalElevationGainM: currentRoute.totalElevationGain,
    waypoints: currentRoute.waypoints.map(w => ({
      id: w.id,
      name: w.name,
      dist_m: w.dist_m,
      lat: w.lat,
      lon: w.lon,
      ele: w.ele,
      type: w.extensions?.station?.type || "informational",
      subtype: w.extensions?.station?.subtype || null,
      passes: w.extensions?.station?.passes || []
    }))
  } : null;

  // Build the message contents. Include the route context in the system/user boundary.
  const contextText = condensedRoute 
    ? `Here is the current course structure:\n\`\`\`json\n${JSON.stringify(condensedRoute, null, 2)}\n\`\`\`\n`
    : "";

  const systemInstructionPart = {
    parts: [{ text: SYSTEM_INSTRUCTION }]
  };

  // Compile history
  const contents = [...chatHistory];
  
  // Append current user message
  contents.push({
    role: "user",
    parts: [{ text: `${contextText}User Request: ${userPrompt}\n\nPlease analyze the request, compile or modify the course stations, and return the output conforming strictly to the requested JSON schema.` }]
  });

  const requestBody = {
    contents,
    systemInstruction: systemInstructionPart,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.1, // low temperature for precise JSON generation
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API Error: ${message}`);
  }

  const result = await response.json();
  
  // Extract output text
  const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!outputText) {
    throw new Error("Empty response from Gemini API.");
  }

  // Parse structured output
  try {
    const parsedData = JSON.parse(outputText);
    return {
      stations: parsedData.stations || [],
      rawText: outputText,
      // Helper to append to conversation history
      assistantMessage: result.candidates[0].content
    };
  } catch (err) {
    console.error("Failed to parse Gemini output as JSON:", outputText);
    throw new Error("Gemini returned invalid JSON structure: " + err.message);
  }
}

/**
 * Fetches the list of available Gemini models supporting the generateContent method.
 * @param {string} apiKey Gemini API Key
 * @returns {Promise<Array<Object>>} List of model objects with name and displayName
 */
export async function fetchAvailableModels(apiKey) {
  if (!apiKey) {
    throw new Error("Gemini API key is required to retrieve models.");
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `HTTP ${response.status}`;
    throw new Error(`Failed to list models: ${message}`);
  }
  const data = await response.json();
  if (!data.models) return [];

  // Filter to models supporting generateContent and containing 'gemini' and ('flash' or 'pro') in their name
  // Exclude tuning, embedding, tts, test, and other specialized models like nanobanana
  return data.models
    .filter(m => {
      const name = m.name.toLowerCase();
      const supportsGenerate = m.supportedGenerationMethods?.includes("generateContent");
      const isGemini = name.includes("gemini");
      const isFlashOrPro = name.includes("flash") || name.includes("pro");
      
      const isExcluded = name.includes("tuning") || 
                         name.includes("tuned") || 
                         name.includes("embed") || 
                         name.includes("tts") || 
                         name.includes("nanobanana") || 
                         name.includes("whisper") || 
                         name.includes("test") ||
                         name.includes("001") ||
                         name.includes("nano");
      
      return supportsGenerate && isGemini && isFlashOrPro && !isExcluded;
    })
    .map(m => ({
      name: m.name, // e.g. "models/gemini-2.0-flash"
      displayName: m.displayName || m.name.split("/").pop()
    }));
}
