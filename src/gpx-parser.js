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

/**
 * Calculates the spatial distance between two lat/lon pairs using the Haversine formula.
 * @param {number} lat1 Latitude 1
 * @param {number} lon1 Longitude 1
 * @param {number} lat2 Latitude 2
 * @param {number} lon2 Longitude 2
 * @returns {number} Distance in meters
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Snaps a lat/lng position to the nearest segment of a route's trackpoints.
 */
export function snapToRouteSegments(route, pos, nominalDistM = null) {
  const pts = route.trackpoints;
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) {
    return {
      lat: pts[0].lat,
      lon: pts[0].lon,
      ele: pts[0].ele,
      dist_m: pts[0].dist_m,
      closestTrackpointIndex: 0
    };
  }

  const search = (windowLimit) => {
    let minSqDist = Infinity;
    let result = null;
    const latToMeters = 111320;

    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i];
      const B = pts[i + 1];

      if (windowLimit !== null && nominalDistM !== null) {
        const avgDist = (A.dist_m + B.dist_m) / 2;
        if (Math.abs(avgDist - nominalDistM) > windowLimit) {
          continue;
        }
      }

      const cosLat = Math.cos((A.lat + B.lat) * Math.PI / 360);
      const ax = A.lon * cosLat;
      const ay = A.lat;
      const bx = B.lon * cosLat;
      const by = B.lat;
      const px = pos.lng * cosLat;
      const py = pos.lat;

      const vx = bx - ax;
      const vy = by - ay;
      const wx = px - ax;
      const wy = py - ay;

      const lensq = vx * vx + vy * vy;
      let t = 0;
      if (lensq > 0) {
        t = (wx * vx + wy * vy) / lensq;
        t = Math.max(0, Math.min(1, t));
      }

      const cx = ax + t * vx;
      const cy = ay + t * vy;

      const projLon = cx / cosLat;
      const projLat = cy;

      const dx = (px - cx) * latToMeters;
      const dy = (py - cy) * latToMeters;
      const sqDist = dx * dx + dy * dy;

      if (sqDist < minSqDist) {
        minSqDist = sqDist;
        result = {
          lat: projLat,
          lon: projLon,
          ele: A.ele + t * (B.ele - A.ele),
          dist_m: A.dist_m + t * (B.dist_m - A.dist_m),
          closestTrackpointIndex: i
        };
      }
    }
    return result;
  };

  let snapped = null;
  if (nominalDistM !== null) {
    snapped = search(3000); // Try ±3km window first to preserve correct pass (outbound vs inbound)
  }
  if (!snapped) {
    snapped = search(null); // Fallback to full course search
  }
  return snapped;
}

/**
 * Re-calculates indices, cumulative distances, elevations and snap links on course modifications.
 */
export function recalculateRouteMetrics(route) {
  const pts = route.trackpoints;
  if (!pts || pts.length === 0) return;

  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    pt.index = i;
    
    let grade = 0;
    if (i > 0) {
      const prev = pts[i - 1];
      const segmentDist = haversine(prev.lat, prev.lon, pt.lat, pt.lon);
      totalDistance += segmentDist;

      const eleDiff = pt.ele - prev.ele;
      if (eleDiff > 0) {
        totalElevationGain += eleDiff;
      } else {
        totalElevationLoss += Math.abs(eleDiff);
      }

      let j = i - 1;
      while (j > 0 && totalDistance - pts[j].dist_m < 30) {
        j--;
      }
      const basePt = pts[j];
      if (basePt) {
        const runDist = totalDistance - basePt.dist_m;
        const riseEle = pt.ele - basePt.ele;
        if (runDist > 5) {
          grade = (riseEle / runDist) * 100;
        }
      }
    }

    pt.dist_m = totalDistance;
    pt.grade = grade;
  }

  route.totalDistance = totalDistance;
  route.totalElevationGain = totalElevationGain;
  route.totalElevationLoss = totalElevationLoss;
  route.avgSpacing = pts.length > 0 ? (totalDistance / pts.length) : 0;

  // Re-snap waypoints
  route.waypoints.forEach((wpt) => {
    const snapped = snapToRouteSegments(route, { lat: wpt.lat, lng: wpt.lon });
    if (snapped) {
      wpt.ele = snapped.ele;
      wpt.dist_m = snapped.dist_m;
      wpt.closestTrackpointIndex = snapped.closestTrackpointIndex;
    }
  });

  route.waypoints.sort((a, b) => a.dist_m - b.dist_m);
}


/**
 * Parses GPX XML content into a structured route object.
 * @param {string} gpxText Raw GPX XML string
 * @returns {Object} Structured route data
 */
export function parseGPX(gpxText, units = "imperial") {
  // Regex parsing for name, desc
  const nameMatch = gpxText.match(/<name>([\s\S]*?)<\/name>/);
  const routeName = nameMatch ? nameMatch[1].trim() : "Imported Route";
  
  const descMatch = gpxText.match(/<desc>([\s\S]*?)<\/desc>/);
  const routeDesc = descMatch ? descMatch[1].trim() : "No description provided.";
  
  const rawPts = [];
  const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"(?:\s*\/|>([\s\S]*?)<\/trkpt>)/g;
  let idx = 0;
  let match;
  while ((match = trkptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3] || "";
    
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
    
    const timeMatch = inner.match(/<time>([^<]+)<\/time>/);
    const time = timeMatch ? timeMatch[1] : null;

    rawPts.push({
      index: idx,
      lat,
      lon,
      ele,
      time,
    });
    idx++;
  }

  // Fallback: If no trackpoints (<trkpt>) are found, parse routepoints (<rtept>)
  if (rawPts.length === 0) {
    const rteptRegex = /<rtept\s+lat="([^"]+)"\s+lon="([^"]+)"(?:\s*\/|>([\s\S]*?)<\/rtept>)/g;
    idx = 0;
    while ((match = rteptRegex.exec(gpxText)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      const inner = match[3] || "";
      
      const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
      const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
      
      const timeMatch = inner.match(/<time>([^<]+)<\/time>/);
      const time = timeMatch ? timeMatch[1] : null;

      rawPts.push({
        index: idx,
        lat,
        lon,
        ele,
        time,
      });
      idx++;
    }
  }

  // Apply an 11-point moving average elevation smoothing pass (5 points on each side)
  if (rawPts.length >= 3) {
    const temp = rawPts.map(p => p.ele);
    const windowSize = 5;
    for (let k = 0; k < rawPts.length; k++) {
      let sum = 0;
      let count = 0;
      const start = Math.max(0, k - windowSize);
      const end = Math.min(rawPts.length - 1, k + windowSize);
      for (let j = start; j <= end; j++) {
        sum += temp[j];
        count++;
      }
      rawPts[k].ele = sum / count;
    }
  }

  const trackpoints = [];
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  for (let i = 0; i < rawPts.length; i++) {
    const pt = rawPts[i];
    let segmentDist = 0;
    let grade = 0;

    if (i > 0) {
      const prev = rawPts[i - 1];
      segmentDist = haversine(prev.lat, prev.lon, pt.lat, pt.lon);
      totalDistance += segmentDist;

      const eleDiff = pt.ele - prev.ele;
      if (eleDiff > 0) {
        totalElevationGain += eleDiff;
      } else {
        totalElevationLoss += Math.abs(eleDiff);
      }

      // Calculate a stable slope grade over a 30-meter baseline to filter out GPS noise
      let j = i - 1;
      while (j > 0 && totalDistance - trackpoints[j].dist_m < 30) {
        j--;
      }
      const basePt = trackpoints[j];
      if (basePt) {
        const runDist = totalDistance - basePt.dist_m;
        const riseEle = pt.ele - basePt.ele;
        if (runDist > 5) {
          grade = (riseEle / runDist) * 100;
        }
      }
    }

    trackpoints.push({
      index: i,
      lat: pt.lat,
      lon: pt.lon,
      ele: pt.ele,
      dist_m: totalDistance,
      grade,
      time: pt.time,
    });
  }

  // Waypoints
  const waypoints = [];
  const wptRegex = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"(?:\s*\/|>([\s\S]*?)<\/wpt>)/g;
  let wptIdx = 0;
  while ((match = wptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3] || "";
    
    const nMatch = inner.match(/<name>([^<]*)<\/name>/);
    const name = nMatch ? nMatch[1].trim() : `Waypoint ${wptIdx + 1}`;
    
    const eMatch = inner.match(/<ele>([^<]*)<\/ele>/);
    const ele = eMatch ? parseFloat(eMatch[1]) : 0;
    
    const sMatch = inner.match(/<sym>([^<]*)<\/sym>/);
    const sym = sMatch ? sMatch[1].trim() : "icons/services.svg";
    
    const dMatch = inner.match(/<desc>([^<]*)<\/desc>/);
    const desc = dMatch ? dMatch[1].trim() : "";

    let customExtension = null;
    const stationMatch = inner.match(/<(?:ca:)?station([^>]*)>([\s\S]*?)<\/(?:ca:)?station>/);
    if (stationMatch) {
      const attrs = stationMatch[1];
      const stationInner = stationMatch[2];
      
      const typeMatch = attrs.match(/type="([^"]+)"/);
      const idMatch = attrs.match(/id="([^"]+)"/);
      const subtypeMatch = attrs.match(/subtype="([^"]+)"/);
      
      const type = typeMatch ? typeMatch[1] : null;
      const id = idMatch ? idMatch[1] : `station-${wptIdx}`;
      const subtype = subtypeMatch ? subtypeMatch[1] : null;

      const passes = [];
      const passRegex = /<(?:ca:)?pass([^>]*)\/?>/g;
      let pMatch;
      while ((pMatch = passRegex.exec(stationInner)) !== null) {
        const pAttrs = pMatch[1];
        const numM = pAttrs.match(/num="([^"]+)"/);
        const distM = pAttrs.match(/dist_m="([^"]+)"/);
        const labelM = pAttrs.match(/label="([^"]+)"/);
        const cutoffClockM = pAttrs.match(/cutoff_clock="([^"]+)"/);
        const cutoffElapsedM = pAttrs.match(/cutoff_elapsed="([^"]+)"/);
        
        passes.push({
          num: parseInt(numM ? numM[1] : "1"),
          dist_m: parseFloat(distM ? distM[1] : "0"),
          label: labelM ? labelM[1] : "",
          cutoff_clock: cutoffClockM ? cutoffClockM[1] : "",
          cutoff_elapsed: cutoffElapsedM ? cutoffElapsedM[1] : ""
        });
      }

      let accessibility = {};
      const accessMatch = stationInner.match(/<(?:ca:)?accessibility([^>]*)\/?>/);
      if (accessMatch) {
        const aAttrs = accessMatch[1];
        accessibility = {
          crew_allowed: /crew_allowed="true"/.test(aAttrs),
          pacer_allowed: /pacer_allowed="true"/.test(aAttrs),
          vehicle_tier: (aAttrs.match(/vehicle_tier="([^"]+)"/) || [])[1] || "none",
          drop_bag_allowed: /drop_bag_allowed="true"/.test(aAttrs)
        };
      }

      let services = {};
      const servMatch = stationInner.match(/<(?:ca:)?services([^>]*)\/?>/);
      if (servMatch) {
        const sAttrs = servMatch[1];
        services = {
          water: /water="true"/.test(sAttrs),
          unmanaged_water: /unmanaged_water="true"/.test(sAttrs),
          food: /food="true"/.test(sAttrs),
          hot_food: /hot_food="true"/.test(sAttrs),
          toilets: /toilets="true"/.test(sAttrs),
          medical: /medical="true"/.test(sAttrs),
          sleep_area: /sleep_area="true"/.test(sAttrs)
        };
      }

      let navigation_alert = null;
      const navMatch = stationInner.match(/<(?:ca:)?navigation_alert([^>]*)\/?>/);
      if (navMatch) {
        const nAttrs = navMatch[1];
        navigation_alert = {
          severity: (nAttrs.match(/severity="([^"]+)"/) || [])[1] || "info",
          turn_type: (nAttrs.match(/turn_type="([^"]+)"/) || [])[1] || "straight",
          prompt: (nAttrs.match(/prompt="([^"]+)"/) || [])[1] || ""
        };
      }

      customExtension = {
        station: {
          id, type, subtype, passes, accessibility, services, navigation_alert
        }
      };
    }

    let closestIdx = 0;
    let minSpatialDist = Infinity;
    const nameLower = name.toLowerCase();
    const symLower = sym.toLowerCase();
    const isFinish = nameLower.includes("finish") || nameLower.includes("end") || symLower.includes("finish") || symLower.includes("end");
    const startIndex = isFinish ? Math.floor(trackpoints.length / 2) : 0;

    for (let idx = startIndex; idx < trackpoints.length; idx++) {
      const trk = trackpoints[idx];
      const dist = haversine(lat, lon, trk.lat, trk.lon);
      if (dist < minSpatialDist) {
        minSpatialDist = dist;
        closestIdx = idx;
      }
    }

    waypoints.push({
      id: customExtension?.station?.id || `wpt-${wptIdx}`,
      name,
      lat,
      lon,
      ele,
      sym,
      desc,
      closestTrackpointIndex: closestIdx,
      dist_m: trackpoints[closestIdx]?.dist_m || 0,
      extensions: customExtension
    });
    wptIdx++;
  }

  const parsedRoute = {
    name: routeName,
    description: routeDesc,
    trackpoints,
    waypoints,
    totalDistance,
    totalElevationGain,
    totalElevationLoss,
    warnings: [],
  };

  calculateWarnings(parsedRoute, [], units);
  return parsedRoute;
}

/**
 * Parses KML content into a structured route object matching the GPX schema.
 * @param {string} kmlText Raw KML XML string
 * @param {string} units Measurement units ("imperial" or "metric")
 * @returns {Object} Structured route data
 */
export function parseKML(kmlText, units = "imperial") {
  // Extract Document name
  const docNameMatch = kmlText.match(/<Document>[\s\S]*?<name>([^<]+)<\/name>/);
  const routeName = docNameMatch ? docNameMatch[1].trim() : "Imported KML Route";

  const descMatch = kmlText.match(/<Document>[\s\S]*?<description>([^<]+)<\/description>/);
  const routeDesc = descMatch ? descMatch[1].trim() : "No description provided.";

  const coordsMatch = kmlText.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
  if (!coordsMatch) {
    throw new Error("No coordinates/path coordinates found in KML file.");
  }
  
  const coordsStr = coordsMatch[1].trim();
  const rawPts = [];
  const coordTokens = coordsStr.split(/\s+/);
  let idx = 0;
  for (const token of coordTokens) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const ele = parts[2] ? parseFloat(parts[2]) : 0;
      rawPts.push({
        index: idx++,
        lat,
        lon,
        ele,
        time: null
      });
    }
  }

  // Waypoints (Placemarks with Point coordinates, ignoring LineString tracks)
  const waypoints = [];
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match;
  let wptIdx = 0;
  while ((match = placemarkRegex.exec(kmlText)) !== null) {
    const inner = match[1];
    if (inner.includes("<LineString>")) continue;

    const ptMatch = inner.match(/<Point>([\s\S]*?)<\/Point>/);
    if (!ptMatch) continue;

    const coordMatch = ptMatch[1].match(/<coordinates>([^<]+)<\/coordinates>/);
    if (!coordMatch) continue;

    const parts = coordMatch[1].trim().split(",");
    if (parts.length < 2) continue;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    const ele = parts[2] ? parseFloat(parts[2]) : 0;

    const nameMatch = inner.match(/<name>([^<]+)<\/name>/);
    const name = nameMatch ? nameMatch[1].trim() : `Waypoint ${wptIdx + 1}`;

    const descMatch = inner.match(/<description>([^<]+)<\/description>/);
    const desc = descMatch ? descMatch[1].trim() : "";

    waypoints.push({
      id: `kml-wpt-${wptIdx}`,
      name,
      lat,
      lon,
      ele,
      sym: "icons/services.svg",
      desc,
      dist_m: 0,
      closestTrackpointIndex: 0,
      extensions: {}
    });
    wptIdx++;
  }

  // Calculate cumulative distances & smooth elevations
  const trackpoints = [];
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  // Apply 11-point moving average elevation smoothing
  if (rawPts.length >= 3) {
    const temp = rawPts.map(p => p.ele);
    const windowSize = 5;
    for (let k = 0; k < rawPts.length; k++) {
      const start = Math.max(0, k - windowSize);
      const end = Math.min(rawPts.length - 1, k + windowSize);
      let sum = 0;
      for (let j = start; j <= end; j++) {
        sum += temp[j];
      }
      rawPts[k].ele = sum / (end - start + 1);
    }
  }

  for (let i = 0; i < rawPts.length; i++) {
    const pt = rawPts[i];
    let segmentDist = 0;
    let grade = 0;

    if (i > 0) {
      const prev = rawPts[i - 1];
      segmentDist = haversine(prev.lat, prev.lon, pt.lat, pt.lon);
      totalDistance += segmentDist;

      const dEle = pt.ele - prev.ele;
      if (dEle > 0) {
        totalElevationGain += dEle;
      } else {
        totalElevationLoss += Math.abs(dEle);
      }
      if (segmentDist > 0) {
        grade = (dEle / segmentDist) * 100;
      }
    }

    trackpoints.push({
      index: pt.index,
      lat: pt.lat,
      lon: pt.lon,
      ele: pt.ele,
      dist_m: totalDistance,
      grade,
      time: pt.time
    });
  }

  // Snap waypoints to closest trackpoints
  waypoints.forEach((wpt) => {
    let minDiff = Infinity;
    let closestIdx = 0;
    for (let idx = 0; idx < trackpoints.length; idx++) {
      const pt = trackpoints[idx];
      const dist = haversine(wpt.lat, wpt.lon, pt.lat, pt.lon);
      if (dist < minDiff) {
        minDiff = dist;
        closestIdx = idx;
      }
    }
    wpt.closestTrackpointIndex = closestIdx;
    wpt.dist_m = trackpoints[closestIdx]?.dist_m || 0;
  });

  const parsedRoute = {
    name: routeName,
    description: routeDesc,
    trackpoints,
    waypoints,
    totalDistance,
    totalElevationGain,
    totalElevationLoss,
    warnings: []
  };

  calculateWarnings(parsedRoute, [], units);
  return parsedRoute;
}

/**
 * Calculates safety warnings (Resource Deserts, Difficult Climbs, Exposure Risk) for a parsed route.
 * Modifies the route object directly by populating `route.warnings`.
 * @param {Object} route The parsed route object
 */
export function calculateWarnings(route, extraWarnings = [], units = "imperial") {
  const isImperial = units === "imperial";
  const distMultiplier = isImperial ? 1 / 1609.344 : 1 / 1000;
  const distName = isImperial ? "miles" : "km";
  const elevMultiplier = isImperial ? 3.28084 : 1;
  const elevName = isImperial ? "ft" : "m";

  const warnings = [...extraWarnings];
  const trackpoints = route.trackpoints;
  if (!trackpoints || trackpoints.length === 0) return;

  // 1. RESOURCE DESERTS
  // Define water/food resources. We filter waypoints that have water or food services, or are classified as aid/water.
  const resourceWaypoints = route.waypoints
    .filter((wpt) => {
      const isWaterSym = wpt.sym.includes("water") || wpt.name.toLowerCase().includes("water") || wpt.name.toLowerCase().includes("spring") || wpt.name.toLowerCase().includes("creek");
      const isAidSym = wpt.sym.includes("aid") || wpt.name.toLowerCase().includes("aid") || wpt.name.toLowerCase().includes("station") || wpt.name.toLowerCase().includes("checkpoint");
      
      const hasWater = wpt.extensions?.station?.services?.water || wpt.extensions?.station?.services?.unmanaged_water;
      const hasFood = wpt.extensions?.station?.services?.food;
      
      return isWaterSym || isAidSym || hasWater || hasFood;
    })
    .sort((a, b) => a.dist_m - b.dist_m);

  // Gaps threshold: 5 miles (~8,046 meters)
  const DESERT_THRESHOLD_M = 8046.72;

  // Check start of route to first resource
  if (resourceWaypoints.length > 0) {
    const firstDist = resourceWaypoints[0].dist_m;
    if (firstDist > DESERT_THRESHOLD_M) {
      warnings.push({
        id: "desert-start",
        type: "RESOURCE_DESERT",
        message: `Resource Desert: No water/food for first ${(firstDist * distMultiplier).toFixed(1)} ${distName} of course.`,
        startDist: 0,
        endDist: firstDist,
        approved: true,
      });
    }
  } else {
    // No resources at all!
    warnings.push({
      id: "desert-full",
      type: "RESOURCE_DESERT",
      message: `Resource Desert: No water or aid stations configured on this ${(route.totalDistance * distMultiplier).toFixed(1)} ${distName} route!`,
      startDist: 0,
      endDist: route.totalDistance,
      approved: true,
    });
  }

  // Check gaps between resources
  for (let i = 0; i < resourceWaypoints.length - 1; i++) {
    const startWpt = resourceWaypoints[i];
    const endWpt = resourceWaypoints[i + 1];
    const gap = endWpt.dist_m - startWpt.dist_m;

    if (gap > DESERT_THRESHOLD_M) {
      warnings.push({
        id: `desert-gap-${i}`,
        type: "RESOURCE_DESERT",
        message: `Resource Desert: ${(gap * distMultiplier).toFixed(1)} ${distName} between "${startWpt.name}" and "${endWpt.name}".`,
        startDist: startWpt.dist_m,
        endDist: endWpt.dist_m,
        approved: true,
      });
    }
  }

  // Check from last resource to finish
  if (resourceWaypoints.length > 0) {
    const lastDist = resourceWaypoints[resourceWaypoints.length - 1].dist_m;
    const finalGap = route.totalDistance - lastDist;
    if (finalGap > DESERT_THRESHOLD_M) {
      warnings.push({
        id: "desert-end",
        type: "RESOURCE_DESERT",
        message: `Resource Desert: No water/food for final ${(finalGap * distMultiplier).toFixed(1)} ${distName} to finish.`,
        startDist: lastDist,
        endDist: route.totalDistance,
        approved: true,
      });
    }
  }

  // 2. DIFFICULT CLIMBS
  // A climb is difficult if it has a high difficulty score based on elevation gain and grade.
  let inClimb = false;
  let climbStartIdx = -1;
  let maxEle = -Infinity;
  let maxEleIdx = -1;
  let lastPositiveGradeDist = 0;

  for (let i = 0; i < trackpoints.length; i++) {
    const tp = trackpoints[i];
    const grade = tp.grade;

    if (!inClimb) {
      if (grade > 3.5) {
        inClimb = true;
        climbStartIdx = i;
        maxEle = tp.ele;
        maxEleIdx = i;
        lastPositiveGradeDist = tp.dist_m;
      }
    } else {
      // Update max elevation seen
      if (tp.ele > maxEle) {
        maxEle = tp.ele;
        maxEleIdx = i;
      }

      if (grade > 3.5) {
        lastPositiveGradeDist = tp.dist_m;
      }

      // Check termination conditions:
      // 1. Descended more than 20 meters from max elevation seen on this climb.
      // 2. Traveled more than 200 meters since the last time the grade was > 3.5%.
      const descendedTooMuch = tp.ele < maxEle - 20;
      const flatTooLong = tp.dist_m - lastPositiveGradeDist > 200;

      if (descendedTooMuch || flatTooLong || i === trackpoints.length - 1) {
        // We terminate the climb at the peak (maxEleIdx) or current point
        const endIdx = descendedTooMuch || flatTooLong ? maxEleIdx : i;
        const startPt = trackpoints[climbStartIdx];
        const endPt = trackpoints[endIdx];
        const climbDist = endPt.dist_m - startPt.dist_m;
        const climbGain = endPt.ele - startPt.ele;

        // Ensure the climb is at least a quarter mile (400 meters) and has positive gain
        if (climbDist >= 400 && climbGain > 0) {
          const avgGrade = (climbGain / climbDist) * 100;
          
          // Difficulty Score = Elevation Gain (m) * Average Grade (%)
          const score = Math.round(climbGain * avgGrade);

          // We warn about climbs with difficulty score >= 100
          if (score >= 100) {
            const startDist = (startPt.dist_m * distMultiplier).toFixed(1);
            const endDist = (endPt.dist_m * distMultiplier).toFixed(1);
            
            // Format nice message with difficulty category
            let difficultyLabel = "Moderate";
            if (score > 1500) difficultyLabel = "Extreme";
            else if (score > 600) difficultyLabel = "Severe";
            else if (score > 250) difficultyLabel = "Difficult";

            warnings.push({
              id: `climb-${climbStartIdx}`,
              type: "DIFFICULT_CLIMB",
              message: `Difficult Climb (${difficultyLabel}, Score: ${score}): Climb from ${startDist} to ${endDist} ${distName} (+${Math.round(climbGain * elevMultiplier)}${elevName} gain, avg grade: ${avgGrade.toFixed(1)}%).`,
              startDist: startPt.dist_m,
              endDist: endPt.dist_m,
              climbScore: score,
              approved: true,
            });
          }
        }

        // Reset climb tracking
        inClimb = false;
        climbStartIdx = -1;
        maxEle = -Infinity;
        maxEleIdx = -1;
        
        // Retrospectively backtrack the loop if we terminated early due to descent,
        // so we don't skip the start of a new climb starting right after the peak.
        if (descendedTooMuch || flatTooLong) {
          i = endIdx; // loop will increment this to endIdx + 1
        }
      }
    }
  }



  route.warnings = warnings;
}

/**
 * Snaps nominal distances to actual GPX trackpoint indices.
 * @param {Array} cumulativeDistances Cumulative distance list in meters
 * @param {number} targetDist Target nominal distance in meters
 * @returns {number} Closest trackpoint index
 */
function findClosestIndex(cumulativeDistances, targetDist) {
  let minDiff = Infinity;
  let closestIdx = 0;
  for (let idx = 0; idx < cumulativeDistances.length; idx++) {
    const diff = Math.abs(cumulativeDistances[idx] - targetDist);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = idx;
    }
  }
  return closestIdx;
}

/**
 * Snaps turnarounds to the midpoint of the course (furthest point/turnaround).
 * @param {Array} cumulativeDistances Cumulative distance list in meters
 * @returns {number} Turnaround index
 */
function findTurnaroundPoint(cumulativeDistances) {
  const totalDist = cumulativeDistances[cumulativeDistances.length - 1];
  const targetDist = totalDist / 2.0;
  return findClosestIndex(cumulativeDistances, targetDist);
}

/**
 * Port of Python's multi-pass intersection snapping.
 * Finds a trackpoint near the first pass that minimizes the spatial distance
 * to the trackpoints in the neighborhoods of the other passes.
 */
function findMultiPassIntersection(trackpoints, cumulativeDistances, passNominalDistancesM, scaleFactor, maxDeviationM = 1500) {
  if (!passNominalDistancesM || passNominalDistancesM.length < 2) {
    return 0;
  }

  const N = trackpoints.length;
  const scaledDistances = passNominalDistancesM.map((d) => d * scaleFactor);

  // Initial estimate for first pass
  const I1 = findClosestIndex(cumulativeDistances, scaledDistances[0]);

  // Determine spatial search boundaries for first pass
  let startSearch = 0;
  let endSearch = N - 1;
  for (let i = 0; i < N; i++) {
    if (cumulativeDistances[i] >= scaledDistances[0] - maxDeviationM) {
      startSearch = i;
      break;
    }
  }
  for (let i = N - 1; i >= 0; i--) {
    if (cumulativeDistances[i] <= scaledDistances[0] + maxDeviationM) {
      endSearch = i;
      break;
    }
  }

  let bestIdx = I1;
  let minTotalScore = Infinity;

  // Set up search ranges for subsequent passes
  const otherRanges = [];
  for (let k = 1; k < scaledDistances.length; k++) {
    const d = scaledDistances[k];
    let oStart = 0;
    let oEnd = N - 1;
    for (let i = 0; i < N; i++) {
      if (cumulativeDistances[i] >= d - maxDeviationM) {
        oStart = i;
        break;
      }
    }
    for (let i = N - 1; i >= 0; i--) {
      if (cumulativeDistances[i] <= d + maxDeviationM) {
        oEnd = i;
        break;
      }
    }
    otherRanges.push({ start: oStart, end: oEnd });
  }

  // Optimize search
  for (let cIdx = startSearch; cIdx <= endSearch; cIdx++) {
    const cPt = trackpoints[cIdx];
    let totalScore = 0.0;

    for (let rIdx = 0; rIdx < otherRanges.length; rIdx++) {
      const range = otherRanges[rIdx];
      let minODist = Infinity;

      for (let j = range.start; j <= range.end; j++) {
        const oPt = trackpoints[j];
        const dist = haversine(cPt.lat, cPt.lon, oPt.lat, oPt.lon);
        if (dist < minODist) {
          minODist = dist;
        }
      }
      totalScore += minODist;
    }

    if (totalScore < minTotalScore) {
      minTotalScore = totalScore;
      bestIdx = cIdx;
    }
  }

  return bestIdx;
}

/**
 * Reconciles the route object by snapping new stations payload (from LLM) onto the trackpoints.
 * Modifies route.waypoints in place.
 * @param {Object} route The in-memory route object
 * @param {Object} extractionPayload JSON containing parsed stations list
 * @param {number} nominalDistanceM Optional nominal distance of course in meters
 */
export function reconcileCourse(route, extractionPayload, units = "imperial", nominalDistanceM = null) {
  const trackpoints = route.trackpoints;
  const cumulativeDistances = trackpoints.map((t) => t.dist_m);
  const actualDistanceM = route.totalDistance;

  let scaleFactor = 1.0;
  if (nominalDistanceM) {
    scaleFactor = actualDistanceM / nominalDistanceM;
  }

  const stations = extractionPayload.stations || [];
  const updatedWaypoints = [...route.waypoints];
  const spatialWarnings = [];

  stations.forEach((station) => {
    const stationId = station.id;
    const name = station.name;
    const type = station.type;
    const subtype = station.subtype;
    let passes = station.passes || [];

    // Deduplicate passes that are at the same distance and have the same pass number
    const uniquePasses = [];
    passes.forEach((p) => {
      const duplicate = uniquePasses.find(
        (up) => up.num === p.num && Math.abs(up.dist_m - p.dist_m) < 10
      );
      if (!duplicate) {
        uniquePasses.push(p);
      } else {
        if (!duplicate.label && p.label) duplicate.label = p.label;
        if (!duplicate.cutoff_clock && p.cutoff_clock) duplicate.cutoff_clock = p.cutoff_clock;
        if (!duplicate.cutoff_elapsed && p.cutoff_elapsed) duplicate.cutoff_elapsed = p.cutoff_elapsed;
      }
    });
    passes = uniquePasses;

    if (passes.length === 0) return;

    let closestIdx = 0;
    let lat = 0;
    let lon = 0;
    let useExactOverride = false;

    const override = station.coordinate_override;
    if (override) {
      const overrideLat = parseFloat(override.lat);
      const overrideLon = parseFloat(override.lon);

      // Automatic Multi-Pass Detection along the trackpoints
      const distances = trackpoints.map(pt => haversine(overrideLat, overrideLon, pt.lat, pt.lon));
      const detectedPasses = [];
      const thresholdM = 200;

      for (let i = 1; i < distances.length - 1; i++) {
        const prev = distances[i - 1];
        const curr = distances[i];
        const next = distances[i + 1];

        if (curr < prev && curr < next && curr < thresholdM) {
          detectedPasses.push({
            idx: i,
            dist_m: trackpoints[i].dist_m,
            spatial_dist: curr
          });
        }
      }

      // Collapse duplicate/adjacent passes within 2000m
      const mergedPasses = [];
      detectedPasses.forEach(p => {
        if (mergedPasses.length === 0) {
          mergedPasses.push(p);
        } else {
          const last = mergedPasses[mergedPasses.length - 1];
          if (p.dist_m - last.dist_m < 2000) {
            if (p.spatial_dist < last.spatial_dist) {
              mergedPasses[mergedPasses.length - 1] = p;
            }
          } else {
            mergedPasses.push(p);
          }
        }
      });

      // Update passes array using the detected passes
      if (mergedPasses.length > 0) {
        passes = mergedPasses.map((mp, index) => {
          const originalPass = station.passes?.[index];
          return {
            num: index + 1,
            dist_m: mp.dist_m,
            label: originalPass?.label || (mergedPasses.length > 1 ? (index === 0 ? "Outbound" : "Inbound") : ""),
            cutoff_clock: originalPass?.cutoff_clock || null,
            cutoff_elapsed: originalPass?.cutoff_elapsed || null
          };
        });
        
        closestIdx = mergedPasses[0].idx;
      } else {
        // Fallback to absolute closest if no local minimum under 200m was found
        let minSpatialDist = Infinity;
        trackpoints.forEach((pt, idx) => {
          const dist = haversine(overrideLat, overrideLon, pt.lat, pt.lon);
          if (dist < minSpatialDist) {
            minSpatialDist = dist;
            closestIdx = idx;
          }
        });
      }

      // Calculate spatial mismatch warning using the final selected closestIdx
      const finalSpatialDist = haversine(overrideLat, overrideLon, trackpoints[closestIdx].lat, trackpoints[closestIdx].lon);

      lat = overrideLat;
      lon = overrideLon;
      useExactOverride = true;

      if (finalSpatialDist > 2000) {
        const distName = units === "imperial" ? "miles" : "km";
        const distVal = units === "imperial" ? finalSpatialDist / 1609.344 : finalSpatialDist / 1000;
        spatialWarnings.push({
          id: `spatial-mismatch-${stationId}`,
          type: "SPATIAL_MISMATCH",
          message: `Spatial Mismatch: Station "${name}" coordinate override is ${distVal.toFixed(1)} ${distName} from the nearest trackpoint.`,
          startDist: trackpoints[closestIdx].dist_m,
          endDist: trackpoints[closestIdx].dist_m,
          approved: true,
        });
      }
    } else {
      // Heuristic: check if turnaround
      let isTurnaround = false;
      passes.forEach((p) => {
        const label = (p.label || "").toLowerCase();
        if (label.includes("turnaround") || label.includes("turn-around")) {
          isTurnaround = true;
        }
      });

      if (isTurnaround) {
        closestIdx = findTurnaroundPoint(cumulativeDistances);
      } else if (passes.length > 1) {
        const passNominalDistancesM = passes.map((p) => p.dist_m);
        closestIdx = findMultiPassIntersection(
          trackpoints,
          cumulativeDistances,
          passNominalDistancesM,
          scaleFactor
        );
      } else {
        const firstPass = passes[0];
        const nominalPassDistM = firstPass.dist_m;
        const snappedPassDistM = nominalPassDistM * scaleFactor;
        closestIdx = findClosestIndex(cumulativeDistances, snappedPassDistM);
      }

      const targetPt = trackpoints[closestIdx];
      lat = targetPt.lat;
      lon = targetPt.lon;
    }

    const targetPt = trackpoints[closestIdx];
    const ele = targetPt.ele;

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

    // Build description
    const descParts = passes.map((p) => `Pass ${p.num} at ${(p.dist_m / 1000).toFixed(2)}km (${p.label || ""})`);
    const desc = descParts.join(" | ");

    // Build standard extension dictionary format
    const customExtension = {
      station: {
        id: stationId,
        type,
        subtype,
        passes,
        accessibility: station.accessibility || {},
        services: station.services || {},
        navigation_alert: station.navigation_alert || null,
      },
    };

    // Remove old waypoint with same ID if exists to prevent duplicate addition
    const existingIndex = updatedWaypoints.findIndex((w) => w.id === stationId);
    const newWaypoint = {
      id: stationId,
      name,
      lat,
      lon,
      ele,
      sym,
      desc,
      dist_m: targetPt.dist_m,
      closestTrackpointIndex: closestIdx,
      extensions: customExtension,
    };

    if (existingIndex !== -1) {
      updatedWaypoints[existingIndex] = newWaypoint;
    } else {
      updatedWaypoints.push(newWaypoint);
    }
  });

  route.waypoints = updatedWaypoints;
  
  // Ensure every waypoint has a corresponding trackpoint detour
  route.waypoints.forEach((wpt) => {
    const pts = route.trackpoints;
    const matchIdx = pts.findIndex(
      (pt) => Math.abs(pt.lat - wpt.lat) < 0.000001 && Math.abs(pt.lon - wpt.lon) < 0.000001
    );
    if (matchIdx === -1) {
      // No trackpoint exists at the waypoint's exact coordinates.
      // Find the closest segment and insert a detour
      const snapped = snapToRouteSegments(route, { lat: wpt.lat, lng: wpt.lon }, wpt.dist_m);
      if (snapped) {
        const insertIdx = snapped.closestTrackpointIndex;
        const newTrackPt = {
          lat: wpt.lat,
          lon: wpt.lon,
          ele: snapped.ele,
          dist_m: snapped.dist_m,
          time: pts[insertIdx]?.time || null,
        };
        if (insertIdx === 0 && snapped.dist_m === 0) {
          pts.unshift(newTrackPt);
        } else if (insertIdx === pts.length - 2 && Math.abs(snapped.dist_m - pts[pts.length - 1].dist_m) < 0.1) {
          pts.push(newTrackPt);
        } else {
          pts.splice(insertIdx + 1, 0, newTrackPt);
        }
      }
    }
  });

  // Recalculate route metrics (gains, distances, grades) after modifying trackpoints
  recalculateRouteMetrics(route);
  
  // Recalculate warnings because adding resources resolves resource deserts
  calculateWarnings(route, spatialWarnings, units);
}

/**
 * Calculates metrics from a specific trackpoint index to the next aid station and active climb.
 * @param {Object} route The route object
 * @param {number} currentIdx Current trackpoint index
 * @returns {Object} Metric data
 */
export function getMetricsForPoint(route, currentIdx) {
  const pts = route.trackpoints;
  if (!pts || pts.length === 0 || currentIdx < 0 || currentIdx >= pts.length) {
    return { nextAid: null, activeClimb: null };
  }

  const currentPt = pts[currentIdx];
  const currentDist = currentPt.dist_m;

  // 1. Find Next Aid Station / POI
  // We sort waypoints by distance and find the first one past currentDist that is an aid station or segmenting POI
  const nextAidWpt = route.waypoints
    .filter(w => w.dist_m > currentDist + 1 && (w.extensions?.station?.type === "segmenting" || w.sym.includes("aid_station")))
    .sort((a, b) => a.dist_m - b.dist_m)[0];

  let nextAid = null;
  if (nextAidWpt) {
    const endIdx = nextAidWpt.closestTrackpointIndex;
    
    // Calculate gain/loss between currentIdx and endIdx
    let gain = 0;
    let loss = 0;
    
    const limit = Math.min(endIdx, pts.length - 1);
    for (let i = currentIdx + 1; i <= limit; i++) {
      const diff = pts[i].ele - pts[i - 1].ele;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }

    nextAid = {
      name: nextAidWpt.name,
      dist_m: nextAidWpt.dist_m - currentDist,
      gain_m: gain,
      loss_m: loss,
      cutoff_clock: nextAidWpt.extensions?.station?.passes?.[0]?.cutoff_clock || null
    };
  }

  // 2. Find Active Long Climb
  // Check if currentDist falls inside any DIFFICULT_CLIMB warning
  let activeClimb = null;
  if (route.warnings) {
    const activeClimbWarn = route.warnings.find(
      w => w.type === "DIFFICULT_CLIMB" && w.approved && currentDist >= w.startDist && currentDist <= w.endDist
    );

    if (activeClimbWarn) {
      // Find remaining distance
      const remainingDist = activeClimbWarn.endDist - currentDist;

      // Find max elevation within this climb warning segment to calculate remaining vertical gain
      let maxEle = currentPt.ele;
      let startIdx = 0;
      let endIdx = pts.length - 1;

      // Locate indices matching the warning distances
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].dist_m >= activeClimbWarn.startDist) {
          startIdx = i;
          break;
        }
      }
      for (let i = pts.length - 1; i >= 0; i--) {
        if (pts[i].dist_m <= activeClimbWarn.endDist) {
          endIdx = i;
          break;
        }
      }

      // Find maximum elevation from current position to end of climb
      for (let i = currentIdx; i <= endIdx; i++) {
        if (pts[i].ele > maxEle) {
          maxEle = pts[i].ele;
        }
      }

      const remainingGain = Math.max(0, maxEle - currentPt.ele);

      activeClimb = {
        dist_m: remainingDist,
        gain_m: remainingGain
      };
    }
  }

  return { nextAid, activeClimb };
}

