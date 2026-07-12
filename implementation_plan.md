# 🗺️ RuffTerrain Web App: 3D Trail/Hike Visualizer & Augmenter

This implementation plan outlines the steps, architecture, and file structure to build the complete, feature-rich web application for importing, visualizing, and augmenting remote, outdoor hikes or trail runs using the Google Maps JavaScript 3D Maps API.

## Goal Description
Refactor the existing web application under `feature-setup-app/` to implement a high-fidelity visual layout matching the provided screenshots. This includes adding a top stats bar, bottom scrubber panel with sliders, 3D compass, collapsed/expanded POI dialog with service icons and passes checklist, auto-pausing camera playback at POIs, climb color-coding toggle, elevation scrubbing with progress fills, distance/gain calculations to the next aid station, and course lock/unlock edit protections.

## Requirements

The application satisfies the following detailed requirements:

### Functional Requirements
1. **Interactive Course Playback & Controls**:
   - Automatic camera fly-through with configurable play speed, camera range (distance), and tilt angle.
   - **Auto-Pause at POIs**: Playback automatically pauses when the camera reaches a Point of Interest, triggering the POI detail card.
   - Playback speed, camera range, and tilt settings are stored and loaded from `localStorage`.
2. **POI Details Card & Table (Screenshot 4)**:
   - A detailed overlay showing station details, cutoffs, distance to next/prev, and a table of passes.
   - Appears collapsed initially (summary row only). Click to expand to show details and pause playback. Includes a close button to resume.
   - Uses descriptive service icons: Water `💧`, Food `🍔`, Toilet `🚾`, Medical `➕`, Sleep `🛌`, Camera `📷`, Phone `📞`, Transit `🚌`, Pacer `🏃`, Crew `🚗`, etc.
3. **Advanced HUD Stats & Climb Calculations**:
   - Calculate and display distance and remaining elevation gain/loss to the next aid station from the current scrub point.
   - Identify active long climbs and display remaining climb distance/gain.
   - Display a **3D Whiskey Compass** (Screenshot 3) showing the current orientation of the map canvas, rotating in real-time.
4. **Editable Route & Elevation Features**:
   - Toggle to **Lock / Unlock** editing features. When locked, editing buttons and Gemini Chat modifications are disabled to prevent accidental clicks.
   - Support manual elevation correction queries via Open-Meteo API. Auto-warn/prompt the user to fetch elevations if the GPX file lacks elevation data.
   - Keep a history of the **10 most recently loaded courses** in `localStorage` for quick retrieval.
5. **Elevation Scrubber & Climb Visualizer (Screenshot 1, 5)**:
   - Elevation profile chart filled in with color up to the current playback position.
   - Interactive scrubbing (click/drag) moves target marker and updates map camera instantly.
   - **Climb Visualizer Toggle**: Easily switch the path polyline color-coding on/off. When active:
     - **Red**: Steep climbs (> 2% grade)
     - **Green**: Descents (< -2% grade)
     - **Blue**: Neutral segments (-2% to 2% grade)
     - When inactive: Solid cyan path.
6. **API Config & Units Toggle**:
   - Setting page supports changing pause duration, API keys, and Units (Metric: km/meters vs. Imperial: miles/feet).
   - Core calculations are performed strictly in metric, with conversions occurring only at the rendering layer.

### Non-Functional Requirements
1. **Premium Glassmorphic Design**:
   - Layout matching screenshots: HUD stats at the top, compass at middle-right, elevation scrubber at bottom-center.
   - Eliminate `ResizeObserver loop completed with undelivered notifications` errors by using absolute positioning and fixed sizes for chart parents.

## Proposed Changes

We will modify/create the following files in the project:

### [MODIFY] [index.html](file:///Users/dkhawk/Projects/RuffTerrain/feature-setup-app/index.html)
Update the HTML structure to implement the HUD bar at the top, the compass overlay, the collapsed/expanded POI dialog template, and Settings panel fields (units, pause time).

### [MODIFY] [src/style.css](file:///Users/dkhawk/Projects/RuffTerrain/feature-setup-app/src/style.css)
Update HSL tokens and write custom rules for the top HUD metrics bar, whiskey compass rotation, POI passes grid table, toggles, and scroll layouts.

### [MODIFY] [src/gpx-parser.js](file:///Users/dkhawk/Projects/RuffTerrain/feature-setup-app/src/gpx-parser.js)
Refactor parsing to calculate next-aid metrics, active climbs, and parse/write cutoff elapsed structures from the GPX.

### [MODIFY] [src/map-3d.js](file:///Users/dkhawk/Projects/RuffTerrain/feature-setup-app/src/map-3d.js)
Update maps3d integration to support:
- Configurable tilt and range settings.
- Real-time compass heading detection.
- Path grade color-coding switchable by user toggle (Red >2%, Green <-2%, Blue neutral).

### [MODIFY] [src/elevation-chart.js](file:///Users/dkhawk/Projects/RuffTerrain/feature-setup-app/src/elevation-chart.js)
Add scrubber progress fills, click-to-move-marker coordinate mapping, and hover tooltips for waypoints.

### [MODIFY] [src/main.js](file:///Users/dkhawk/Projects/RuffTerrain/feature-setup-app/src/main.js)
Coordinate playback auto-pauses at POIs, lock/unlock edit states, units translations, and load/save settings to `localStorage` (including the 10 most recent courses).

## Verification Plan
1. **Unit Tests**: Run `npm run test` or check JS logic for unit/imperial translations.
2. **Manual QA**:
   - Load the demo. Verify top HUD values convert correctly when toggling Metric vs. Imperial.
   - Run playback. Check that it pauses at each POI, shows the collapsed POI dialog, and expands on click.
   - Adjust speed, range, and tilt sliders; verify values are saved in `localStorage` and restored on page refresh.
   - Verify the compass rotates as the map pivots.
   - Toggle climb colors on/off; check that colors reflect the >2% / <-2% grade rule.
