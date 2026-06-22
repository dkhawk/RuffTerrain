import { test, describe } from "node:test";
import assert from "node:assert";
import { parseGPX, getMetricsForPoint, classifyGradient, computeSectorGradient } from "../src/gpx-parser.js";
import { writeGPX } from "../src/gpx-writer.js";
import { getWeatherConditionStyle, getElapsedHoursAtDistance, getWeatherWindowDetails } from "../src/fetch-weather.js";

describe("GPX Parser & Writer Tests", () => {
  
  test("Fallback services inference from waypoint description", () => {
    const mockGpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Test Course</name>
  </metadata>
  <wpt lat="45.0" lon="6.0">
    <ele>1000.0</ele>
    <name>Aid Station Alpha</name>
    <desc>**Food, Water, Bathroom**</desc>
  </wpt>
  <wpt lat="45.1" lon="6.1">
    <ele>1200.0</ele>
    <name>Col de Test</name>
    <desc>A beautiful high mountain pass</desc>
  </wpt>
  <trk>
    <trkseg>
      <trkpt lat="45.0" lon="6.0"><ele>1000.0</ele></trkpt>
      <trkpt lat="45.1" lon="6.1"><ele>1200.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const route = parseGPX(mockGpx, "imperial");
    
    assert.strictEqual(route.waypoints.length, 2);
    assert.strictEqual(route.minElevation, 1000.0);
    assert.strictEqual(route.maxElevation, 1200.0);
    
    // First waypoint (Aid Station)
    const wpt1 = route.waypoints[0];
    assert.strictEqual(wpt1.name, "Aid Station Alpha");
    assert.strictEqual(wpt1.sym, "icons/aid_station.svg");
    assert.ok(wpt1.extensions?.station);
    assert.strictEqual(wpt1.extensions.station.type, "segmenting");
    assert.strictEqual(wpt1.extensions.station.subtype, "aid_station");
    assert.strictEqual(wpt1.extensions.station.services.water, true);
    assert.strictEqual(wpt1.extensions.station.services.food, true);
    assert.strictEqual(wpt1.extensions.station.services.toilets, true);

    // Second waypoint (Summit)
    const wpt2 = route.waypoints[1];
    assert.strictEqual(wpt2.name, "Col de Test");
    assert.strictEqual(wpt2.sym, "icons/summit.svg");
    assert.ok(wpt2.extensions?.station);
    assert.strictEqual(wpt2.extensions.station.type, "informational");
    assert.strictEqual(wpt2.extensions.station.subtype, "summit");
    assert.strictEqual(wpt2.extensions.station.services.water, false);
  });

  test("Multiple tracks parsed as segments", () => {
    const mockMultiTrkGpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Segment One</name>
    <desc>The warmup climb</desc>
    <trkseg>
      <trkpt lat="45.0" lon="6.0"><ele>1000.0</ele></trkpt>
      <trkpt lat="45.05" lon="6.05"><ele>1100.0</ele></trkpt>
    </trkseg>
  </trk>
  <trk>
    <name>Segment Two</name>
    <desc>The technical descent</desc>
    <trkseg>
      <trkpt lat="45.05" lon="6.05"><ele>1100.0</ele></trkpt>
      <trkpt lat="45.1" lon="6.1"><ele>1200.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const route = parseGPX(mockMultiTrkGpx, "imperial");
    
    assert.strictEqual(route.segments.length, 2);
    
    // Segment 1
    assert.strictEqual(route.segments[0].name, "Segment One");
    assert.strictEqual(route.segments[0].desc, "The warmup climb");
    assert.strictEqual(route.segments[0].startIndex, 0);
    assert.strictEqual(route.segments[0].endIndex, 1);
    
    // Segment 2
    assert.strictEqual(route.segments[1].name, "Segment Two");
    assert.strictEqual(route.segments[1].desc, "The technical descent");
    assert.strictEqual(route.segments[1].startIndex, 2);
    assert.strictEqual(route.segments[1].endIndex, 3);
  });

  test("GPX Writer preserves multi-segment serialization", () => {
    const mockRoute = {
      name: "TMB Test",
      description: "TMB description",
      waypoints: [
        {
          lat: 45.0,
          lon: 6.0,
          ele: 1000.0,
          name: "Start Line",
          sym: "icons/start.svg",
          desc: "Start description",
          extensions: {
            station: {
              id: "start",
              type: "segmenting",
              subtype: "aid_station",
              passes: [{ num: 1, dist_m: 0, label: "Start" }]
            }
          }
        }
      ],
      trackpoints: [
        { lat: 45.0, lon: 6.0, ele: 1000.0 },
        { lat: 45.1, lon: 6.1, ele: 1100.0 }
      ],
      segments: [
        {
          name: "Segment One",
          desc: "Description One",
          startIndex: 0,
          endIndex: 1
        }
      ]
    };

    const xml = writeGPX(mockRoute);
    
    // Assert it contains trk with name Segment One and desc Description One
    assert.ok(xml.includes("<trk>"));
    assert.ok(xml.includes("<name>Segment One</name>"));
    assert.ok(xml.includes("<desc>Description One</desc>"));
  });

  test("Deduplicates/excludes <ca:passes> container matching in passRegex", () => {
    const mockGpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ca="http://coursearchitect.com/schema/v1">
  <wpt lat="45.0" lon="6.0">
    <name>Start</name>
    <extensions>
      <ca:station type="segmenting" id="start" subtype="aid_station">
        <ca:passes>
          <ca:pass num="1" dist_m="0.0" label="Start"/>
        </ca:passes>
      </ca:station>
    </extensions>
  </wpt>
  <trk>
    <trkseg>
      <trkpt lat="45.0" lon="6.0"><ele>1000.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const route = parseGPX(mockGpx, "imperial");
    const wpt = route.waypoints[0];
    const passes = wpt.extensions.station.passes;
    assert.strictEqual(passes.length, 1);
    assert.strictEqual(passes[0].label, "Start");
  });

  test("Sorts waypoints by course distance chronologically", () => {
    const mockGpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.2" lon="6.2">
    <name>Finish Line</name>
  </wpt>
  <wpt lat="45.0" lon="6.0">
    <name>Start Line</name>
  </wpt>
  <wpt lat="45.1" lon="6.1">
    <name>Midpoint Aid</name>
  </wpt>
  <trk>
    <trkseg>
      <trkpt lat="45.0" lon="6.0"><ele>1000.0</ele></trkpt>
      <trkpt lat="45.1" lon="6.1"><ele>1100.0</ele></trkpt>
      <trkpt lat="45.2" lon="6.2"><ele>1200.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const route = parseGPX(mockGpx, "imperial");
    
    assert.strictEqual(route.waypoints.length, 3);
    assert.strictEqual(route.waypoints[0].name, "Start Line");
    assert.strictEqual(route.waypoints[1].name, "Midpoint Aid");
    assert.strictEqual(route.waypoints[2].name, "Finish Line");
  });

  test("Weather condition styles mappings", () => {
    const clearStyle = getWeatherConditionStyle("CLEAR");
    assert.strictEqual(clearStyle.emoji, "☀️");
    assert.strictEqual(clearStyle.label, "Clear");

    const cloudyStyle = getWeatherConditionStyle("CLOUDY");
    assert.strictEqual(cloudyStyle.emoji, "☁️");
    assert.strictEqual(cloudyStyle.label, "Cloudy");

    const rainStyle = getWeatherConditionStyle("RAIN");
    assert.strictEqual(rainStyle.emoji, "🌧️");
    assert.strictEqual(rainStyle.label, "Rain");

    const unknownStyle = getWeatherConditionStyle("UNKNOWN_WEATHER_TYPE");
    assert.strictEqual(unknownStyle.emoji, "🌡️");
    assert.strictEqual(unknownStyle.label, "UNKNOWN WEATHER TYPE");
  });

  test("getElapsedHoursAtDistance with linear fallback", () => {
    const route = {
      totalDistance: 10000 // 10km
    };
    
    // Progress at 0m (start) should be 0 hrs
    assert.strictEqual(getElapsedHoursAtDistance(route, 0, 4.0), 0);
    
    // Progress halfway (5000m) should be 2.0 hrs for a 4.0 hr duration
    assert.strictEqual(getElapsedHoursAtDistance(route, 5000, 4.0), 2.0);
    
    // Progress at end (10000m) should be 4.0 hrs
    assert.strictEqual(getElapsedHoursAtDistance(route, 10000, 4.0), 4.0);

    // Verify it handles custom durations (e.g. 14.5 hours) correctly
    assert.strictEqual(getElapsedHoursAtDistance(route, 5000, 14.5), 7.25);
    assert.strictEqual(getElapsedHoursAtDistance(route, 10000, 14.5), 14.5);
  });

  test("getElapsedHoursAtDistance with active execution plan", () => {
    const route = {
      totalDistance: 16093.44, // 10 miles in meters
      executionPlan: {
        startTime: "06:00",
        targetDurationHrs: 2.0,
        sectors: [
          {
            start_dist_m: 0,
            end_dist_m: 8046.72, // Mile 0 to 5
            target_pace_min: 10 // 10 min/mi
          },
          {
            start_dist_m: 8046.72,
            end_dist_m: 16093.44, // Mile 5 to 10
            target_pace_min: 12 // 12 min/mi
          }
        ]
      }
    };

    // At 0m (start), should be 0 hrs
    assert.strictEqual(getElapsedHoursAtDistance(route, 0, 4.0), 0);

    // At Mile 5 (8046.72m), should be 5 miles * (10 min/mi) = 50 mins = 0.8333 hrs
    const halfHrs = getElapsedHoursAtDistance(route, 8046.72, 4.0);
    assert.ok(Math.abs(halfHrs - (50 / 60)) < 0.001);

    // At Mile 10 (16093.44m), should be 50 mins + 5 miles * (12 min/mi) = 50 + 60 = 110 mins = 1.8333 hrs
    const totalHrs = getElapsedHoursAtDistance(route, 16093.44, 4.0);
    assert.ok(Math.abs(totalHrs - (110 / 60)) < 0.001);
  });

  test("getElapsedHoursAtDistance with distance overflow beyond final sector", () => {
    const route = {
      totalDistance: 16093.44, // 10 miles in meters
      executionPlan: {
        startTime: "06:00",
        targetDurationHrs: 2.0,
        sectors: [
          {
            start_dist_m: 0,
            end_dist_m: 8046.72, // Mile 0 to 5
            target_pace_min: 10 // 10 min/mi
          },
          {
            start_dist_m: 8046.72,
            end_dist_m: 16093.44, // Mile 5 to 10
            target_pace_min: 12 // 12 min/mi
          }
        ]
      }
    };

    // Cumulative time at the end of the last sector (16093.44m, 10 miles) is 110 mins.
    // If we request time at Mile 11 (17702.78m), which is 1 mile past the last sector's end,
    // it should add 1 mile * (12 min/mi) = 12 mins.
    // Total should be 110 + 12 = 122 mins = 2.0333 hrs.
    const distMile11 = 16093.44 + 1609.344;
    const elapsedHrs = getElapsedHoursAtDistance(route, distMile11, 4.0);
    assert.ok(Math.abs(elapsedHrs - (122 / 60)) < 0.001);
  });

  test("getWeatherWindowDetails scaling and range calculations", () => {
    const route = {
      totalDistance: 10000
    };
    const now = Date.now();
    const forecastData = {
      forecastHours: [
        { time: new Date(now - 3600000 * 2).toISOString(), temperature: { degrees: 10 } }, // -2h
        { time: new Date(now - 3600000).toISOString(), temperature: { degrees: 12 } },     // -1h
        { time: new Date(now).toISOString(), temperature: { degrees: 15 } },               // 0h (closest)
        { time: new Date(now + 3600000).toISOString(), temperature: { degrees: 18 } },     // +1h
        { time: new Date(now + 3600000 * 2).toISOString(), temperature: { degrees: 20 } }, // +2h
        { time: new Date(now + 3600000 * 3).toISOString(), temperature: { degrees: 22 } }  // +3h
      ]
    };

    // 1. Waypoint at the start of the course (dist = 0): should yield a 2-hour window
    // Center at index 2 (now). halfBefore for W=2 is Math.floor(1/2) = 0.
    // Window starts at index 2 (now) and has length 2: indexes [2, 3] (now, +1h).
    // Min temperature: 15, Max: 18. Window size: 2.
    const startDetails = getWeatherWindowDetails(route, 0, forecastData, now);
    assert.ok(startDetails);
    assert.strictEqual(startDetails.windowSize, 2);
    assert.strictEqual(startDetails.displayHours.length, 2);
    assert.strictEqual(startDetails.minTemp, 15);
    assert.strictEqual(startDetails.maxTemp, 18);

    // 2. Waypoint at the end of the course (dist = 10000): should yield a 5-hour window
    // Center at index 2 (now). halfBefore for W=5 is Math.floor(4/2) = 2.
    // Window starts at index 2-2=0 (-2h) and has length 5: indexes [0, 1, 2, 3, 4] (-2h, -1h, now, +1h, +2h).
    // Min temperature: 10, Max: 20. Window size: 5.
    const endDetails = getWeatherWindowDetails(route, 10000, forecastData, now);
    assert.ok(endDetails);
    assert.strictEqual(endDetails.windowSize, 5);
    assert.strictEqual(endDetails.displayHours.length, 5);
    assert.strictEqual(endDetails.minTemp, 10);
    assert.strictEqual(endDetails.maxTemp, 20);
  });

  test("getElapsedHoursAtDistance with scaled pacing sectors (simulating bumpArrivalTime)", () => {
    const route = {
      totalDistance: 16093.44, // 10 miles in meters
      executionPlan: {
        startTime: "06:00",
        targetDurationHrs: 2.0,
        sectors: [
          {
            start_dist_m: 0,
            end_dist_m: 8046.72, // Mile 0 to 5
            target_pace_min: 10 // 10 min/mi
          },
          {
            start_dist_m: 8046.72,
            end_dist_m: 16093.44, // Mile 5 to 10
            target_pace_min: 12 // 12 min/mi
          }
        ]
      }
    };

    // Simulate bumping the arrival time at Mile 5 (8046.72m) by +10 minutes:
    // Original elapsed hours at Mile 5 is 50 mins = 0.8333 hrs.
    // New elapsed hours at Mile 5 is 60 mins = 1.0 hr.
    // Scale factor is 60 / 50 = 1.2.
    // Preceding sectors (only Sector 0: start_dist_m < 8046.72) have target_pace_min scaled by 1.2.
    route.executionPlan.sectors[0].target_pace_min *= 1.2; // New pace = 12 min/mi

    // New elapsed hours at Mile 5: should be 5 miles * (12 min/mi) = 60 mins = 1.0 hr.
    const newHalfHrs = getElapsedHoursAtDistance(route, 8046.72, 4.0);
    assert.ok(Math.abs(newHalfHrs - 1.0) < 0.001);

    // Elapsed hours at Mile 10 (16093.44m) should be:
    // 60 mins (sector 1) + 5 miles * (12 min/mi) (sector 2) = 120 mins = 2.0 hrs.
    const newTotalHrs = getElapsedHoursAtDistance(route, 16093.44, 4.0);
    assert.ok(Math.abs(newTotalHrs - 2.0) < 0.001);
  });

  test("GPX Writer and Parser preserve weather and ETA arrival time ranges", () => {
    const mockRoute = {
      name: "Weather Pacing Course",
      description: "Test Course",
      waypoints: [{
        lat: 40.0,
        lon: -105.0,
        ele: 1500,
        name: "Aid Station 1",
        sym: "Aid",
        desc: "Water station",
        extensions: {
          station: {
            type: "segmenting",
            id: "as-1",
            subtype: "aid_station",
            passes: [{
              num: 1,
              dist_m: 5000,
              label: "AS1",
              target_arrival: "10:15",
              eta_earliest: "10:05",
              eta_latest: "10:30",
              weather_cond: "Partly Cloudy",
              weather_temp_c: 18.5
            }]
          }
        }
      }],
      trackpoints: [{ lat: 40.0, lon: -105.0, ele: 1500 }]
    };

    const xml = writeGPX(mockRoute);
    assert.ok(xml.includes('eta_earliest="10:05"'));
    assert.ok(xml.includes('eta_latest="10:30"'));
    assert.ok(xml.includes('weather_cond="Partly Cloudy"'));
    assert.ok(xml.includes('weather_temp_c="18.5"'));

    const restored = parseGPX(xml, "imperial");
    const pass = restored.waypoints[0].extensions.station.passes[0];
    assert.strictEqual(pass.target_arrival, "10:15");
    assert.strictEqual(pass.eta_earliest, "10:05");
    assert.strictEqual(pass.eta_latest, "10:30");
    assert.strictEqual(pass.weather_cond, "Partly Cloudy");
    assert.strictEqual(pass.weather_temp_c, 18.5);
  });

  test("Authoritative ETA calculation for HUD, Waypoint List, and Printed Plan", () => {
    const mockGpx = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.1" lon="6.1">
    <ele>1200.0</ele>
    <name>Twin Lakes Aid</name>
    <sym>icons/aid_station.svg</sym>
  </wpt>
  <trk>
    <trkseg>
      <trkpt lat="45.0" lon="6.0"><ele>1000.0</ele></trkpt>
      <trkpt lat="45.1" lon="6.1"><ele>1200.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
    const route = parseGPX(mockGpx, "imperial");
    const metrics = getMetricsForPoint(route, 0);
    assert.ok(metrics.nextAid);
    assert.strictEqual(metrics.nextAid.name, "Twin Lakes Aid");
    assert.strictEqual(typeof metrics.nextAid.absolute_dist_m, "number");
    
    // Verify elapsed hours calculation at aid station
    const elHrs = getElapsedHoursAtDistance(route, metrics.nextAid.absolute_dist_m, 12);
    assert.ok(elHrs >= 0);
  });

  test("Sector terrain serialization and heuristic inference", () => {
    const mockRoute = {
      waypoints: [],
      trackpoints: [{ lat: 40.0, lon: -105.0, ele: 1500 }],
      executionPlan: {
        targetDurationHrs: 12,
        sectors: [{
          start_dist_m: 0,
          end_dist_m: 5000,
          name: "Sugar Loaf Climb",
          terrain: "climb",
          target_pace_min: 15,
          strategy: "Power hike steep climb"
        }, {
          start_dist_m: 5000,
          end_dist_m: 10000,
          name: "Downhill Rush",
          target_pace_min: 8,
          strategy: "Smooth downhill jog"
        }]
      }
    };

    const xml = writeGPX(mockRoute);
    assert.ok(xml.includes('terrain="climb"'));

    const restored = parseGPX(xml, "imperial");
    assert.strictEqual(restored.executionPlan.sectors[0].terrain, "climb");
    assert.strictEqual(restored.executionPlan.sectors[1].terrain, "descend");
  });

  test("User-settable climb gradient classification scale and coloring", () => {
    // Test default classification thresholds
    assert.strictEqual(classifyGradient(1.5).key, "flat");
    assert.strictEqual(classifyGradient(4.0).key, "moderate");
    assert.strictEqual(classifyGradient(6.5).key, "steep");
    assert.strictEqual(classifyGradient(9.0).key, "verysteep");
    assert.strictEqual(classifyGradient(12.0).key, "extreme");
    assert.strictEqual(classifyGradient(-3.0).key, "descent");

    // Test computeSectorGradient
    const mockRoute = {
      trackpoints: [
        { dist_m: 0, ele: 1000 },
        { dist_m: 1000, ele: 1080 } // +80m over 1000m = 8.0% grade
      ]
    };
    const grade = computeSectorGradient(mockRoute, { start_dist_m: 0, end_dist_m: 1000 });
    assert.strictEqual(grade, 8);
    assert.strictEqual(classifyGradient(grade).key, "steep");
  });

});

