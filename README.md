# 🗺️ Ruff Terrain — 3D Course Architect & Route Visualizer

Kokopelli's Ruff Terrain Explorer is a client-side WebGL web application designed to help hikers, trail runners, and other outdoor adventurers import, enrich, and visualize remote trail courses in high-fidelity 3D. 

It overlays route GPX/KML paths onto 3D satellite terrain, calculates detailed safety metrics (difficult climbs and resource gaps), provides an interactive cinematic playback fly-through simulation, and integrates with the **Gemini Course Architect** generative AI to ingest unstructured text or PDFs (such as race detail web pages) to auto-generate checkpoints, aid stations, and safety attributes.

---

## 🚀 Key Features

1. **High-Fidelity 3D Map Renderer**: Embeds the Google Maps JavaScript 3D Maps API to track routes, color-code steep climbs vs. descents, and display custom 3D interactive waypoint markers.
2. **Resilient Elevation Correction**: Batches coordinate coordinates to fetch real-world ground elevations from Open-Meteo with an automatic Open-Elevation fallback, then applies an 11-point moving average filter.
3. **Safety Alerts Engine**: Automatically evaluates routes for:
   * **Resource Deserts**: Gaps between water/food sources exceeding 5 miles (~8km).
   * **Difficult Climbs**: Steep climbs (grade > 3.5%) categorized by difficulty scores (Moderate to Extreme).
   * **Spatial Mismatches**: Waypoints whose coordinates sit more than 2,000 meters off-route.
4. **Gemini Course Architect Chat**: Direct Gemini AI integration using strict JSON schemas to modify, add, or override waypoints from chat commands or uploaded PDF race guides (parsed client-side using PDF.js).
5. **Course Profile Canvas Scrubber**: A high-DPI retina-calibrated Canvas elevation chart displaying climbs, custom alerts highlight, and real-time hover telemetries.
6. **Export Enhanced GPX**: Serializes course configurations back into standard GPX decorated with custom `ca:` namespace XML annotations to preserve aid station details.
7. **Weather Forecast Integration**: Integrates the Google Weather API to display 3-hour forecasts, wind speed/direction, humidity, cloud cover, and precipitation probability along the scrubber timeline and within checkpoint details dialogs.

---

## 🛠️ Tech Stack

* **Language**: Vanilla modern ES6 JavaScript modules, HTML5, and CSS3.
* **Map Engine**: Google Maps JavaScript 3D Maps API (`Map3DElement`, `Polyline3DElement`, `Marker3DInteractiveElement`).
* **Visuals & Charts**: HTML5 Canvas API (custom drawing with device-pixel-ratio scaling).
* **AI Integration**: Google Gemini API via HTTPS REST (`v1beta` endpoint).
* **Weather Integration**: Google Weather API via HTTPS REST (`forecast/hours:lookup` endpoint).
* **Bundler & Server**: Vite JS dev & production builds.
* **Testing Suite**: Native Node.js Test Runner.

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your machine:
* **Node.js** (v18.0.0 or higher)
* **npm** (v9.0.0 or higher)
* **Google Maps Platform API Key** (with the Maps JavaScript API and 3D Maps SDK enabled)
* **Google Gemini API Key** (for using the chat assistant or description-to-waypoint generation)

---

## ⚙️ Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/dkhawk/RuffTerrain.git
cd RuffTerrain
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env.local` file inside the root directory to store your credentials:
```bash
VITE_MAPS_API_KEY=your_google_maps_api_key_here
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

*Note: You can also configure or update these keys directly in the application's **Settings panel** (⚙️ button in top-left HUD), which will persist them locally in your browser's `localStorage`.*

### 4. Start the Development Server
```bash
npm run dev
```
Open the URL shown in your terminal (usually something like **http://localhost:5173/**) in your browser.

### 5. Run the Test Suite
To run the local unit tests (covering GPX/KML parsing, custom XML annotations, sorting, and helper logic):
```bash
npm test
```

---

## ⌨️ Keyboard Shortcuts

RuffTerrain includes keyboard shortcuts to speed up route analysis and planning:

| Key | Action |
| --- | --- |
| `Space` | Toggle Fly-Through Play / Pause |
| `[` / `]` | Decrease / Increase playback speed |
| `C` / `c` | Toggle Gemini Chat Panel |
| `A` / `a` | Toggle Safety Alerts Panel |
| `W` / `w` | Toggle Weather Forecast Panel |
| `E` / `e` | Toggle Open / Import (Edit Course) Panel |
| `L` / `l` | Toggle Track Lock state |
| `Home` / `End` | Jump simulation playback to Start / Finish |
| `Esc` | Close active dialogs, settings, or side panels |
| `?` | Toggle Keyboard Shortcuts Help Overlay |

---

## 📐 Mathematical Algorithms & Calculations

### 1. Spatial Coordinate Distance (Haversine Formula)
Used to calculate the distance $d$ in meters between two lat/lon coordinate pairs on a spherical Earth:

$$\Delta \phi = \frac{(\text{lat}_2 - \text{lat}_1) \cdot \pi}{180}$$
$$\Delta \lambda = \frac{(\text{lon}_2 - \text{lon}_1) \cdot \pi}{180}$$
$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos\left(\frac{\text{lat}_1 \cdot \pi}{180}\right) \cdot \cos\left(\frac{\text{lat}_2 \cdot \pi}{180}\right) \cdot \sin^2\left(\frac{\Delta \lambda}{2}\right)$$
$$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$
$$d = R \cdot c$$

*Where $R = 6,371,000\text{ meters}$ (Earth's radius).*

### 2. Slope Grade Calculation
To calculate slope grade (%) at a trackpoint while filtering out GPS jitter, the app evaluates altitude differences over a stable **30-meter cumulative distance baseline**:

$$\text{run} = d_{\text{current}} - d_{\text{base}}$$
$$\text{rise} = h_{\text{current}} - h_{\text{base}}$$
$$\text{grade} = \left(\frac{\text{rise}}{\text{run}}\right) \cdot 100 \quad (\text{if }\text{run} > 5\text{ meters})$$

*The base index is found by walking backward until the cumulative distance difference is $\ge 30\text{ meters}$.*

### 3. Snapping Projections
When waypoints are added or modified, they are snapped to the closest route segment:
1. Scale lon/lat coordinate difference based on average latitude.
2. Calculate projection fraction $t$ along segment $AB$:
   $$t = \max\left(0, \min\left(1, \frac{\vec{w} \cdot \vec{v}}{\|\vec{v}\|^2}\right)\right)$$
3. Interpolate the snapped coordinates, elevations, and cumulative distances using $t$.

---

## 🗂️ Course Architect Custom XML GPX Schema (`ca:`)

When exporting GPX files, RuffTerrain injects custom XML namespace metadata under `xmlns:ca="http://coursearchitect.com/schema/v1"` inside `<wpt>` extensions. This keeps aid station services, cutoffs, and alerts structured:

```xml
<wpt lat="40.0150" lon="-105.2705">
  <ele>1624.00</ele>
  <name>Resurrection Aid Station</name>
  <sym>icons/aid_station.svg</sym>
  <extensions>
    <ca:station type="segmenting" id="resurrection" subtype="aid_station">
      <ca:passes>
        <ca:pass num="1" dist_m="7242" label="Outbound" cutoff_clock="9:15 AM" cutoff_elapsed="PT2H15M" />
        <ca:pass num="2" dist_m="27681" label="Inbound" cutoff_clock="1:15 PM" cutoff_elapsed="PT6H15M" />
      </ca:passes>
      <ca:accessibility crew_allowed="true" pacer_allowed="false" vehicle_tier="auto" drop_bag_allowed="true" />
      <ca:services water="true" unmanaged_water="false" food="true" toilets="true" medical="true" />
      <ca:navigation_alert severity="info" turn_type="straight" prompt="Keep straight past reservoir road." />
    </ca:station>
  </extensions>
</wpt>
```

---

## 📦 Directory Structure

```
.
├── index.html            # Main markup layout, HUD panels, and templates
├── package.json          # Node scripts and dependencies (Vite, PDF.js, etc.)
├── test/                 # Test files (TAP-based unit tests)
├── public/               # Static assets (custom SVG waypoint pins and icons)
└── src/
    ├── main.js           # Core controller; coordinates playback, UI state, and storage
    ├── style.css         # CSS variables, premium glassmorphism tokens, and animations
    ├── gpx-parser.js     # GPX/KML parsers, distance math, snapping, alerts engine
    ├── gpx-writer.js     # Serializes route state to valid XML GPX with ca: namespaces
    ├── map-3d.js         # Controls WebGL Map3DElement camera, pins, and tracklines
    ├── elevation-chart.js# Canvas-based high-DPI elevation scrubber chart
    ├── fetch-elevation.js# Resilient elevation corrector (batching, retry logic, fallback)
    ├── fetch-weather.js  # Resilient weather forecaster (caching, condition mapping)
    └── gemini-client.js  # Interconnects user inputs/files with Gemini REST API
```

---

## 🔧 Troubleshooting

### Flat Elevation Profile
* **Issue**: Imported GPX file does not contain elevation tags, resulting in a flat elevation profile line (0 elevation) and no climb alert calculations.
* **Fix**: Use the **`⚡ Fetch & Correct Elevations`** button located at the bottom of the **Edit Course** panel. The app will fetch satellite-derived elevation data from Open-Meteo and rebuild the elevation profile and climb stats. Export the corrected file using **`📥 Export Enhanced GPX`** to save the elevation data back into your GPX file.

### WebGL Map Fails to Render
* **Issue**: The map pane is black or satellite imagery does not render.
* **Fix**: Check that your Google Maps API key is correct in the Settings panel and that your key has permission to access the **Map3DElement / 3D Maps API** (which requires enabling the standard Maps JavaScript API under billing-enabled Google Cloud projects).
