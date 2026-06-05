---
name: course-architect
description: Reconcile, validate, and snap course milestones and points of interest (POIs) extracted by Gemini against trackpoints from GPX/KML routes.
risk: low
source: project
---

# Course Architect Skill

This skill provides instructions, guidelines, and command-line utilities to reconcile unstructured or semi-structured course metadata with spatial route trackpoints (supporting loop and out-and-back pass snapping).

## When to Use
Use this skill when:
1. Reconciling a route's GPX track file with a text metadata file (e.g. `PP-meta-data.txt` detailing milestones/amenities).
2. Generating structured JSON layouts of courses with correct coordinate snapping and elevation lookups.
3. Automatically identifying multiple passes on out-and-back or looping trails (e.g., Barr Camp on Pikes Peak).
4. Running verification tests on route milestone snapping distances in the terminal.

## Key Abstractions
- **Route trackpoints**: Arrays of coordinate objects `{ lat, lon, ele, dist_m }` representing the physical trail path.
- **Coordinate Snapping**: Projects the waypoint coordinate to the nearest trackpoint segment.
- **Snapping Search Window**: To handle loop and out-and-back routes, the snap logic searches within a `±3000 meter` window around the nominal pass distance first to keep the waypoint pinned to the correct pass (outbound vs. inbound).
- **Automatic Multi-Pass Detection**: Walks the trackpoints to find all distance local minima (under 200m) and merges close duplicates (within 2000m) to generate correct outbound/inbound passes automatically.

## CLI Usage
Run the Javascript CLI utility from the root of the workspace to reconcile any course track and metadata text file:

```bash
node ./.gemini/skills/course-architect/scripts/reconcile_course.js \
  <gpx_path> \
  <metadata_path> \
  <output_json_path> \
  [--model <model_name>] \
  [--units imperial|metric]
```

### Example
```bash
node ./.gemini/skills/course-architect/scripts/reconcile_course.js \
  ./samples/Pikes_Peak.gpx \
  ./samples/PP-meta-data.txt \
  ./samples/reconciled_pikes_peak.json
```

## Validation & Assertions
Always verify that:
- Waypoint coordinates are snapped to the nearest trackpoint within a tight distance tolerance.
- For out-and-back sections, the waypoint has two passes (e.g. Pass 1 Outbound, Pass 2 Inbound) at correct distances.
- Detour trackpoints are inserted into the route's trackpoints array when waypoints don't sit directly on the track, using the correct snapped index to preserve layout sequence.
