# Projects Index

This file tracks the active projects, their goals, and current status in the `RuffTerrain` workspace.

## Active Projects

### 🗺️ RuffTerrain: 3D Map Showcase
An Android application designed to demonstrate the integration and features of the **Google Maps 3D SDK for Android** in a modern Jetpack Compose codebase.

*   **Status**: 🟢 Initializing Setup
*   **Goal**: Create a showcase app demonstrating 3D map features, custom camera movements, 3D overlays, and responsive UI.
*   **Target SDKs**: Google Maps 3D SDK for Android
*   **Worktrees**:
    *   [`main/`](file:///Users/dkhawk/Projects/RuffTerrain/main) (Base/Releases)
    *   [`feature-preview-poi/`](file:///Users/dkhawk/Projects/RuffTerrain/feature-preview-poi) (Feature: Enhanced Preview & POI Weather)

---

## Workspace Configuration
*   **Git Setup**: Bare repository in `.bare/` with worktrees in the root.
*   **Continuous Log**: [`BUILD_JOURNAL.md`](file:///Users/dkhawk/Projects/RuffTerrain/BUILD_JOURNAL.md)

## Reference Repositories
*   [Google Maps 3D SDK Samples](https://github.com/googlemaps-samples/android-maps3d-samples)
*   [Android Maps Compose](https://github.com/googlemaps/android-maps-compose)
*   [Google Maps Android Samples](https://github.com/googlemaps-samples/android-samples)

## Google Maps Link & Formatting Guidelines
When generating documentation, directories, spreadsheets, or markdown references with Google Maps coordinates (`lat`, `lon`):
*   **NEVER** use plain centering URLs (`https://www.google.com/maps/@lat,lon,15z`), as they do not drop a visible marker pin or provide one-click navigation.
*   **Always provide Dropped Pin (Visible Marker) URLs**: `https://www.google.com/maps/search/?api=1&query=lat,lon` (instantly drops a visible red marker pin and opens the side panel where "Directions" is immediately accessible).
*   **Always provide One-Click Driving Directions URLs**: `https://www.google.com/maps/dir/?api=1&destination=lat,lon&travelmode=driving` (immediately launches Google Maps turn-by-turn driving navigation directly to the checkpoint).
