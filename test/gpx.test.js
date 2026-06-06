import { test, describe } from "node:test";
import assert from "node:assert";
import { parseGPX } from "../src/gpx-parser.js";
import { writeGPX } from "../src/gpx-writer.js";

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

});
