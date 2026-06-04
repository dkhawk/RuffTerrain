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

import { calculateWarnings } from "./gpx-parser.js";

/**
 * Fetches elevations for coordinate pairs from Open-Meteo with Open-Elevation fallback.
 * Processes in batches of 20 to avoid URL length constraints.
 * @param {Array} coords Array of [lat, lon] pairs
 * @param {Function} progressCallback Callback for progress reporting (current, total)
 * @returns {Promise<Array>} Array of elevations in meters
 */
async function fetchElevationsAPI(coords, progressCallback) {
  const batchSize = 20;
  const elevations = [];

  for (let i = 0; i < coords.length; i += batchSize) {
    const batch = coords.slice(i, i + batchSize);
    if (progressCallback) {
      progressCallback(Math.min(i + batchSize, coords.length), coords.length);
    }

    let success = false;
    let retries = 3;
    let delayMs = 1000;

    while (!success && retries > 0) {
      try {
        // Try Open-Meteo
        const lats = batch.map((c) => c[0]).join(",");
        const lons = batch.map((c) => c[1]).join(",");
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        
        if (data && data.elevation) {
          elevations.push(...data.elevation);
          success = true;
        } else {
          throw new Error("No elevation data in Open-Meteo response");
        }
      } catch (err) {
        console.warn(`Open-Meteo batch failed (retries remaining: ${retries - 1}):`, err);
        
        // Try Open-Elevation fallback
        try {
          const url = "https://api.open-elevation.com/api/v1/lookup";
          const payload = {
            locations: batch.map((c) => ({ latitude: c[0], longitude: c[1] })),
          };

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
          const data = await response.json();

          if (data && data.results) {
            elevations.push(...data.results.map((loc) => loc.elevation));
            success = true;
          } else {
            throw new Error("No elevation data in Open-Elevation response");
          }
        } catch (err2) {
          console.warn("Open-Elevation fallback also failed:", err2);
          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs *= 2; // exponential backoff
          }
        }
      }
    }

    if (!success) {
      console.error(`Failed to fetch elevations for batch starting at index ${i}. Filling with 0.0.`);
      elevations.push(...Array(batch.length).fill(0.0));
    }

    // Rate limit safeguard sleep
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return elevations;
}

/**
 * Corrects and interpolates elevations for an in-memory route object.
 * @param {Object} route The parsed route object to modify
 * @param {Function} progressCallback Callback to display progress
 * @returns {Promise<void>}
 */
export async function correctRouteElevations(route, progressCallback) {
  const trackpoints = route.trackpoints;
  const N = trackpoints.length;
  if (N === 0) return;

  const coords = trackpoints.map((pt) => [pt.lat, pt.lon]);

  // Sample every 10th point and always include the last point (N-1)
  const step = 10;
  const sampleIndices = [];
  for (let i = 0; i < N; i += step) {
    sampleIndices.push(i);
  }
  if (sampleIndices[sampleIndices.length - 1] !== N - 1) {
    sampleIndices.push(N - 1);
  }

  const sampleCoords = sampleIndices.map((idx) => coords[idx]);

  // Fetch sampled elevations
  const sampleElevations = await fetchElevationsAPI(sampleCoords, progressCallback);

  // Map back and linearly interpolate
  const fullElevations = Array(N).fill(0.0);
  sampleIndices.forEach((sampleIdx, k) => {
    fullElevations[sampleIdx] = sampleElevations[k];
  });

  for (let k = 0; k < sampleIndices.length - 1; k++) {
    const startIdx = sampleIndices[k];
    const endIdx = sampleIndices[k + 1];
    const startEle = fullElevations[startIdx];
    const endEle = fullElevations[endIdx];

    const diff = endIdx - startIdx;
    if (diff > 1) {
      for (let i = startIdx + 1; i < endIdx; i++) {
        const fraction = (i - startIdx) / diff;
        fullElevations[i] = startEle + fraction * (endEle - startEle);
      }
    }
  }

  // Write elevations back to trackpoints and recalculate grades
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  trackpoints.forEach((pt, i) => {
    pt.ele = fullElevations[i];

    if (i > 0) {
      const prev = trackpoints[i - 1];
      const segmentDist = pt.dist_m - prev.dist_m;
      const eleDiff = pt.ele - prev.ele;

      if (eleDiff > 0) {
        totalElevationGain += eleDiff;
      } else {
        totalElevationLoss += Math.abs(eleDiff);
      }

      if (segmentDist > 0.1) {
        pt.grade = (eleDiff / segmentDist) * 100;
      } else {
        pt.grade = 0;
      }
    } else {
      pt.grade = 0;
    }
  });

  route.totalElevationGain = totalElevationGain;
  route.totalElevationLoss = totalElevationLoss;

  // Sync waypoint elevations to closest trackpoint elevations
  route.waypoints.forEach((wpt) => {
    if (wpt.closestTrackpointIndex !== undefined) {
      wpt.ele = trackpoints[wpt.closestTrackpointIndex].ele;
    }
  });

  // Recalculate warnings (climb calculations depend on elevations)
  calculateWarnings(route);
}
