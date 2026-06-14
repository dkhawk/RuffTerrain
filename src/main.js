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

import { parseGPX, parseKML, reconcileCourse, getMetricsForPoint, calculateWarnings, haversine, snapToRouteSegments, recalculateRouteMetrics } from "./gpx-parser.js";
import { writeGPX } from "./gpx-writer.js";
import { correctRouteElevations } from "./fetch-elevation.js";
import { sendToGemini, fetchAvailableModels, generateWaypointFromDescription } from "./gemini-client.js";
import { loadGoogleMaps, Map3DController, calculateBearing } from "./map-3d.js";
import { ElevationChart } from "./elevation-chart.js";
import { fetchWeatherForecast, getWeatherConditionStyle } from "./fetch-weather.js";

// ==========================================
// STATE MANAGEMENT & CONFIGURATIONS
// ==========================================

// Credentials (API keys fallback to environment variables from .env.local)
let apiKeyMaps = import.meta.env.VITE_GMAPS_API_KEY || localStorage.getItem("gmaps_api_key") || "";
let apiKeyGemini = localStorage.getItem("gemini_api_key") || import.meta.env.VITE_GEMINI_API_KEY || "";
let geminiModel = localStorage.getItem("gemini_model") || "models/gemini-2.0-flash";

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
let lastPausedPoiId = null;  // Prevents getting stuck in a loop at the same POI
let autoResumeTimeout = null; // Handles the timer for auto-continuing the preview
let isEditingPoiLocation = false; // Manages the edit location mode of the active POI
let activeDialogWpt = null; // Waypoint currently loaded in the POI dialog
let currentAbortController = null; // Active Gemini Chat API AbortController
let isPlacingNewPoi = false; // Placement mode flag
let tempPoiData = null; // Temporary snapped point coordinates
let attachedFiles = []; // Array of attached files for Gemini chat

// ==========================================
// DOM ELEMENT REFERENCES
// ==========================================

// Loader and HUD Telemetry Dashboard
const hudMetrics = document.getElementById("hud-metrics");
const hudValTime = document.getElementById("hud-val-time");
const hudMetricTime = document.getElementById("hud-metric-time");
const hudValDistCur = document.getElementById("hud-val-dist-cur");
const hudValDistTot = document.getElementById("hud-val-dist-tot");
const hudValElev = document.getElementById("hud-val-elev");
const hudValGainCur = document.getElementById("hud-val-gain-cur");
const hudValGainTot = document.getElementById("hud-val-gain-tot");
const hudValLossCur = document.getElementById("hud-val-loss-cur");
const hudValLossTot = document.getElementById("hud-val-loss-tot");
const hudValNextAs = document.getElementById("hud-val-next-as");
const activeSegmentDisplay = document.getElementById("active-segment-display");

// Whiskey Compass
const whiskeyCompass = document.getElementById("whiskey-compass");
const compassDial = document.getElementById("compass-dial");
const compassDegrees = document.getElementById("compass-degrees");

// Left panel components (Importer & Gemini chatbot)
const cardImporter = document.getElementById("card-importer");
const importTriggerBtn = document.getElementById("import-trigger-btn");
const closeImporterBtn = document.getElementById("close-importer-btn");
const dropZone = document.getElementById("drop-zone");
const fileSelector = document.getElementById("file-selector");
const editLockCheckbox = document.getElementById("edit-lock-checkbox");
const dragSnapCheckbox = document.getElementById("drag-snap-checkbox");

const cardGeminiChat = document.getElementById("card-gemini-chat");
const unifiedDrawerCard = document.getElementById("unified-drawer-card");
const tabPoiMode = document.getElementById("tab-poi-mode");
const tabChatMode = document.getElementById("tab-chat-mode");
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
const statElevRange = document.getElementById("stat-elev-range");
const statMaxElev = document.getElementById("stat-max-elev");
const statMinElev = document.getElementById("stat-min-elev");
const statLongestGap = document.getElementById("stat-longest-gap");

const activeClimbInfoBox = document.getElementById("active-climb-info-box");
const activeClimbText = document.getElementById("active-climb-text");

const correctElevationBtn = document.getElementById("correct-elevation-btn");
const elevationProgress = document.getElementById("elevation-progress");
const elevationProgressFill = document.getElementById("elevation-progress-fill");
const elevationProgressLabel = document.getElementById("elevation-progress-label");
const exportGpxBtn = document.getElementById("export-gpx-btn");

// Add POI custom control components
const addPoiStartBtn = document.getElementById("add-poi-start-btn");
const addPoiPanel = document.getElementById("add-poi-panel");
const addPoiCloseBtn = document.getElementById("add-poi-close-btn");
const addPoiLatLng = document.getElementById("add-poi-latlng");
const addPoiDist = document.getElementById("add-poi-dist");
const addPoiDesc = document.getElementById("add-poi-desc");
const addPoiCancelBtn = document.getElementById("add-poi-cancel-btn");
const addPoiSubmitBtn = document.getElementById("add-poi-submit-btn");

// Cleanup & Waypoint Edit Panel Components
const editWaypointList = document.getElementById("edit-waypoint-list");

const cardWarnings = document.getElementById("card-warnings");
const warningsCount = document.getElementById("warnings-count");
const warningsList = document.getElementById("warnings-list");
const toggleWarningsBtn = document.getElementById("toggle-warnings-btn");
const closeWarningsBtn = document.getElementById("close-warnings-btn");
const regenerateWarningsBtn = document.getElementById("regenerate-warnings-btn");
const clearWarningsHighlightBtn = document.getElementById("clear-warnings-highlight-btn");

// Collapsible POI Detail Dialog Panel
const poiDetailDialog = document.getElementById("poi-detail-dialog");
const poiValName = document.getElementById("poi-val-name");
const poiValNameInput = document.getElementById("poi-val-name-input");
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
const poiDialogEditBtn = document.getElementById("poi-dialog-edit-btn");
const poiEditModeSelector = document.getElementById("poi-edit-mode-selector");
const poiEditModeSnap = document.getElementById("poi-edit-mode-snap");
const poiEditModeFree = document.getElementById("poi-edit-mode-free");

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
const settingsTurnDamping = document.getElementById("settings-turn-damping");
const turnDampingVal = document.getElementById("turn-damping-val");
const recentCoursesList = document.getElementById("recent-courses-list");
const saveSettingsBtn = document.getElementById("save-settings-btn");

// Course Info Modal
const courseInfoOverlay = document.getElementById("course-info-overlay");
const courseInfoBtn = document.getElementById("course-info-btn");
const closeInfoBtn = document.getElementById("close-info-btn");
const courseInfoText = document.getElementById("course-info-text");
const toggleStatsBtn = document.getElementById("toggle-stats-btn");
const closeStatsBtn = document.getElementById("close-stats-btn");
// UI Notifications Toast
const toastNotification = document.getElementById("toast-notification");

// Weather Panel & UI
const toggleWeatherBtn = document.getElementById("toggle-weather-btn");
const cardWeather = document.getElementById("card-weather");
const closeWeatherBtn = document.getElementById("close-weather-btn");
const weatherLoader = document.getElementById("weather-loader");
const weatherError = document.getElementById("weather-error");
const weatherContent = document.getElementById("weather-content");
const weatherLocationSubtitle = document.getElementById("weather-location-subtitle");

const weatherCurrentTemp = document.getElementById("weather-current-temp");
const weatherCurrentFeels = document.getElementById("weather-current-feels");
const weatherCurrentEmoji = document.getElementById("weather-current-emoji");
const weatherCurrentDesc = document.getElementById("weather-current-desc");
const weatherCurrentWind = document.getElementById("weather-current-wind");
const weatherCurrentHumidity = document.getElementById("weather-current-humidity");
const weatherCurrentPrecip = document.getElementById("weather-current-precip");
const weatherCurrentClouds = document.getElementById("weather-current-clouds");
const weatherForecastHoursList = document.getElementById("weather-forecast-hours-list");
const weatherPlanStartInput = document.getElementById("weather-plan-start");
const weatherPlanDurationInput = document.getElementById("weather-plan-duration");
const weatherProjectedTimeLbl = document.getElementById("weather-projected-time");

// POI Weather Section
const poiWeatherSection = document.getElementById("poi-weather-section");
const poiWeatherEmoji = document.getElementById("poi-weather-emoji");
const poiWeatherDesc = document.getElementById("poi-weather-desc");
const poiWeatherWind = document.getElementById("poi-weather-wind");
const poiWeatherTemp = document.getElementById("poi-weather-temp");
const poiWeatherPrecip = document.getElementById("poi-weather-precip");

// Weather throttling/debouncing state
let lastWeatherLat = null;
let lastWeatherLon = null;
let weatherDebounceTimer = null;
let weatherAbortController = null;

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
    const targetWpt = activeRoute.waypoints.find(w => w === wpt);
    if (targetWpt) {
      const prevLat = targetWpt.lat;
      const prevLon = targetWpt.lon;

      const shouldSnap = dragSnapCheckbox ? dragSnapCheckbox.checked : true;
      const snapped = snapToRouteSegments(activeRoute, newPosition, targetWpt.dist_m);
      
      let finalLat = newPosition.lat;
      let finalLng = newPosition.lng;

      if (shouldSnap && snapped) {
        finalLat = snapped.lat;
        finalLng = snapped.lon;
        targetWpt.lat = snapped.lat;
        targetWpt.lon = snapped.lon;
        targetWpt.ele = snapped.ele;
        targetWpt.dist_m = snapped.dist_m;
        targetWpt.closestTrackpointIndex = snapped.closestTrackpointIndex;
      } else {
        targetWpt.lat = newPosition.lat;
        targetWpt.lon = newPosition.lng;
        if (snapped) {
          targetWpt.ele = snapped.ele;
          targetWpt.dist_m = snapped.dist_m;
          targetWpt.closestTrackpointIndex = snapped.closestTrackpointIndex;
        }
      }

      // Update detour trackpoint
      const pts = activeRoute.trackpoints;
      const matchIdx = pts.findIndex(
        pt => Math.abs(pt.lat - prevLat) < 0.000001 && Math.abs(pt.lon - prevLon) < 0.000001
      );

      if (matchIdx !== -1) {
        // Update existing detour trackpoint
        pts[matchIdx].lat = finalLat;
        pts[matchIdx].lon = finalLng;
      } else {
        // Create new detour trackpoint
        const snappedNew = snapToRouteSegments(activeRoute, { lat: finalLat, lng: finalLng });
        if (snappedNew) {
          const insertIdx = snappedNew.closestTrackpointIndex;
          const newTrackPt = {
            lat: finalLat,
            lon: finalLng,
            ele: snappedNew.ele,
            dist_m: snappedNew.dist_m,
            time: pts[insertIdx]?.time || null
          };
          if (insertIdx === 0 && snappedNew.dist_m === 0) {
            pts.unshift(newTrackPt);
          } else if (insertIdx === pts.length - 2 && Math.abs(snappedNew.dist_m - pts[pts.length - 1].dist_m) < 0.1) {
            pts.push(newTrackPt);
          } else {
            pts.splice(insertIdx + 1, 0, newTrackPt);
          }
        }
      }

      // Recalculate route metrics
      recalculateRouteMetrics(activeRoute);

      // Redraw map & chart
      mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
      elevationChart.setRoute(activeRoute);
      updateRouteStatsUI(activeRoute);
      renderEditWaypointList();

      showToast(`Updated location for: ${wpt.name}`);
      saveActiveRouteState();

      // Redraw map elements to sync marker locations exactly
      mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);

      // If we are currently showing details of this waypoint, refresh the dialog content
      if (poiDetailDialog && !poiDetailDialog.classList.contains("hidden") && poiValName.textContent === targetWpt.name) {
        showPoiDetailDialog(targetWpt, targetWpt.closestTrackpointIndex, targetWpt.dist_m);
      }
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
      lastPausedPoiId = null;
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
        showPoiDetailDialog(matchedPoi, index, matchedPoi.dist_m);
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

  setTimeout(() => {
    fetch("./samples/enhanced_52m_start.gpx")
      .then(res => res.text())
      .then(text => {
        processGpxContent(text, "enhanced_52m_start.gpx");
      })
      .catch(err => console.log("Sample load err:", err));
  }, 200);
});

// ==========================================
// PREFERENCES & UTILS RENDERERS
// ==========================================

/**
 * Updates the camera range label to show value in feet or meters depending on units.
 */
function updateCameraRangeLabel(val) {
  if (units === "imperial") {
    const feet = Math.round(val * 3.28084);
    rangeLabelVal.textContent = `${feet} ft`;
  } else {
    rangeLabelVal.textContent = `${val}m`;
  }
}

/**
 * Restores user UI preferences from localStorage and configures widgets to reflect them.
 */
function loadPreferences() {
  const savedSpeed = localStorage.getItem("pref_playback_speed");
  if (savedSpeed) {
    playbackSpeed.value = savedSpeed;
    speedLabelVal.textContent = savedSpeed;
  }

  const savedRange = localStorage.getItem("pref_cam_range") || cameraRangeSlider.value;
  cameraRangeSlider.value = savedRange;
  updateCameraRangeLabel(parseInt(savedRange));
  mapController.cameraRange = parseInt(savedRange);

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

  const savedDragSnap = localStorage.getItem("pref_drag_snap");
  if (savedDragSnap) {
    const isChecked = savedDragSnap === "true";
    if (dragSnapCheckbox) dragSnapCheckbox.checked = isChecked;
  } else {
    if (dragSnapCheckbox) dragSnapCheckbox.checked = true;
    localStorage.setItem("pref_drag_snap", "true");
  }

  const savedTurnDamping = localStorage.getItem("pref_turn_damping");
  if (savedTurnDamping) {
    if (settingsTurnDamping) settingsTurnDamping.value = savedTurnDamping;
    if (turnDampingVal) turnDampingVal.textContent = `${savedTurnDamping}%`;
    if (mapController) mapController.turnRateFactor = (101 - parseInt(savedTurnDamping)) / 1000;
  } else {
    if (settingsTurnDamping) settingsTurnDamping.value = "86";
    if (turnDampingVal) turnDampingVal.textContent = "86%";
    if (mapController) mapController.turnRateFactor = 0.015;
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
  } else {
    document.body.classList.remove("edit-locked");
    chatInput.disabled = false;
    chatSubmit.disabled = false;
    correctElevationBtn.disabled = false;
    fileSelector.disabled = false;
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

    // Show course importer card on successful map load
    if (cardImporter) {
      cardImporter.classList.remove("hidden");
    }

    // Draw pre-existing route if initialized
    if (activeRoute) {
      mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
      mapController.syncToTrackpoint(playbackIndex, false);
    }
  } catch (err) {
    console.error(err);
    let loaderState = document.getElementById("map-loader-state");
    if (!loaderState) {
      loaderState = document.createElement("div");
      loaderState.id = "map-loader-state";
      document.getElementById("map-container")?.appendChild(loaderState);
    }
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
 * Returns a unit-converted numerical temperature value representation from celsius.
 */
function convertTemperatureValue(celsius) {
  if (units === "imperial") {
    return Math.round((celsius * 9) / 5 + 32) + "°F";
  }
  return Math.round(celsius) + "°C";
}

/**
 * Returns a unit-converted numerical wind speed value representation from km/h.
 */
function convertWindSpeedValue(kmh) {
  if (units === "imperial") {
    return Math.round(kmh * 0.621371) + " mph";
  }
  return Math.round(kmh) + " km/h";
}

/**
 * Helper to format display hour string from weather API displayDateTime structure.
 */
function formatDisplayHour(displayDateTime) {
  if (!displayDateTime) return "--:--";
  const hours = displayDateTime.hours;
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:00 ${ampm}`;
}

/**
 * Updates the Weather Panel layout with details.
 */
async function updateWeatherUI(lat, lon) {
  if (!apiKeyMaps) {
    if (weatherError) {
      weatherError.textContent = "Google Maps API Key is required for weather forecast.";
      weatherError.classList.remove("hidden");
    }
    if (weatherLoader) weatherLoader.classList.add("hidden");
    if (weatherContent) weatherContent.classList.add("hidden");
    return;
  }

  if (weatherAbortController) {
    weatherAbortController.abort();
  }
  weatherAbortController = new AbortController();

  if (weatherLoader) weatherLoader.classList.remove("hidden");
  if (weatherError) weatherError.classList.add("hidden");
  if (weatherContent) weatherContent.classList.add("hidden");

  try {
    const data = await fetchWeatherForecast(lat, lon, 48, apiKeyMaps);
    if (!data || !data.forecastHours || data.forecastHours.length === 0) {
      throw new Error("No forecast data returned.");
    }

    // Determine location subtitle
    let locationName = `Lat: ${Number(lat).toFixed(4)}, Lon: ${Number(lon).toFixed(4)}`;
    if (activeRoute && activeRoute.waypoints) {
      const closestWpt = activeRoute.waypoints.find(wpt => {
        const d = haversine(lat, lon, wpt.lat, wpt.lon);
        return d < 0.1; // within 100 meters
      });
      if (closestWpt) {
        locationName = `Near ${closestWpt.name}`;
      }
    }
    if (weatherLocationSubtitle) {
      weatherLocationSubtitle.textContent = locationName;
    }

    let progressFraction = 0;
    if (activeRoute && activeRoute.trackpoints && activeRoute.trackpoints.length > 0 && activeRoute.totalDistance > 0) {
      const snapped = snapToRouteSegments(activeRoute, { lat, lng: lon });
      if (snapped && snapped.dist_m !== undefined) {
        progressFraction = Math.max(0, Math.min(1, snapped.dist_m / activeRoute.totalDistance));
      }
    }

    let planStartMs = Date.now();
    if (weatherPlanStartInput && weatherPlanStartInput.value) {
      const parsed = new Date(weatherPlanStartInput.value);
      if (!isNaN(parsed)) {
        planStartMs = parsed.getTime();
      }
    }

    const durationHrs = (weatherPlanDurationInput && parseFloat(weatherPlanDurationInput.value)) ? parseFloat(weatherPlanDurationInput.value) : 4.0;
    const estArrivalMs = planStartMs + progressFraction * (durationHrs * 3600 * 1000);
    const arrivalDate = new Date(estArrivalMs);

    if (weatherProjectedTimeLbl) {
      const arrDay = arrivalDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const arrTime = arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      weatherProjectedTimeLbl.textContent = `Arrive (${Math.round(progressFraction * 100)}%): ${arrDay}, ${arrTime}`;
    }

    let selectedHour = data.forecastHours[0];
    let minDiff = Infinity;

    data.forecastHours.forEach(hr => {
      let hrMs = Date.now();
      if (hr.time) {
        hrMs = new Date(hr.time).getTime();
      } else if (hr.displayDateTime) {
        const dt = hr.displayDateTime;
        hrMs = new Date(dt.year || arrivalDate.getFullYear(), (dt.month || arrivalDate.getMonth() + 1) - 1, dt.day || arrivalDate.getDate(), dt.hours || 0).getTime();
      }

      const diff = Math.abs(hrMs - arrivalDate.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        selectedHour = hr;
      }
    });

    const current = selectedHour;
    const condition = current.weatherCondition || {};
    const condStyle = getWeatherConditionStyle(condition.type);

    if (weatherCurrentTemp) {
      weatherCurrentTemp.textContent = convertTemperatureValue(current.temperature?.degrees ?? 0);
    }
    if (weatherCurrentFeels) {
      weatherCurrentFeels.textContent = `Feels like ${convertTemperatureValue(current.feelsLikeTemperature?.degrees ?? 0)}`;
    }
    if (weatherCurrentEmoji) {
      weatherCurrentEmoji.textContent = condStyle.emoji;
    }
    if (weatherCurrentDesc) {
      weatherCurrentDesc.textContent = condition.description?.text || condStyle.label;
    }

    if (weatherCurrentWind) {
      const windSpeed = current.wind?.speed?.value ?? 0;
      const windDir = current.wind?.direction?.cardinal || "N/A";
      weatherCurrentWind.textContent = `${convertWindSpeedValue(windSpeed)} ${windDir}`;
    }
    if (weatherCurrentHumidity) {
      weatherCurrentHumidity.textContent = `${current.relativeHumidity ?? "--"}%`;
    }
    if (weatherCurrentPrecip) {
      weatherCurrentPrecip.textContent = `${current.precipitation?.probability?.percent ?? 0}%`;
    }
    if (weatherCurrentClouds) {
      weatherCurrentClouds.textContent = `${current.cloudCover ?? "--"}%`;
    }

    if (weatherForecastHoursList) {
      weatherForecastHoursList.innerHTML = "";
      const selectedIdx = data.forecastHours.indexOf(selectedHour);
      const displayHours = data.forecastHours.slice(Math.max(0, selectedIdx), selectedIdx + 8);

      displayHours.forEach((hourData, idx) => {
        const hrCond = hourData.weatherCondition || {};
        const hrStyle = getWeatherConditionStyle(hrCond.type);
        const hrTemp = hourData.temperature?.degrees ?? 0;
        const timeStr = formatDisplayHour(hourData.displayDateTime);

        const row = document.createElement("div");
        row.className = "weather-forecast-hour-row";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.background = idx === 0 ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.03)";
        row.style.border = idx === 0 ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255, 255, 255, 0.05)";
        row.style.borderRadius = "6px";
        row.style.padding = "6px 10px";

        row.innerHTML = `
          <span class="time" style="font-size: 11px; font-weight: ${idx === 0 ? 'bold' : '500'}; color: ${idx === 0 ? '#10b981' : 'inherit'}; min-width: 65px; text-align: left;">${timeStr}</span>
          <span class="emoji" style="font-size: 16px; margin: 0 8px;">${hrStyle.emoji}</span>
          <span class="desc" style="font-size: 11px; color: var(--text-muted); flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${hrCond.description?.text || hrStyle.label}</span>
          <span class="temp" style="font-size: 11px; font-weight: bold; min-width: 45px; text-align: right;">${convertTemperatureValue(hrTemp)}</span>
        `;
        weatherForecastHoursList.appendChild(row);
      });
    }

    if (weatherLoader) weatherLoader.classList.add("hidden");
    if (weatherContent) weatherContent.classList.remove("hidden");
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Error updating weather UI:", error);
      if (weatherError) {
        weatherError.textContent = error.message || "Failed to load weather forecast.";
        weatherError.classList.remove("hidden");
      }
      if (weatherLoader) weatherLoader.classList.add("hidden");
    }
  }
}

/**
 * Updates POI weather sub-view.
 */
async function updatePoiWeatherUI(wpt) {
  if (!apiKeyMaps) {
    if (poiWeatherSection) poiWeatherSection.classList.add("hidden");
    return;
  }

  if (poiWeatherSection) poiWeatherSection.classList.remove("hidden");
  if (poiWeatherEmoji) poiWeatherEmoji.textContent = "🌡️";
  if (poiWeatherDesc) poiWeatherDesc.textContent = "Loading...";
  if (poiWeatherWind) poiWeatherWind.textContent = "Wind: --";
  if (poiWeatherTemp) poiWeatherTemp.textContent = "--";
  if (poiWeatherPrecip) poiWeatherPrecip.textContent = "Rain: --%";

  try {
    const data = await fetchWeatherForecast(wpt.lat, wpt.lon, 1, apiKeyMaps);
    if (!data || !data.forecastHours || data.forecastHours.length === 0) {
      throw new Error("No forecast data");
    }

    const current = data.forecastHours[0];
    const condition = current.weatherCondition || {};
    const condStyle = getWeatherConditionStyle(condition.type);

    if (poiWeatherEmoji) poiWeatherEmoji.textContent = condStyle.emoji;
    if (poiWeatherDesc) poiWeatherDesc.textContent = condition.description?.text || condStyle.label;
    
    const tempCelsius = current.temperature?.degrees ?? 0;
    if (poiWeatherTemp) poiWeatherTemp.textContent = convertTemperatureValue(tempCelsius);

    const windSpeed = current.wind?.speed?.value ?? 0;
    const windDir = current.wind?.direction?.cardinal || "N/A";
    if (poiWeatherWind) {
      poiWeatherWind.textContent = `Wind: ${convertWindSpeedValue(windSpeed)} ${windDir}`;
    }

    if (poiWeatherPrecip) {
      poiWeatherPrecip.textContent = `Rain: ${current.precipitation?.probability?.percent ?? 0}%`;
    }
  } catch (error) {
    console.error("Failed to load POI weather:", error);
    if (poiWeatherDesc) poiWeatherDesc.textContent = "Forecast unavailable";
    if (poiWeatherTemp) poiWeatherTemp.textContent = "--";
  }
}

/**
 * Triggers a debounced weather update for the specified lat/lon.
 */
function triggerWeatherWeather(lat, lon, force = false) {
  if (!apiKeyMaps) return;
  if (!cardWeather || cardWeather.classList.contains("hidden")) return;

  if (weatherDebounceTimer) {
    clearTimeout(weatherDebounceTimer);
  }

  weatherDebounceTimer = setTimeout(() => {
    const distShift = (lastWeatherLat !== null && lastWeatherLon !== null) 
      ? haversine(lat, lon, lastWeatherLat, lastWeatherLon) 
      : Infinity;

    if (force || distShift > 2.0) {
      lastWeatherLat = lat;
      lastWeatherLon = lon;
      updateWeatherUI(lat, lon);
    }
  }, 600);
}

/**
 * Coordinates sidebar panel horizontal shift mapping.
 */
function updateWeatherShiftedState() {
  if (!cardWarnings || !cardWeather) return;
  const warningsVisible = !cardWarnings.classList.contains("hidden");
  const weatherVisible = !cardWeather.classList.contains("hidden");

  if (warningsVisible && weatherVisible) {
    cardWeather.classList.add("shifted");
  } else {
    cardWeather.classList.remove("shifted");
  }
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
  if (cameraRangeSlider) {
    updateCameraRangeLabel(parseInt(cameraRangeSlider.value));
  }
}

/**
 * Updates telemetry metrics displayed on the HUD and handles climb hazard warnings.
 * @param {number} index Current trackpoint cursor index
 */
function updateHUD(index) {
  if (!activeRoute) return;
  const pts = activeRoute.trackpoints;
  if (index === undefined || index === null || index < 0 || index >= pts.length) return;

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

  // 8. Update active segment tag display
  if (activeSegmentDisplay) {
    if (activeRoute.segments && activeRoute.segments.length > 1) {
      const activeSeg = activeRoute.segments.find(seg => currentDist >= seg.startDist && currentDist <= seg.endDist);
      if (activeSeg) {
        activeSegmentDisplay.textContent = activeSeg.name;
        activeSegmentDisplay.classList.remove("hidden");
        activeSegmentDisplay.title = activeSeg.desc || "Active Segment";
      } else {
        activeSegmentDisplay.classList.add("hidden");
      }
    } else {
      activeSegmentDisplay.classList.add("hidden");
    }
  }

  // 9. Debounced Weather Update
  triggerWeatherWeather(currentPt.lat, currentPt.lon);
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
  if (lastPausedPoiId) {
    playbackIndex = Math.min(pts.length - 1, Math.floor(playbackIndex) + 1);
  }
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

    const prevDist = playbackDistance;
    playbackDistance += simSpeed * dt;

    if (playbackDistance >= activeRoute.totalDistance) {
      pausePlayback();
      playbackDistance = activeRoute.totalDistance;
      playbackIndex = activeRoute.trackpoints.length - 1;
      updatePlaybackFrame();
      return;
    }

    updatePlaybackFrame();

    // Reset lastPausedPoiId if we move away from it by more than 50 meters
    if (lastPausedPoiId) {
      let poiDist = 0;
      if (lastPausedPoiId.includes("-pass-")) {
        const parts = lastPausedPoiId.split("-pass-");
        const wptId = parts[0];
        const passNum = parseInt(parts[1]);
        const wpt = activeRoute.waypoints.find(w => w.id === wptId);
        const pass = wpt?.extensions?.station?.passes?.find(p => p.num === passNum);
        poiDist = pass ? pass.dist_m : 0;
      } else {
        const lastPoi = activeRoute.waypoints.find(w => w.id === lastPausedPoiId);
        poiDist = lastPoi ? lastPoi.dist_m : 0;
      }
      
      if (Math.abs(playbackDistance - poiDist) > 50) {
        lastPausedPoiId = null;
      }
    }
    
    // Auto-pause preview verification when approaching a waypoint checkpoint
    let reachedPoi = null;
    let crossedPass = null;

    for (const wpt of activeRoute.waypoints) {
      const passes = wpt.extensions?.station?.passes || [];
      if (passes.length > 0) {
        // Multi-pass waypoint: check if we crossed any of its passes
        for (const pass of passes) {
          const passDist = pass.dist_m;
          const passKey = `${wpt.id}-pass-${pass.num}`;
          if (passDist >= Math.min(prevDist, playbackDistance) && 
              passDist <= Math.max(prevDist, playbackDistance) && 
              passKey !== lastPausedPoiId) {
            reachedPoi = wpt;
            crossedPass = pass;
            break;
          }
        }
      } else {
        // Single-pass / standard waypoint: check base dist_m
        if (wpt.dist_m >= Math.min(prevDist, playbackDistance) && 
            wpt.dist_m <= Math.max(prevDist, playbackDistance) && 
            wpt.id !== lastPausedPoiId) {
          reachedPoi = wpt;
          break;
        }
      }
      if (reachedPoi) break;
    }

    if (reachedPoi) {
      const isMultiPass = crossedPass !== null;
      lastPausedPoiId = isMultiPass ? `${reachedPoi.id}-pass-${crossedPass.num}` : reachedPoi.id;
      pausePlayback();
      showPoiDetailDialog(reachedPoi, reachedPoi.closestTrackpointIndex, playbackDistance, true);
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

  // Calculate dynamic lookahead based on average point spacing (pure-pursuit style)
  const avgSpacing = activeRoute.avgSpacing || 10;
  const lookaheadDist = playbackDistance + Math.max(50, avgSpacing * 3.5);
  const lookaheadPt = getInterpolatedPoint(lookaheadDist);
  
  const targetHeading = calculateBearing(pt.lat, pt.lon, lookaheadPt.lat, lookaheadPt.lon);

  if (mapController) {
    const speedScale = playbackSpeed ? parseInt(playbackSpeed.value) : 1;
    mapController.updateCamera(pt, targetHeading, speedScale);
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
 * Renders interactive toggle buttons inside the amenities row for editing services.
 */
function renderEditAmenities(wpt) {
  if (!poiServicesIconsRow || !wpt) return;
  poiServicesIconsRow.innerHTML = "";

  if (!wpt.extensions) wpt.extensions = {};
  if (!wpt.extensions.station) {
    wpt.extensions.station = { type: "informational", passes: [], services: {}, accessibility: {} };
  }
  const station = wpt.extensions.station;
  if (!station.services) station.services = {};
  if (!station.accessibility) station.accessibility = {};

  const AMENITIES_LIST = [
    { key: "water", icon: "💧", label: "Water", category: "services" },
    { key: "food", icon: "🍔", label: "Food", category: "services" },
    { key: "toilets", icon: "🚾", label: "Restrooms", category: "services" },
    { key: "medical", icon: "➕", label: "Aid", category: "services" },
    { key: "sleep_area", icon: "🛌", label: "Sleep", category: "services" },
    { key: "crew_allowed", icon: "🚗", label: "Crew Access", category: "accessibility" },
    { key: "pacer_allowed", icon: "🏃", label: "Pacer Exchange", category: "accessibility" },
    { key: "drop_bag_allowed", icon: "🎒", label: "Drop Bag", category: "accessibility" }
  ];

  AMENITIES_LIST.forEach(item => {
    const badge = document.createElement("button");
    badge.className = "btn btn-secondary btn-sm";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.gap = "4px";
    badge.style.padding = "4px 8px";
    badge.style.borderRadius = "4px";
    badge.style.fontSize = "11px";
    badge.style.cursor = "pointer";
    badge.style.border = "1px solid rgba(255,255,255,0.15)";
    badge.style.margin = "2px";

    const store = item.category === "services" ? station.services : station.accessibility;
    let isActive = !!store[item.key];

    const updateStyle = () => {
      if (isActive) {
        badge.style.backgroundColor = "rgba(59, 130, 246, 0.25)";
        badge.style.borderColor = "var(--primary-color)";
        badge.style.color = "var(--text-color)";
        badge.style.opacity = "1";
      } else {
        badge.style.backgroundColor = "rgba(255, 255, 255, 0.02)";
        badge.style.borderColor = "rgba(255,255,255,0.05)";
        badge.style.color = "var(--text-muted)";
        badge.style.opacity = "0.5";
      }
    };

    updateStyle();

    badge.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isActive = !isActive;
      store[item.key] = isActive;
      updateStyle();
    });

    poiServicesIconsRow.appendChild(badge);
  });
}

/**
 * Displays POI detail dialog window populated with services and multi-pass timeline metrics.
 * @param {Object} wpt Waypoint details parsed from GPX schema
 * @param {number} index Trackpoint index snapping point
 */
function showPoiDetailDialog(wpt, index, referenceDist = null, startCollapsed = false) {
  if (!poiDetailDialog) return;

  // Fetch and show weather for the POI
  updatePoiWeatherUI(wpt);

  activeDialogWpt = wpt;
  isEditingPoiLocation = false;
  if (poiValNameInput) {
    poiValNameInput.classList.add("hidden");
    poiValNameInput.value = wpt.name;
  }
  if (poiValName) poiValName.classList.remove("hidden");
  if (poiDialogEditBtn) {
    poiDialogEditBtn.textContent = "✏️ Edit Waypoint";
    poiDialogEditBtn.style.backgroundColor = "var(--primary-color)";
  }
  if (poiEditModeSelector) {
    poiEditModeSelector.classList.add("hidden");
  }
  if (mapController) {
    mapController.setEditLock(true);
  }

  // Clear any existing active timeouts
  if (autoResumeTimeout) {
    clearTimeout(autoResumeTimeout);
    autoResumeTimeout = null;
  }

  // Title headers
  poiValName.textContent = wpt.name;

  const currentDist = referenceDist !== null ? referenceDist : wpt.dist_m;
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

  // Setup collapsed or expanded initial view states
  if (startCollapsed) {
    poiDetailDialog.classList.add("collapsed");
  } else {
    poiDetailDialog.classList.remove("collapsed");
  }
  poiDetailDialog.classList.remove("hidden");
  console.log("[main] REMOVED HIDDEN FROM poiDetailDialog. unifiedDrawerCard exists:", !!unifiedDrawerCard);
  if (unifiedDrawerCard) {
    unifiedDrawerCard.classList.remove("hidden");
    console.log("[main] REMOVED HIDDEN FROM unifiedDrawerCard");
  }
  if (tabPoiMode) {
    console.log("[main] CLICKING tabPoiMode");
    tabPoiMode.click();
  }

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
  if (isEditingPoiLocation) {
    isEditingPoiLocation = false;
    if (poiDialogEditBtn) {
      poiDialogEditBtn.textContent = "✏️ Edit Location";
      poiDialogEditBtn.style.backgroundColor = "var(--primary-color)";
    }
    if (poiEditModeSelector) {
      poiEditModeSelector.classList.add("hidden");
    }
    if (mapController) {
      mapController.setEditLock(true);
    }
  }

  if (poiDetailDialog) {
    poiDetailDialog.classList.add("hidden");
  }
  if (unifiedDrawerCard) {
    unifiedDrawerCard.classList.add("hidden");
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

  // Attempt to write to localStorage, trimming oldest entries if the quota is exceeded
  let success = false;
  while (!success && recentCourses.length > 0) {
    try {
      localStorage.setItem("recent_courses", JSON.stringify(recentCourses));
      success = true;
    } catch (err) {
      if (err.name === "QuotaExceededError" || err.code === 22) {
        console.warn("Storage quota exceeded. Removing oldest course from history cache:", recentCourses[recentCourses.length - 1].name);
        recentCourses.pop(); // Remove the oldest item and try again
      } else {
        console.error("Failed to write recent courses to localStorage:", err);
        break; // break to prevent infinite loops on other errors
      }
    }
  }

  renderRecentCoursesList();
}

/**
 * Auto-saves the current active route state back into the local history list.
 */
function saveActiveRouteState() {
  if (!activeRoute) return;
  try {
    const updatedGpxText = writeGPX(activeRoute);
    addRecentCourse(activeRoute.name, updatedGpxText);
  } catch (err) {
    console.error("Failed to auto-save course state:", err);
  }
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

/**
 * Projects a point onto the closest line segment of the route trackpoints.
 * Returns snapped coordinates, interpolated elevation, and distance along course.
 */


/**
 * Renders the waypoint list in the Edit Course sidebar panel.
 */
function renderEditWaypointList() {
  if (!editWaypointList) return;

  if (!activeRoute || activeRoute.waypoints.length === 0) {
    editWaypointList.innerHTML = `<span style="font-size: 10px; color: var(--text-muted); text-align: center; font-style: italic; padding: 6px 0; display: block; width: 100%;">No waypoints loaded.</span>`;
    return;
  }

  editWaypointList.innerHTML = "";
  activeRoute.waypoints.forEach((wpt, index) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.style.padding = "8px 10px";
    item.style.background = "rgba(255,255,255,0.05)";
    item.style.border = "1px solid rgba(255,255,255,0.08)";
    item.style.borderRadius = "6px";
    item.style.fontSize = "12px";
    item.style.gap = "8px";
    item.style.boxSizing = "border-box";
    item.style.transition = "background-color 0.15s, border-color 0.15s";

    item.addEventListener("mouseenter", () => {
      item.style.background = "rgba(255,255,255,0.08)";
      item.style.borderColor = "rgba(255,255,255,0.15)";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "rgba(255,255,255,0.05)";
      item.style.borderColor = "rgba(255,255,255,0.08)";
    });

    const nameSpan = document.createElement("span");
    nameSpan.style.flex = "1";
    nameSpan.style.whiteSpace = "nowrap";
    nameSpan.style.overflow = "hidden";
    nameSpan.style.textOverflow = "ellipsis";
    const distVal = units === "miles" 
      ? `${(wpt.dist_m / 1609.34).toFixed(1)} mi` 
      : `${(wpt.dist_m / 1000).toFixed(1)} km`;
    nameSpan.textContent = `${wpt.name} (${distVal})`;
    nameSpan.style.cursor = "pointer";
    nameSpan.style.color = "var(--text-color)";
    nameSpan.style.fontWeight = "500";
    nameSpan.title = "Click to jump to waypoint";
    nameSpan.addEventListener("click", () => {
      const event = new CustomEvent("waypoint-click", { detail: wpt });
      window.dispatchEvent(event);
    });

    const actionDiv = document.createElement("div");
    actionDiv.style.display = "flex";
    actionDiv.style.gap = "6px";

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.textContent = "✏️";
    editBtn.style.background = "none";
    editBtn.style.border = "none";
    editBtn.style.cursor = "pointer";
    editBtn.style.fontSize = "12px";
    editBtn.style.padding = "4px";
    editBtn.style.borderRadius = "4px";
    editBtn.style.transition = "background-color 0.15s";
    editBtn.addEventListener("mouseenter", () => {
      editBtn.style.background = "rgba(255,255,255,0.1)";
    });
    editBtn.addEventListener("mouseleave", () => {
      editBtn.style.background = "none";
    });
    editBtn.title = "Edit location";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const event = new CustomEvent("waypoint-click", { detail: wpt });
      window.dispatchEvent(event);
      setTimeout(() => {
        if (poiDialogEditBtn && !isEditingPoiLocation) {
          poiDialogEditBtn.click();
        }
      }, 150);
    });

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.textContent = "❌";
    delBtn.style.background = "none";
    delBtn.style.border = "none";
    delBtn.style.cursor = "pointer";
    delBtn.style.fontSize = "11px";
    delBtn.style.padding = "4px";
    delBtn.style.borderRadius = "4px";
    delBtn.style.transition = "background-color 0.15s";
    delBtn.addEventListener("mouseenter", () => {
      delBtn.style.background = "rgba(239,68,68,0.15)";
    });
    delBtn.addEventListener("mouseleave", () => {
      delBtn.style.background = "none";
    });
    delBtn.title = "Delete waypoint";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete ${wpt.name}?`)) {
        const prevLat = wpt.lat;
        const prevLon = wpt.lon;

        activeRoute.waypoints.splice(index, 1);
        
        // Remove matching detour trackpoint
        const matchIdx = activeRoute.trackpoints.findIndex(
          pt => Math.abs(pt.lat - prevLat) < 0.000001 && Math.abs(pt.lon - prevLon) < 0.000001
        );
        if (matchIdx !== -1) {
          activeRoute.trackpoints.splice(matchIdx, 1);
        }

        recalculateRouteMetrics(activeRoute);
        
        mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
        if (elevationChart) elevationChart.setRoute(activeRoute);
        updateRouteStatsUI(activeRoute);
        renderWarningsUI(activeRoute);
        
        showToast(`Removed waypoint: ${wpt.name}`);
        saveActiveRouteState();
        renderEditWaypointList();
        closePoiDetailDialog(false);
      }
    });

    actionDiv.appendChild(editBtn);
    actionDiv.appendChild(delBtn);
    item.appendChild(nameSpan);
    item.appendChild(actionDiv);
    editWaypointList.appendChild(item);
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
  const isKml = filename.endsWith(".kml") || text.includes("<kml") || text.includes("</kml>");
  activeRoute = isKml ? parseKML(text, units) : parseGPX(text, units);
  activeRoute.avgSpacing = activeRoute.trackpoints.length > 0 ? (activeRoute.totalDistance / activeRoute.trackpoints.length) : 0;
  chatHistory = []; // Reset Gemini chatbot context on new course ingestion
  pausePlayback();
  playbackDistance = 0;
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
    let infoHtml = `<p>${escapeHtml(activeRoute.description)}</p>`;
    if (activeRoute.segments && activeRoute.segments.length > 1) {
      infoHtml += `<h4 style="margin-top: 20px; font-weight: 600; color: var(--primary-color);">COURSE SEGMENTS</h4>`;
      infoHtml += `<div class="course-segments-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">`;
      activeRoute.segments.forEach((seg, idx) => {
        const distVal = ((seg.endDist - seg.startDist) * (units === "imperial" ? 1 / 1609.344 : 1 / 1000)).toFixed(2);
        const distUnit = units === "imperial" ? "mi" : "km";
        infoHtml += `
          <div class="segment-info-item" style="padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02);">
            <div style="font-weight: 600; font-size: 13px; color: var(--primary-color); display: flex; justify-content: space-between;">
              <span>${idx + 1}. ${escapeHtml(seg.name)}</span>
              <span>${distVal} ${distUnit}</span>
            </div>
            ${seg.desc ? `<div style="font-size: 12px; margin-top: 4px; color: rgba(255,255,255,0.6);">${escapeHtml(seg.desc)}</div>` : ''}
          </div>
        `;
      });
      infoHtml += `</div>`;
    }
    courseInfoText.innerHTML = infoHtml;
    courseInfoBtn.classList.remove("hidden");
  } else if (activeRoute.segments && activeRoute.segments.length > 1) {
    let infoHtml = `<h4 style="margin-top: 10px; font-weight: 600; color: var(--primary-color);">COURSE SEGMENTS</h4>`;
    infoHtml += `<div class="course-segments-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">`;
    activeRoute.segments.forEach((seg, idx) => {
      const distVal = ((seg.endDist - seg.startDist) * (units === "imperial" ? 1 / 1609.344 : 1 / 1000)).toFixed(2);
      const distUnit = units === "imperial" ? "mi" : "km";
      infoHtml += `
        <div class="segment-info-item" style="padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02);">
          <div style="font-weight: 600; font-size: 13px; color: var(--primary-color); display: flex; justify-content: space-between;">
            <span>${idx + 1}. ${escapeHtml(seg.name)}</span>
            <span>${distVal} ${distUnit}</span>
          </div>
          ${seg.desc ? `<div style="font-size: 12px; margin-top: 4px; color: rgba(255,255,255,0.6);">${escapeHtml(seg.desc)}</div>` : ''}
        </div>
      `;
    });
    infoHtml += `</div>`;
    courseInfoText.innerHTML = infoHtml;
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
  if (toggleStatsBtn) toggleStatsBtn.classList.add("hidden");
  cardWarnings.classList.remove("hidden");
  if (toggleWarningsBtn) toggleWarningsBtn.classList.add("hidden");
  cardWeather.classList.remove("hidden");
  if (toggleWeatherBtn) toggleWeatherBtn.classList.add("hidden");
  updateWeatherShiftedState();
  
  if (activeRoute.trackpoints.length > 0) {
    const startPt = activeRoute.trackpoints[0];
    triggerWeatherWeather(startPt.lat, startPt.lon, true);
  }

  cardElevationScrubber.classList.remove("hidden");
  hudMetrics.classList.remove("hidden");

  // Show/hide time HUD column based on presence of actual timestamps in the GPX
  const hasTime = activeRoute.trackpoints.length > 0 && !!activeRoute.trackpoints[0].time;
  if (hudMetricTime) {
    if (hasTime) {
      hudMetricTime.classList.remove("hidden");
    } else {
      hudMetricTime.classList.add("hidden");
    }
  }
  if (cardGeminiChat) {
    cardGeminiChat.classList.remove("hidden");
  }
  const toggleChatBtn = document.getElementById("toggle-chat-btn");
  if (toggleChatBtn) {
    toggleChatBtn.classList.add("hidden");
  }

  // Sync components
  elevationChart.units = units;
  elevationChart.setRoute(activeRoute);

  if (apiKeyMaps && mapController.map) {
    mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
    mapController.syncToTrackpoint(0, true);
  }

  elevationChart.progressIndex = 0;
  elevationChart.hoverIdx = -1;
  elevationChart.draw();

  updateRouteStatsUI(activeRoute);
  renderWarningsUI(activeRoute);
  updateUnitLabels();
  updateHUD(0);
  if (clearWarningsHighlightBtn) {
    clearWarningsHighlightBtn.classList.add("hidden");
  }
  
  // Render sidebar waypoints outline list
  renderEditWaypointList();

  // Save to recently played list
  addRecentCourse(activeRoute.name, text);

  showToast(`Loaded ${filename}`);
}

function updateRouteStatsUI(route) {
  if (!route) return;
  const distStr = convertDistanceValue(route.totalDistance || 0);
  const distUnit = units === "imperial" ? "mi" : "km";
  if (statDist) statDist.textContent = `${distStr} ${distUnit}`;

  const gainStr = convertElevationValue(route.totalElevationGain || 0);
  const lossStr = convertElevationValue(route.totalElevationLoss || 0);
  const eleUnit = units === "imperial" ? "ft" : "m";

  if (statGain) statGain.textContent = `+${gainStr}${eleUnit}`;
  if (statLoss) statLoss.textContent = `-${lossStr}${eleUnit}`;
  if (statWpts) statWpts.textContent = route.waypoints ? route.waypoints.length : 0;

  const minElevStr = convertElevationValue(route.minElevation || 0);
  const maxElevStr = convertElevationValue(route.maxElevation || 0);
  if (statElevRange) {
    statElevRange.textContent = `${minElevStr} - ${maxElevStr} ${eleUnit}`;
  }
  if (statMaxElev) {
    statMaxElev.textContent = `${maxElevStr} ${eleUnit}`;
  }
  if (statMinElev) {
    statMinElev.textContent = `${minElevStr} ${eleUnit}`;
  }

  if (statLongestGap) {
    let maxGap = 0;
    let gapDesc = "None";

    const sortedWpts = [...(route.waypoints || [])].sort((a, b) => (a.dist_m || 0) - (b.dist_m || 0));

    if (sortedWpts.length === 0) {
      maxGap = route.totalDistance || 0;
      gapDesc = "Start ➔ Finish";
    } else {
      let maxDist = Math.max(0, sortedWpts[0].dist_m || 0);
      maxDist = Math.min(maxDist, route.totalDistance || 0);
      gapDesc = `Start ➔ ${sortedWpts[0].name}`;
      maxGap = maxDist;

      for (let i = 1; i < sortedWpts.length; i++) {
        let prevD = Math.max(0, sortedWpts[i-1].dist_m || 0);
        let currD = Math.max(0, sortedWpts[i].dist_m || 0);
        prevD = Math.min(prevD, route.totalDistance || 0);
        currD = Math.min(currD, route.totalDistance || 0);

        const g = currD - prevD;
        if (g > maxGap) {
          maxGap = g;
          gapDesc = `${sortedWpts[i-1].name} ➔ ${sortedWpts[i].name}`;
        }
      }

      const lastG = Math.max(0, (route.totalDistance || 0) - (sortedWpts[sortedWpts.length - 1].dist_m || 0));
      if (lastG > maxGap) {
        maxGap = lastG;
        gapDesc = `${sortedWpts[sortedWpts.length - 1].name} ➔ Finish`;
      }
    }

    const gapStr = convertDistanceValue(maxGap);
    statLongestGap.textContent = `${gapStr} ${distUnit} (${gapDesc})`;
  }
}

function renderWarningsUI(route) {
  warningsList.innerHTML = "";
  const approvedWarnings = route.warnings.filter(w => w.approved);
  warningsCount.textContent = approvedWarnings.length;

  if (route.warnings.length === 0) {
    warningsList.innerHTML = `<div class="small-label" style="text-align:center;padding:12px;color:var(--text-muted)">No safety alerts found on this trail.</div>`;
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

    item.addEventListener("click", (e) => {
      // Don't trigger if they click the approve/reject toggle button
      if (e.target.closest(".warn-toggle")) return;

      if (typeof mapController !== "undefined" && mapController && warn.approved) {
        // Clear active class from all warning items
        const allItems = warningsList.querySelectorAll(".warning-item");
        allItems.forEach(i => i.classList.remove("active"));

        // Highlight this item in the sidebar
        item.classList.add("active");

        mapController.highlightWarning(warn);
        if (clearWarningsHighlightBtn) {
          clearWarningsHighlightBtn.classList.remove("hidden");
        }
      }
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
  // Gemini chat model selector display
  const geminiModelSelect = document.getElementById("chat-gemini-model");
  const fetchModelsLink = document.getElementById("chat-fetch-models-link");

  const populateModelDropdown = async (forceFetch = false) => {
    if (!geminiModelSelect) return;

    // Standard fallback models
    const fallbackModels = [
      { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash (Default)" },
      { name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash" },
      { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }
    ];

    let models = fallbackModels;
    const currentKey = apiKeyGemini;

    if (currentKey && (forceFetch || localStorage.getItem("kokopelli_models_fetched") === null)) {
      try {
        if (fetchModelsLink) fetchModelsLink.textContent = "Fetching...";
        const liveModels = await fetchAvailableModels(currentKey);
        if (liveModels && liveModels.length > 0) {
          models = liveModels;
          localStorage.setItem("kokopelli_cached_models", JSON.stringify(liveModels));
          localStorage.setItem("kokopelli_models_fetched", "true");
        }
        if (fetchModelsLink) fetchModelsLink.textContent = "Refresh list";
      } catch (err) {
        console.error("Failed to fetch live Gemini models:", err);
        if (fetchModelsLink) fetchModelsLink.textContent = "Refresh failed";
        const cached = localStorage.getItem("kokopelli_cached_models");
        if (cached) {
          try {
            models = JSON.parse(cached);
          } catch (e) {}
        }
      }
    } else {
      const cached = localStorage.getItem("kokopelli_cached_models");
      if (cached) {
        try {
          models = JSON.parse(cached);
        } catch (e) {}
      }
    }

    // Filter models list to exclude tuning, embedding, tts, test, 001, and nano models
    const filteredModels = models.filter(m => {
      const name = m.name.toLowerCase();
      const isExcluded = name.includes("tuning") || 
                         name.includes("tuned") || 
                         name.includes("embed") || 
                         name.includes("tts") || 
                         name.includes("nanobanana") || 
                         name.includes("whisper") || 
                         name.includes("test") ||
                         name.includes("001") ||
                         name.includes("nano");
      return !isExcluded;
    });

    geminiModelSelect.innerHTML = "";
    filteredModels.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.displayName;
      if (m.name === geminiModel) {
        opt.selected = true;
      }
      geminiModelSelect.appendChild(opt);
    });

    if (!filteredModels.some(m => m.name === geminiModel)) {
      const opt = document.createElement("option");
      opt.value = geminiModel;
      opt.textContent = geminiModel.split("/").pop();
      opt.selected = true;
      geminiModelSelect.appendChild(opt);
    }
  };

  if (geminiModelSelect) {
    geminiModelSelect.addEventListener("change", () => {
      geminiModel = geminiModelSelect.value;
      localStorage.setItem("gemini_model", geminiModel);
      showToast(`Model switched to ${geminiModel.split("/").pop()}`);
    });
  }

  if (fetchModelsLink) {
    fetchModelsLink.addEventListener("click", (e) => {
      e.preventDefault();
      populateModelDropdown(true);
    });
  }

  // Populate dropdown once on startup
  populateModelDropdown();

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

  // Open / Import trigger toggles the importer card panel
  if (importTriggerBtn && cardImporter) {
    importTriggerBtn.addEventListener("click", () => {
      cardImporter.classList.toggle("hidden");
    });
  }

  // Close importer button hides the panel
  if (closeImporterBtn && cardImporter) {
    closeImporterBtn.addEventListener("click", () => {
      cardImporter.classList.add("hidden");
    });
  }

  // Gemini Chat panel toggling
  const toggleChatBtn = document.getElementById("toggle-chat-btn");
  const closeChatBtn = document.getElementById("close-chat-btn");
  const clearChatContextBtn = document.getElementById("clear-chat-context-btn");

  if (toggleChatBtn && cardGeminiChat) {
    toggleChatBtn.addEventListener("click", () => {
      if (unifiedDrawerCard) {
        unifiedDrawerCard.classList.remove("hidden");
      }
      cardGeminiChat.classList.remove("hidden");
      if (tabChatMode) tabChatMode.click();
      toggleChatBtn.classList.add("hidden");
    });
  }

  const closeUnifiedDrawerBtn = document.getElementById("close-unified-drawer-btn");
  if (closeUnifiedDrawerBtn && unifiedDrawerCard) {
    closeUnifiedDrawerBtn.addEventListener("click", () => {
      unifiedDrawerCard.classList.add("hidden");
      if (toggleChatBtn && activeRoute) {
        toggleChatBtn.classList.remove("hidden");
      }
    });
  }

  if (tabPoiMode && tabChatMode) {
    tabPoiMode.addEventListener("click", () => {
      tabPoiMode.classList.add("active");
      tabChatMode.classList.remove("active");
      if (poiDetailDialog) {
        poiDetailDialog.classList.remove("hidden");
        poiDetailDialog.scrollIntoView({ behavior: "smooth" });
      }
    });

    tabChatMode.addEventListener("click", () => {
      tabChatMode.classList.add("active");
      tabPoiMode.classList.remove("active");
      if (cardGeminiChat) {
        cardGeminiChat.classList.remove("hidden");
        cardGeminiChat.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  if (clearChatContextBtn) {
    clearChatContextBtn.addEventListener("click", () => {
      chatHistory = [];
      const routeName = activeRoute ? activeRoute.name : "route";
      chatMessages.innerHTML = `
        <div class="message assistant">
          <p>Cleared conversation history. Ask me to configure aid stations or paste new details for "<strong>${routeName}</strong>".</p>
        </div>
      `;
      showToast("Conversation context cleared.");
    });
  }

  // Course Info Overlay
  if (courseInfoBtn && courseInfoOverlay) {
    courseInfoBtn.addEventListener("click", () => courseInfoOverlay.classList.remove("hidden"));
  }
  if (closeInfoBtn && courseInfoOverlay) {
    closeInfoBtn.addEventListener("click", () => courseInfoOverlay.classList.add("hidden"));
  }

  // Warnings Toggle
  if (toggleWarningsBtn) {
    toggleWarningsBtn.addEventListener("click", () => {
      cardWarnings.classList.remove("hidden");
      toggleWarningsBtn.classList.add("hidden");
      updateWeatherShiftedState();
    });
  }
  if (closeWarningsBtn) {
    closeWarningsBtn.addEventListener("click", () => {
      cardWarnings.classList.add("hidden");
      toggleWarningsBtn.classList.remove("hidden");
      updateWeatherShiftedState();
    });
  }

  // Weather Toggle
  if (toggleWeatherBtn) {
    toggleWeatherBtn.addEventListener("click", () => {
      cardWeather.classList.remove("hidden");
      toggleWeatherBtn.classList.add("hidden");
      updateWeatherShiftedState();
      
      // Force initial weather update on open
      if (activeRoute && activeRoute.trackpoints.length > 0) {
        const pt = activeRoute.trackpoints[playbackIndex || 0];
        if (pt) {
          triggerWeatherWeather(pt.lat, pt.lon, true);
        }
      }
    });
  }
  if (closeWeatherBtn) {
    closeWeatherBtn.addEventListener("click", () => {
      cardWeather.classList.add("hidden");
      toggleWeatherBtn.classList.remove("hidden");
      updateWeatherShiftedState();
    });
  }

  if (weatherPlanStartInput) {
    const savedStart = localStorage.getItem("pref_weather_start");
    if (savedStart) {
      weatherPlanStartInput.value = savedStart;
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      const tzoffset = tomorrow.getTimezoneOffset() * 60000;
      weatherPlanStartInput.value = (new Date(tomorrow - tzoffset)).toISOString().slice(0, 16);
    }
    weatherPlanStartInput.addEventListener("change", () => {
      if (weatherPlanStartInput.value) {
        localStorage.setItem("pref_weather_start", weatherPlanStartInput.value);
        if (lastWeatherLat !== null && lastWeatherLon !== null) {
          triggerWeatherWeather(lastWeatherLat, lastWeatherLon, true);
        }
      }
    });
  }

  if (weatherPlanDurationInput) {
    const savedDur = localStorage.getItem("pref_weather_duration");
    if (savedDur) {
      weatherPlanDurationInput.value = savedDur;
    }
    weatherPlanDurationInput.addEventListener("change", () => {
      if (weatherPlanDurationInput.value) {
        localStorage.setItem("pref_weather_duration", weatherPlanDurationInput.value);
        if (lastWeatherLat !== null && lastWeatherLon !== null) {
          triggerWeatherWeather(lastWeatherLat, lastWeatherLon, true);
        }
      }
    });
  }

  // Course Stats Toggle
  if (toggleStatsBtn) {
    toggleStatsBtn.addEventListener("click", () => {
      cardStats.classList.remove("hidden");
      toggleStatsBtn.classList.add("hidden");
    });
  }
  if (closeStatsBtn) {
    closeStatsBtn.addEventListener("click", () => {
      cardStats.classList.add("hidden");
      toggleStatsBtn.classList.remove("hidden");
    });
  }

  if (regenerateWarningsBtn) {
    regenerateWarningsBtn.addEventListener("click", () => {
      if (!activeRoute) return;
      const spatialWarnings = activeRoute.warnings ? activeRoute.warnings.filter(w => w.type === "SPATIAL_MISMATCH") : [];
      calculateWarnings(activeRoute, spatialWarnings, units);
      renderWarningsUI(activeRoute);
      elevationChart.draw();
      showToast("Alerts regenerated.");
    });
  }

  if (clearWarningsHighlightBtn) {
    clearWarningsHighlightBtn.addEventListener("click", () => {
      if (typeof mapController !== "undefined" && mapController) {
        mapController.clearWarningHighlight();
      }
      if (warningsList) {
        const allItems = warningsList.querySelectorAll(".warning-item");
        allItems.forEach(i => i.classList.remove("active"));
      }
      clearWarningsHighlightBtn.classList.add("hidden");
      showToast("Warning highlight cleared.");
    });
  }

  // Save Settings Modal parameters
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      const oldMapsKey = apiKeyMaps;
      apiKeyMaps = mapsApiKeyInput.value.trim();
      apiKeyGemini = geminiApiKeyInput.value.trim();
      units = settingsUnits.value;
      pauseDuration = parseInt(settingsPauseTime.value) || 0;

      const turnDampingValue = settingsTurnDamping.value;
      localStorage.setItem("pref_turn_damping", turnDampingValue);
      if (mapController) {
        mapController.turnRateFactor = (101 - parseInt(turnDampingValue)) / 1000;
      }

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
        
        const spatialWarnings = activeRoute.warnings ? activeRoute.warnings.filter(w => w.type === "SPATIAL_MISMATCH") : [];
        calculateWarnings(activeRoute, spatialWarnings, units);
        renderWarningsUI(activeRoute);
      }

      updateUnitLabels();
      settingsOverlay.classList.add("hidden");
      showToast("Configurations saved.");

      if (apiKeyMaps && apiKeyMaps !== oldMapsKey) {
        initMap3D();
      }
    });
  }

  // Drag & Drop Course Importers
  if (dropZone && fileSelector) {
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
  }

  // Edit protection Lock toggle
  if (editLockCheckbox) {
    editLockCheckbox.addEventListener("change", (e) => {
      toggleEditLock(e.target.checked);
      showToast(e.target.checked ? "Edits locked." : "Edits unlocked.");
    });
  }

  // Waypoint Dragging snapping toggle listener
  if (dragSnapCheckbox) {
    dragSnapCheckbox.addEventListener("change", (e) => {
      localStorage.setItem("pref_drag_snap", e.target.checked);
      showToast(e.target.checked ? "Waypoint snapping enabled." : "Waypoint free drag enabled.");
    });
  }



  // Gemini Chat augmentation submissions
  const handleChatSubmit = async () => {
    if (document.body.classList.contains("edit-locked")) return;

    const prompt = chatInput.value.trim();
    if (!prompt && attachedFiles.length === 0) return;

    if (!apiKeyGemini) {
      showToast("Please configure Gemini API Key in the settings first.");
      openSettings();
      return;
    }

    if (!activeRoute) {
      showToast("Please import a GPX file first.");
      return;
    }

    // Compile the user prompt/payload
    let userPrompt;
    let chatHistoryPromptText = prompt;
    let partsForHistory = [];

    if (attachedFiles.length > 0) {
      const parts = [];
      let textContent = "";

      if (prompt) {
        textContent += `${prompt}\n\n`;
      }

      attachedFiles.forEach(file => {
        if (!file.isImage) {
          textContent += `--- Attached File: ${file.name} ---\n${file.content}\n---------------------\n\n`;
        }
      });

      if (textContent) {
        parts.push({ text: textContent });
        partsForHistory.push({ text: textContent });
      }

      attachedFiles.forEach(file => {
        if (file.isImage) {
          const imgPart = {
            inlineData: {
              mimeType: file.type,
              data: file.content
            }
          };
          parts.push(imgPart);
          partsForHistory.push(imgPart);
        }
      });

      userPrompt = parts;
      
      const attachmentNames = attachedFiles.map(f => f.name).join(", ");
      chatHistoryPromptText = prompt 
        ? `${prompt}\n[Attached: ${attachmentNames}]` 
        : `[Attached: ${attachmentNames}]`;
    } else {
      userPrompt = prompt;
      partsForHistory.push({ text: prompt });
    }

    appendChatMessage(chatHistoryPromptText, "user");
    chatInput.value = "";

    chatStatusText.textContent = "Analyzing course & reconciling miles...";
    chatStatus.classList.remove("hidden");
    chatSubmit.disabled = true;

    // Instantiate new AbortController
    currentAbortController = new AbortController();

    // Set up manual timeout for 2 minutes (120,000 ms)
    const timeoutId = setTimeout(() => {
      if (currentAbortController) {
        console.warn("Gemini request timed out after 2 minutes.");
        currentAbortController.abort();
        showToast("Request timed out after 2 minutes.");
      }
    }, 120000);

    try {
      const response = await sendToGemini(userPrompt, activeRoute, apiKeyGemini, chatHistory, geminiModel, currentAbortController.signal);

      chatHistory.push({ role: "user", parts: partsForHistory });
      chatHistory.push(response.assistantMessage);

      // Clear attachments
      attachedFiles = [];
      const chatAttachedContainer = document.getElementById("chat-attached-files-container");
      if (chatAttachedContainer) {
        chatAttachedContainer.innerHTML = "";
      }

      if (response.stations && response.stations.length > 0) {
        reconcileCourse(activeRoute, response, units);

        mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
        elevationChart.setRoute(activeRoute);
        updateRouteStatsUI(activeRoute);
        renderWarningsUI(activeRoute);

        appendChatMessage(`Added and snapped ${response.stations.length} milestones onto the route successfully!`, "assistant");
        showToast("Route augmented successfully.");
        saveActiveRouteState();
      } else {
        appendChatMessage("Analyzed request, but did not extract any specific course waypoints to inject. Try giving explicit distances (e.g., 'add an aid station at mile 10').", "assistant");
      }
    } catch (err) {
      console.error(err);
      if (err.name === "AbortError") {
        appendChatMessage("Request was cancelled or timed out after 2 minutes.", "assistant");
      } else {
        appendChatMessage(`Reconciliation Error: ${err.message}`, "assistant");
        showToast("Failed to process request.");
      }
    } finally {
      clearTimeout(timeoutId);
      currentAbortController = null;
      chatStatus.classList.add("hidden");
      chatSubmit.disabled = document.body.classList.contains("edit-locked");
    }
  };

  if (chatSubmit) {
    chatSubmit.addEventListener("click", handleChatSubmit);
  }
  
  const chatCancelBtn = document.getElementById("chat-cancel-btn");
  if (chatCancelBtn) {
    chatCancelBtn.addEventListener("click", () => {
      if (currentAbortController) {
        currentAbortController.abort();
      }
    });
  }
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleChatSubmit();
      }
    });
  }

  // Elevation correction triggers
  if (correctElevationBtn) {
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
        saveActiveRouteState();
      } catch (err) {
        showToast("Elevation fetch failed: " + err.message);
      } finally {
        correctElevationBtn.disabled = document.body.classList.contains("edit-locked");
        elevationProgress.classList.add("hidden");
      }
    });
  }

  // Export GPX Trigger
  if (exportGpxBtn) {
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
  }

  // Playback Control Button Toggle
  if (btnPlayback) {
    btnPlayback.addEventListener("click", () => {
      if (!activeRoute) return;
      if (isPlaying) {
        pausePlayback();
      } else {
        closePoiDetailDialog(false);
        startPlayback();
      }
    });
  }

  // Rewind Control Trigger
  if (btnPlaybackRewind) {
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
  }

  // Speed Slider Listener
  if (playbackSpeed) {
    playbackSpeed.addEventListener("input", (e) => {
      const val = e.target.value;
      speedLabelVal.textContent = val;
      localStorage.setItem("pref_playback_speed", val);

      if (isPlaying) {
        pausePlayback();
        startPlayback();
      }
    });
  }

  // Camera Range Slider Listener
  if (cameraRangeSlider) {
    cameraRangeSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      updateCameraRangeLabel(val);
      localStorage.setItem("pref_cam_range", val);

      if (mapController) {
        mapController.cameraRange = val;
        if (!isPlaying && activeRoute) {
          mapController.syncToTrackpoint(playbackIndex, false);
        }
      }
    });
  }

  // Camera Tilt Slider Listener
  if (cameraTiltSlider) {
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
  }

  // Camera Rotation Turn Damping Slider Listener
  if (settingsTurnDamping) {
    settingsTurnDamping.addEventListener("input", (e) => {
      const val = e.target.value;
      if (turnDampingVal) turnDampingVal.textContent = `${val}%`;
    });
  }

  // Color Coding Climbs polyline toggle
  if (climbColorsCheckbox) {
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
  }

  // POI dialog expanded/collapsed switch
  if (poiDialogToggleExpand && poiDetailDialog) {
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
  }

  // POI dialog playback Pause/Continue buttons
  if (poiDialogPlaybackPause) {
    poiDialogPlaybackPause.addEventListener("click", () => {
      pausePlayback();
      if (autoResumeTimeout) {
        clearTimeout(autoResumeTimeout);
        autoResumeTimeout = null;
      }
      showToast("Playback paused.");
    });
  }

  if (poiDialogPlaybackContinue) {
    poiDialogPlaybackContinue.addEventListener("click", () => {
      closePoiDetailDialog(true);
    });
  }

  // Close buttons listeners
  if (poiDialogCloseHeader) {
    poiDialogCloseHeader.addEventListener("click", () => {
      closePoiDetailDialog(false);
    });
  }

  if (poiDialogCloseBottom) {
    poiDialogCloseBottom.addEventListener("click", () => {
      closePoiDetailDialog(false);
    });
  }

  // Edit Waypoint Button Handler
  if (poiDialogEditBtn) {
    poiDialogEditBtn.addEventListener("click", () => {
      if (!isEditingPoiLocation) {
        // Enter Edit Mode
        isEditingPoiLocation = true;
        poiDialogEditBtn.textContent = "💾 Save Waypoint";
        poiDialogEditBtn.style.backgroundColor = "#10b981"; // Emerald Green
        if (poiEditModeSelector) {
          poiEditModeSelector.classList.remove("hidden");
        }

        // Toggle name input visibility
        if (poiValNameInput && poiValName) {
          poiValNameInput.value = activeDialogWpt ? activeDialogWpt.name : "";
          poiValNameInput.classList.remove("hidden");
          poiValName.classList.add("hidden");
          poiValNameInput.focus();
        }

        // Render interactive amenities badges
        if (activeDialogWpt) {
          renderEditAmenities(activeDialogWpt);
        }
        
        // Sync active state from current preference
        const isSnap = dragSnapCheckbox ? dragSnapCheckbox.checked : true;
        if (isSnap) {
          poiEditModeSnap.classList.add("active");
          poiEditModeFree.classList.remove("active");
        } else {
          poiEditModeFree.classList.add("active");
          poiEditModeSnap.classList.remove("active");
        }

        if (mapController) {
          mapController.setEditLock(false); // unlock draggable markers
        }
        poiDetailDialog.classList.add("hidden");
        const rBanner = document.getElementById("relocate-banner");
        if (rBanner) {
          rBanner.classList.remove("hidden");
          const bName = document.getElementById("relocate-banner-name");
          if (bName) bName.textContent = activeDialogWpt ? activeDialogWpt.name : "";
        }
        showToast("Click anywhere on the map to place.");
      } else {
        // Exit/Save Edit Mode
        isEditingPoiLocation = false;
        poiDialogEditBtn.textContent = "✏️ Edit Waypoint";
        poiDialogEditBtn.style.backgroundColor = "var(--primary-color)";
        if (poiEditModeSelector) {
          poiEditModeSelector.classList.add("hidden");
        }
        const rBanner = document.getElementById("relocate-banner");
        if (rBanner) rBanner.classList.add("hidden");
        poiDetailDialog.classList.remove("hidden");

        // Save name input
        if (poiValNameInput && poiValName && activeDialogWpt) {
          const newName = poiValNameInput.value.trim();
          if (newName) {
            activeDialogWpt.name = newName;
            poiValName.textContent = newName;
          }
          poiValNameInput.classList.add("hidden");
          poiValName.classList.remove("hidden");
        }

        if (mapController) {
          mapController.setEditLock(true); // lock markers
          mapController.drawRoute(activeRoute, climbColorsCheckbox.checked); // Redraw icons & text labels
        }

        renderEditWaypointList();

        // Refresh POI static details panel view
        if (activeDialogWpt) {
          showPoiDetailDialog(activeDialogWpt, playbackIndex);
        }

        showToast("Waypoint details saved successfully.");
        saveActiveRouteState();
      }
    });
  }

  const relocateDoneBtn = document.getElementById("relocate-done-btn");
  if (relocateDoneBtn) {
    relocateDoneBtn.addEventListener("click", () => {
      if (poiDialogEditBtn && isEditingPoiLocation) {
        poiDialogEditBtn.click();
      }
    });
  }

  // Snap to Course Pill Toggle
  if (poiEditModeSnap) {
    poiEditModeSnap.addEventListener("click", () => {
      poiEditModeSnap.classList.add("active");
      poiEditModeFree.classList.remove("active");
      if (dragSnapCheckbox) {
        dragSnapCheckbox.checked = true;
      }
      localStorage.setItem("pref_drag_snap", "true");
    });
  }

  // Free Drag Pill Toggle
  if (poiEditModeFree) {
    poiEditModeFree.addEventListener("click", () => {
      poiEditModeFree.classList.add("active");
      poiEditModeSnap.classList.remove("active");
      if (dragSnapCheckbox) {
        dragSnapCheckbox.checked = false;
      }
      localStorage.setItem("pref_drag_snap", "false");
    });
  }

  // Listen to waypoint markers clicks from 3D Satellite Map
  window.addEventListener("waypoint-click", (e) => {
    console.log("[main] WINDOW RECEIVED WAYPOINT-CLICK EVENT:", e.detail?.name, "isEditingPoiLocation:", isEditingPoiLocation);
    if (isEditingPoiLocation) return;
    const wpt = e.detail;
    pausePlayback();
    playbackIndex = wpt.closestTrackpointIndex !== undefined ? wpt.closestTrackpointIndex : 0;
    lastPausedPoiIndex = playbackIndex; // Prevent immediate repeat of trigger

    console.log("[main] DISPATCHING TO SYNC & HUD. playbackIndex:", playbackIndex);
    if (mapController) {
      mapController.syncToTrackpoint(playbackIndex, true);
    }
    
    elevationChart.progressIndex = playbackIndex;
    elevationChart.hoverIdx = -1;
    elevationChart.draw();
    
    updateHUD(playbackIndex);
    console.log("[main] CALLING showPoiDetailDialog FOR WAYPOINT:", wpt?.name);
    showPoiDetailDialog(wpt, playbackIndex, playbackDistance);
  });

  // ==========================================
  // ADD NEW WAYPOINT (POI) PLACEMENT LOGIC
  // ==========================================

  const cancelPoiPlacement = () => {
    isPlacingNewPoi = false;
    tempPoiData = null;
    if (addPoiPanel) {
      addPoiPanel.classList.add("hidden");
    }
    if (mapController) {
      mapController.removeTemporaryMarker();
      mapController.setEditLock(true);
    }
  };

  if (addPoiStartBtn) {
    addPoiStartBtn.addEventListener("click", () => {
      if (!activeRoute) {
        showToast("Please import a GPX file first.");
        return;
      }
      closePoiDetailDialog(false);
      isPlacingNewPoi = true;
      tempPoiData = null;
      
      if (addPoiPanel) {
        addPoiPanel.classList.remove("hidden");
      }
      if (addPoiLatLng) {
        addPoiLatLng.textContent = "Click on the map to place the marker.";
      }
      if (addPoiDist) {
        addPoiDist.textContent = "-- mi";
      }
      if (addPoiDesc) {
        addPoiDesc.value = "";
      }
      if (addPoiSubmitBtn) {
        addPoiSubmitBtn.disabled = true;
        addPoiSubmitBtn.textContent = "Generate Waypoint";
      }

      if (mapController) {
        mapController.removeTemporaryMarker();
        mapController.setEditLock(false); // unlock edit lock during placement/drags
      }

      showToast("Placement mode enabled. Click anywhere on the map/route to set initial position.");
    });
  }

  // Handle map clicks to place the temporary marker or relocate active POI
  if (mapController) {
    mapController.onMapClick = (pos) => {
      if (isEditingPoiLocation && activeDialogWpt) {
        const isSnap = dragSnapCheckbox ? dragSnapCheckbox.checked : true;
        let targetPos = {
          lat: pos.lat,
          lon: pos.lng || pos.lon,
          ele: pos.altitude || 0,
          dist_m: activeDialogWpt.dist_m,
          closestTrackpointIndex: activeDialogWpt.closestTrackpointIndex
        };

        if (isSnap) {
          const snapped = snapToRouteSegments(activeRoute, { lat: pos.lat, lng: pos.lng || pos.lon });
          if (snapped) {
            targetPos = snapped;
          }
        }

        activeDialogWpt.lat = targetPos.lat;
        activeDialogWpt.lon = targetPos.lon;
        if (targetPos.ele) activeDialogWpt.ele = targetPos.ele;
        if (targetPos.dist_m !== undefined) activeDialogWpt.dist_m = targetPos.dist_m;
        if (targetPos.closestTrackpointIndex !== undefined) {
          activeDialogWpt.closestTrackpointIndex = targetPos.closestTrackpointIndex;
          playbackIndex = targetPos.closestTrackpointIndex;
        }

        activeRoute.waypoints.sort((a, b) => a.dist_m - b.dist_m);

        mapController.updateWaypointMarkerPosition(activeDialogWpt, targetPos, playbackIndex);

        elevationChart.progressIndex = playbackIndex;
        elevationChart.draw();
        updateHUD(playbackIndex);

        const distStr = units === "miles"
          ? `${(activeDialogWpt.dist_m / 1609.34).toFixed(2)} mi`
          : `${(activeDialogWpt.dist_m / 1000).toFixed(2)} km`;

        showToast(`Relocated "${activeDialogWpt.name}" to ${distStr}`);
        return;
      }

      if (!isPlacingNewPoi) return;

      const snapped = snapToRouteSegments(activeRoute, { lat: pos.lat, lng: pos.lng });
      if (!snapped) {
        showToast("Could not snap coordinates. Please click closer to the route line.");
        return;
      }

      tempPoiData = {
        lat: snapped.lat,
        lon: snapped.lon,
        ele: snapped.ele,
        dist_m: snapped.dist_m,
        closestTrackpointIndex: snapped.closestTrackpointIndex
      };

      // Show temporary marker on map
      mapController.showTemporaryMarker(tempPoiData);

      // Enable submit button
      if (addPoiSubmitBtn) {
        addPoiSubmitBtn.disabled = false;
      }

      // Update HUD/panel details
      const distText = units === "miles" 
        ? `${(tempPoiData.dist_m / 1609.34).toFixed(2)} mi` 
        : `${(tempPoiData.dist_m / 1000).toFixed(2)} km`;
      
      if (addPoiLatLng) {
        addPoiLatLng.textContent = `${tempPoiData.lat.toFixed(5)}, ${tempPoiData.lon.toFixed(5)}`;
      }
      if (addPoiDist) {
        addPoiDist.textContent = distText;
      }
    };

    // Handle temporary marker dragging
    mapController.onTempMarkerDragEnd = (newPos) => {
      if (!isPlacingNewPoi) return;

      const snapped = snapToRouteSegments(activeRoute, newPos);
      if (snapped) {
        tempPoiData = {
          lat: snapped.lat,
          lon: snapped.lon,
          ele: snapped.ele,
          dist_m: snapped.dist_m,
          closestTrackpointIndex: snapped.closestTrackpointIndex
        };

        // Snap the marker's visual position to the route line
        if (mapController.tempMarker) {
          mapController.tempMarker.position = { lat: snapped.lat, lng: snapped.lon };
        }

        const distText = units === "miles" 
          ? `${(tempPoiData.dist_m / 1609.34).toFixed(2)} mi` 
          : `${(tempPoiData.dist_m / 1000).toFixed(2)} km`;
        
        if (addPoiLatLng) {
          addPoiLatLng.textContent = `${tempPoiData.lat.toFixed(5)}, ${tempPoiData.lon.toFixed(5)}`;
        }
        if (addPoiDist) {
          addPoiDist.textContent = distText;
        }
      }
    };
  }

  // Cancel buttons listeners
  if (addPoiCloseBtn) {
    addPoiCloseBtn.addEventListener("click", cancelPoiPlacement);
  }
  if (addPoiCancelBtn) {
    addPoiCancelBtn.addEventListener("click", cancelPoiPlacement);
  }

  // Generate & Save Submit Handler
  if (addPoiSubmitBtn) {
    addPoiSubmitBtn.addEventListener("click", async () => {
      if (!isPlacingNewPoi || !tempPoiData || !activeRoute) return;

      const descText = addPoiDesc ? addPoiDesc.value.trim() : "";
      if (!descText) {
        showToast("Please provide a description first.");
        return;
      }

      if (!apiKeyGemini) {
        showToast("Please configure Gemini API Key in settings first.");
        openSettings();
        return;
      }

      addPoiSubmitBtn.disabled = true;
      addPoiSubmitBtn.textContent = "Generating...";
      showToast("Generating waypoint with Gemini...");

      try {
        const result = await generateWaypointFromDescription(descText, tempPoiData, apiKeyGemini, geminiModel);
        
        // Build new waypoint object
        const newWpt = {
          lat: tempPoiData.lat,
          lon: tempPoiData.lon,
          ele: tempPoiData.ele,
          name: result.name || "New Waypoint",
          desc: result.notes || descText,
          sym: result.type === "aid_station" ? "Scenic Area" : "Circle",
          dist_m: tempPoiData.dist_m,
          closestTrackpointIndex: tempPoiData.closestTrackpointIndex,
          extensions: {
            station: {
              type: result.type || "informational",
              subtype: result.subtype || null,
              passes: []
            }
          }
        };

        if (result.cutoffTime) {
          newWpt.extensions.station.passes.push({
            num: 1,
            dist_m: tempPoiData.dist_m,
            cutoff_clock: result.cutoffTime,
            label: ""
          });
        }

        // Insert waypoint
        activeRoute.waypoints.push(newWpt);

        // Insert detour / extension points in trackpoints
        const insertIdx = tempPoiData.closestTrackpointIndex;
        const pts = activeRoute.trackpoints;
        const newTrackPt = {
          lat: tempPoiData.lat,
          lon: tempPoiData.lon,
          ele: tempPoiData.ele,
          dist_m: tempPoiData.dist_m,
          time: pts[insertIdx]?.time || null
        };

        if (insertIdx === 0 && tempPoiData.dist_m === 0) {
          activeRoute.trackpoints.unshift(newTrackPt);
        } else if (insertIdx === pts.length - 2 && Math.abs(tempPoiData.dist_m - pts[pts.length - 1].dist_m) < 0.1) {
          activeRoute.trackpoints.push(newTrackPt);
        } else {
          activeRoute.trackpoints.splice(insertIdx + 1, 0, newTrackPt);
        }

        // Recalculate route metrics
        recalculateRouteMetrics(activeRoute);
 
        // Redraw and update UIs
        mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
        elevationChart.setRoute(activeRoute);
        updateRouteStatsUI(activeRoute);
        renderWarningsUI(activeRoute);
        renderEditWaypointList();
 
        showToast(`Added waypoint: ${newWpt.name}`);
        saveActiveRouteState();

        // Exit mode and cleanup
        cancelPoiPlacement();
      } catch (err) {
        console.error("Failed to generate waypoint:", err);
        showToast("Generation failed: " + err.message);
        addPoiSubmitBtn.disabled = false;
        addPoiSubmitBtn.textContent = "Generate Waypoint";
      }
    });
  }



  // Initialize keyboard shortcuts & chat file attachments support
  setupKeyboardShortcuts();
  setupChatFileAttachments();
  setupResetBoulderButton();
}

/**
 * Configure course reset button logic.
 */
function setupResetBoulderButton() {
  const resetBtn = document.getElementById("reset-boulder-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      // Clear route state variables
      activeRoute = null;
      chatHistory = [];
      playbackIndex = 0;
      lastPausedPoiIndex = -1;

      // Close open dialogs
      closePoiDetailDialog(false);

      // Reset HUD/stats
      const nameDisplay = document.getElementById("course-name-display");
      if (nameDisplay) {
        nameDisplay.textContent = "NO ROUTE LOADED";
      }

      // Hide panels
      cardStats.classList.add("hidden");
      if (toggleStatsBtn) toggleStatsBtn.classList.add("hidden");
      cardWarnings.classList.add("hidden");
      const toggleWarningsBtn = document.getElementById("toggle-warnings-btn");
      if (toggleWarningsBtn) toggleWarningsBtn.classList.add("hidden");
      if (clearWarningsHighlightBtn) {
        clearWarningsHighlightBtn.classList.add("hidden");
      }
      cardWeather.classList.add("hidden");
      if (toggleWeatherBtn) toggleWeatherBtn.classList.add("hidden");
      lastWeatherLat = null;
      lastWeatherLon = null;
      cardElevationScrubber.classList.add("hidden");
      hudMetrics.classList.add("hidden");
      
      if (cardGeminiChat) {
        cardGeminiChat.classList.add("hidden");
      }
      const toggleChatBtn = document.getElementById("toggle-chat-btn");
      if (toggleChatBtn) {
        toggleChatBtn.classList.add("hidden");
      }

      // Reset Map Controller
      if (mapController) {
        mapController.resetToBoulder();
      }

      // Re-enable welcome importer card
      if (cardImporter) {
        cardImporter.classList.remove("hidden");
      }

      fetch("./samples/enhanced_52m_start.gpx")
        .then(res => res.text())
        .then(text => {
          processGpxContent(text, "enhanced_52m_start.gpx");
        })
        .catch(err => console.log("Sample load err:", err));

      showToast("Reset to Boulder.");
    });
  }
}

/**
 * Configure global and local hotkeys for rapid route inspection and control.
 */
function setupKeyboardShortcuts() {
  const shortcutsOverlay = document.getElementById("shortcuts-overlay");
  const closeShortcutsBtn = document.getElementById("close-shortcuts-btn");
  const keyboardShortcutsBtn = document.getElementById("keyboard-shortcuts-btn");

  if (keyboardShortcutsBtn && shortcutsOverlay) {
    keyboardShortcutsBtn.addEventListener("click", () => {
      shortcutsOverlay.classList.remove("hidden");
    });
  }

  if (closeShortcutsBtn && shortcutsOverlay) {
    closeShortcutsBtn.addEventListener("click", () => {
      shortcutsOverlay.classList.add("hidden");
    });
  }

  window.addEventListener("keydown", (e) => {
    // Check if focused on input/textarea/editable element
    const activeEl = document.activeElement;
    if (activeEl && (
      activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.isContentEditable
    )) {
      return;
    }

    switch (e.key) {
      case " ": // Space
        e.preventDefault();
        if (isPlaying) {
          pausePlayback();
          showToast("Playback paused.");
        } else {
          startPlayback();
          showToast("Playback started.");
        }
        break;

      case "[": // Speed down
        if (playbackSpeed) {
          let currentVal = parseInt(playbackSpeed.value);
          if (currentVal > 1) {
            currentVal--;
            playbackSpeed.value = currentVal;
            playbackSpeed.dispatchEvent(new Event("change"));
            showToast(`Playback speed: ${currentVal}x`);
          }
        }
        break;

      case "]": // Speed up
        if (playbackSpeed) {
          let currentVal = parseInt(playbackSpeed.value);
          if (currentVal < 10) {
            currentVal++;
            playbackSpeed.value = currentVal;
            playbackSpeed.dispatchEvent(new Event("change"));
            showToast(`Playback speed: ${currentVal}x`);
          }
        }
        break;

      case "-":
      case "_":
      case "r": // Zoom out / Increase Range
        if (cameraRangeSlider) {
          let currentVal = parseInt(cameraRangeSlider.value);
          if (currentVal < parseInt(cameraRangeSlider.max)) {
            currentVal = Math.min(parseInt(cameraRangeSlider.max), currentVal + 100);
            cameraRangeSlider.value = currentVal;
            cameraRangeSlider.dispatchEvent(new Event("input"));
            showToast(`Camera Range: ${currentVal}m`);
          }
        }
        break;

      case "=":
      case "+":
      case "R": // Zoom in / Decrease Range
        if (cameraRangeSlider) {
          let currentVal = parseInt(cameraRangeSlider.value);
          if (currentVal > parseInt(cameraRangeSlider.min)) {
            currentVal = Math.max(parseInt(cameraRangeSlider.min), currentVal - 100);
            cameraRangeSlider.value = currentVal;
            cameraRangeSlider.dispatchEvent(new Event("input"));
            showToast(`Camera Range: ${currentVal}m`);
          }
        }
        break;

      case "ArrowUp":
      case "PageUp":
      case "t": // Increase Tilt
        if (cameraTiltSlider) {
          let currentVal = parseInt(cameraTiltSlider.value);
          if (currentVal < parseInt(cameraTiltSlider.max)) {
            currentVal = Math.min(parseInt(cameraTiltSlider.max), currentVal + 5);
            cameraTiltSlider.value = currentVal;
            cameraTiltSlider.dispatchEvent(new Event("input"));
            showToast(`Camera Tilt: ${currentVal}°`);
          }
        }
        break;

      case "ArrowDown":
      case "PageDown":
      case "T": // Decrease Tilt
        if (cameraTiltSlider) {
          let currentVal = parseInt(cameraTiltSlider.value);
          if (currentVal > parseInt(cameraTiltSlider.min)) {
            currentVal = Math.max(parseInt(cameraTiltSlider.min), currentVal - 5);
            cameraTiltSlider.value = currentVal;
            cameraTiltSlider.dispatchEvent(new Event("input"));
            showToast(`Camera Tilt: ${currentVal}°`);
          }
        }
        break;

      case "c":
      case "C":
        // Toggle Gemini chat sidebar
        const toggleChatBtn = document.getElementById("toggle-chat-btn");
        if (toggleChatBtn) {
          toggleChatBtn.click();
        }
        break;

      case "l":
      case "L":
        // Toggle Lock checkbox
        if (editLockCheckbox) {
          editLockCheckbox.checked = !editLockCheckbox.checked;
          editLockCheckbox.dispatchEvent(new Event("change"));
        }
        break;

      case "Home":
        e.preventDefault();
        if (activeRoute) {
          playbackDistance = 0;
          playbackIndex = 0;
          updatePlaybackFrame();
          if (mapController) {
            mapController.syncToTrackpoint(0, false);
          }
          showToast("Jumped to Start");
        }
        break;

      case "End":
        e.preventDefault();
        if (activeRoute) {
          playbackDistance = activeRoute.totalDistance;
          playbackIndex = activeRoute.trackpoints.length - 1;
          updatePlaybackFrame();
          if (mapController) {
            mapController.syncToTrackpoint(activeRoute.trackpoints.length - 1, false);
          }
          showToast("Jumped to Finish");
        }
        break;

      case "a":
      case "A":
        if (toggleWarningsBtn && !toggleWarningsBtn.classList.contains("hidden")) {
          toggleWarningsBtn.click();
        } else if (cardWarnings && !cardWarnings.classList.contains("hidden")) {
          closeWarningsBtn.click();
        }
        break;

      case "e":
      case "E":
        if (importTriggerBtn) {
          importTriggerBtn.click();
        }
        break;

      case "w":
      case "W":
        if (toggleWeatherBtn && !toggleWeatherBtn.classList.contains("hidden")) {
          toggleWeatherBtn.click();
        } else if (cardWeather && !cardWeather.classList.contains("hidden")) {
          closeWeatherBtn.click();
        }
        break;

      case "Escape":
        // Close overlays and dialogs
        if (shortcutsOverlay && !shortcutsOverlay.classList.contains("hidden")) {
          shortcutsOverlay.classList.add("hidden");
        }
        if (settingsOverlay && !settingsOverlay.classList.contains("hidden")) {
          settingsOverlay.classList.add("hidden");
        }
        if (poiDetailDialog && !poiDetailDialog.classList.contains("hidden")) {
          poiDetailDialog.classList.add("hidden");
        }
        if (courseInfoOverlay && !courseInfoOverlay.classList.contains("hidden")) {
          courseInfoOverlay.classList.add("hidden");
        }
        if (cardWeather && !cardWeather.classList.contains("hidden")) {
          closeWeatherBtn.click();
        }
        if (cardWarnings && !cardWarnings.classList.contains("hidden")) {
          closeWarningsBtn.click();
        }
        if (cardImporter && !cardImporter.classList.contains("hidden")) {
          closeImporterBtn.click();
        }
        break;

      case "?":
        if (shortcutsOverlay) {
          if (shortcutsOverlay.classList.contains("hidden")) {
            shortcutsOverlay.classList.remove("hidden");
          } else {
            shortcutsOverlay.classList.add("hidden");
          }
        }
        break;
    }
  });
}

/**
 * Configure attachments handling for Gemini Chat messages.
 */
function setupChatFileAttachments() {
  const chatAttachBtn = document.getElementById("chat-attach-btn");
  const chatFileInput = document.getElementById("chat-file-input");
  const chatAttachedContainer = document.getElementById("chat-attached-files-container");

  if (!chatAttachBtn || !chatFileInput || !chatAttachedContainer) return;

  chatAttachBtn.addEventListener("click", () => {
    if (document.body.classList.contains("edit-locked")) return;
    chatFileInput.click();
  });

  chatFileInput.addEventListener("change", async (e) => {
    if (document.body.classList.contains("edit-locked")) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      // Prevent duplicates
      if (attachedFiles.some(f => f.name === file.name)) continue;

      try {
        const fileData = await readFileContent(file);
        if (fileData) {
          attachedFiles.push({
            name: file.name,
            type: file.type,
            content: fileData.content,
            isImage: fileData.isImage
          });
        }
      } catch (err) {
        showToast(`Error reading file ${file.name}: ${err.message}`);
      }
    }

    renderAttachedFiles();
    chatFileInput.value = ""; // Reset input so same file can be selected again
  });

  function renderAttachedFiles() {
    chatAttachedContainer.innerHTML = "";
    attachedFiles.forEach((file, index) => {
      const badge = document.createElement("div");
      badge.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        font-size: 11px;
        color: var(--text-color);
        font-family: var(--font-ui);
      `;

      const icon = file.isImage ? "🖼️" : file.type.includes("pdf") ? "📄" : "📝";
      badge.innerHTML = `
        <span>${icon} ${file.name}</span>
        <span class="delete-attachment" style="cursor: pointer; font-weight: bold; color: var(--text-muted); margin-left: 4px; font-size: 12px;">×</span>
      `;

      badge.querySelector(".delete-attachment").addEventListener("click", () => {
        attachedFiles.splice(index, 1);
        renderAttachedFiles();
      });

      chatAttachedContainer.appendChild(badge);
    });
  }

  // Helper to read file content based on type
  async function readFileContent(file) {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type.includes("pdf") || file.name.endsWith(".pdf");

    if (isImage) {
      // Base64 read for images
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          // Extract base64 payload from data URL
          const base64Data = reader.result.split(",")[1];
          resolve({
            name: file.name,
            type: file.type,
            content: base64Data,
            isImage: true
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } else if (isPdf) {
      // PDF text extraction using PDF.js
      try {
        const text = await extractTextFromPdf(file);
        return {
          name: file.name,
          type: "text/plain",
          content: text,
          isImage: false
        };
      } catch (err) {
        console.error("PDF text extraction failed:", err);
        throw new Error("Could not extract text from PDF: " + err.message);
      }
    } else {
      // Standard text-based read (TXT, CSV, GPX, JSON, XML)
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            name: file.name,
            type: file.type || "text/plain",
            content: reader.result,
            isImage: false
          });
        };
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }
  }

  async function extractTextFromPdf(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      text += strings.join(" ") + "\n";
    }
    return text;
  }
}
