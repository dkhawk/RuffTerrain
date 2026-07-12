  1. 3D Map Renderer & Camera Playback Simulation (requirements.md)
      • Renders courses on a high-fidelity 3D WebGL satellite map using Google's 3D Maps API.
      • Features interactive waypoint markers, a 3D compass overlay, color-coded route segments highlighting steep climbs, and a smooth camera fly-through playback mode with automatic pauses at points of interest (POIs).
  2. Route File Ingestion, Smoothing & Correction (requirements.md)
      • Supports importing GPX and KML files.
      • Automatically smooths elevation profiles using an 11-point moving average filter and updates/corrects elevations using throttled batch calls to the Open-Meteo Elevation API.
      • Supports dynamic route splicing to handle detours when editing or dragging waypoints.
  3. Gemini Course Architect AI Chat Integration (requirements.md)
      • Integrates Google's Gemini API to process unstructured race detail text or PDF uploads (parsed directly in the browser via PDF.js).
      • Generates structured aid stations, cutoff times (parsed as ISO 8601 durations), amenities, and navigation instructions mapping to a strict system schema.
  4. Safety Warnings Engine (requirements.md)
      • Automatically detects safety hazards including Resource Deserts (gaps over 5 miles without food/water), Difficult Climbs (climb segments with custom difficulty scores based on grade and elevation gain), and Spatial     
      Mismatch (waypoint drift greater than 2000 meters from the course line).
      • Interacting with a warning automatically flies the 3D camera to highlight the specific problematic route segment.
  5. Interactive Elevation Scrubber Chart (requirements.md)
      • Renders a high-DPI custom Canvas graph of the course profile showing cumulative progress and slope grade.
      • Includes interactive tooltips and popovers that reveal waypoint details, cutoffs, and visual iconography for available amenities (Water, Food, Restrooms, Medical, and Sleep) when scrubbed or hovered.
