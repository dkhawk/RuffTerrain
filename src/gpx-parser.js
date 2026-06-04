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
 * Parses GPX XML content into a structured route object.
 * @param {string} gpxText Raw GPX XML string
 * @returns {Object} Structured route data
 */
export function parseGPX(gpxText) {
  // Regex parsing for name, desc
  const nameMatch = gpxText.match(/<name>([\s\S]*?)<\/name>/);
  const routeName = nameMatch ? nameMatch[1].trim() : "Imported Route";
  
  const descMatch = gpxText.match(/<desc>([\s\S]*?)<\/desc>/);
  const routeDesc = descMatch ? descMatch[1].trim() : "No description provided.";
  
  const trackpoints = [];
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  // Trackpoints
  const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)">([\s\S]*?)<\/trkpt>/g;
  let i = 0;
  let match;
  while ((match = trkptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3];
    
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
    
    const timeMatch = inner.match(/<time>([^<]+)<\/time>/);
    const time = timeMatch ? timeMatch[1] : null;

    let segmentDist = 0;
    let grade = 0;
    
    if (i > 0) {
      const prev = trackpoints[i - 1];
      segmentDist = haversine(prev.lat, prev.lon, lat, lon);
      totalDistance += segmentDist;

      const eleDiff = ele - prev.ele;
      if (eleDiff > 0) {
        totalElevationGain += eleDiff;
      } else {
        totalElevationLoss += Math.abs(eleDiff);
      }

      if (segmentDist > 0.1) {
        grade = (eleDiff / segmentDist) * 100;
      }
    }
    
    trackpoints.push({
      index: i,
      lat,
      lon,
      ele,
      dist_m: totalDistance,
      grade,
      time,
    });
    i++;
  }

  // Waypoints
  const waypoints = [];
  const wptRegex = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)">([\s\S]*?)<\/wpt>/g;
  let wptIdx = 0;
  while ((match = wptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3];
    
    const nMatch = inner.match(/<name>([^<]*)<\/name>/);
    const name = nMatch ? nMatch[1].trim() : `Waypoint ${wptIdx + 1}`;
    
    const eMatch = inner.match(/<ele>([^<]*)<\/ele>/);
    const ele = eMatch ? parseFloat(eMatch[1]) : 0;
    
    const sMatch = inner.match(/<sym>([^<]*)<\/sym>/);
    const sym = sMatch ? sMatch[1].trim() : "icons/services.svg";
    
    const dMatch = inner.match(/<desc>([^<]*)<\/desc>/);
    const desc = dMatch ? dMatch[1].trim() : "";

    let customExtension = null;
    const stationMatch = inner.match(/<station([^>]*)>([\s\S]*?)<\/station>/);
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
      const passRegex = /<pass([^>]*)\/?>/g;
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
      const accessMatch = stationInner.match(/<accessibility([^>]*)\/?>/);
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
      const servMatch = stationInner.match(/<services([^>]*)\/?>/);
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
      const navMatch = stationInner.match(/<navigation_alert([^>]*)\/?>/);
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
    trackpoints.forEach((trk, idx) => {
      const dist = haversine(lat, lon, trk.lat, trk.lon);
      if (dist < minSpatialDist) {
        minSpatialDist = dist;
        closestIdx = idx;
      }
    });

    waypoints.push({
      id: customExtension?.station.id || `wpt-${wptIdx}`,
      name,
      lat,
      lon,
      ele,
      sym,
      desc,
      dist_m: trackpoints[closestIdx]?.dist_m || 0,
      customExtension
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

  calculateWarnings(parsedRoute);
  return parsedRoute;
}

/**
 * Calculates safety warnings (Resource Deserts, Difficult Climbs, Exposure Risk) for a parsed route.
 * Modifies the route object directly by populating `route.warnings`.
 * @param {Object} route The parsed route object
 */
export function calculateWarnings(route) {
  const warnings = [];
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
        message: `Resource Desert: No water/food for first ${(firstDist / 1609.344).toFixed(1)} miles of course.`,
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
      message: `Resource Desert: No water or aid stations configured on this ${(route.totalDistance / 1609.344).toFixed(1)} mile route!`,
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
        message: `Resource Desert: ${(gap / 1609.344).toFixed(1)} miles between "${startWpt.name}" and "${endWpt.name}".`,
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
        message: `Resource Desert: No water/food for final ${(finalGap / 1609.344).toFixed(1)} miles to finish.`,
        startDist: lastDist,
        endDist: route.totalDistance,
        approved: true,
      });
    }
  }

  // 2. DIFFICULT CLIMBS
  // A climb is difficult if there is a sustained steep grade (>10%) for a continuous distance of over 800m.
  let climbStartIdx = -1;
  let cumulativeClimbGain = 0;

  for (let i = 0; i < trackpoints.length; i++) {
    const tp = trackpoints[i];
    
    // Check if we are on a steep climb (> 8% grade to catch sustained climbs)
    if (tp.grade > 8) {
      if (climbStartIdx === -1) {
        climbStartIdx = i;
        cumulativeClimbGain = 0;
      } else {
        const prev = trackpoints[i - 1];
        const gain = tp.ele - prev.ele;
        if (gain > 0) cumulativeClimbGain += gain;
      }
    } else {
      // End of climb check
      if (climbStartIdx !== -1) {
        const climbDist = tp.dist_m - trackpoints[climbStartIdx].dist_m;
        // Sustained steep climb: >800m horizontal distance or >200m vertical elevation gain
        if (climbDist >= 800 || cumulativeClimbGain >= 200) {
          const startMi = (trackpoints[climbStartIdx].dist_m / 1609.344).toFixed(1);
          const endMi = (tp.dist_m / 1609.344).toFixed(1);
          warnings.push({
            id: `climb-${climbStartIdx}`,
            type: "DIFFICULT_CLIMB",
            message: `Difficult Climb: Sustained climb from Mile ${startMi} to ${endMi} (+${Math.round(cumulativeClimbGain)}m gain).`,
            startDist: trackpoints[climbStartIdx].dist_m,
            endDist: tp.dist_m,
            approved: true,
          });
        }
        climbStartIdx = -1;
      }
    }
  }

  // 3. EXPOSURE RISKS
  // Detect continuous sections of extremely steep slopes (> 15% grade) for at least 200m.
  let exposureStartIdx = -1;
  for (let i = 0; i < trackpoints.length; i++) {
    const tp = trackpoints[i];
    const absGrade = Math.abs(tp.grade);

    if (absGrade > 15) {
      if (exposureStartIdx === -1) {
        exposureStartIdx = i;
      }
    } else {
      if (exposureStartIdx !== -1) {
        const expDist = tp.dist_m - trackpoints[exposureStartIdx].dist_m;
        if (expDist >= 200) {
          const startMi = (trackpoints[exposureStartIdx].dist_m / 1609.344).toFixed(1);
          const endMi = (tp.dist_m / 1609.344).toFixed(1);
          warnings.push({
            id: `exposure-${exposureStartIdx}`,
            type: "EXPOSURE_RISK",
            message: `Exposure Risk: Very steep slopes (>15% grade) from Mile ${startMi} to ${endMi}.`,
            startDist: trackpoints[exposureStartIdx].dist_m,
            endDist: tp.dist_m,
            approved: true,
          });
        }
        exposureStartIdx = -1;
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
export function reconcileCourse(route, extractionPayload, nominalDistanceM = null) {
  const trackpoints = route.trackpoints;
  const cumulativeDistances = trackpoints.map((t) => t.dist_m);
  const actualDistanceM = route.totalDistance;

  let scaleFactor = 1.0;
  if (nominalDistanceM) {
    scaleFactor = actualDistanceM / nominalDistanceM;
  }

  const stations = extractionPayload.stations || [];
  const updatedWaypoints = [...route.waypoints];

  stations.forEach((station) => {
    const stationId = station.id;
    const name = station.name;
    const type = station.type;
    const subtype = station.subtype;
    const passes = station.passes || [];

    if (passes.length === 0) return;

    let closestIdx = 0;
    let lat = 0;
    let lon = 0;
    let useExactOverride = false;

    const override = station.coordinate_override;
    if (override) {
      const overrideLat = parseFloat(override.lat);
      const overrideLon = parseFloat(override.lon);

      // Find closest trackpoint to lock elevation
      let minSpatialDist = Infinity;
      trackpoints.forEach((pt, idx) => {
        const dist = haversine(overrideLat, overrideLon, pt.lat, pt.lon);
        if (dist < minSpatialDist) {
          minSpatialDist = dist;
          closestIdx = idx;
        }
      });

      lat = overrideLat;
      lon = overrideLon;
      useExactOverride = true;
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
  
  // Recalculate warnings because adding resources resolves resource deserts
  calculateWarnings(route);
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

