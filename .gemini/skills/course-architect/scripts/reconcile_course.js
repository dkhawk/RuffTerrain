#!/usr/bin/env node

/**
 * Course Architect Reconciliation CLI
 * 
 * Reconciles a GPX route track with unstructured metadata or instruction files 
 * using the Gemini API, producing a reconciled, snapped, and pass-deduplicated 
 * course layout.
 */

import fs from "fs";
import path from "path";
import { parseGPX, reconcileCourse, serializeGPX } from "../../../../src/gpx-parser.js";
import { sendToGemini } from "../../../../src/gemini-client.js";

const args = process.argv.slice(2);

if (args.length < 3) {
  console.log("Usage: node reconcile_course.js <gpx_path> <metadata_path> <output_path> [--model <model_name>] [--units imperial|metric]");
  process.exit(1);
}

const [gpxPath, metaPath, outputPath] = args;

// Optional parameters
let modelName = "models/gemini-2.5-flash-lite";
let units = "imperial";

for (let i = 3; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) {
    modelName = args[i + 1];
    i++;
  } else if (args[i] === "--units" && args[i + 1]) {
    units = args[i + 1];
    i++;
  }
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Error: GEMINI_API_KEY environment variable is not defined.");
  process.exit(1);
}

(async () => {
  try {
    console.log(`Reading GPX track: ${gpxPath}...`);
    const gpxText = fs.readFileSync(path.resolve(gpxPath), "utf8");
    const route = parseGPX(gpxText, units);
    console.log(`Parsed course "${route.name}" with ${route.trackpoints.length} trackpoints.`);

    console.log(`Reading metadata file: ${metaPath}...`);
    const promptText = fs.readFileSync(path.resolve(metaPath), "utf8");

    console.log(`Reconciling via Gemini using model: ${modelName}...`);
    const geminiResult = await sendToGemini(promptText, route, apiKey, [], modelName);
    
    console.log(`Reconciling waypoints & snapping local minima passes...`);
    reconcileCourse(route, geminiResult, units);

    console.log(`Reconciliation complete. Waypoints generated:`);
    route.waypoints.forEach((w) => {
      const miles = w.dist_m / 1609.344;
      const passes = w.extensions?.station?.passes || [];
      console.log(`- Waypoint: ${w.name} at ${miles.toFixed(2)} mi`);
      passes.forEach((p) => {
        const pmiles = p.dist_m / 1609.344;
        console.log(`  * Pass ${p.num} [${p.label || "Pass"}]: ${pmiles.toFixed(2)} mi`);
      });
    });

    if (outputPath.toLowerCase().endsWith(".gpx")) {
      console.log(`Serializing reconciled route to GPX format...`);
      const gpxOutput = serializeGPX(route);
      console.log(`Writing output GPX to: ${outputPath}...`);
      fs.writeFileSync(path.resolve(outputPath), gpxOutput, "utf8");
    } else {
      const outputPayload = {
        success: true,
        course_name: route.name,
        total_distance_m: route.totalDistance,
        waypoints: route.waypoints.map((w) => ({
          id: w.id,
          name: w.name,
          lat: w.lat,
          lon: w.lon,
          ele: w.ele,
          dist_m: w.dist_m,
          passes: w.extensions?.station?.passes || [],
          services: w.extensions?.station?.services || {},
          subtype: w.extensions?.station?.subtype || "aid_station"
        }))
      };

      console.log(`Writing output JSON to: ${outputPath}...`);
      fs.writeFileSync(path.resolve(outputPath), JSON.stringify(outputPayload, null, 2), "utf8");
    }
    console.log("Success!");
  } catch (err) {
    console.error("Reconciliation CLI failed:", err);
    process.exit(1);
  }
})();
