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
 * Dynamically loads the Google Maps JavaScript API.
 * @param {string} apiKey Google Maps API Key
 * @returns {Promise<Object>} Resolves with the google.maps namespace
 */
export function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps && window.google.maps.maps3d) {
      resolve(window.google.maps);
      return;
    }

    // Clean up any existing scripts
    const existingScript = document.getElementById("gmaps-api-script");
    if (existingScript) existingScript.remove();

    const script = document.createElement("script");
    script.id = "gmaps-api-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=maps3d&v=alpha`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // Check if maps3d was loaded
      if (window.google && window.google.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error("Google Maps JavaScript API namespace failed to initialize."));
      }
    };
    script.onerror = (err) => reject(new Error("Failed to load Google Maps script: network error."));
    document.head.appendChild(script);
  });
}

/**
 * Calculates the bearing between two GPS coordinates
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

/**
 * Spherical linear interpolation for heading (handles 360 wrap)
 */
function slerpHeading(current, target, factor) {
  let diff = target - current;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  let newHeading = current + diff * factor;
  while (newHeading < 0) newHeading += 360;
  return newHeading % 360;
}

/**
 * Helper to generate a valid SVGElement (circle/dot) for 3D Marker templates.
 */
function createSvgDot(color, size = 24) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.style.display = "block";
  svg.style.filter = "drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.6))";

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", size / 2);
  circle.setAttribute("cy", size / 2);
  circle.setAttribute("r", size / 2 - 4); // leaving a 4px padding/border margin
  circle.setAttribute("fill", color);
  circle.setAttribute("stroke", "#1e293b");
  circle.setAttribute("stroke-width", "3");

  svg.appendChild(circle);
  return svg;
}

/**
 * Visual controller that wraps the Google Maps 3D Element.
 */
export class Map3DController {
  /**
   * @param {HTMLElement} container Parent element to inject the map into
   */
  constructor(container) {
    this.container = container;
    this.map = null;
    this.polylines = [];
    this.markers = [];
    this.activeRoute = null;
    this.currentTrackMarker = null; // moving marker when scrubbing elevation profile
    this.activeWarningPolyline = null;
    
    // Configurable Camera Properties
    this.cameraRange = 1500;
    this.cameraTilt = 65;
    this.colorCodeClimbs = false;
    this.isEditLocked = true;
    this.turnRateFactor = 0.015;

    // Simulation State
    this.currentCameraLat = 0;
    this.currentCameraLng = 0;
    this.currentCameraAltitude = 0;
    this.currentCameraHeading = 0;

    // Callbacks
    this.onHeadingChange = null;
    this.onCameraChange = null;
    this.onWaypointDragEnd = null;
  }

  /**
   * Initializes the 3D Map element.
   * @param {Object} mapsNamespace Google Maps namespace
   * @param {Object} center Initial center coordinate { lat, lng, altitude }
   */
  async initialize(mapsNamespace, center = { lat: 39.2508, lng: -106.2925, altitude: 3100 }) {
    this.container.innerHTML = ""; // Clear loader message

    const { Map3DElement, Marker3DElement, Polyline3DElement } = await google.maps.importLibrary("maps3d");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    this.Map3DElement = Map3DElement;
    this.Marker3DElement = Marker3DElement;
    this.Polyline3DElement = Polyline3DElement;
    this.AdvancedMarkerElement = AdvancedMarkerElement;

    this.map = new Map3DElement({
      center: { lat: center.lat, lng: center.lng, altitude: center.altitude + 2000 },
      range: this.cameraRange,
      tilt: this.cameraTilt,
      heading: 0,
      mode: "HYBRID"
    });

    this.map.style.width = "100%";
    this.map.style.height = "100%";
    this.map.style.display = "block";

    this.container.appendChild(this.map);

    // Setup Event Listeners for camera/orientation change to drive the compass
    this.map.addEventListener("gmp-headingchange", () => {
      if (this.onHeadingChange && this.map) {
        this.onHeadingChange(this.map.heading);
      }
    });

    this.map.addEventListener("gmp-camerapositionchange", () => {
      if (this.onCameraChange && this.map) {
        this.onCameraChange({
          heading: this.map.heading,
          tilt: this.map.tilt,
          range: this.map.range
        });
      }
    });

    this.currentTrackMarker = null;
  }

  /**
   * Updates camera configuration parameters dynamically.
   */
  setCameraConfig(range, tilt) {
    this.cameraRange = range;
    this.cameraTilt = tilt;
    
    // Update map immediately if initialized and not in fly-through playback
    if (this.map) {
      this.map.range = range;
      this.map.tilt = tilt;
    }
  }

  /**
   * Toggles the edit lock on all current and future markers.
   */
  setEditLock(isLocked) {
    this.isEditLocked = isLocked;
    this.markers.forEach(marker => {
      marker.gmpDraggable = !isLocked;
    });
  }

  /**
   * Clears the current route overlays and markers.
   */
  clear() {
    if (!this.map) return;
    
    // Remove polylines
    this.polylines.forEach((poly) => {
      try {
        this.map.removeChild(poly);
      } catch (e) {
        poly.remove();
      }
    });
    this.polylines = [];

    // Remove markers
    this.markers.forEach((marker) => {
      try {
        this.map.removeChild(marker);
      } catch (e) {
        marker.remove();
      }
    });
    this.markers = [];

    if (this.currentTrackMarker) {
      try {
        this.map.removeChild(this.currentTrackMarker);
      } catch (e) {
        this.currentTrackMarker.remove();
      }
      this.currentTrackMarker = null;
    }

    if (this.activeWarningPolyline) {
      try {
        this.map.removeChild(this.activeWarningPolyline);
      } catch (e) {
        this.activeWarningPolyline.remove();
      }
      this.activeWarningPolyline = null;
    }
  }

  /**
   * Renders a route's tracks and waypoints on the 3D map.
   * @param {Object} route Route object parsed by gpx-parser
   * @param {boolean} colorCodeClimbs Override settings to toggle climb color code on/off
   */
  async drawRoute(route, colorCodeClimbs = this.colorCodeClimbs) {
    if (!this.map) return;
    this.clear();
    this.activeRoute = route;
    this.colorCodeClimbs = colorCodeClimbs;

    const { Marker3DElement, Polyline3DElement } = await google.maps.importLibrary("maps3d");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    this.Marker3DElement = Marker3DElement;
    this.Polyline3DElement = Polyline3DElement;
    this.AdvancedMarkerElement = AdvancedMarkerElement;

    const trackpoints = route.trackpoints;
    if (trackpoints.length < 2) return;

    // Calculate bounds to show the full course overhead
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    trackpoints.forEach(pt => {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lon < minLon) minLon = pt.lon;
      if (pt.lon > maxLon) maxLon = pt.lon;
    });

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const latDiff = maxLat - minLat;
    const lngDiff = maxLon - minLon;

    // Convert degree differences to physical meters
    const H = latDiff * 111000;
    const W = lngDiff * 111000 * Math.cos(centerLat * Math.PI / 180);

    let mapWidth = window.innerWidth;
    let mapHeight = window.innerHeight;
    if (this.map) {
      const rect = this.map.getBoundingClientRect();
      if (rect.width && rect.height) {
        mapWidth = rect.width;
        mapHeight = rect.height;
      }
    }

    // 3D Camera FOV vertical constant (safely calibrated to 30 degrees)
    const tanHalfFov = Math.tan((30 / 2) * Math.PI / 180);
    
    // Required camera range to fit height vertically
    const rangeH = H / (2 * tanHalfFov);
    
    // Required camera range to fit width horizontally
    const aspectRatio = mapWidth / mapHeight;
    const rangeW = W / (2 * tanHalfFov * aspectRatio);
    
    // Select largest bounding dimension constraint and add a 50% safety padding margin
    const idealRange = Math.max(5000, Math.max(rangeH, rangeW) * 1.5);

    this.map.center = { lat: centerLat, lng: centerLon, altitude: 0 };
    this.map.range = idealRange;
    this.map.tilt = 0; // Look straight down
    this.map.heading = 0; // North up

    // Downsample trackpoints for 3D rendering to prevent WebGL/Browser hangs on massive files
    // 1000 points is enough for visual fidelity at the macro scale without crashing
    const maxPoints = 1500;
    const step = Math.max(1, Math.floor(trackpoints.length / maxPoints));
    const renderPts = [];
    for (let i = 0; i < trackpoints.length; i += step) {
      renderPts.push(trackpoints[i]);
    }
    // Always include the last point
    if (renderPts[renderPts.length - 1] !== trackpoints[trackpoints.length - 1]) {
      renderPts.push(trackpoints[trackpoints.length - 1]);
    }

    if (colorCodeClimbs) {
      // Climb Color Visualizer:
      // Red: steep climbs (> 2% grade)
      // Green: descents (< -2% grade)
      // Blue: neutral segments (-2% to 2% grade)
      const CLIMB_COLORS = {
        climb: "#ff4e4e",   // Red
        descent: "#52e098", // Green
        neutral: "#3ea4ff"  // Blue
      };

      // Smooth grades using a 10-point moving average to filter GPS wiggles.
      const windowSize = 10;
      const smoothedGrades = new Array(renderPts.length);
      for (let i = 0; i < renderPts.length; i++) {
        let sum = 0;
        let count = 0;
        const start = Math.max(0, i - windowSize / 2);
        const end = Math.min(renderPts.length - 1, i + windowSize / 2);
        for (let j = start; j <= end; j++) {
          sum += renderPts[j].grade;
          count++;
        }
        smoothedGrades[i] = sum / count;
      }

      const getClimbCategory = (grade) => {
        if (grade > 2.5) return "climb";
        if (grade < -2.5) return "descent";
        return "neutral";
      };

      let currentSegment = [];
      let currentCategory = getClimbCategory(smoothedGrades[0]);

      for (let i = 0; i < renderPts.length; i++) {
        const pt = renderPts[i];
        const category = getClimbCategory(smoothedGrades[i]);

        if (category !== currentCategory && currentSegment.length > 0) {
          // 15m relative offset to drape slightly above the ground
          currentSegment.push({ lat: pt.lat, lng: pt.lon, altitude: 15 });
          this.addPolylineSegment(currentSegment, CLIMB_COLORS[currentCategory]);
          
          currentSegment = [{ lat: pt.lat, lng: pt.lon, altitude: 15 }];
          currentCategory = category;
        } else {
          currentSegment.push({ lat: pt.lat, lng: pt.lon, altitude: 15 });
        }
      }

      if (currentSegment.length > 0) {
        this.addPolylineSegment(currentSegment, CLIMB_COLORS[currentCategory]);
      }
    } else {
      // Standard visualizer: single solid blue/cyan line
      const coords = renderPts.map(pt => ({ lat: pt.lat, lng: pt.lon, altitude: 15 }));
      this.addPolylineSegment(coords, "#00d2ff");
    }

    // Add Waypoints
    route.waypoints.forEach((wpt) => {
      const marker = new this.AdvancedMarkerElement({
        position: { lat: wpt.lat, lng: wpt.lon },
        title: wpt.name,
        gmpClickable: true,
        gmpDraggable: !this.isEditLocked,
        content: createWaypointSvg(wpt)
      });

      // Add click popover details
      marker.addEventListener("click", () => {
        const event = new CustomEvent("waypoint-click", { detail: wpt });
        window.dispatchEvent(event);
      });

      // Draggable Editing logic
      marker.addEventListener("dragend", () => {
        if (this.onWaypointDragEnd) {
          this.onWaypointDragEnd(wpt, marker.position);
        }
      });

      this.map.append(marker);
      this.markers.push(marker);
    });

    // Create scrubbing tracker cursor
    const startPt = trackpoints[0];
    this.currentTrackMarker = new this.AdvancedMarkerElement({
      position: { lat: startPt.lat, lng: startPt.lon },
      content: createSvgDot("#ffeb3b", 24)
    });

    this.map.append(this.currentTrackMarker);
  }

  /**
   * Helper to draw a single 3D polyline segment.
   */
  addPolylineSegment(coordinates, strokeColor) {
    if (!this.Polyline3DElement) return;
    const poly = new this.Polyline3DElement({
      strokeColor: strokeColor,
      strokeWidth: 6,
      altitudeMode: "CLAMP_TO_GROUND",
      path: coordinates
    });
    this.map.append(poly);
    this.polylines.push(poly);
  }

  /**
   * Synchronizes map view / camera target to a specific trackpoint by index.
   * @param {number} trkptIndex Trackpoint index to snap to
   * @param {boolean} smooth True if using camera flyTo animation, false for instantaneous jump
   */
  syncToTrackpoint(trkptIndex, smooth = false) {
    if (!this.map || !this.activeRoute) return;
    const pt = this.activeRoute.trackpoints[trkptIndex];
    if (!pt) return;

    if (this.currentTrackMarker) {
      this.currentTrackMarker.position = { lat: pt.lat, lng: pt.lon };
    }

    this.currentCameraLat = pt.lat;
    this.currentCameraLng = pt.lon;
    this.currentCameraAltitude = pt.ele;

    const targetCamera = {
      center: { lat: pt.lat, lng: pt.lon, altitude: pt.ele },
      range: this.cameraRange, 
      tilt: this.cameraTilt,
      heading: this.map.heading, // maintain current heading
    };

    if (smooth) {
      this.map.flyCameraTo({
        endCamera: targetCamera,
        durationMillis: 800,
      });
    } else {
      this.map.center = targetCamera.center;
      this.map.range = targetCamera.range;
      this.map.tilt = targetCamera.tilt;
    }
  }

  /**
   * Smoothly animates map camera along the route for fly-through showcase using bungee physics.
   * @param {Object} pt Trackpoint coordinate `{lat, lon, ele}`
   * @param {number} targetHeading Math heading angle looking forward
   */
  updateCamera(pt, targetHeading) {
    if (!this.map || !pt) return;

    if (this.currentTrackMarker) {
      this.currentTrackMarker.position = { lat: pt.lat, lng: pt.lon, altitude: 15 };
    }

    if (this.currentCameraAltitude === 0) {
      this.currentCameraLat = pt.lat;
      this.currentCameraLng = pt.lon;
      this.currentCameraAltitude = pt.ele;
      this.currentCameraHeading = targetHeading;
    }

    // Apply a loose "bungee" lerp to the camera's focal point.
    // This creates a soft deadzone/hysteresis so the camera isn't jerked around 
    // by every tiny GPS deviation, giving the marker room to move.
    this.currentCameraLat += (pt.lat - this.currentCameraLat) * 0.05;
    this.currentCameraLng += (pt.lon - this.currentCameraLng) * 0.05;
    this.currentCameraAltitude += (pt.ele - this.currentCameraAltitude) * 0.05;

    // Heavily damp the turn rate
    this.currentCameraHeading = slerpHeading(this.currentCameraHeading, targetHeading, this.turnRateFactor);

    this.map.center = { lat: this.currentCameraLat, lng: this.currentCameraLng, altitude: this.currentCameraAltitude };
    this.map.range = this.cameraRange;
    this.map.tilt = this.cameraTilt;
    this.map.heading = this.currentCameraHeading;
  }

  /**
   * Highlights a safety warning segment with a thicker polyline outline on the 3D map
   * and smoothly pans/zooms the camera to focus on it.
   * @param {Object} warn Warning object from activeRoute.warnings
   */
  highlightWarning(warn) {
    if (!this.map || !this.activeRoute) return;

    // 1. Clear previous warning highlight
    if (this.activeWarningPolyline) {
      try {
        this.map.removeChild(this.activeWarningPolyline);
      } catch (e) {
        this.activeWarningPolyline.remove();
      }
      this.activeWarningPolyline = null;
    }

    const trackpoints = this.activeRoute.trackpoints;
    // Extract points within the warning range
    const warnPts = trackpoints.filter(pt => pt.dist_m >= warn.startDist && pt.dist_m <= warn.endDist);
    if (warnPts.length === 0) return;

    // 2. Select color based on warning type
    let strokeColor = "rgba(245, 158, 11, 0.55)"; // default Amber for Resource Deserts
    if (warn.type === "DIFFICULT_CLIMB" || warn.type === "EXPOSURE_RISK") {
      strokeColor = "rgba(239, 68, 68, 0.6)"; // Red for terrain hazards
    } else if (warn.type === "SPATIAL_MISMATCH") {
      strokeColor = "rgba(168, 85, 247, 0.6)"; // Purple for spatial mismatches
    }

    // 3. Create a thick highlight polyline
    if (!this.Polyline3DElement) return;
    this.activeWarningPolyline = new this.Polyline3DElement({
      strokeColor: strokeColor,
      strokeWidth: 14,
      altitudeMode: "CLAMP_TO_GROUND",
      path: warnPts.map(pt => ({ lat: pt.lat, lng: pt.lon, altitude: 10 }))
    });
    
    this.map.append(this.activeWarningPolyline);

    // 4. Calculate bounds of the warning segment to fit the camera
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    warnPts.forEach(pt => {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lon < minLon) minLon = pt.lon;
      if (pt.lon > maxLon) maxLon = pt.lon;
    });

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const latDiff = maxLat - minLat;
    const lngDiff = maxLon - minLon;

    // Convert degree differences to physical meters
    const H = latDiff * 111000;
    const W = lngDiff * 111000 * Math.cos(centerLat * Math.PI / 180);

    let mapWidth = window.innerWidth;
    let mapHeight = window.innerHeight;
    const rect = this.map.getBoundingClientRect();
    if (rect.width && rect.height) {
      mapWidth = rect.width;
      mapHeight = rect.height;
    }

    const tanHalfFov = Math.tan((30 / 2) * Math.PI / 180);
    const rangeH = H / (2 * tanHalfFov);
    const aspectRatio = mapWidth / mapHeight;
    const rangeW = W / (2 * tanHalfFov * aspectRatio);
    
    // Safety margin 1.5x, but clamp minimum range to 1000m for viewability
    const idealRange = Math.max(1000, Math.max(rangeH, rangeW) * 1.5);

    // Compute average elevation of the warning segment to prevent underground camera positioning
    let sumEle = 0;
    warnPts.forEach(pt => {
      sumEle += pt.ele;
    });
    const avgEle = sumEle / warnPts.length;

    // Smoothly fly camera to show the warning segment
    this.map.flyCameraTo({
      endCamera: {
        center: { lat: centerLat, lng: centerLon, altitude: avgEle },
        range: idealRange,
        tilt: 45, // Tilted view to show terrain details
        heading: this.map.heading // keep current heading
      },
      durationMillis: 1500
    });
  }
}

/**
 * Generates a premium custom vector SVG node representing the type of waypoint.
 * Supports Start, Finish, First Aid/Medical, Water, Food/Aid Station, and Default markers.
 * @param {Object} wpt Waypoint details
 * @returns {SVGElement} SVG DOM node
 */
function createWaypointSvg(wpt) {
  const sym = (wpt.sym || "").toLowerCase();
  const name = (wpt.name || "").toLowerCase();
  const station = wpt.extensions?.station;
  const services = station?.services || {};

  let type = "waypoint"; // Default

  if (name === "start" || sym.includes("start")) {
    type = "start";
  } else if (name === "finish" || sym.includes("finish") || sym.includes("checkered")) {
    type = "finish";
  } else if (services.medical || sym.includes("medical") || sym.includes("first aid") || sym.includes("hospital") || sym.includes("aid")) {
    type = "medical";
  } else if (services.food || services.hot_food || sym.includes("food") || sym.includes("restaurant")) {
    type = "food";
  } else if (services.water || services.unmanaged_water || sym.includes("water") || sym.includes("drop") || sym.includes("spring")) {
    type = "water";
  } else if (station?.type === "aid-station" || sym.includes("station") || sym.includes("aid")) {
    type = "aid-station";
  }

  const width = 36;
  const height = 36;

  let bg = "#ffb834"; // default orange-yellow
  let icon = "";

  if (type === "start") {
    bg = "#10b981"; // Emerald Green
    icon = `<path d="M15 12l9 6-9 6z" fill="white" />`;
  } else if (type === "finish") {
    bg = "#ef4444"; // Red
    icon = `
      <path d="M12 10h12v10H12z" fill="white" />
      <path d="M12 10h3v3h-3zm6 0h3v3h-3zm-3 3h3v3h-3zm6 0h3v3h-3zm-6 3h3v3h-3zm6 0h3v3h-3z" fill="black" />
      <path d="M11 9h1v18h-1z" fill="white" />
    `;
  } else if (type === "medical") {
    bg = "#f43f5e"; // Rose Red
    icon = `<path d="M16 11h4v5h5v4h-5v5h-4v-5h-5v-4h5z" fill="white" />`;
  } else if (type === "food" || type === "aid-station") {
    bg = "#8b5cf6"; // Royal Purple
    icon = `
      <path d="M12 11v6h2v-6h-2zm3-2v8h1.5v-8H15zm4 2v6h2v-6h-2zm-8-3h11a1 1 0 0 1 1 1v12a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V10a1 1 0 0 1 1-1z" fill="none" stroke="white" stroke-width="2" />
      <path d="M13 13v4m5-4v4" stroke="white" stroke-width="1.5" stroke-linecap="round" />
    `;
  } else if (type === "water") {
    bg = "#06b6d4"; // Cyan
    icon = `<path d="M18 11c0 0-5 5.5-5 8.5a5 5 0 0 0 10 0c0-3-5-8.5-5-8.5z" fill="white" />`;
  } else {
    bg = "#3b82f6"; // Blue
    icon = `<circle cx="18" cy="18" r="4.5" fill="white" />`;
  }

  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 36 36">
      <defs>
        <filter id="marker-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.4"/>
        </filter>
      </defs>
      <circle cx="18" cy="18" r="14" fill="${bg}" stroke="#ffffff" stroke-width="2.5" filter="url(#marker-shadow)" />
      ${icon}
    </svg>
  `;

  const parser = new DOMParser();
  return parser.parseFromString(svgString, "image/svg+xml").documentElement;
}
