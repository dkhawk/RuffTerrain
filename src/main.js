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
 * @fileoverview Main Controller logic for the Lizard Kokopelli Ruff Terrain Web application.
 * Coordinates route loading, AI studio augmentations, 3D satellite visualization, and flight preview dashboards.
 *
 * Why this structure:
 * We manage all states globally (active route, units system, camera configurations, recent courses, edit lock status).
 * By keeping a metric-base model internally and handling conversions strictly in the rendering layer, we prevent rounding drifts.
 * The preview controller iterates through trackpoint bearings to control camera panning and triggers contextual auto-pauses when approaching points of interest.
 */

import { parseGPX, reconcileCourse, getMetricsForPoint } from "./gpx-parser.js";
import { writeGPX } from "./gpx-writer.js";
import { correctRouteElevations } from "./fetch-elevation.js";
import { sendToGemini } from "./gemini-client.js";
import { loadGoogleMaps, Map3DController, calculateBearing } from "./map-3d.js";
import { ElevationChart } from "./elevation-chart.js";

// ==========================================
// STATE MANAGEMENT & CONFIGURATIONS
// ==========================================

// Credentials (API keys fallback to environment variables from .env.local)
let apiKeyMaps = localStorage.getItem("gmaps_api_key") || import.meta.env.VITE_GMAPS_API_KEY || "";
let apiKeyGemini = localStorage.getItem("gemini_api_key") || import.meta.env.VITE_GEMINI_API_KEY || "";

// Active Route details parsed from GPX data
let activeRoute = null;
let chatHistory = [];

// Interface Controllers
let mapController = null;
let elevationChart = null;

// Display Units ('metric' or 'imperial')
let units = localStorage.getItem("settings_units") || "imperial";

// POI Auto-pause Duration in seconds (set to 0 for infinite manual pause)
let pauseDuration = parseInt(localStorage.getItem("settings_pause_duration")) || 5;

// Recent courses queue (stores up to 10 parsed courses in local storage for instant switching)
let recentCourses = [];
try {
  recentCourses = JSON.parse(localStorage.getItem("recent_courses")) || [];
} catch (e) {
  recentCourses = [];
}

// Playback Fly-Through Preview States
let playbackAnimationId = null;
let playbackDistance = 0;
let lastFrameTime = 0;
let playbackInterval = null;
let playbackIndex = 0;
let isPlaying = false;
let lastPausedPoiIndex = -1; // Prevents getting stuck in a loop at the same POI trackpoint
let autoResumeTimeout = null; // Handles the timer for auto-continuing the preview

// ==========================================
// DOM ELEMENT REFERENCES
// ==========================================

// Loader and HUD Telemetry Dashboard
const hudMetrics = document.getElementById("hud-metrics");
const hudValTime = document.getElementById("hud-val-time");
const hudValDistCur = document.getElementById("hud-val-dist-cur");
const hudValDistTot = document.getElementById("hud-val-dist-tot");
const hudValElev = document.getElementById("hud-val-elev");
const hudValGainCur = document.getElementById("hud-val-gain-cur");
const hudValGainTot = document.getElementById("hud-val-gain-tot");
const hudValLossCur = document.getElementById("hud-val-loss-cur");
const hudValLossTot = document.getElementById("hud-val-loss-tot");
const hudValNextAs = document.getElementById("hud-val-next-as");

// Whiskey Compass
const whiskeyCompass = document.getElementById("whiskey-compass");
const compassDial = document.getElementById("compass-dial");
const compassDegrees = document.getElementById("compass-degrees");

// Left panel components (Importer & Gemini chatbot)
const cardImporter = document.getElementById("card-importer");
const dropZone = document.getElementById("drop-zone");
const fileSelector = document.getElementById("file-selector");
const loadLeadvilleDemo = document.getElementById("load-leadville-demo");
const editLockCheckbox = document.getElementById("edit-lock-checkbox");

const cardGeminiChat = document.getElementById("card-gemini-chat");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSubmit = document.getElementById("chat-submit");
const chatStatus = document.getElementById("chat-status");
const chatStatusText = document.getElementById("chat-status-text");

// Right panel components (Course Profile Metrics & Safety Warnings)
const cardStats = document.getElementById("card-stats");
const statDist = document.getElementById("stat-dist");
const statGain = document.getElementById("stat-gain");
const statLoss = document.getElementById("stat-loss");
const statWpts = document.getElementById("stat-wpts");

const activeClimbInfoBox = document.getElementById("active-climb-info-box");
const activeClimbText = document.getElementById("active-climb-text");

const correctElevationBtn = document.getElementById("correct-elevation-btn");
const elevationProgress = document.getElementById("elevation-progress");
const elevationProgressFill = document.getElementById("elevation-progress-fill");
const elevationProgressLabel = document.getElementById("elevation-progress-label");
const exportGpxBtn = document.getElementById("export-gpx-btn");

const cardWarnings = document.getElementById("card-warnings");
const warningsCount = document.getElementById("warnings-count");
const warningsList = document.getElementById("warnings-list");
const toggleWarningsBtn = document.getElementById("toggle-warnings-btn");
const closeWarningsBtn = document.getElementById("close-warnings-btn");

// Collapsible POI Detail Dialog Panel
const poiDetailDialog = document.getElementById("poi-detail-dialog");
const poiValName = document.getElementById("poi-val-name");
const poiValPassTag = document.getElementById("poi-val-pass-tag");
const poiValCutoffTag = document.getElementById("poi-val-cutoff-tag");
const poiValArrive = document.getElementById("poi-val-arrive");
const poiValPrev = document.getElementById("poi-val-prev");
const poiValNext = document.getElementById("poi-val-next");

const poiDialogPlaybackPause = document.getElementById("poi-dialog-playback-pause");
const poiDialogPlaybackContinue = document.getElementById("poi-dialog-playback-continue");
const poiDialogToggleExpand = document.getElementById("poi-dialog-toggle-expand");
const poiDialogCloseHeader = document.getElementById("poi-dialog-close-header");
const poiDialogCloseBottom = document.getElementById("poi-dialog-close-bottom");

const poiTimelinePassesList = document.getElementById("poi-timeline-passes-list");
const poiServicesIconsRow = document.getElementById("poi-services-icons-row");
const poiTableRows = document.getElementById("poi-table-rows");

// Bottom elevation scrubber & preview control sliders
const cardElevationScrubber = document.getElementById("card-elevation-scrubber");
const elevationCanvas = document.getElementById("elevation-canvas");
const btnPlayback = document.getElementById("btn-playback");
const btnPlaybackRewind = document.getElementById("btn-playback-rewind");
const climbColorsCheckbox = document.getElementById("climb-colors-checkbox");

const playbackSpeed = document.getElementById("playback-speed");
const cameraRangeSlider = document.getElementById("camera-range-slider");
const cameraTiltSlider = document.getElementById("camera-tilt-slider");

const speedLabelVal = document.getElementById("speed-label-val");
const rangeLabelVal = document.getElementById("range-label-val");
const tiltLabelVal = document.getElementById("tilt-label-val");

// Settings Modal overlay
const settingsOverlay = document.getElementById("settings-overlay");
const globalSettingsBtn = document.getElementById("global-settings-btn");
const setupKeysTriggerWelcome = document.getElementById("setup-keys-trigger-welcome");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const mapsApiKeyInput = document.getElementById("maps-api-key");
const geminiApiKeyInput = document.getElementById("gemini-api-key");
const settingsUnits = document.getElementById("settings-units");
const settingsPauseTime = document.getElementById("settings-pause-time");
const recentCoursesList = document.getElementById("recent-courses-list");
const saveSettingsBtn = document.getElementById("save-settings-btn");

// Course Info Modal
const courseInfoOverlay = document.getElementById("course-info-overlay");
const courseInfoBtn = document.getElementById("course-info-btn");
const closeInfoBtn = document.getElementById("close-info-btn");
const courseInfoText = document.getElementById("course-info-text");
// UI Notifications Toast
const toastNotification = document.getElementById("toast-notification");

// ==========================================
// APPLICATION INITIALIZATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  // Pre-fill credential configurations
  mapsApiKeyInput.value = apiKeyMaps;
  geminiApiKeyInput.value = apiKeyGemini;

  // Set units system on select field
  settingsUnits.value = units;
  settingsPauseTime.value = pauseDuration;

  // Initialize interactive 3D map viewport
  mapController = new Map3DController(document.getElementById("map-canvas"));

  // Bind compass rotation event triggers directly to Map 3D heading modifications
  mapController.onHeadingChange = (heading) => {
    if (compassDial) {
      // 3D CSS cylindrical effect
      compassDial.style.transform = `rotateY(${-heading}deg)`;
    }
    if (compassDegrees) {
      const degrees = Math.round((heading + 360) % 360);
      compassDegrees.textContent = `${degrees === 0 ? 360 : degrees}°`;
    }
  };

  mapController.onWaypointDragEnd = (wpt, newPosition) => {
    if (!activeRoute) return;
    const targetWpt = activeRoute.waypoints.find(w => w.name === wpt.name && w.lat === wpt.lat && w.lon === wpt.lon);
    if (targetWpt) {
      targetWpt.lat = newPosition.lat;
      targetWpt.lon = newPosition.lng;
      showToast(`Updated location for: ${wpt.name}`);
    }
  };

  // Initialize dynamic canvas-based elevation chart profile scrubber
  elevationChart = new ElevationChart(elevationCanvas, (index, isClick) => {
    if (!activeRoute) return;

    if (isClick) {
      // User clicked specifically to scrub/jump coordinates
      pausePlayback();
      playbackIndex = index;
      lastPausedPoiIndex = -1; // Reset so they can re-trigger POI pauses from this jump
      closePoiDetailDialog(false);

      if (mapController) {
        mapController.syncToTrackpoint(index, true);
      }
      elevationChart.progressIndex = index;
      elevationChart.draw();
      updateHUD(index);

      // Check if they jumped directly onto an aid station / waypoint POI
      const matchedPoi = activeRoute.waypoints.find(w => w.closestTrackpointIndex === index);
      if (matchedPoi) {
        showPoiDetailDialog(matchedPoi, index);
      }
    } else {
      // Standard mouse hover scrub - pan camera target only when paused to maintain smoothness
      if (!isPlaying && mapController) {
        mapController.syncToTrackpoint(index, false);
        updateHUD(index);
      }
    }
  });

  // Load custom UI preferences stored in localStorage
  loadPreferences();

  // Draw list of recently augmented courses
  renderRecentCoursesList();

  // Try initializing Maps 3D if key is present
  if (apiKeyMaps) {
    initMap3D();
  }

  // Bind event listeners to UI actions
  setupEventListeners();

  // Auto-restore most recently loaded course if available in the history queue
  if (recentCourses.length > 0) {
    const mostRecent = recentCourses[0];
    showToast(`Restoring course: ${mostRecent.name}...`);
    setTimeout(() => {
      processGpxContent(mostRecent.content, mostRecent.name);
    }, 200);
  } else {
    // Automatically load the Leadville Demo course on first launch
    setTimeout(async () => {
      try {
        showToast("Fetching Leadville Marathon GPX demo...");
        const response = await fetch(`/leadville_sample.gpx?t=${new Date().getTime()}`);
        if (!response.ok) throw new Error("Failed to fetch demo file");
        const text = await response.text();
        processGpxContent(text, "Leadville Marathon Demo");
      } catch (err) {
        showToast("Demo failed to load: " + err.message);
      }
    }, 200);
  }
});

// ==========================================
// PREFERENCES & UTILS RENDERERS
// ==========================================

/**
 * Restores user UI preferences from localStorage and configures widgets to reflect them.
 */
function loadPreferences() {
  const savedSpeed = localStorage.getItem("pref_playback_speed");
  if (savedSpeed) {
    playbackSpeed.value = savedSpeed;
    speedLabelVal.textContent = savedSpeed;
  }

  const savedRange = localStorage.getItem("pref_cam_range");
  if (savedRange) {
    cameraRangeSlider.value = savedRange;
    rangeLabelVal.textContent = `${savedRange}m`;
    mapController.cameraRange = parseInt(savedRange);
  }

  const savedTilt = localStorage.getItem("pref_tilt");
  if (savedTilt) {
    cameraTiltSlider.value = savedTilt;
    tiltLabelVal.textContent = `${savedTilt}°`;
    mapController.cameraTilt = parseInt(savedTilt);
  }

  const savedClimbColors = localStorage.getItem("pref_climb_colors");
  if (savedClimbColors) {
    const isChecked = savedClimbColors === "true";
    climbColorsCheckbox.checked = isChecked;
    mapController.colorCodeClimbs = isChecked;
  }

  const savedEditLock = localStorage.getItem("pref_edit_lock");
  if (savedEditLock) {
    const isLocked = savedEditLock === "true";
    editLockCheckbox.checked = isLocked;
    toggleEditLock(isLocked);
  }
}

/**
 * Handles UI locking features. Disables/enables input widgets and applies opacity styling filters.
 * @param {boolean} isLocked Lock active status
 */
function toggleEditLock(isLocked) {
  localStorage.setItem("pref_edit_lock", isLocked);
  if (isLocked) {
    document.body.classList.add("edit-locked");
    chatInput.disabled = true;
    chatSubmit.disabled = true;
    correctElevationBtn.disabled = true;
    fileSelector.disabled = true;
    loadLeadvilleDemo.disabled = true;
  } else {
    document.body.classList.remove("edit-locked");
    chatInput.disabled = false;
    chatSubmit.disabled = false;
    correctElevationBtn.disabled = false;
    fileSelector.disabled = false;
    loadLeadvilleDemo.disabled = false;
  }
  
  if (typeof mapController !== 'undefined' && mapController) {
    mapController.setEditLock(isLocked);
  }
}

/**
 * Displays a premium Glassmorphic Toast Notification popup to keep user informed of background state.
 */
function showToast(message, duration = 4000) {
  if (!toastNotification) return;
  toastNotification.textContent = message;
  toastNotification.classList.remove("hidden");
  setTimeout(() => {
    toastNotification.classList.add("hidden");
  }, duration);
}

/**
 * Lazily loads the Google Maps script context and initializes the 3D Satellite Globe inside the container viewport.
 */
async function initMap3D() {
  try {
    const loaderState = document.getElementById("map-loader-state");
    loaderState.innerHTML = `<div class="welcome-box"><span class="spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 12px;"></span><p>Initializing Google Maps 3D satellite tiles...</p></div>`;

    await loadGoogleMaps(apiKeyMaps);
    await mapController.initialize(window.google.maps);

    loaderState.classList.add("hidden");
    if (whiskeyCompass) {
      whiskeyCompass.classList.remove("hidden");
    }
    showToast("Satellite terrain data loaded.");

    // Draw pre-existing route if initialized
    if (activeRoute) {
      mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
      mapController.syncToTrackpoint(playbackIndex, false);
    }
  } catch (err) {
    console.error(err);
    const loaderState = document.getElementById("map-loader-state");
    loaderState.innerHTML = `
      <div class="welcome-box">
        <h2 style="color:var(--error-color)">Map Load Failed</h2>
        <p>${err.message}</p>
        <button id="setup-keys-trigger-fail" class="btn btn-secondary mt-3">Configure API Keys</button>
      </div>
    `;
    document.getElementById("setup-keys-trigger-fail")?.addEventListener("click", () => {
      settingsOverlay.classList.remove("hidden");
    });
  }
}

// ==========================================
// CORE METRIC CALCULATIONS & UNITS SYSTEMS
// ==========================================

/**
 * Returns a unit-converted numerical distance representation from meter coordinates.
 */
function convertDistanceValue(meters) {
  if (units === "imperial") {
    return (meters / 1609.344).toFixed(2);
  } else {
    return (meters / 1000).toFixed(2);
  }
}

/**
 * Returns a unit-converted numerical elevation/gain value representation from meters.
 */
function convertElevationValue(meters) {
  if (units === "imperial") {
    return Math.round(meters * 3.28084);
  } else {
    return Math.round(meters);
  }
}

/**
 * Formats a metric distance coordinate output string with matching unit suffixes.
 */
function formatDistance(meters) {
  const distVal = convertDistanceValue(meters);
  const distUnit = units === "imperial" ? "mi" : "km";
  return `${distVal} ${distUnit}`;
}

/**
 * Formats a metric elevation coordinate output string with matching unit suffixes.
 */
function formatElevation(meters) {
  const elevVal = convertElevationValue(meters);
  const elevUnit = units === "imperial" ? "ft" : "m";
  return `${elevVal} ${elevUnit}`;
}

/**
 * Computes the elapsed duration at a trackpoint.
 * If GPX trackpoints contain timestamps, computes the exact difference relative to the start point.
 * Otherwise, estimates the elapsed duration based on a typical trail-running speed of 10 km/h (2.778 m/s).
 */
function getElapsedTime(route, k) {
  const pts = route.trackpoints;
  if (!pts || pts.length === 0 || k < 0 || k >= pts.length) return 0;

  const currentPt = pts[k];
  const startPt = pts[0];

  if (currentPt.time && startPt.time) {
    const elapsedMs = new Date(currentPt.time) - new Date(startPt.time);
    return Math.max(0, elapsedMs / 1000);
  } else {
    // Estimator fallback: 10 km/h trail speed
    return currentPt.dist_m / 2.778;
  }
}

/**
 * Formats a duration in seconds to standard HH:MM:SS clock format.
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Precomputes running gain and loss aggregates along the trackpoints list.
 * This optimizes performance to O(1) during scrub queries.
 */
function precomputeRunningMetrics(route) {
  if (!route || !route.trackpoints || route.trackpoints.length === 0) return;
  
  let runningGain = 0;
  let runningLoss = 0;

  route.trackpoints[0].runningGain = 0;
  route.trackpoints[0].runningLoss = 0;

  for (let i = 1; i < route.trackpoints.length; i++) {
    const prev = route.trackpoints[i - 1];
    const curr = route.trackpoints[i];
    const diff = curr.ele - prev.ele;
    
    if (diff > 0) {
      runningGain += diff;
    } else {
      runningLoss += Math.abs(diff);
    }
    
    curr.runningGain = runningGain;
    curr.runningLoss = runningLoss;
  }
}

/**
 * Helper to identify the nearest preceding and succeeding aid stations relative to a course distance.
 * Essential for rendering multi-pass snapped timelines.
 */
function getSegmentingNeighbors(d) {
  if (!activeRoute) {
    return { 
      prev: { name: "START", dist_m: 0 }, 
      next: { name: "FINISH", dist_m: 0 } 
    };
  }

  // Nearest previous milestone
  const prevWpts = activeRoute.waypoints
    .filter(w => w.dist_m < d - 10 && (w.extensions?.station?.type === "segmenting" || w.sym.includes("aid_station")))
    .sort((a, b) => b.dist_m - a.dist_m);
  const prevWpt = prevWpts[0];

  // Nearest next milestone
  const nextWpts = activeRoute.waypoints
    .filter(w => w.dist_m > d + 10 && (w.extensions?.station?.type === "segmenting" || w.sym.includes("aid_station")))
    .sort((a, b) => a.dist_m - b.dist_m);
  const nextWpt = nextWpts[0];

  return {
    prev: prevWpt ? { name: prevWpt.name, dist_m: prevWpt.dist_m } : { name: "START", dist_m: 0 },
    next: nextWpt ? { name: nextWpt.name, dist_m: nextWpt.dist_m } : { name: "FINISH", dist_m: activeRoute.totalDistance }
  };
}

// ==========================================
// INTERACTIVE HUD & PREVIEW CONTROLLER
// ==========================================

/**
 * Dynamically updates the units indicator text in the top HUD dashboard display based on units preference.
 */
function updateUnitLabels() {
  const distUnit = units === "imperial" ? "mi" : "km";
  const elevUnit = units === "imperial" ? "ft" : "m";

  document.querySelectorAll(".hud-metric").forEach(metric => {
    const label = metric.querySelector(".hud-metric-label")?.textContent;
    const unitSpan = metric.querySelector(".unit-lbl");
    if (unitSpan) {
      if (label === "DIST") {
        unitSpan.textContent = distUnit;
      } else if (label === "ELEV" || label === "GAIN" || label === "LOSS") {
        unitSpan.textContent = elevUnit;
      }
    }
  });
}

/**
 * Updates telemetry metrics displayed on the HUD and handles climb hazard warnings.
 * @param {number} index Current trackpoint cursor index
 */
function updateHUD(index) {
  if (!activeRoute) return;
  const pts = activeRoute.trackpoints;
  if (index < 0 || index >= pts.length) return;

  const currentPt = pts[index];
  const currentDist = currentPt.dist_m;

  // 1. Clock timer
  const elapsed = getElapsedTime(activeRoute, index);
  hudValTime.textContent = formatTime(elapsed);

  // 2. Cumulative distance
  hudValDistCur.textContent = convertDistanceValue(currentDist);
  hudValDistTot.textContent = convertDistanceValue(activeRoute.totalDistance);

  // 3. Absolute altitude elevation
  hudValElev.textContent = convertElevationValue(currentPt.ele);

  // 4. Cumulative climbing gain
  const runningGain = currentPt.runningGain || 0;
  hudValGainCur.textContent = convertElevationValue(runningGain);
  hudValGainTot.textContent = convertElevationValue(activeRoute.totalElevationGain);

  // 5. Cumulative descending loss
  const runningLoss = currentPt.runningLoss || 0;
  hudValLossCur.textContent = convertElevationValue(runningLoss);
  hudValLossTot.textContent = convertElevationValue(activeRoute.totalElevationLoss);

  // 6. Distance and gain to next aid station
  const { nextAid, activeClimb } = getMetricsForPoint(activeRoute, index);
  if (nextAid) {
    const distStr = convertDistanceValue(nextAid.dist_m);
    const distUnit = units === "imperial" ? "mi" : "km";
    const gainStr = convertElevationValue(nextAid.gain_m);
    const lossStr = convertElevationValue(nextAid.loss_m);
    const eleUnit = units === "imperial" ? "ft" : "m";

    hudValNextAs.textContent = `${nextAid.name} (+${distStr} ${distUnit}, +${gainStr} / -${lossStr} ${eleUnit})`;
  } else {
    hudValNextAs.textContent = "Finish Line reached";
  }

  // 7. Render Climb Hazard card warning if traversing a steep slope
  if (activeClimb) {
    const distStr = convertDistanceValue(activeClimb.dist_m);
    const distUnit = units === "imperial" ? "mi" : "km";
    const gainStr = convertElevationValue(activeClimb.gain_m);
    const eleUnit = units === "imperial" ? "ft" : "m";

    activeClimbText.textContent = `Remaining: ${distStr} ${distUnit} (+${gainStr} ${eleUnit})`;
    activeClimbInfoBox.classList.remove("hidden");
  } else {
    activeClimbInfoBox.classList.add("hidden");
  }
}

/**
 * Interpolates the coordinate at a specific distance along the track.
 */
function getInterpolatedPoint(distance) {
  if (!activeRoute || activeRoute.trackpoints.length === 0) return null;
  const pts = activeRoute.trackpoints;
  if (distance <= 0) return { ...pts[0], index: 0 };
  if (distance >= activeRoute.totalDistance) return { ...pts[pts.length - 1], index: pts.length - 1 };

  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].dist_m <= distance && pts[i + 1].dist_m > distance) {
      const pt1 = pts[i];
      const pt2 = pts[i + 1];
      const distSpan = pt2.dist_m - pt1.dist_m;
      const factor = distSpan === 0 ? 0 : (distance - pt1.dist_m) / distSpan;
      
      return {
        lat: pt1.lat + (pt2.lat - pt1.lat) * factor,
        lon: pt1.lon + (pt2.lon - pt1.lon) * factor,
        ele: pt1.ele + (pt2.ele - pt1.ele) * factor,
        index: i + factor
      };
    }
  }
  return { ...pts[pts.length - 1], index: pts.length - 1 };
}

/**
 * Activates camera fly-through playback loops across route coordinates.
 */
function startPlayback() {
  if (!activeRoute || activeRoute.trackpoints.length < 2) return;

  isPlaying = true;
  btnPlayback.textContent = "⏸";
  btnPlayback.title = "Pause Fly-Through";

  const pts = activeRoute.trackpoints;
  playbackDistance = pts[Math.floor(playbackIndex)]?.dist_m || 0;

  if (playbackDistance >= activeRoute.totalDistance) {
    playbackDistance = 0;
    playbackIndex = 0;
  }

  lastFrameTime = performance.now();

  function renderLoop(currentTime) {
    if (!isPlaying) return;

    const dt = (currentTime - lastFrameTime) / 1000; // seconds
    lastFrameTime = currentTime;

    const speedScale = parseInt(playbackSpeed.value); // 1-10 slider
    const simSpeed = 20 * speedScale * speedScale; // 20m/s to 2000m/s
    
    playbackDistance += simSpeed * dt;

    if (playbackDistance >= activeRoute.totalDistance) {
      pausePlayback();
      playbackDistance = activeRoute.totalDistance;
      playbackIndex = activeRoute.trackpoints.length - 1;
      updatePlaybackFrame();
      return;
    }

    updatePlaybackFrame();
    
    // Auto-pause preview verification when approaching a waypoint checkpoint
    const currentIdxInt = Math.floor(playbackIndex);
    const reachedPoiByIndex = activeRoute.waypoints.find(
      w => w.closestTrackpointIndex === currentIdxInt && w.closestTrackpointIndex !== lastPausedPoiIndex
    );

    if (reachedPoiByIndex) {
      lastPausedPoiIndex = currentIdxInt;
      pausePlayback();
      showPoiDetailDialog(reachedPoiByIndex, currentIdxInt);
      return; 
    }

    playbackAnimationId = requestAnimationFrame(renderLoop);
  }

  playbackAnimationId = requestAnimationFrame(renderLoop);
}

function updatePlaybackFrame() {
  const pt = getInterpolatedPoint(playbackDistance);
  if (!pt) return;

  playbackIndex = pt.index;

  const lookaheadDist = playbackDistance + 50;
  const lookaheadPt = getInterpolatedPoint(lookaheadDist);
  
  const targetHeading = calculateBearing(pt.lat, pt.lon, lookaheadPt.lat, lookaheadPt.lon);

  if (mapController) {
    mapController.updateCamera(pt, targetHeading);
  }

  const idxInt = Math.floor(playbackIndex);
  elevationChart.progressIndex = idxInt;
  elevationChart.hoverIdx = idxInt;
  elevationChart.draw();

  updateHUD(idxInt);
}

/**
 * Pauses camera preview.
 */
function pausePlayback() {
  isPlaying = false;
  btnPlayback.textContent = "▶";
  btnPlayback.title = "Start Fly-Through";
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  if (playbackAnimationId) {
    cancelAnimationFrame(playbackAnimationId);
    playbackAnimationId = null;
  }
}

// ==========================================
// POI DIALOG & SERVICES RENDERER
// ==========================================

/**
 * Displays POI detail dialog window populated with services and multi-pass timeline metrics.
 * @param {Object} wpt Waypoint details parsed from GPX schema
 * @param {number} index Trackpoint index snapping point
 */
function showPoiDetailDialog(wpt, index) {
  if (!poiDetailDialog) return;

  // Clear any existing active timeouts
  if (autoResumeTimeout) {
    clearTimeout(autoResumeTimeout);
    autoResumeTimeout = null;
  }

  // Title headers
  poiValName.textContent = wpt.name;

  const currentDist = wpt.dist_m;
  const passes = wpt.extensions?.station?.passes || [];

  // Identify active pass index relative to current course location
  let activePassIdx = 0;
  let minPassDiff = Infinity;
  passes.forEach((pass, i) => {
    const diff = Math.abs(pass.dist_m - currentDist);
    if (diff < minPassDiff) {
      minPassDiff = diff;
      activePassIdx = i;
    }
  });
  const activePass = passes[activePassIdx];

  // Render pass tags
  if (passes.length > 1) {
    poiValPassTag.textContent = `Pass ${activePass.num} of ${passes.length}`;
    poiValPassTag.classList.remove("hidden");
  } else {
    poiValPassTag.textContent = "Waypoint";
    poiValPassTag.classList.remove("hidden");
  }

  // Render cutoff tags
  if (activePass && activePass.cutoff_clock) {
    poiValCutoffTag.textContent = `CUTOFF: ${activePass.cutoff_clock}`;
    poiValCutoffTag.classList.remove("hidden");
  } else {
    poiValCutoffTag.classList.add("hidden");
  }

  // ARRIVE distance
  poiValArrive.textContent = formatDistance(currentDist);

  // PREV AS distance metrics
  const neighbors = getSegmentingNeighbors(currentDist);
  const prevDiff = currentDist - neighbors.prev.dist_m;
  poiValPrev.textContent = `+${formatDistance(prevDiff)} (${neighbors.prev.name})`;

  // NEXT AS distance metrics
  const nextDiff = neighbors.next.dist_m - currentDist;
  poiValNext.textContent = `${formatDistance(nextDiff)} (${neighbors.next.name})`;

  // Detailed passes lists
  poiTimelinePassesList.innerHTML = "";
  if (passes.length > 0) {
    passes.forEach(p => {
      const li = document.createElement("li");
      let itemText = `Pass ${p.num}: ${formatDistance(p.dist_m)}`;
      if (p.cutoff_clock) {
        itemText += ` (Cutoff: ${p.cutoff_clock})`;
      }
      if (p.label) {
        itemText += ` - ${p.label}`;
      }
      li.textContent = itemText;
      poiTimelinePassesList.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = `Waypoint location: ${formatDistance(currentDist)}`;
    poiTimelinePassesList.appendChild(li);
  }

  // Service icons mapping (restrooms, aid, water, sleep, etc.)
  poiServicesIconsRow.innerHTML = "";
  const station = wpt.extensions?.station;
  if (station) {
    const s = station.services || {};
    const a = station.accessibility || {};

    const serviceList = [];
    if (s.water || s.unmanaged_water) serviceList.push({ icon: "💧", label: "Water" });
    if (s.food || s.hot_food) serviceList.push({ icon: "🍔", label: "Food" });
    if (s.toilets) serviceList.push({ icon: "🚾", label: "Restrooms" });
    if (s.medical) serviceList.push({ icon: "➕", label: "Aid" });
    if (s.sleep_area) serviceList.push({ icon: "🛌", label: "Sleep" });
    if (a.crew_allowed) serviceList.push({ icon: "🚗", label: "Crew Access" });
    if (a.pacer_allowed) serviceList.push({ icon: "🏃", label: "Pacer Exchange" });
    if (a.drop_bag_allowed) serviceList.push({ icon: "🎒", label: "Drop Bag" });

    // Secondary checks in name strings
    const nameL = wpt.name.toLowerCase();
    const descL = (wpt.desc || "").toLowerCase();
    if (nameL.includes("phone") || descL.includes("phone")) serviceList.push({ icon: "📞", label: "Phone" });
    if (nameL.includes("view") || nameL.includes("scenic") || descL.includes("view")) serviceList.push({ icon: "📷", label: "Camera View" });
    if (descL.includes("shuttle") || descL.includes("bus") || descL.includes("transport")) serviceList.push({ icon: "🚌", label: "Transportation" });

    if (serviceList.length === 0) {
      poiServicesIconsRow.textContent = "No amenities listed.";
    } else {
      serviceList.forEach(item => {
        const pill = document.createElement("span");
        pill.style.display = "inline-flex";
        pill.style.alignItems = "center";
        pill.style.gap = "4px";
        pill.style.padding = "2px 8px";
        pill.style.borderRadius = "4px";
        pill.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
        pill.style.border = "1px solid rgba(255, 255, 255, 0.1)";
        pill.style.fontSize = "11px";
        pill.style.color = "var(--text-secondary)";
        pill.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;
        poiServicesIconsRow.appendChild(pill);
      });
    }
  } else {
    poiServicesIconsRow.textContent = "No amenities listed.";
  }

  // Snapped passes metric table
  poiTableRows.innerHTML = "";
  if (passes.length > 0) {
    passes.forEach(p => {
      const tr = document.createElement("tr");

      const tdNum = document.createElement("td");
      tdNum.textContent = `#${p.num}`;

      const tdArrive = document.createElement("td");
      tdArrive.textContent = formatDistance(p.dist_m);

      const pNeighbors = getSegmentingNeighbors(p.dist_m);
      
      const pPrevDiff = p.dist_m - pNeighbors.prev.dist_m;
      const tdPrev = document.createElement("td");
      tdPrev.textContent = `+${formatDistance(pPrevDiff)} (${pNeighbors.prev.name})`;

      const pNextDiff = pNeighbors.next.dist_m - p.dist_m;
      const tdNext = document.createElement("td");
      tdNext.textContent = `${formatDistance(pNextDiff)} (${pNeighbors.next.name})`;

      const tdCutoff = document.createElement("td");
      tdCutoff.textContent = p.cutoff_clock || p.cutoff_elapsed || "--";

      tr.appendChild(tdNum);
      tr.appendChild(tdArrive);
      tr.appendChild(tdPrev);
      tr.appendChild(tdNext);
      tr.appendChild(tdCutoff);

      // Highlight active pass row
      if (activePass && p.num === activePass.num) {
        tr.style.backgroundColor = "rgba(255, 184, 52, 0.08)";
        tr.style.borderLeft = "2px solid var(--primary-color)";
      }

      poiTableRows.appendChild(tr);
    });
  } else {
    // single row fallback for basic waypoints
    const tr = document.createElement("tr");

    const tdNum = document.createElement("td");
    tdNum.textContent = `#1`;

    const tdArrive = document.createElement("td");
    tdArrive.textContent = formatDistance(currentDist);

    const tdPrev = document.createElement("td");
    tdPrev.textContent = `+${formatDistance(prevDiff)} (${neighbors.prev.name})`;

    const tdNext = document.createElement("td");
    tdNext.textContent = `${formatDistance(nextDiff)} (${neighbors.next.name})`;

    const tdCutoff = document.createElement("td");
    tdCutoff.textContent = "--";

    tr.appendChild(tdNum);
    tr.appendChild(tdArrive);
    tr.appendChild(tdPrev);
    tr.appendChild(tdNext);
    tr.appendChild(tdCutoff);

    poiTableRows.appendChild(tr);
  }

  // Start in collapsed state matching aesthetics requirements
  poiDetailDialog.classList.add("collapsed");
  poiDetailDialog.classList.remove("hidden");

  // Setup auto-resume timeout (skip if settings pauseTime is set to 0)
  if (pauseDuration > 0) {
    autoResumeTimeout = setTimeout(() => {
      // Auto-resume ONLY if the dialog is still collapsed and visible (not expanded or closed)
      if (!poiDetailDialog.classList.contains("hidden") && poiDetailDialog.classList.contains("collapsed")) {
        closePoiDetailDialog(true); // close dialog and start playback
      }
    }, pauseDuration * 1000);
  }
}

/**
 * Hides POI dialog cards and resumes flight-through if requested.
 * @param {boolean} resumePlayback Start playback loop
 */
function closePoiDetailDialog(resumePlayback = false) {
  if (poiDetailDialog) {
    poiDetailDialog.classList.add("hidden");
  }
  if (autoResumeTimeout) {
    clearTimeout(autoResumeTimeout);
    autoResumeTimeout = null;
  }
  if (resumePlayback) {
    startPlayback();
  }
}

// ==========================================
// RECENT ROUTES STORAGE CONTROLLER
// ==========================================

/**
 * Inserts route details into the local history list. Ensures uniqueness and caps at 10 items.
 */
function addRecentCourse(name, gpxText) {
  recentCourses = recentCourses.filter(c => c.name !== name);
  recentCourses.unshift({
    name,
    content: gpxText,
    date: Date.now()
  });

  if (recentCourses.length > 10) {
    recentCourses = recentCourses.slice(0, 10);
  }

  localStorage.setItem("recent_courses", JSON.stringify(recentCourses));
  renderRecentCoursesList();
}

/**
 * Draws the list of recently loaded routes in the settings modal.
 */
function renderRecentCoursesList() {
  if (!recentCoursesList) return;

  if (recentCourses.length === 0) {
    recentCoursesList.innerHTML = `<span class="empty-list-text">No recently played routes.</span>`;
    return;
  }

  recentCoursesList.innerHTML = "";
  recentCourses.forEach(c => {
    const item = document.createElement("div");
    item.className = "recent-course-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "recent-course-name";
    nameSpan.textContent = c.name;

    const dateSpan = document.createElement("span");
    dateSpan.className = "recent-course-date";
    const date = new Date(c.date);
    dateSpan.textContent = date.toLocaleDateString();

    item.appendChild(nameSpan);
    item.appendChild(dateSpan);

    item.addEventListener("click", (e) => {
      e.preventDefault();
      settingsOverlay.classList.add("hidden");
      processGpxContent(c.content, c.name);
    });

    recentCoursesList.appendChild(item);
  });
}

// ==========================================
// FILE HANDLERS & WIDGET EVENTS
// ==========================================

function loadGpxFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      processGpxContent(e.target.result, file.name);
    } catch (err) {
      showToast("Error parsing file: " + err.message);
    }
  };
  reader.readAsText(file);
}

/**
 * Sets state variables, redraws chart and map overlays, updates stats dashboards.
 */
function processGpxContent(text, filename) {
  activeRoute = parseGPX(text);
  chatHistory = []; // Reset Gemini chatbot context on new course ingestion
  playbackIndex = 0;
  lastPausedPoiIndex = -1;
  closePoiDetailDialog(false);

  // Pre-calculate running elevation gain and loss values
  precomputeRunningMetrics(activeRoute);

  // Display route name
  const nameDisplay = document.getElementById("course-name-display");
  if (nameDisplay) {
    nameDisplay.textContent = activeRoute.name.toUpperCase();
  }

  // Display Course Info
  if (activeRoute.description && activeRoute.description !== "No description provided.") {
    courseInfoText.textContent = activeRoute.description;
    courseInfoBtn.classList.remove("hidden");
  } else {
    courseInfoText.textContent = "No description available.";
    courseInfoBtn.classList.add("hidden");
  }

  // Clear chatbot logs
  chatMessages.innerHTML = `
    <div class="message assistant">
      <p>Imported "<strong>${activeRoute.name}</strong>" successfully. Paste race details or ask me to configure aid stations.</p>
    </div>
  `;

  // Make overlays visible
  cardStats.classList.remove("hidden");
  cardWarnings.classList.remove("hidden");
  if (toggleWarningsBtn) toggleWarningsBtn.classList.add("hidden");
  cardElevationScrubber.classList.remove("hidden");
  hudMetrics.classList.remove("hidden");

  // Sync components
  elevationChart.units = units;
  elevationChart.setRoute(activeRoute);

  if (apiKeyMaps && mapController.map) {
    mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
  }

  updateRouteStatsUI(activeRoute);
  renderWarningsUI(activeRoute);
  updateUnitLabels();
  updateHUD(0);

  // Save to recently played list
  addRecentCourse(activeRoute.name, text);

  showToast(`Loaded ${filename}`);
}

function updateRouteStatsUI(route) {
  const distStr = convertDistanceValue(route.totalDistance);
  const distUnit = units === "imperial" ? "mi" : "km";
  statDist.textContent = `${distStr} ${distUnit}`;

  const gainStr = convertElevationValue(route.totalElevationGain);
  const lossStr = convertElevationValue(route.totalElevationLoss);
  const eleUnit = units === "imperial" ? "ft" : "m";

  statGain.textContent = `+${gainStr}${eleUnit}`;
  statLoss.textContent = `-${lossStr}${eleUnit}`;
  statWpts.textContent = route.waypoints.length;
}

function renderWarningsUI(route) {
  warningsList.innerHTML = "";
  const approvedWarnings = route.warnings.filter(w => w.approved);
  warningsCount.textContent = approvedWarnings.length;

  if (route.warnings.length === 0) {
    warningsList.innerHTML = `<div class="small-label" style="text-align:center;padding:12px;color:var(--text-muted)">No safety warnings found on this trail.</div>`;
    return;
  }

  route.warnings.forEach((warn) => {
    const item = document.createElement("div");
    item.className = `warning-item ${warn.type.toLowerCase().replace("_", "-")}`;
    if (!warn.approved) item.classList.add("rejected");

    const textSpan = document.createElement("span");
    textSpan.className = "warning-text";
    textSpan.textContent = warn.message;

    const actionDiv = document.createElement("div");
    actionDiv.className = "warning-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "warn-toggle approve";
    toggleBtn.innerHTML = warn.approved ? "✅" : "❌";
    toggleBtn.title = warn.approved ? "Reject Warning" : "Accept Warning";

    toggleBtn.addEventListener("click", () => {
      warn.approved = !warn.approved;
      renderWarningsUI(route);
      elevationChart.draw();
    });

    actionDiv.appendChild(toggleBtn);
    item.appendChild(textSpan);
    item.appendChild(actionDiv);
    warningsList.appendChild(item);
  });
}

function appendChatMessage(text, role) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.innerHTML = `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`;

  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Configures event triggers for inputs, settings updates, chat submissions, and playbacks.
 */
function setupEventListeners() {
  // Settings Overlay display
  const openSettings = () => {
    mapsApiKeyInput.value = apiKeyMaps;
    geminiApiKeyInput.value = apiKeyGemini;
    settingsUnits.value = units;
    settingsPauseTime.value = pauseDuration;
    renderRecentCoursesList();
    settingsOverlay.classList.remove("hidden");
  };

  globalSettingsBtn.addEventListener("click", openSettings);
  setupKeysTriggerWelcome.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", () => settingsOverlay.classList.add("hidden"));

  // Open / Import trigger
  const importTriggerBtn = document.getElementById("import-trigger-btn");
  if (importTriggerBtn) {
    importTriggerBtn.addEventListener("click", () => fileSelector.click());
  }

  // Course Info Overlay
  courseInfoBtn.addEventListener("click", () => courseInfoOverlay.classList.remove("hidden"));
  closeInfoBtn.addEventListener("click", () => courseInfoOverlay.classList.add("hidden"));

  // Warnings Toggle
  if (toggleWarningsBtn) {
    toggleWarningsBtn.addEventListener("click", () => {
      cardWarnings.classList.remove("hidden");
      toggleWarningsBtn.classList.add("hidden");
    });
  }
  if (closeWarningsBtn) {
    closeWarningsBtn.addEventListener("click", () => {
      cardWarnings.classList.add("hidden");
      toggleWarningsBtn.classList.remove("hidden");
    });
  }

  // Save Settings Modal parameters
  saveSettingsBtn.addEventListener("click", () => {
    const oldMapsKey = apiKeyMaps;
    apiKeyMaps = mapsApiKeyInput.value.trim();
    apiKeyGemini = geminiApiKeyInput.value.trim();
    units = settingsUnits.value;
    pauseDuration = parseInt(settingsPauseTime.value) || 0;

    localStorage.setItem("gmaps_api_key", apiKeyMaps);
    localStorage.setItem("gemini_api_key", apiKeyGemini);
    localStorage.setItem("settings_units", units);
    localStorage.setItem("settings_pause_duration", pauseDuration);

    if (elevationChart) {
      elevationChart.units = units;
      elevationChart.draw();
    }

    if (activeRoute) {
      updateRouteStatsUI(activeRoute);
      updateHUD(playbackIndex);
    }

    updateUnitLabels();
    settingsOverlay.classList.add("hidden");
    showToast("Configurations saved.");

    if (apiKeyMaps && apiKeyMaps !== oldMapsKey) {
      initMap3D();
    }
  });

  // Drag & Drop Course Importers
  dropZone.addEventListener("click", () => {
    if (document.body.classList.contains("edit-locked")) return;
    fileSelector.click();
  });
  
  fileSelector.addEventListener("change", (e) => {
    if (document.body.classList.contains("edit-locked")) return;
    if (e.target.files.length > 0) {
      loadGpxFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (document.body.classList.contains("edit-locked")) return;
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (document.body.classList.contains("edit-locked")) return;
    if (e.dataTransfer.files.length > 0) {
      loadGpxFile(e.dataTransfer.files[0]);
    }
  });

  // Edit protection Lock toggle
  editLockCheckbox.addEventListener("change", (e) => {
    toggleEditLock(e.target.checked);
    showToast(e.target.checked ? "Edits locked." : "Edits unlocked.");
  });

  // Load Leadville Demo Course
  loadLeadvilleDemo.addEventListener("click", async () => {
    if (document.body.classList.contains("edit-locked")) return;
    try {
      showToast("Fetching Leadville Marathon GPX demo...");
      const response = await fetch(`/leadville_sample.gpx?t=${new Date().getTime()}`);
      if (!response.ok) throw new Error("Failed to fetch demo file");
      const text = await response.text();
      processGpxContent(text, "Leadville Marathon Demo");
    } catch (err) {
      showToast("Demo failed to load: " + err.message);
    }
  });

  // Gemini Chat augmentation submissions
  const handleChatSubmit = async () => {
    if (document.body.classList.contains("edit-locked")) return;

    const prompt = chatInput.value.trim();
    if (!prompt) return;

    if (!apiKeyGemini) {
      showToast("Please configure Gemini API Key in the settings first.");
      openSettings();
      return;
    }

    if (!activeRoute) {
      showToast("Please import a GPX file first.");
      return;
    }

    appendChatMessage(prompt, "user");
    chatInput.value = "";

    chatStatusText.textContent = "Analyzing course & reconciling miles...";
    chatStatus.classList.remove("hidden");
    chatSubmit.disabled = true;

    try {
      const response = await sendToGemini(prompt, activeRoute, apiKeyGemini, chatHistory);

      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      chatHistory.push(response.assistantMessage);

      if (response.stations && response.stations.length > 0) {
        reconcileCourse(activeRoute, response);

        mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
        elevationChart.setRoute(activeRoute);
        updateRouteStatsUI(activeRoute);
        renderWarningsUI(activeRoute);

        appendChatMessage(`Added and snapped ${response.stations.length} milestones onto the route successfully!`, "assistant");
        showToast("Route augmented successfully.");
      } else {
        appendChatMessage("Analyzed request, but did not extract any specific course waypoints to inject. Try giving explicit distances (e.g., 'add an aid station at mile 10').", "assistant");
      }
    } catch (err) {
      console.error(err);
      appendChatMessage(`Reconcilation Error: ${err.message}`, "assistant");
      showToast("Failed to process request.");
    } finally {
      chatStatus.classList.add("hidden");
      chatSubmit.disabled = !document.body.classList.contains("edit-locked");
    }
  };

  chatSubmit.addEventListener("click", handleChatSubmit);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  // Elevation correction triggers
  correctElevationBtn.addEventListener("click", async () => {
    if (document.body.classList.contains("edit-locked")) return;
    if (!activeRoute) return;

    correctElevationBtn.disabled = true;
    elevationProgress.classList.remove("hidden");

    try {
      showToast("Fetching ground elevations from Open-Meteo...");
      await correctRouteElevations(activeRoute, (current, total) => {
        const percent = Math.round((current / total) * 100);
        elevationProgressFill.style.width = `${percent}%`;
        elevationProgressLabel.textContent = `Fetching: ${percent}% (${current}/${total})`;
      });

      precomputeRunningMetrics(activeRoute);
      mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
      elevationChart.setRoute(activeRoute);
      updateRouteStatsUI(activeRoute);
      renderWarningsUI(activeRoute);

      showToast("Route elevations corrected successfully.");
    } catch (err) {
      showToast("Elevation fetch failed: " + err.message);
    } finally {
      correctElevationBtn.disabled = !document.body.classList.contains("edit-locked");
      elevationProgress.classList.add("hidden");
    }
  });

  // Export GPX Trigger
  exportGpxBtn.addEventListener("click", () => {
    if (!activeRoute) return;

    try {
      const xmlString = writeGPX(activeRoute);
      const blob = new Blob([xmlString], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `enhanced_${activeRoute.name.toLowerCase().replace(/\s+/g, "_")}.gpx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast("GPX exported successfully.");
    } catch (err) {
      showToast("Export failed: " + err.message);
    }
  });

  // Playback Control Button Toggle
  btnPlayback.addEventListener("click", () => {
    if (!activeRoute) return;
    if (isPlaying) {
      pausePlayback();
    } else {
      closePoiDetailDialog(false);
      startPlayback();
    }
  });

  // Rewind Control Trigger
  btnPlaybackRewind.addEventListener("click", () => {
    pausePlayback();
    playbackIndex = 0;
    lastPausedPoiIndex = -1;
    closePoiDetailDialog(false);

    if (activeRoute) {
      if (mapController) {
        mapController.syncToTrackpoint(0, true);
      }
      elevationChart.progressIndex = 0;
      elevationChart.hoverIdx = -1;
      elevationChart.draw();
      updateHUD(0);
    }
  });

  // Speed Slider Listener
  playbackSpeed.addEventListener("input", (e) => {
    const val = e.target.value;
    speedLabelVal.textContent = val;
    localStorage.setItem("pref_playback_speed", val);

    if (isPlaying) {
      pausePlayback();
      startPlayback();
    }
  });

  // Camera Range Slider Listener
  cameraRangeSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    rangeLabelVal.textContent = `${val}m`;
    localStorage.setItem("pref_cam_range", val);

    if (mapController) {
      mapController.cameraRange = val;
      if (!isPlaying && activeRoute) {
        mapController.syncToTrackpoint(playbackIndex, false);
      }
    }
  });

  // Camera Tilt Slider Listener
  cameraTiltSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    tiltLabelVal.textContent = `${val}°`;
    localStorage.setItem("pref_tilt", val);

    if (mapController) {
      mapController.cameraTilt = val;
      if (!isPlaying && activeRoute) {
        mapController.syncToTrackpoint(playbackIndex, false);
      }
    }
  });

  // Color Coding Climbs polyline toggle
  climbColorsCheckbox.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    localStorage.setItem("pref_climb_colors", isChecked);
    if (mapController) {
      mapController.colorCodeClimbs = isChecked;
      if (activeRoute) {
        mapController.drawRoute(activeRoute, isChecked);
        mapController.syncToTrackpoint(playbackIndex, false);
      }
    }
  });

  // POI dialog expanded/collapsed switch
  poiDialogToggleExpand.addEventListener("click", () => {
    const isCollapsed = poiDetailDialog.classList.contains("collapsed");
    if (isCollapsed) {
      // Expanding! Pause playback and cancel auto resume timers
      poiDetailDialog.classList.remove("collapsed");
      pausePlayback();
      if (autoResumeTimeout) {
        clearTimeout(autoResumeTimeout);
        autoResumeTimeout = null;
      }
    } else {
      // Collapsing!
      poiDetailDialog.classList.add("collapsed");
    }
  });

  // POI dialog playback Pause/Continue buttons
  poiDialogPlaybackPause.addEventListener("click", () => {
    pausePlayback();
    if (autoResumeTimeout) {
      clearTimeout(autoResumeTimeout);
      autoResumeTimeout = null;
    }
    showToast("Playback paused.");
  });

  poiDialogPlaybackContinue.addEventListener("click", () => {
    closePoiDetailDialog(true);
  });

  // Close buttons listeners
  poiDialogCloseHeader.addEventListener("click", () => {
    closePoiDetailDialog(true);
  });

  poiDialogCloseBottom.addEventListener("click", () => {
    closePoiDetailDialog(true);
  });

  // Listen to waypoint markers clicks from 3D Satellite Map
  window.addEventListener("waypoint-click", (e) => {
    const wpt = e.detail;
    pausePlayback();
    playbackIndex = wpt.closestTrackpointIndex;
    lastPausedPoiIndex = playbackIndex; // Prevent immediate repeat of trigger

    if (mapController) {
      mapController.syncToTrackpoint(playbackIndex, true);
    }
    
    elevationChart.progressIndex = playbackIndex;
    elevationChart.hoverIdx = -1;
    elevationChart.draw();
    
    updateHUD(playbackIndex);
    showPoiDetailDialog(wpt, playbackIndex);
  });
}
