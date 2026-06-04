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
    
    // Configurable Camera Properties
    this.cameraRange = 1500;
    this.cameraTilt = 65;
    this.colorCodeClimbs = false;
    this.isEditLocked = true;

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

    await google.maps.importLibrary("maps3d");

    this.map = document.createElement('gmp-map-3d');
    this.map.center = { lat: center.lat, lng: center.lng, altitude: center.altitude + 2000 };
    this.map.range = this.cameraRange;
    this.map.tilt = this.cameraTilt;
    this.map.heading = 0;

    this.map.mode = "HYBRID"; // Show 3D building/terrain details plus label overlays
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

    // Create the scrubbing cursor marker (interactive 3D pin)
    this.currentTrackMarker = document.createElement('gmp-marker-3d');
    this.currentTrackMarker.position = { lat: center.lat, lng: center.lng, altitude: 15 };
    this.currentTrackMarker.altitudeMode = "RELATIVE_TO_GROUND";
    this.currentTrackMarker.extrude = false;
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

    try {
      this.map.removeChild(this.currentTrackMarker);
    } catch (e) {}
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

    await google.maps.importLibrary("maps3d");

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

    // Approximate the distance of the bounding box diagonal using Haversine
    const R = 6371000;
    const dLat = (maxLat - minLat) * Math.PI / 180;
    const dLon = (maxLon - minLon) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(minLat * Math.PI / 180) * Math.cos(maxLat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distM = R * c;

    this.map.center = { lat: centerLat, lng: centerLon, altitude: 0 };
    this.map.range = Math.max(1000, distM * 1.15); // Add padding
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
      const marker = document.createElement('gmp-marker-3d-interactive');
      marker.position = { lat: wpt.lat, lng: wpt.lon, altitude: wpt.ele };
      marker.altitudeMode = "RELATIVE_TO_GROUND";
      marker.extruded = true;
      marker.drawsWhenOccluded = true;
      marker.label = wpt.name;

      const iconImg = document.createElement("img");
      let iconUrl = wpt.sym || "icons/services.svg";
      if (!iconUrl.startsWith("/")) iconUrl = "/" + iconUrl; // normalize path

      iconImg.src = iconUrl;
      iconImg.style.width = "28px";
      iconImg.style.height = "28px";
      iconImg.style.filter = "drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.5))";

      const template = document.createElement('template');
      
      const wrapper = document.createElement("div");
      wrapper.className = "marker-wrapper";
      wrapper.appendChild(iconImg);

      // Boundary detection for edge cutoffs
      if (wpt.name.toLowerCase() === "start" || route.waypoints.indexOf(wpt) === 0) {
        wrapper.classList.add("edge-left");
      } else if (wpt.name.toLowerCase() === "finish" || route.waypoints.indexOf(wpt) === route.waypoints.length - 1) {
        wrapper.classList.add("edge-right");
      }

      // Hover Pane
      const tooltip = document.createElement("div");
      tooltip.className = "marker-tooltip";
      tooltip.textContent = wpt.name;
      wrapper.appendChild(tooltip);

      template.content.appendChild(wrapper);
      marker.appendChild(template);

      // Add click popover details
      marker.addEventListener("gmp-click", () => {
        const event = new CustomEvent("waypoint-click", { detail: wpt });
        window.dispatchEvent(event);
      });

      // Draggable Editing logic
      marker.gmpDraggable = !this.isEditLocked;
      marker.addEventListener("gmp-dragend", () => {
        if (this.onWaypointDragEnd) {
          this.onWaypointDragEnd(wpt, marker.position);
        }
      });

      this.map.append(marker);
      this.markers.push(marker);
    });

    // Add scrubbing tracker cursor
    if (this.currentTrackMarker) {
      this.currentTrackMarker.position = { lat: startPt.lat, lng: startPt.lon, altitude: 15 };
      this.map.append(this.currentTrackMarker);
    }
  }

  /**
   * Helper to draw a single 3D polyline segment.
   */
  addPolylineSegment(coordinates, strokeColor) {
    const poly = document.createElement('gmp-polyline-3d');
    poly.strokeColor = strokeColor;
    poly.strokeWidth = 6;
    poly.altitudeMode = "RELATIVE_TO_GROUND";
    poly.coordinates = coordinates;
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
      this.currentTrackMarker.position = { lat: pt.lat, lng: pt.lon, altitude: 15 };
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
    this.currentCameraHeading = slerpHeading(this.currentCameraHeading, targetHeading, 0.015);

    this.map.center = { lat: this.currentCameraLat, lng: this.currentCameraLng, altitude: this.currentCameraAltitude };
    this.map.range = this.cameraRange;
    this.map.tilt = this.cameraTilt;
    this.map.heading = this.currentCameraHeading;
  }
}
