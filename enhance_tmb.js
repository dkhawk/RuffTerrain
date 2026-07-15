import fs from "fs";
import path from "path";
import { parseGPX, serializeGPX } from "./src/gpx-parser.js";

const gpxPath = "./samples/TMB-Day-1-Chamonix-to-Contamines-Enhanced.gpx";
const outputPath = "./samples/TMB-Day-1-Chamonix-to-Contamines-Enhanced.gpx";

const gpxText = fs.readFileSync(gpxPath, "utf8");
const route = parseGPX(gpxText, "metric");

console.log(`Parsed route: ${route.name}`);
console.log(`Waypoints found: ${route.waypoints.length}`);

// We will recreate the waypoints with structured fields
const newWaypoints = route.waypoints.map((w, idx) => {
  const name = w.name;
  const desc = w.desc || "";
  const slug = name.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9-]/g, "");

  // Determine subtype and type
  let type = "informational";
  let subtype = "navigation";
  
  if (desc.includes("Food") || desc.includes("Water") || desc.includes("Bathroom")) {
    type = "segmenting";
    subtype = "aid_station";
  } else if (name.toLowerCase().includes("pass") || name.toLowerCase().includes("col")) {
    subtype = "summit";
  } else if (name.toLowerCase().includes("bridge") || desc.toLowerCase().includes("bridge")) {
    subtype = "scenic";
  }

  // Determine services
  const services = {};
  if (desc.includes("Water")) services.water = true;
  if (desc.includes("Food")) services.food = true;
  if (desc.includes("Bathroom")) services.toilets = true;

  // Determine accessibility
  const accessibility = {};
  if (desc.includes("Transit")) {
    accessibility.crew_allowed = true;
    accessibility.pacer_allowed = false;
    accessibility.vehicle_tier = "auto";
    accessibility.drop_bag_allowed = name.toLowerCase().includes("start") || name.toLowerCase().includes("end");
  } else if (type === "segmenting") {
    accessibility.crew_allowed = false;
    accessibility.pacer_allowed = false;
    accessibility.vehicle_tier = "none";
    accessibility.drop_bag_allowed = false;
  }

  // Passes
  const passes = [{
    num: 1,
    dist_m: w.dist_m,
    label: name.includes("Start") ? "Start" : (name.includes("End") ? "End" : "")
  }];

  // Extensions
  const extensions = {
    station: {
      id: slug,
      type,
      subtype,
      passes,
      services,
      accessibility
    }
  };

  // Symbol configuration
  let sym = "icons/services.svg";
  const nameL = name.toLowerCase();
  if (nameL.includes("start")) {
    sym = "icons/start.svg";
  } else if (nameL.includes("finish") || nameL.includes("(end)")) {
    sym = "icons/finish.svg";
  } else if (subtype === "aid_station" || nameL.includes("aid") || nameL.includes("station") || nameL.includes("checkpoint")) {
    sym = "icons/aid_station.svg";
  } else if (subtype === "water_source" || nameL.includes("creek") || nameL.includes("spring") || nameL.includes("water") || nameL.includes("well") || nameL.includes("stream")) {
    sym = "icons/water.svg";
  } else if (subtype === "scenic" || nameL.includes("viewpoint") || nameL.includes("vista") || nameL.includes("lookout")) {
    sym = "icons/scenic.svg";
  } else if (subtype === "campground" || nameL.includes("camp") || nameL.includes("campsite")) {
    sym = "icons/campground.svg";
  } else if (subtype === "refuge" || nameL.includes("refuge") || nameL.includes("rifugio") || nameL.includes("shelter")) {
    sym = "icons/refuge.svg";
  } else if (subtype === "summit" || nameL.includes("pass") || nameL.includes("col") || nameL.includes("summit") || nameL.includes("peak")) {
    sym = "icons/summit.svg";
  }

  // Format description
  const descParts = passes.map((p) => `Pass ${p.num} at ${(p.dist_m / 1000).toFixed(2)}km${p.label ? ` (${p.label})` : ""}`);
  const formattedDesc = descParts.join(" | ");

  return {
    ...w,
    id: slug,
    sym,
    desc: formattedDesc,
    extensions
  };
});

// Sort waypoints by distance
newWaypoints.sort((a, b) => a.dist_m - b.dist_m);

// Update route waypoints
route.waypoints = newWaypoints;

// Output reconciled GPX
const gpxOutput = serializeGPX(route);
fs.writeFileSync(outputPath, gpxOutput, "utf8");
console.log("GPX file successfully enhanced!");
