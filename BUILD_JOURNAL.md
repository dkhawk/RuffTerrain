# Build Journal: RuffTerrain Map 3D App

This journal records all design decisions, architecture patterns, development steps, and interactions with the LLM. It serves as a continuous record of how this project is built from scratch.

---

## 📅 June 4, 2026

### 🚀 Session 1: Workspace Initialization
*   **Goal**: Setup the development environment and Git workspace.
*   **Decisions & Rationale**:
    *   **Bare Git Setup**: Initialized a bare repository inside `.bare/` with a `.git` pointer file at the root. Worktrees will be added as subdirectories in the root (e.g. `main/`, `feature-name/`). This isolates the work environment and avoids conflicts across branch modifications.
    *   **Release Basis**: Dedicated `main/` worktree as the stable branch representing release versions. No direct coding will happen on `main`.
    *   **Workspace Logging**:
        *   [`PROJECTS.md`](file:///Users/dkhawk/Projects/RuffTerrain/PROJECTS.md): An index tracking the high-level goals, status, and SDK references.
        *   [`BUILD_JOURNAL.md`](file:///Users/dkhawk/Projects/RuffTerrain/BUILD_JOURNAL.md): A continuous log (this file) kept at the root (untracked by Git) to document all LLM sessions, decisions, and development progression.
*   **Key Actions Taken**:
    *   Initialized bare git repository in `.bare`.
    *   Added `main` orphan worktree, committed initial `README.md` and `.gitignore`.
    *   Created `PROJECTS.md` and `BUILD_JOURNAL.md` at the root.
    *   Created local workspace instruction files (`.cursorrules`, `.claudeprompt`, `.github/copilot-instructions.md`, and `AGENT_CONTEXT.md`) to guide any starting LLM (including Gemini/Antigravity and Claude) to pay attention to `PROJECTS.md` and log to `BUILD_JOURNAL.md` using the project's worktree conventions.
*   **Next Steps**:
    *   Create a feature branch worktree for the Android application scaffolding (e.g., `feature-setup-app`).
    *   Scaffold the basic Android project structure.

---

### 🚀 Session 2: Pivot to Web App & Requirements Alignment
*   **Goal**: Define the requirements and design the client-side Web Application for route import and enhancement.
*   **Decisions & Rationale**:
    *   **Scope Pivot**: Shifted focus from Android application development to building a Web Application first. Mobile apps will follow in subsequent phases.
    *   **Tech Stack**: Selected Vite, HTML5, Vanilla JavaScript, and Vanilla CSS. This keeps the application lightweight, fast, and offline-friendly without unnecessary framework overhead.
    *   **Core Data Engine**: Standardized a non-destructive GPX import-augment-export pipeline using browser-native `DOMParser` for XML ingestion and serialization.
    *   **3D Map Layer**: Integrated Google Maps JavaScript 3D Maps API (`Map3DElement`, `Polyline3DElement`, `Marker3DInteractiveElement`) to display grade-colored trail segments and custom interactive resource markers.
    *   **UI/UX Concept**: Floating glassmorphic cards overlaying a full-screen satellite terrain map with synchronized elevation charts.
*   **Key Actions Taken**:
    *   Created `feature-setup-app` worktree representing the `feature/setup-app` branch.
    *   Initialized a new Vite Vanilla JS project in `feature-setup-app` and installed dependencies.
    *   Conducted interactive requirements alignment session (/grill-me) to formalize functional/non-functional criteria.
    *   Wrote the final requirements and implementation plan to `implementation_plan.md` at the project root.

---

## 📅 June 5, 2026

### 🚀 Session 3: Fixing Marker Visibility & Blueprint Alignment
*   **Goal**: Diagnose and resolve waypoint and tracking marker rendering issues.
*   **Decisions & Rationale**:
    *   **3D Marker Restorations**: Restored the use of `Marker3DElement` and `Marker3DInteractiveElement` instead of 2D `AdvancedMarkerElement`. Advanced 2D markers are incompatible with 3D Map views (`Map3DElement`) and fail to render.
    *   **HTML Slotted Template Enforcement**: Enforced custom markup wrapping in `HTMLTemplateElement` (`<template>`) for all custom elements (SVGs/styled wrappers) appended to 3D Map markers. Directly appending child elements without template slots is invalid in the Google Maps JS 3D API custom component registry.
    *   **Pure SVGElement Wrapping**: Replaced nested `HTMLDivElement` (`div`) wrappers and `HTMLImageElement` (`<img>`) tags inside templates with pure parsed `SVGElement` nodes (using a `DOMParser` helper). The Maps 3D WebGL renderer rejects HTML wrappers inside templates, resulting in invisible or blocked pins, whereas direct `SVGElement` child elements render cleanly.
    *   **Interaction Event Hooks**: Changed the waypoint drag interaction to listen to `gmp-dragend` instead of the 2D `dragend` to support positioning updates natively under 3D coordinates.
*   **Key Actions Taken**:
    *   Modified `src/map-3d.js` to import and utilize `Marker3DElement` and `Marker3DInteractiveElement` from the `maps3d` library namespace.
    *   Added `parseSvgStringToElement()` helper to construct valid `SVGElement` nodes from SVG markup strings.
    *   Wrapped parsed `SVGElement` nodes directly inside `<template>` elements and appended them to 3D Map markers, eliminating nested div wrappers.
    *   Successfully ran `npm run build` to verify clean compilation.

### 🚀 Session 4: Resolving Self-Closing GPX Tag Parsing
*   **Goal**: Fix parser error when loading `g2g.gpx` or similar flat route files containing self-closing trackpoints.
*   **Decisions & Rationale**:
    *   **Robust RegExp Parsing**: Updated the regular expression pattern matching `<trkpt>`, `<rtept>`, and `<wpt>` tags in `src/gpx-parser.js`. The previous pattern expected a traditional opening-closing tag pair (`<trkpt>...</trkpt>`), which broke on flat GPX files with self-closing nodes (`<trkpt ... />`).
    *   **Fallback Safety Guards**: Added safety guards (`match[3] || ""`) when parsing optional nested elements like `<ele>` and `<time>` within the match subgroups.
*   **Key Actions Taken**:
    *   Updated parser expressions in `src/gpx-parser.js` to optionally support trailing slashes (`(?:\s*\/|...)`).
    *   Created and executed local scratch tests to verify parsing compliance.
    *   Validated the production build layout.

### 🚀 Session 5: Waypoint-to-Route Track Coupling
*   **Goal**: Dynamically alter the trail route geometry when a waypoint is added, dragged, or deleted.
*   **Decisions & Rationale**:
    *   **Dynamic Out-and-Back Detours (Option B)**: Spliced new trackpoint vertices into the route's `trackpoints` array when a waypoint is placed in the middle of a trail segment. This stretches the route's polyline to visit the POI and immediately returns to the trail.
    *   **Start/End Terminal Extensions (Option C)**: prepended or appended trackpoints if the placed waypoint sits closer to the start or finish boundary nodes than any intermediate trail segment.
    *   **Dynamic Rubber-Band Drag Updates**: Linked the `onWaypointDragEnd` handler to search for a trackpoint at the waypoint's previous coordinates (matching via close spatial tolerances) and shifted that trackpoint to the new dragged coordinate, dynamically stretching the route line.
    *   **Detour Cleanup on Deletion**: Cleaned up the route geometry on waypoint deletion by finding and deleting the corresponding detour trackpoint, reverting the trail to its original straight path.
*   **Key Actions Taken**:
    *   Modified `src/main.js`'s `addPoiSubmitBtn` listener to insert detour/terminal extension coordinates into `activeRoute.trackpoints` and invoke `recalculateRouteMetrics()`.
    *   Refactored `onWaypointDragEnd` to search for and update the matching detour trackpoint coordinate.
    *   Added matching trackpoint removal within the waypoint deletion confirmation block.
    *   Successfully ran `npm run build` to verify clean compilation.

### 🚀 Session 6: Fixing Chat Reconcile Detours & Waypoint List UX Spacing
*   **Goal**: Ensure waypoints added or overridden via Gemini chat trigger track detours, and fix the cramped waypoint list in the sidebar.
*   **Decisions & Rationale**:
    *   **Modularizing Geometry Utilities**: Moved `snapToRouteSegments` and `recalculateRouteMetrics` from `src/main.js` into `src/gpx-parser.js`. This allows `reconcileCourse` (which processes the AI chat responses) to reuse the exact same track-coupling/snapping logic.
    *   **Post-Reconciliation Detour Injection**: Added a post-processing pass at the end of `reconcileCourse` that checks all waypoints for matching trackpoint detours. If a waypoint was created off-route (e.g. from an AI coordinate override), the parser automatically inserts the detour trackpoints and recalculates the metrics.
    *   **POI List Sidebar Room**: Increased `#edit-waypoint-list` container's `max-height` from `140px` to `240px` to reduce scroll overflow. Increased item padding (`8px 10px`), font-size (`12px`), and added micro-transitions with hover states to make items feel like premium interactive cards.
*   **Key Actions Taken**:
    *   Migrated utility functions to `src/gpx-parser.js` and updated imports/local calls.
    *   Added off-route detour checking/insertion to the end of `reconcileCourse` in `src/gpx-parser.js`.
    *   Updated `#edit-waypoint-list` styling in `index.html` and item styling inside `renderEditWaypointList()` in `src/main.js`.
    *   Successfully verified the production build.

### 🚀 Session 7: Reverse Engineering & Requirements Extraction
*   **Goal**: Deconstruct and formalize the engineering requirements for the entire Kokopelli Ruff Terrain Web application.
*   **Decisions & Rationale**:
    *   **Documenting Mathematical & Snapping Heuristics**: Extracted exact mathematical formulas for coordinate distance (Haversine), slope grade calculation (30m baseline), and snapping heuristics (standard snapping, snap window thresholds, turnaround midpoint identification, multi-pass intersection optimization).
    *   **Defining Custom XML Schema Extensions**: Formalized the `ca:` schema specifications used for timing passes, accessibility settings, amenities checklists, and navigation alerts inside GPX `<extensions>`.
    *   **Standardizing Client-Side Architectures**: Cataloged requirements for client-side components including coordinate interpolation (linear fractional index), camera simulation loops (SLERP, Bungee Lerp filters, POI auto-pauses), canvas elevation charts (retina scaling, translucent warning zone highlight overlays), and Gemini AI Chat APIs.
*   **Key Actions Taken**:
    *   Conducted deep-dive code audits of `main.js`, `gpx-parser.js`, `map-3d.js`, `elevation-chart.js`, `gemini-client.js`, `fetch-elevation.js`, and `gpx-writer.js`.
    *   Compiled all details into a structured, reference-grade engineering specification document saved at [`requirements.md`](file:///Users/dkhawk/.gemini/jetski/brain/0130726c-76e2-48ed-8d0b-d224c17d6577/requirements.md).

---

## 📅 June 6, 2026

### 🚀 Session 8: Resolving False Resource Desert Warnings on Standard GPX
*   **Goal**: Diagnose and resolve false-positive resource warnings when loading flat GPX files (like `TMB-Full-Tour-Enhanced.gpx`) that do not contain custom Course Architect XML schema tags (`ca:`).
*   **Decisions & Rationale**:
    *   **Inference-based Fallback Parser**: Added a fallback heuristic block to the GPX parsing stage in `src/gpx-parser.js`. If a waypoint has no `<ca:station>` extension element, the parser now checks the waypoint description (`desc`) and name for keywords (like "Water", "Food", "Bathroom", "Medical") to dynamically infer and populate services.
    *   **Uniform Single-Pass Structure**: Generated a single default timing pass and snapped distance parameter for inferred resources so they behave identically to standard single-pass timing checkpoints.
    *   **Automatic Symbol Upgrading**: Refined the default symbol assignment logic: if the parsed symbol is the generic `icons/services.svg`, it is updated to match the inferred subtype (e.g. `icons/water.svg`, `icons/aid_station.svg`, etc.), ensuring correct mapping pins show in both the WebGL 3D map views and tooltip dashboards.
*   **Key Actions Taken**:
    *   Replaced the waypoint parsing loop inside `src/gpx-parser.js` to construct fallback extensions and symbols.
    *   Refactored `calculateWarnings`'s Resource Desert gap detection to loop through flattened, snapped resource passes.
    *   Verified built assets compiled successfully with `npm run build`.

---

### 🚀 Session 9: Multi-Segment Track Parsing & Dynamic HUD Displays
*   **Goal**: Enable course creators to define and describe distinct course segments in standard GPX files and display segment information during playback fly-throughs.
*   **Decisions & Rationale**:
    *   **GPX Multi-Track Support**: Supported standard GPX multi-track schemas by parsing multiple `<trk>` elements as individual segments. If a GPX has multiple tracks, they are stored as a `segments` array containing their respective names, descriptions, and trackpoint boundaries.
    *   **Flat Trackpoint Preservation**: Kept trackpoint list fully flattened globally. This prevents breaking existing physics, grade-coloring, warning systems, or animation engines while keeping segment-aware metadata available.
    *   **Segment Serializer (GPX Writer)**: Updated `writeGPX` to serialize the flat trackpoints list back into multiple discrete `<trk>` blocks matching the segmented structure when `route.segments` is populated.
    *   **Context-Aware HUD Tag**: Added a dynamic HUD element `#active-segment-display` next to the course name. It maps the scrubber/camera distance to the corresponding segment during fly-through playback, showing the active segment and description tooltip.
    *   **Segment List Dialog Overlay**: Augmented the Course Info overlay modal to parse and list segments with distances and descriptions if the track contains more than one segment.
*   **Key Actions Taken**:
    *   Refactored `parseGPX` to iterate through `<trk>` elements and map segment distances.
    *   Updated `writeGPX` in `src/gpx-writer.js` to serialize multiple tracks based on segment bounds.
    *   Added CSS styling `.active-segment-tag` to `src/style.css` and tag container to `index.html`.
    *   Wrote dynamic updates into `updateHUD` and `displayCourseInfo` in `src/main.js`.
    *   Verified built assets compiled successfully with `npm run build`.

---

### 🚀 Session 10: Native ESM Unit Testing Suite
*   **Goal**: Create a lightweight, high-performance unit test suite to validate the GPX parsing, fallback inference, and serialization changes without adding heavy runtime dependencies.
*   **Decisions & Rationale**:
    *   **Native Node Test Runner**: Utilized Node.js's built-in `node:test` runner and `node:assert` modules. This provides ESM compatibility and execution speeds under 70ms with zero security or supply chain risks.
    *   **Comprehensive Coverage**: Covered fallback service/subtype/symbol inferences, multiple track/segment parsing bounds, and multi-track preservation in serialization.
*   **Key Actions Taken**:
    *   Created test suite at `test/gpx.test.js`.
    *   Added `npm test` script to `package.json`.
    *   Successfully executed tests with zero failures.

---

### 🚀 Session 11: Correcting Playback Resumption on Dialog Dismissal
*   **Goal**: Prevent the tracking marker from unexpectedly starting or resuming playback when dismissing the POI detail dialog card via Close/Delete buttons.
*   **Decisions & Rationale**:
    *   **Distinct Playback Command Parameters**: Evaluated and corrected the `closePoiDetailDialog(resumePlayback)` invocations. Dismissing the card using the header "X" button, the bottom "Close" button, deleting a waypoint, or triggering the "Add Waypoint" panel should NOT resume play/movement. We changed these parameters from `true` to `false`.
    *   **Keep Playback Control Decoupled**: Retained `closePoiDetailDialog(true)` only for the explicit "Continue" button and the auto-resume pause timer, ensuring correct user control.
*   **Key Actions Taken**:
    *   Modified `main.js` event listeners for `poiDialogCloseHeader` and `poiDialogCloseBottom` to pass `false`.
    *   Updated edit list deletion handler and `addPoiStartBtn` handler to pass `false`.
    *   Verified built assets compiled successfully with `npm run build` and tests passed.

---

### 🚀 Session 12: Dismissible Course Statistics & Elevation Range
*   **Goal**: Provide users with a complete course profile statistics display (including elevation range bounds) that can be dismissed and reopened at any time.
*   **Decisions & Rationale**:
    *   **Elevation Range Calculations**: Integrated min/max elevation calculations directly into `parseGPX`, `parseKML`, and `recalculateRouteMetrics` in `src/gpx-parser.js`.
    *   **Full-Width Stats Layout**: Added `.stat-box.full-width` CSS styles to support clean span of the "Elevation Range" value across the 2-column stats grid.
    *   **Dismiss & Reopen Control**: Injected a close button (`#close-stats-btn`) in the Course Profile header and a toggle button (`#toggle-stats-btn`, mapped to `📊`) in the HUD action section.
    *   **Synchronous State Toggling**: Modeled stats card toggle behaviors after warnings panels: closing the card hides it and unhides the toggle button; loading or resetting routes resets panel visibility states.
*   **Key Actions Taken**:
    *   Updated `gpx-parser.js` to compute `minElevation` and `maxElevation`.
    *   Added close button container and "Elevation Range" box to `index.html`.
    *   Created CSS style rule for `.stat-box.full-width` in `src/style.css`.
    *   Bound DOM elements and implemented click event listeners in `src/main.js`.
    *   Verified built assets compiled successfully with `npm run build` and unit tests pass.

---

### 🚀 Session 13: Fixing Pass Duplication (passRegex Bug)
*   **Goal**: Prevent XML parsing of `<ca:passes>` container tags from being falsely identified as waypoint `<ca:pass>` elements.
*   **Decisions & Rationale**:
    *   **Word Boundary Regex Restriction**: Placed a word boundary constraint (`\b`) inside the regular expression parsing passes: `/<(?:ca:)?pass\b([^>]*)\/?>/g`. This strictly matches only `<ca:pass>` elements and ignores `<ca:passes>` container tags, which were previously double-counted as an extra blank pass.
*   **Key Actions Taken**:
    *   Updated `src/gpx-parser.js` passRegex pattern.
    *   Added dedicated test case `"Deduplicates/excludes <ca:passes> container matching in passRegex"` in `test/gpx.test.js`.
    *   Ran `npm test` and committed changes successfully.

---

### 🚀 Session 14: Chronological Waypoint Ordering
*   **Goal**: Ensure waypoints are sorted in chronological order as encountered along the course (from Start to Finish).
*   **Decisions & Rationale**:
    *   **Sort Post-Snapping**: Added explicit `waypoints.sort((a, b) => a.dist_m - b.dist_m)` steps in the parsers (`parseGPX` and `parseKML`) immediately after closest-trackpoint snapping is completed. This guarantees that waypoints are correctly ordered based on cumulative distance along the track, rather than their arbitrary XML definition sequence.
*   **Key Actions Taken**:
    *   Added sorting logic in `parseGPX` and `parseKML` functions.
    *   Wrote unit test `"Sorts waypoints by course distance chronologically"` in `test/gpx.test.js` to ensure out-of-order XML waypoints are returned in chronological distance order.
    *   Ran test suite and committed changes.

---

### 🚀 Session 15: Enhancing Elevation Profile Chart Sizing
*   **Goal**: Make the bottom elevation profile chart taller so that climb slopes and elevation gradients are more easily readable.
*   **Decisions & Rationale**:
    *   **Increase Profile Height**: Expanded the bottom panel (`.panel-bottom-center`) height from `140px` to `200px`. The inner `.chart-container` automatically scales using flexbox, resulting in a taller and more detailed elevation canvas layout.
    *   **Offsite Side Panels bottom constraint**: Adjusted adjacent bottom-left and middle-right panels' `bottom` offset from `156px` to `216px`. This preserves the uniform `16px` visual padding threshold and prevents panels from overlapping when the taller bottom profile card is open.
*   **Key Actions Taken**:
    *   Modified `.panel-bottom-center`, `.panel-bottom-left`, and `.panel-middle-right` layout constraints inside `src/style.css`.
    *   Compiled clean production assets with `npm run build` and committed changes.

---

### 🚀 Session 16: Conditionally Hiding HUD Time Metric
*   **Goal**: Hide the "TIME" HUD metric column when a course layout has no real time/recording timestamps, preventing synthetic or misleading paces from showing.
*   **Decisions & Rationale**:
    *   **Presence-Based Visibility Toggling**: Added `id="hud-metric-time"` to the Time column container in `index.html`. On route ingestion, `main.js` checks if the GPX trackpoints contain actual timestamps (e.g. `activeRoute.trackpoints[0].time`).
    *   **Automatic Layout Reflow**: If timestamps are missing, the "TIME" metric is hidden (`.classList.add("hidden")`), allowing the other metrics (DIST, ELEV, GAIN, LOSS, NEXT AS) to slide over naturally using the existing flexbox layout.
*   **Key Actions Taken**:
    *   Updated `index.html` structure.
    *   Added visibility detection logic to `src/main.js`.
    *   Compiled clean assets and committed changes.

---

### 🚀 Session 17: Clearing Safety Warning Highlights
*   **Goal**: Allow users to clear highlighted safety warning polylines from the map and UI when they no longer need to focus on them.
*   **Decisions & Rationale**:
    *   **Map Method Implementation**: Created `clearWarningHighlight()` inside `Map3D` in `src/map-3d.js` to securely remove `this.activeWarningPolyline` from the Google 3D Map viewport.
    *   **Action Header Button**: Injected a broom button (`🧹` / `#clear-warnings-highlight-btn`) inside the Warnings panel header. It is hidden by default and only becomes visible when a warning is actively highlighted.
    *   **Automated Cleanups**: Bound triggers to automatically clear active warnings and hide the broom button whenever a new route is loaded or the active route is reset to Boulder.
*   **Key Actions Taken**:
    *   Added `clearWarningHighlight()` method to `Map3D` class.
    *   Appended `#clear-warnings-highlight-btn` element to the header of `#card-warnings` in `index.html`.
    *   Registered event listener in `src/main.js` to execute clearing and toggle button class states.
    *   Added automated cleaning during route load/reset steps.

---

### 🚀 Session 18: Synchronized Sidebar Warning Highlights
*   **Goal**: Highlight the warning item in the sidebar list when a user clicks on it to view it on the map/trail.
*   **Decisions & Rationale**:
    *   **Interactive Sidebar Styling**: Added `.active` status CSS classes tailored to warning categories (`.climb.active`, `.desert.active`, `.spatial-mismatch.active`) in `src/style.css` to match their respective map polyline highlighting colors with premium background hues and glowing box shadows.
    *   **Event State Management**: Updated click event handlers on warning list items in `src/main.js` to clear `.active` classes from all other items before applying the highlight to the selected item. Also ensured sidebar highlights are removed when clearing the warning highlight via the broom button.
*   **Key Actions Taken**:
    *   Injected active state styles for warning cards in `src/style.css`.
    *   Configured class toggling logic in `renderWarningsUI` and clear button listeners in `src/main.js`.
    *   Compiled clean production assets and committed changes.

---

### 🚀 Session 19: High-Contrast Map and Sidebar Highlighting
*   **Goal**: Resolve contrast issues where map warning segment highlights mixed with satellite terrain textures, making them look desaturated/gray and backwards.
*   **Decisions & Rationale**:
    *   **Main Track Dimmings**: Modified `addPolylineSegment` to retain `originalColor` on `Polyline3DElement` instances. When a warning is highlighted on the map, the rest of the main route segments are dynamically muted to a semi-transparent slate gray (`rgba(148, 163, 184, 0.25)`) and thinned.
    *   **Solid Neon Highlights**: Configured the warning highlight segment to render in 100% solid, opaque, vibrant neon colors (Neon Amber `#f59e0b`, Neon Red `#ef4444`, Neon Purple `#a855f7`) at an increased thickness (`strokeWidth: 14`).
    *   **Sidebar Exclusions**: Set up a container class `.has-active` on the warnings list when a warning is highlighted, which reduces the opacity of all non-focused warning items in the sidebar to `0.45` and applies a grayscale filter, creating absolute clarity of focus.
*   **Key Actions Taken**:
    *   Updated `src/map-3d.js` to store original colors, thin/mute unselected polylines, and use opaque highlight colors.
    *   Implemented `.has-active` toggling in `src/main.js` and sidebar styles in `src/style.css`.
    *   Verified build runs correctly and committed changes.

---

### 🚀 Session 20: Refined Warning Card Highlighting & Map Reversion
*   **Goal**: Simplify the safety warning selection style based on user feedback. Revert high-contrast map polyline muting and resolve sidebar highlighting muddy gray visual confusion.
*   **Decisions & Rationale**:
    *   **Map Scheme Reversion**: Reverted `Map3D`'s warning overlay rendering in `src/map-3d.js` to draw the thick, semi-transparent highlight overlay (`strokeWidth: 14`) using the original colors (`rgba(245, 158, 11, 0.55)`, `rgba(239, 68, 68, 0.6)`, and `rgba(168, 85, 247, 0.6)`) directly over the fully colored, un-muted track segments.
    *   **Simplified Sidebar Active State**: Replaced type-specific, low-opacity active sidebar colors (which mixed with dark cards to look muddy/disabled) with a clean, high-contrast, semi-transparent white highlight: `.warning-item.active { background-color: rgba(255, 255, 255, 0.16) !important; border-color: rgba(255, 255, 255, 0.5) !important; }`. Removed the list item dimming/grayscale logic (`.has-active`) to preserve normal sidebar visual context.
*   **Key Actions Taken**:
    *   Restored original coloring and polyline states in `src/map-3d.js` and removed muting routines.
    *   Refactored active sidebar classes in `src/style.css` and removed `.has-active` helper toggles from `src/main.js`.
    *   Built the app and committed changes.

---

### 🚀 Session 21: Correcting Playback POI Auto-Resume
*   **Goal**: Fix the playback auto-resume behavior where the fly-through got stuck indefinitely when pausing at a POI (waypoint).
*   **Decisions & Rationale**:
    *   **Context-Based Collapse Default**: The auto-resume timeout is conditioned on the POI detail dialog being in the `collapsed` state (to allow users to freeze the timeline by expanding the card manually). However, `showPoiDetailDialog` was hardcoded to start in the `expanded` state, breaking the auto-resume check.
    *   **Conditional Collapsed parameter**: Added `startCollapsed` to `showPoiDetailDialog` in `src/main.js`. It defaults to `false` for manual edits (so they open expanded) but is set to `true` when called during playback auto-pauses in the render loop. This correctly triggers the timer to resume the fly-through.
*   **Key Actions Taken**:
    *   Updated `showPoiDetailDialog` function definition to take `startCollapsed`.
    *   Set `startCollapsed = true` inside the `renderLoop` auto-pause block.
    *   Verified build succeeds, tests pass, and committed changes.

---

### 🚀 Session 22: Relocating Action Buttons to "Edit Course" Panel
*   **Goal**: Resolve the issue where the "Fetch & Correct Elevations" and "Export Enhanced GPX" buttons were completely invisible or overlapped with the "Course Warnings" panel.
*   **Decisions & Rationale**:
    *   **Class Overrides & Overlaps**: Discovered that Card 3 (Route Stats / Course Profile Card) was originally hidden via CSS `display: none !important` because the stats themselves duplicate the top HUD. However, this card also contained the only buttons for correcting elevations and exporting GPX.
    *   **Avoiding Overlaps**: After briefly enabling Card 3, we noticed that it overlapped heavily with the "Course Warnings" card (`.panel-middle-right`) on the right side of the screen.
    *   **UI Redesign**: Instead of stacking cards on the right, we relocated the **"⚡ Fetch & Correct Elevations"** and **"📥 Export Enhanced GPX"** buttons directly to the bottom of the **"Edit Course" (Card 1)** panel on the left. This keeps the right side clean, aligns perfectly with the user's edit-then-export workflow, and keeps Card 3 cleanly hidden via the original CSS rules.
*   **Key Actions Taken**:
    *   Moved action buttons markup from Card 3 to Card 1 in `index.html`.
    *   Restored `.panel-top-right { display: none !important; }` in `src/style.css` to keep Card 3 hidden and prevent visual overlapping.
    *   Verified build succeeds, tests pass, and committed changes.

---

### 🚀 Session 23: Android Port UX Specification & Worktree Setup
*   **Goal**: Create a new worktree and branch for the Android port, and draft a high-fidelity design prompt/spec for the UX designer.
*   **Decisions & Rationale**:
    *   **Worktree Separation**: Created an isolated worktree and branch named `android-port` to separate the upcoming native Android development from the web application repository state.
    *   **Interactive Mobile UX Design**: Structured a detailed mobile UX design prompt specifying custom glassmorphism theme styling, full-screen map backgrounds, bottom sheet drawer controllers, map-pan target reticles for adding waypoints, warning markers directly overlaying the map/chart paths, and empty-state onboarding imports.
    *   **UI Mockup Generation**: Utilized image generation to render a high-fidelity portrait UI mockup illustrating the layout balance of the map, compass, playback controllers, and bottom telemetry panel.
*   **Key Actions Taken**:
    *   Added `android-port` worktree and tracked branch in git.
    *   Drafted and saved `android_ux_design_prompt.md` containing absolute-linked image mockup as an artifact.
