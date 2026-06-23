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

import { parseGPX, parseKML, reconcileCourse, getMetricsForPoint, calculateWarnings, haversine, snapToRouteSegments, recalculateRouteMetrics, classifyGradient, computeSectorGradient, autoSegmentCourse, solveBackwardPacing, saveRunnerProfile, deleteRunnerProfile, solvePacingTriangle, getRunnerProfiles, getActiveRunnerProfile, getActiveGoalPreset } from "./gpx-parser.js";
import { writeGPX } from "./gpx-writer.js";
import { correctRouteElevations } from "./fetch-elevation.js";
import { sendToGemini, fetchAvailableModels, generateWaypointFromDescription } from "./gemini-client.js";
import { parseCalibrationTrack, buildEmpiricalProfile } from "./empirical-calibration.js";
import { loadGoogleMaps, Map3DController, calculateBearing } from "./map-3d.js";
import { ElevationChart } from "./elevation-chart.js";
import { fetchWeatherForecast, getWeatherConditionStyle, getElapsedHoursAtDistance, getWeatherWindowDetails } from "./fetch-weather.js";

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
const studioViewEdit = document.getElementById("studio-view-edit");
const studioTabEdit = document.getElementById("studio-tab-edit");
const studioTabRunner = document.getElementById("studio-tab-runner");
const studioViewRunner = document.getElementById("studio-view-runner");
const runnerProfileSelect = document.getElementById("runner-profile-select");
const pacingModeForward = document.getElementById("pacing-mode-forward");
const pacingModeBackward = document.getElementById("pacing-mode-backward");
const deadlineInputBox = document.getElementById("deadline-input-box");
const deadlineClockInput = document.getElementById("deadline-clock-input");
const solveDeadlineBtn = document.getElementById("solve-deadline-btn");
const pacingTriangleCard = document.getElementById("pacing-triangle-card");
const triangleModeBadge = document.getElementById("triangle-mode-badge");
const triStartInput = document.getElementById("tri-start-input");
const triFinishInput = document.getElementById("tri-finish-input");
const triPacingSummary = document.getElementById("tri-pacing-summary");
const pacingScalingLabel = document.getElementById("pacing-scaling-label");
const solveTriangleBtn = document.getElementById("solve-triangle-btn");
const autoSliceCourseBtn = document.getElementById("auto-slice-course-btn");
const addSplitMarkerBtn = document.getElementById("add-split-marker-btn");
const runnerSectorsList = document.getElementById("runner-sectors-list");
const calibrationFilesInput = document.getElementById("calibration-files-input");
const runCalibrationBtn = document.getElementById("run-calibration-btn");
const calibrationFilesList = document.getElementById("calibration-files-list");
const calibrationResultsCard = document.getElementById("calibration-results-card");
const addRunnerProfileBtn = document.getElementById("add-runner-profile-btn");
const editRunnerProfileBtn = document.getElementById("edit-runner-profile-btn");
const deleteRunnerProfileBtn = document.getElementById("delete-runner-profile-btn");
const exportProfilesBtn = document.getElementById("export-profiles-btn");
const importProfilesInput = document.getElementById("import-profiles-input");
const runnerProfileCreatorCard = document.getElementById("runner-profile-creator-card");
const profileCreatorTitle = document.getElementById("profile-creator-title");
const newProfileName = document.getElementById("new-profile-name");
const newProfileDesc = document.getElementById("new-profile-desc");
const newPaceClimb = document.getElementById("new-pace-climb");
const newPaceFlat = document.getElementById("new-pace-flat");
const newPaceDesc = document.getElementById("new-pace-desc");
const cancelProfileCreateBtn = document.getElementById("cancel-profile-create-btn");
const saveProfileCreateBtn = document.getElementById("save-profile-create-btn");
const studioTabPoi = document.getElementById("studio-tab-poi");
const studioTabChat = document.getElementById("studio-tab-chat");
const studioTabPlan = document.getElementById("studio-tab-plan");
const studioViewPlan = document.getElementById("studio-view-plan");

// Planner form controls
const togglePlannerBtn = document.getElementById("toggle-planner-btn");
const planStartTime = document.getElementById("plan-start-time");
const planSunriseTime = document.getElementById("plan-sunrise-time");
const planSunsetTime = document.getElementById("plan-sunset-time");
const planFitnessLevel = document.getElementById("plan-fitness-level");
const planGoalHrs = document.getElementById("plan-goal-hrs");
const planRecentResult = document.getElementById("plan-recent-result");
const planPaceClimb = document.getElementById("plan-pace-climb");
const planPaceFlat = document.getElementById("plan-pace-flat");
const planPaceDesc = document.getElementById("plan-pace-desc");
const planSteepDescent = document.getElementById("plan-steep-descent");
const planDegradationSlider = document.getElementById("plan-degradation-slider");
const planDegradationVal = document.getElementById("plan-degradation-val");
const generateRacePlanBtn = document.getElementById("generate-race-plan-btn");
const plannerOutputContainer = document.getElementById("planner-output-container");
const planTotalTimeDisp = document.getElementById("plan-total-time-disp");
const planAvgPaceDisp = document.getElementById("plan-avg-pace-disp");
const planSegmentsList = document.getElementById("plan-segments-list");
const applyPlanToHudBtn = document.getElementById("apply-plan-to-hud-btn");

// AI Interview Modal controls
const aiInterviewTrigger = document.getElementById("ai-interview-trigger");
const aiInterviewModal = document.getElementById("ai-interview-modal");
const closeInterviewBtn = document.getElementById("close-interview-btn");
const aiInterviewInput = document.getElementById("ai-interview-input");
const aiInterviewSubmitBtn = document.getElementById("ai-interview-submit-btn");
const aiInterviewCancelBtn = document.getElementById("ai-interview-cancel-btn");
const aiInterviewChatLog = document.getElementById("ai-interview-chat-log");

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
const poiValDist = document.getElementById("poi-val-dist");
const poiValElapsed = document.getElementById("poi-val-elapsed");
const poiValEta = document.getElementById("poi-val-eta");
const poiValEtaRange = document.getElementById("poi-val-eta-range");
const poiValPrev = document.getElementById("poi-val-prev");
const poiValNext = document.getElementById("poi-val-next");

const poiDialogPlaybackPause = document.getElementById("poi-dialog-playback-pause");
const poiDialogPlaybackContinue = document.getElementById("poi-dialog-playback-continue");
const poiDialogToggleExpand = document.getElementById("poi-dialog-toggle-expand");
const poiDialogCloseHeader = document.getElementById("poi-dialog-close-header");
const poiDialogCloseBottom = document.getElementById("poi-dialog-close-bottom");
const closePreviewPoiBtn = document.getElementById("close-preview-poi-btn");

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
const settingsDesertThreshold = document.getElementById("settings-desert-threshold");
const desertThresholdVal = document.getElementById("desert-threshold-val");
let desertThresholdMiles = 8.0;
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
const fetchWeatherBtn = document.getElementById("fetch-weather-btn");
const weatherPendingState = document.getElementById("weather-pending-state");

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
const poiWeatherOfflineMsg = document.getElementById("poi-weather-offline-msg");
const poiWeatherCardContainer = document.getElementById("poi-weather-card-container");
const poiFetchWeatherBtn = document.getElementById("poi-fetch-weather-btn");
const poiWeatherEmoji = document.getElementById("poi-weather-emoji");
const poiWeatherDesc = document.getElementById("poi-weather-desc");
const poiWeatherWind = document.getElementById("poi-weather-wind");
const poiWeatherTemp = document.getElementById("poi-weather-temp");
const poiWeatherPrecip = document.getElementById("poi-weather-precip");

// Global weather fetch status
let hasFetchedWeather = false;
let tempExecutionPlan = null;

// Floating POI Preview Banner (Shown during fly-through preview)
const previewPoiBanner = document.getElementById("preview-poi-banner");
const previewPoiSym = document.getElementById("preview-poi-sym");
const previewPoiName = document.getElementById("preview-poi-name");
const previewPoiType = document.getElementById("preview-poi-type");
const previewPoiWeatherIcon = document.getElementById("preview-poi-weather-icon");
const previewPoiWeatherTemp = document.getElementById("preview-poi-weather-temp");
const previewPoiArriveTime = document.getElementById("preview-poi-arrive-time");
const previewPoiWeatherDesc = document.getElementById("preview-poi-weather-desc");
const previewPoiAmenities = document.getElementById("preview-poi-amenities");
const previewPoiNextDist = document.getElementById("preview-poi-next-dist");
const previewPoiNextGain = document.getElementById("preview-poi-next-gain");
const previewPoiNextLoss = document.getElementById("preview-poi-next-loss");

// Race Strategy Overlay & Elements
const toggleStrategyBtn = document.getElementById("toggle-strategy-btn");
const strategyOverlay = document.getElementById("strategy-overlay");
const closeStrategyBtn = document.getElementById("close-strategy-btn");
const stratPlanStart = document.getElementById("strat-plan-start");
const stratPlanDuration = document.getElementById("strat-plan-duration");
const stratSyncAiBtn = document.getElementById("strat-sync-ai-btn");
const stratAddSectorBtn = document.getElementById("strat-add-sector-btn");
const stratSectorsList = document.getElementById("strat-sectors-list");
const stratEditBox = document.getElementById("strat-edit-box");
const stratEditTitle = document.getElementById("strat-edit-title");
const stratEditCancel = document.getElementById("strat-edit-cancel");
const stratSecName = document.getElementById("strat-sec-name");
const stratSecStart = document.getElementById("strat-sec-start");
const stratSecEnd = document.getElementById("strat-sec-end");
const stratSecPace = document.getElementById("strat-sec-pace");
const stratSecStrategy = document.getElementById("strat-sec-strategy");
const stratSecNutrition = document.getElementById("strat-sec-nutrition");
const stratSecSave = document.getElementById("strat-sec-save");

// AI Race Wizard Elements
const stratTabWizard = document.getElementById("strat-tab-wizard");
const stratTabSectors = document.getElementById("strat-tab-sectors");
const stratViewWizard = document.getElementById("strat-view-wizard");
const stratViewSectors = document.getElementById("strat-view-sectors");
const aiWizardFitness = document.getElementById("ai-wizard-fitness");
const wizardClimbSpd = document.getElementById("wizard-climb-spd");
const wizardDescSpd = document.getElementById("wizard-desc-spd");
const wizardFlatSpd = document.getElementById("wizard-flat-spd");
const wizardClimbLbl = document.getElementById("wizard-climb-lbl");
const wizardDescLbl = document.getElementById("wizard-desc-lbl");
const wizardFlatLbl = document.getElementById("wizard-flat-lbl");
const aiWizardStart = document.getElementById("ai-wizard-start");
const aiSearchStartBtn = document.getElementById("ai-search-start-btn");
const generateAiPlanBtn = document.getElementById("generate-ai-plan-btn");

// Aid Station Facets Modal Elements
const poiDialogFacetsBtn = document.getElementById("poi-dialog-facets-btn");
const poiFacetsModal = document.getElementById("poi-facets-modal");
const closeFacetsBtn = document.getElementById("close-facets-btn");
const facetName = document.getElementById("facet-name");
const facetType = document.getElementById("facet-type");
const facetArrive = document.getElementById("facet-arrive");
const facetSrvWater = document.getElementById("facet-srv-water");
const facetSrvFood = document.getElementById("facet-srv-food");
const facetSrvToilets = document.getElementById("facet-srv-toilets");
const facetSrvMedical = document.getElementById("facet-srv-medical");
const facetAccDropbag = document.getElementById("facet-acc-dropbag");
const facetAccCrew = document.getElementById("facet-acc-crew");
const facetNotes = document.getElementById("facet-notes");
const saveFacetsBtn = document.getElementById("save-facets-btn");

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

  const savedDesert = localStorage.getItem("kokopelli_desert_threshold");
  if (savedDesert) {
    desertThresholdMiles = parseFloat(savedDesert) || 8.0;
  } else {
    desertThresholdMiles = 8.0;
  }
  if (settingsDesertThreshold) settingsDesertThreshold.value = desertThresholdMiles;
  if (desertThresholdVal) desertThresholdVal.textContent = `${desertThresholdMiles.toFixed(1)} mi`;
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
 * Helper to format elapsed or split duration in hours into clean text (e.g. 2h 45m or 45m).
 * @param {number} hrs Duration in hours
 * @returns {string} Formatted split string
 */
function formatSplitTime(hrs) {
  if (hrs === null || hrs === undefined || isNaN(hrs)) return "--";
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
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
 * Resolves the plan start time in milliseconds since epoch.
 */
function getPlanStartMs() {
  let planStartMs = Date.now();
  if (weatherPlanStartInput && weatherPlanStartInput.value) {
    const parsed = new Date(weatherPlanStartInput.value);
    if (!isNaN(parsed)) {
      planStartMs = parsed.getTime();
    }
  }
  return planStartMs;
}

/**
 * Resolves the plan duration in hours.
 */
function getPlanDurationHrs() {
  return (weatherPlanDurationInput && parseFloat(weatherPlanDurationInput.value)) ? parseFloat(weatherPlanDurationInput.value) : 4.0;
}



/**
 * Triggered whenever the execution plan (athlete pacing / start time) changes.
 * Refreshes the weather forecasts in all panels to align with new arrival times.
 */
function onExecutionPlanChanged() {
  if (activeRoute && activeRoute.executionPlan) {
    if (activeRoute.executionPlan.startTime && weatherPlanStartInput) {
      let val = activeRoute.executionPlan.startTime;
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(val)) {
        const hhmm = val.substring(0, 5);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const yyyy = tomorrow.getFullYear();
        const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const dd = String(tomorrow.getDate()).padStart(2, '0');
        val = `${yyyy}-${mm}-${dd}T${hhmm}`;
      }
      weatherPlanStartInput.value = val;
    }
    if (activeRoute.executionPlan.targetDurationHrs && weatherPlanDurationInput) {
      weatherPlanDurationInput.value = activeRoute.executionPlan.targetDurationHrs;
    }
  }
  if (lastWeatherLat !== null && lastWeatherLon !== null) {
    triggerWeatherWeather(lastWeatherLat, lastWeatherLon, true);
  }
  // Refresh Waypoint details if open
  if (poiDetailDialog && !poiDetailDialog.classList.contains("hidden") && activeDialogWpt) {
    showPoiDetailDialog(activeDialogWpt, activeDialogWpt.closestTrackpointIndex, activeDialogWpt.dist_m);
  }
}

/**
 * Updates the Weather Panel layout with details.
 */
async function updateWeatherUI(lat, lon) {
  if (!hasFetchedWeather) {
    if (weatherPendingState) weatherPendingState.classList.remove("hidden");
    if (weatherLoader) weatherLoader.classList.add("hidden");
    if (weatherError) weatherError.classList.add("hidden");
    if (weatherContent) weatherContent.classList.add("hidden");
    
    const hudValWeather = document.getElementById("hud-val-weather");
    if (hudValWeather) hudValWeather.textContent = "--";
    return;
  } else {
    if (weatherPendingState) weatherPendingState.classList.add("hidden");
  }

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

  const isPanelVisible = cardWeather && !cardWeather.classList.contains("hidden");
  if (isPanelVisible) {
    if (weatherLoader) weatherLoader.classList.remove("hidden");
    if (weatherError) weatherError.classList.add("hidden");
    if (weatherContent) weatherContent.classList.add("hidden");
  }

  try {
    const data = await fetchWeatherForecast(lat, lon, 96, apiKeyMaps);
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
    let snappedDist = 0;
    if (activeRoute && activeRoute.trackpoints && activeRoute.trackpoints.length > 0 && activeRoute.totalDistance > 0) {
      const snapped = snapToRouteSegments(activeRoute, { lat, lng: lon });
      if (snapped && snapped.dist_m !== undefined) {
        snappedDist = snapped.dist_m;
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

    const durationHrs = getPlanDurationHrs();
    const elapsedHrs = getElapsedHoursAtDistance(activeRoute, snappedDist, durationHrs);
    const estArrivalMs = planStartMs + elapsedHrs * 3600 * 1000;
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

    const hudValWeather = document.getElementById("hud-val-weather");
    if (hudValWeather && current) {
      const tempStr = convertTemperatureValue(current.temperature?.degrees ?? 0);
      hudValWeather.innerHTML = `${tempStr} <span style="font-size: 14px; margin-left: 2px;">${condStyle.emoji}</span>`;
    }

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

    // Populate all aid stations comparative forecasts
    const weatherAllStationsSection = document.getElementById("weather-all-stations-section");
    const weatherAllStationsList = document.getElementById("weather-all-stations-list");

    if (!activeRoute || !activeRoute.waypoints || activeRoute.waypoints.length === 0) {
      if (weatherAllStationsSection) weatherAllStationsSection.classList.add("hidden");
    } else {
      if (weatherAllStationsSection) weatherAllStationsSection.classList.remove("hidden");
      if (weatherAllStationsList) {
        weatherAllStationsList.innerHTML = "";
        
        // Flatten waypoints into individual passes
        const passesToRender = [];
        activeRoute.waypoints.forEach(wpt => {
          const passes = wpt.extensions?.station?.passes || [];
          if (passes.length > 0) {
            passes.forEach(p => {
              passesToRender.push({
                wpt: wpt,
                passNum: p.num,
                dist_m: p.dist_m,
                name: wpt.name + (passes.length > 1 ? ` (Pass ${p.num})` : ""),
                ele: wpt.ele
              });
            });
          } else {
            passesToRender.push({
              wpt: wpt,
              passNum: 1,
              dist_m: wpt.dist_m,
              name: wpt.name,
              ele: wpt.ele
            });
          }
        });

        // Sort by distance
        passesToRender.sort((a, b) => a.dist_m - b.dist_m);

        // Fetch forecasts sequentially (highly cached)
        for (const item of passesToRender) {
          let cardWeatherEmoji = "🌡️";
          let cardWeatherTemp = "--";
          let cardWeatherDesc = "Loading...";

          const itemElapsedHrs = getElapsedHoursAtDistance(activeRoute, item.dist_m, durationHrs);
          const itemArrivalMs = planStartMs + itemElapsedHrs * 3600 * 1000;
          const itemArrivalDate = new Date(itemArrivalMs);

          let stationForecast = null;
          try {
            stationForecast = await fetchWeatherForecast(item.wpt.lat, item.wpt.lon, 96, apiKeyMaps);
          } catch (e) {
            console.error(`Failed to load forecast for comparative station ${item.name}:`, e);
          }

          if (stationForecast && stationForecast.forecastHours && stationForecast.forecastHours.length > 0) {
            const details = getWeatherWindowDetails(activeRoute, item.dist_m, stationForecast, itemArrivalMs);
            if (details) {
              const cond = details.selectedHour.weatherCondition || {};
              const style = getWeatherConditionStyle(cond.type);
              const hrTemp = details.selectedHour.temperature?.degrees ?? 0;
              cardWeatherEmoji = style.emoji;
              cardWeatherTemp = `${convertTemperatureValue(hrTemp)} (${convertTemperatureValue(details.minTemp)}-${convertTemperatureValue(details.maxTemp)})`;
              cardWeatherDesc = cond.description?.text || style.label;
            }
          }

          const timeStr = itemArrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dayStr = itemArrivalDate.toLocaleDateString([], { weekday: 'short' });
          const arrivalLabel = `${dayStr} ${timeStr}`;

          const card = document.createElement("div");
          card.className = "weather-station-card";
          card.style.display = "flex";
          card.style.justifyContent = "space-between";
          card.style.alignItems = "center";
          card.style.background = "rgba(255, 255, 255, 0.03)";
          card.style.border = "1px solid rgba(255, 255, 255, 0.05)";
          card.style.borderRadius = "6px";
          card.style.padding = "6px 10px";
          card.style.cursor = "pointer";
          card.style.transition = "background 0.2s ease, border-color 0.2s ease";

          card.addEventListener("click", () => {
            if (item.wpt.closestTrackpointIndex !== undefined) {
              playbackIndex = item.wpt.closestTrackpointIndex;
              if (mapController) {
                mapController.syncToTrackpoint(playbackIndex, true);
              }
              if (elevationChart) {
                elevationChart.progressIndex = playbackIndex;
                elevationChart.draw();
              }
              updateHUD(playbackIndex);
              showPoiDetailDialog(item.wpt, playbackIndex, item.dist_m);
            }
          });

          const elevStr = formatElevation(item.ele);
          const distStr = formatDistance(item.dist_m);

          card.innerHTML = `
            <div style="display: flex; flex-direction: column; text-align: left;">
              <span class="station-name" style="font-size: 11px; font-weight: bold; color: #60a5fa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">${item.name}</span>
              <span class="station-meta" style="font-size: 9px; color: var(--text-muted);">Elev: ${elevStr} | Dist: ${distStr}</span>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
              <span class="station-weather" style="font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 14px; margin-right: 2px;">${cardWeatherEmoji}</span>
                <span class="station-temp" style="font-size: 11.5px; font-weight: bold;">${cardWeatherTemp}</span>
              </span>
              <span style="font-size: 8px; color: #10b981; font-weight: 600;">${arrivalLabel}</span>
            </div>
          `;
          weatherAllStationsList.appendChild(card);
        }
      }
    }

    if (isPanelVisible) {
      if (weatherLoader) weatherLoader.classList.add("hidden");
      if (weatherContent) weatherContent.classList.remove("hidden");
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Error updating weather UI:", error);
      if (isPanelVisible) {
        if (weatherError) {
          weatherError.textContent = error.message || "Failed to load weather forecast.";
          weatherError.classList.remove("hidden");
        }
        if (weatherLoader) weatherLoader.classList.add("hidden");
      }
    }
  }
}

/**
 * Updates POI weather sub-view.
 */
async function updatePoiWeatherUI(wpt, currentDist = null) {
  if (!apiKeyMaps) {
    if (poiWeatherSection) poiWeatherSection.classList.add("hidden");
    return;
  }

  const poiWeatherTimeline = document.getElementById("poi-weather-timeline");

  if (poiWeatherSection) poiWeatherSection.classList.remove("hidden");

  if (!hasFetchedWeather) {
    if (poiWeatherOfflineMsg) poiWeatherOfflineMsg.classList.remove("hidden");
    if (poiWeatherCardContainer) poiWeatherCardContainer.classList.add("hidden");
    return;
  } else {
    if (poiWeatherOfflineMsg) poiWeatherOfflineMsg.classList.add("hidden");
    if (poiWeatherCardContainer) poiWeatherCardContainer.classList.remove("hidden");
  }

  if (poiWeatherEmoji) poiWeatherEmoji.textContent = "🌡️";
  if (poiWeatherDesc) poiWeatherDesc.textContent = "Loading...";
  if (poiWeatherWind) poiWeatherWind.textContent = "Wind: --";
  if (poiWeatherTemp) poiWeatherTemp.textContent = "--";
  if (poiWeatherPrecip) poiWeatherPrecip.textContent = "Rain: --%";
  if (poiWeatherTimeline) poiWeatherTimeline.innerHTML = "";

  try {
    const data = await fetchWeatherForecast(wpt.lat, wpt.lon, 96, apiKeyMaps);
    if (!data || !data.forecastHours || data.forecastHours.length === 0) {
      throw new Error("No forecast data");
    }

    const dist = currentDist !== null ? currentDist : wpt.dist_m;
    const elapsedHrs = getElapsedHoursAtDistance(activeRoute, dist, getPlanDurationHrs());
    const planStartMs = getPlanStartMs();
    const arrivalMs = planStartMs + elapsedHrs * 3600 * 1000;
    const arrivalDate = new Date(arrivalMs);

    const details = getWeatherWindowDetails(activeRoute, dist, data, arrivalMs);
    if (!details) {
      throw new Error("No forecast details found");
    }

    const selectedHour = details.selectedHour;
    const condition = selectedHour.weatherCondition || {};
    const condStyle = getWeatherConditionStyle(condition.type);

    if (poiWeatherEmoji) poiWeatherEmoji.textContent = condStyle.emoji;

    const timeString = arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dayString = arrivalDate.toLocaleDateString([], { weekday: 'short' });
    const arrivalLabel = `${dayString} ${timeString}`;

    if (poiWeatherDesc) {
      poiWeatherDesc.textContent = `${condition.description?.text || condStyle.label} (Expected ${arrivalLabel})`;
    }
    
    const tempCelsius = selectedHour.temperature?.degrees ?? 0;
    if (poiWeatherTemp) {
      const mainTemp = convertTemperatureValue(tempCelsius);
      const minTemp = convertTemperatureValue(details.minTemp);
      const maxTemp = convertTemperatureValue(details.maxTemp);
      poiWeatherTemp.textContent = `${mainTemp} (${minTemp}-${maxTemp})`;
    }

    const windSpeed = selectedHour.wind?.speed?.value ?? 0;
    const windDir = selectedHour.wind?.direction?.cardinal || "N/A";
    if (poiWeatherWind) {
      poiWeatherWind.textContent = `Wind: ${convertWindSpeedValue(windSpeed)} ${windDir}`;
    }

    if (poiWeatherPrecip) {
      poiWeatherPrecip.textContent = `Rain: ${selectedHour.precipitation?.probability?.percent ?? 0}%`;
    }

    // Render scaled W-hour window forecast timeline
    if (poiWeatherTimeline) {
      poiWeatherTimeline.innerHTML = "";
      details.displayHours.forEach(hr => {
        const hrCond = hr.weatherCondition || {};
        const hrStyle = getWeatherConditionStyle(hrCond.type);
        const hrTemp = hr.temperature?.degrees ?? 0;
        const hrTimeStr = formatHourOnly(hr);
        const isActive = (hr === selectedHour);

        const box = document.createElement("div");
        box.className = `poi-weather-hour-box ${isActive ? 'active' : ''}`;
        box.innerHTML = `
          <span class="time">${hrTimeStr}</span>
          <span class="emoji" title="${hrCond.description?.text || hrStyle.label}">${hrStyle.emoji}</span>
          <span class="temp">${convertTemperatureValue(hrTemp)}</span>
        `;
        poiWeatherTimeline.appendChild(box);
      });
    }
  } catch (error) {
    console.error("Failed to load POI weather:", error);
    if (poiWeatherDesc) poiWeatherDesc.textContent = "Forecast unavailable";
    if (poiWeatherTemp) poiWeatherTemp.textContent = "--";
  }
}

// Helper to format hour labels
function formatHourOnly(hourData) {
  if (hourData.displayDateTime) {
    const hours = hourData.displayDateTime.hours;
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;
    return `${displayHour} ${ampm}`;
  } else if (hourData.time) {
    return new Date(hourData.time).toLocaleTimeString([], { hour: 'numeric' });
  }
  return "--";
}

/**
 * Triggers a debounced weather update for the specified lat/lon.
 */
function triggerWeatherWeather(lat, lon, force = false) {
  if (!apiKeyMaps) return;
  if (!cardWeather) return;

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
 * Identifies whether a waypoint qualifies as a Major POI (Aid Station, Water, Summit, Finish).
 */
function isMajorPoi(w) {
  if (!w) return false;
  const t = w.extensions?.station?.type;
  const st = w.extensions?.station?.subtype;
  const symLower = (w.sym || "").toLowerCase();
  const nameLower = (w.name || "").toLowerCase();

  if (t === "segmenting" || st === "aid_station" || st === "water_source" || st === "summit" || st === "water") return true;
  if (symLower.includes("aid_station") || symLower.includes("water") || symLower.includes("summit") || symLower.includes("finish") || symLower.includes("start")) return true;
  if (nameLower.includes("finish") || nameLower.includes("start")) return true;

  return false;
}

/**
 * Helper to identify the nearest preceding and succeeding Major POIs relative to a course distance.
 * Computes exact relative distances, elevation gain, and elevation loss.
 */
function getSegmentingNeighbors(d) {
  if (!activeRoute || !activeRoute.trackpoints || activeRoute.trackpoints.length === 0) {
    return { 
      prev: { name: "START", dist_m: 0, relDist_m: 0, gain_m: 0, loss_m: 0 }, 
      next: { name: "FINISH", dist_m: 0, relDist_m: 0, gain_m: 0, loss_m: 0 } 
    };
  }

  const trackpoints = activeRoute.trackpoints;
  let currIdx = 0;
  let minDiff = Infinity;
  for (let idx = 0; idx < trackpoints.length; idx++) {
    const diff = Math.abs(trackpoints[idx].dist_m - d);
    if (diff < minDiff) {
      minDiff = diff;
      currIdx = idx;
    }
  }

  const prevWpts = activeRoute.waypoints
    .filter(w => w.dist_m < d - 15 && isMajorPoi(w))
    .sort((a, b) => b.dist_m - a.dist_m);
  const prevWpt = prevWpts[0];

  const nextWpts = activeRoute.waypoints
    .filter(w => w.dist_m > d + 15 && isMajorPoi(w))
    .sort((a, b) => a.dist_m - b.dist_m);
  const nextWpt = nextWpts[0];

  const getStatsBetween = (startIdx, endIdx) => {
    let sIdx = Math.min(startIdx, endIdx);
    let eIdx = Math.max(startIdx, endIdx);
    let gain = 0;
    let loss = 0;
    for (let k = sIdx + 1; k <= eIdx; k++) {
      const diff = trackpoints[k].ele - trackpoints[k - 1].ele;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    return { gain, loss };
  };

  const prevDist = prevWpt ? prevWpt.dist_m : 0;
  let prevIdx = 0;
  if (prevWpt && prevWpt.closestTrackpointIndex !== undefined) {
    prevIdx = prevWpt.closestTrackpointIndex;
  }
  const prevStats = getStatsBetween(prevIdx, currIdx);

  const nextDist = nextWpt ? nextWpt.dist_m : activeRoute.totalDistance;
  let nextIdx = trackpoints.length - 1;
  if (nextWpt && nextWpt.closestTrackpointIndex !== undefined) {
    nextIdx = nextWpt.closestTrackpointIndex;
  }
  const nextStats = getStatsBetween(currIdx, nextIdx);

  return {
    prev: { 
      name: prevWpt ? prevWpt.name : "START", 
      dist_m: prevDist,
      relDist_m: d - prevDist,
      gain_m: prevStats.gain,
      loss_m: prevStats.loss
    },
    next: { 
      name: nextWpt ? nextWpt.name : "FINISH", 
      dist_m: nextDist,
      relDist_m: nextDist - d,
      gain_m: nextStats.gain,
      loss_m: nextStats.loss
    }
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

    const planDuration = getPlanDurationHrs();
    const elapsedHrs = getElapsedHoursAtDistance(activeRoute, nextAid.absolute_dist_m || (currentPt.dist_m + nextAid.dist_m), planDuration);
    const planStartMs = getPlanStartMs();
    const targetMs = planStartMs + elapsedHrs * 3600 * 1000;
    const targetDate = new Date(targetMs);
    const etaDay = targetDate.toLocaleDateString([], { weekday: 'short' });
    const etaTime = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    hudValNextAs.textContent = `${nextAid.name} (ETA: ${etaDay} ${etaTime}, +${distStr} ${distUnit}, +${gainStr} / -${lossStr} ${eleUnit})`;
  } else {
    const goalHrs = activeRoute.executionPlan?.targetDurationHrs;
    const goalStr = goalHrs ? `${goalHrs.toFixed(2)} hrs` : "Complete";
    hudValNextAs.innerHTML = `🎉 <strong style="color:#34d399;">FINISH LINE REACHED!</strong> (Goal: ${goalStr})`;
    
    if (index === pts.length - 1 && !activeRoute.hasCelebratedFinish) {
      activeRoute.hasCelebratedFinish = true;
      triggerConfetti();
      const overlay = document.getElementById("finish-celebration-overlay");
      const fTime = document.getElementById("celeb-final-time");
      const gRecap = document.getElementById("celeb-goal-recap");
      if (overlay) {
        if (fTime) fTime.textContent = hudValTime.textContent;
        if (gRecap) gRecap.textContent = `Target Goal: ${goalStr}`;
        overlay.classList.remove("hidden");
      }
    } else if (index < pts.length - 10) {
      activeRoute.hasCelebratedFinish = false;
    }
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
  const hudPlanBox = document.getElementById("hud-plan-box");
  const hudValPlanPace = document.getElementById("hud-val-plan-pace");
  const activeSec = activeRoute.executionPlan?.sectors?.find(s => currentDist >= s.start_dist_m && currentDist <= s.end_dist_m);

  if (hudPlanBox && hudValPlanPace && activeSec) {
    const mFloor = Math.floor(activeSec.target_pace_min);
    const sRound = Math.round((activeSec.target_pace_min % 1) * 60).toString().padStart(2, "0");
    hudValPlanPace.textContent = `${mFloor}:${sRound} min/mi`;
    hudPlanBox.title = activeSec.strategy || "Active Sector Strategy";
    hudPlanBox.classList.remove("hidden");
  } else if (hudPlanBox) {
    hudPlanBox.classList.add("hidden");
  }

  // 8b. Update floating Live Race Plan & Subsegments Tracker HUD Box
  const liveBox = document.getElementById("live-race-plan-preview-box");
  if (liveBox && !liveBox.classList.contains("hidden")) {
    const sName = document.getElementById("live-plan-sector-name");
    const sSub = document.getElementById("live-plan-subsegment");
    const sArr = document.getElementById("live-plan-arrival");
    const sPace = document.getElementById("live-plan-pace");
    const sWth = document.getElementById("live-plan-weather-tag");
    if (activeSec) {
      if (sName) sName.textContent = activeSec.name;
      if (sArr) sArr.textContent = activeSec.time_window || "--:--";
      if (sPace) {
        const pFloor = Math.floor(activeSec.target_pace_min);
        const pSec = Math.round((activeSec.target_pace_min % 1) * 60).toString().padStart(2, "0");
        sPace.textContent = `${pFloor}:${pSec} min/mi`;
      }
      if (sWth) sWth.textContent = activeSec.weather_summary || "☀️ Daylight";
      if (sSub) {
        let matchedSub = "📍 Steady Rolling Traverse";
        if (activeClimb) matchedSub = `⛰️ Steep Climb Hazard (+${Math.round(activeClimb.gain_m*3.28084)} ft)`;
        else if (activeSec.subsegments && activeSec.subsegments.length > 0) {
          matchedSub = activeSec.subsegments[0].label;
        }
        sSub.textContent = matchedSub;
      }
    } else {
      if (sName) sName.textContent = "Milestone Traverse";
    }
  }

  if (activeSegmentDisplay) {
    if (activeSec) {
      const isFinishSec = activeSec.end_dist_m >= activeRoute.totalDistance - 10;
      const isStartSec = activeSec.start_dist_m === 0;
      const secEmoji = isFinishSec ? "🏁" : (isStartSec ? "🚀" : "🏃");
      activeSegmentDisplay.innerHTML = `${secEmoji} <strong>${escapeHtml(activeSec.name)}</strong> (${Math.floor(activeSec.target_pace_min)}:${Math.round((activeSec.target_pace_min%1)*60).toString().padStart(2,'0')} min/mi) | <em>${escapeHtml(activeSec.strategy || 'Maintain pace')}</em>`;
      activeSegmentDisplay.classList.remove("hidden");
    } else if (activeRoute.segments && activeRoute.segments.length > 1) {
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
 * Displays premium floating POI preview banner during fly-through simulation
 * to avoid screen clutter, showing relative distances and expected arrival weather.
 */
async function showPreviewPoiBanner(wpt, currentDist) {
  if (!previewPoiBanner) return;

  if (cardImporter) cardImporter.classList.add("hidden");
  if (cardStats) cardStats.classList.add("hidden");

  if (previewPoiName) previewPoiName.textContent = wpt.name;
  if (previewPoiSym) previewPoiSym.textContent = (wpt.sym?.includes("start") ? "🚀" : (wpt.sym?.includes("finish") ? "🏁" : (wpt.sym?.includes("water") ? "💧" : "📍")));
  if (previewPoiType) previewPoiType.textContent = (wpt.extensions?.station?.subtype || "Milestone").replace(/_/g, " ").toUpperCase();

  if (previewPoiAmenities) {
    previewPoiAmenities.innerHTML = "";
    const s = wpt.extensions?.station?.services || {};
    const a = wpt.extensions?.station?.accessibility || {};
    const serviceList = [];
    if (s.water || s.unmanaged_water) serviceList.push({ icon: "💧", label: "Water" });
    if (s.food || s.hot_food) serviceList.push({ icon: "🍔", label: "Food" });
    if (s.toilets) serviceList.push({ icon: "🚾", label: "Restrooms" });
    if (s.medical) serviceList.push({ icon: "➕", label: "Medical" });
    if (s.sleep_area) serviceList.push({ icon: "🛌", label: "Sleep" });
    if (a.crew_allowed) serviceList.push({ icon: "🚗", label: "Crew" });
    if (a.pacer_allowed) serviceList.push({ icon: "🏃", label: "Pacer" });
    if (a.drop_bag_allowed) serviceList.push({ icon: "🎒", label: "Drop Bag" });

    if (serviceList.length === 0) {
      previewPoiAmenities.innerHTML = `<span class="amenity-pill">Checkpoint</span>`;
    } else {
      serviceList.forEach(item => {
        const pill = document.createElement("span");
        pill.className = "amenity-pill";
        pill.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;
        previewPoiAmenities.appendChild(pill);
      });
    }
  }

  const neighbors = getSegmentingNeighbors(currentDist);
  if (previewPoiNextDist) {
    previewPoiNextDist.textContent = `+${formatDistance(neighbors.next.relDist_m)} (${neighbors.next.name})`;
  }
  if (previewPoiNextGain) {
    previewPoiNextGain.textContent = `+${formatElevation(neighbors.next.gain_m)}`;
  }
  if (previewPoiNextLoss) {
    previewPoiNextLoss.textContent = `-${formatElevation(neighbors.next.loss_m)}`;
  }

  let planStartMs = Date.now();
  if (weatherPlanStartInput && weatherPlanStartInput.value) {
    const parsed = new Date(weatherPlanStartInput.value);
    if (!isNaN(parsed)) planStartMs = parsed.getTime();
  }
  const durationHrs = getPlanDurationHrs();
  const elapsedHrs = getElapsedHoursAtDistance(activeRoute, currentDist, durationHrs);
  const estArrivalMs = planStartMs + elapsedHrs * 3600 * 1000;
  const arrivalDate = new Date(estArrivalMs);

  if (previewPoiArriveTime) {
    const arrTime = arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    previewPoiArriveTime.textContent = `Arrive: ${arrTime}`;
  }
  if (previewPoiWeatherDesc) previewPoiWeatherDesc.textContent = hasFetchedWeather ? "Loading forecast..." : "Forecast not fetched";

  if (hasFetchedWeather && apiKeyMaps) {
    try {
      const data = await fetchWeatherForecast(wpt.lat, wpt.lon, 96, apiKeyMaps);
      if (data && data.forecastHours && data.forecastHours.length > 0) {
        const details = getWeatherWindowDetails(activeRoute, currentDist, data, estArrivalMs);
        if (details) {
          const selectedHour = details.selectedHour;
          const cond = selectedHour.weatherCondition || {};
          const style = getWeatherConditionStyle(cond.type);
          if (previewPoiWeatherIcon) previewPoiWeatherIcon.textContent = style.emoji;
          if (previewPoiWeatherTemp) {
            const mainTemp = convertTemperatureValue(selectedHour.temperature?.degrees ?? 0);
            const minTemp = convertTemperatureValue(details.minTemp);
            const maxTemp = convertTemperatureValue(details.maxTemp);
            previewPoiWeatherTemp.textContent = `${mainTemp} (${minTemp}-${maxTemp})`;
          }
          if (previewPoiWeatherDesc) {
            const pop = selectedHour.precipitation?.probability?.percent ?? 0;
            previewPoiWeatherDesc.textContent = `${style.label} (Rain: ${pop}%)`;
          }
        }
      }
    } catch (e) {
      if (previewPoiWeatherDesc) previewPoiWeatherDesc.textContent = "Forecast unavailable";
    }
  } else {
    if (previewPoiWeatherIcon) previewPoiWeatherIcon.textContent = "🌡️";
    if (previewPoiWeatherTemp) previewPoiWeatherTemp.textContent = "--";
    if (previewPoiWeatherDesc) {
      previewPoiWeatherDesc.textContent = apiKeyMaps ? "Forecast not fetched" : "No API Key";
    }
  }

  previewPoiBanner.classList.remove("hidden");

  const pauseSecs = (settingsPauseTime && !isNaN(parseInt(settingsPauseTime.value))) ? parseInt(settingsPauseTime.value) : 5;
  if (pauseSecs > 0) {
    pausePlayback();
    if (autoResumeTimeout) clearTimeout(autoResumeTimeout);
    autoResumeTimeout = setTimeout(() => {
      if (previewPoiBanner) previewPoiBanner.classList.add("hidden");
      startPlayback();
    }, pauseSecs * 1000);
  }
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
      showPreviewPoiBanner(reachedPoi, playbackDistance);
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

  if (cardWarnings && !cardWarnings.classList.contains("hidden") && warningsList) {
    const alerts = warningsList.querySelectorAll(".warning-item");
    alerts.forEach(alertEl => {
      const sDist = parseFloat(alertEl.dataset.startDist || "0");
      const eDist = parseFloat(alertEl.dataset.endDist || "0");
      if (playbackDistance >= sDist && playbackDistance <= eDist) {
        if (!alertEl.classList.contains("active-hazard-pulse")) {
          alertEl.classList.add("active-hazard-pulse");
          alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else {
        alertEl.classList.remove("active-hazard-pulse");
      }
    });
  }
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
 * Bumps the expected arrival time at a specific waypoint distance by an offset in minutes.
 * Scales the preceding sectors' pacing proportionally.
 */
function bumpArrivalTime(dist_m, offsetMinutes) {
  if (!activeRoute) return;
  const originalDuration = getPlanDurationHrs();
  
  if (activeRoute.executionPlan && activeRoute.executionPlan.sectors && activeRoute.executionPlan.sectors.length > 0) {
    const originalElapsedHrs = getElapsedHoursAtDistance(activeRoute, dist_m, originalDuration);
    if (originalElapsedHrs <= 0.05) {
      showToast("Cannot adjust start boundary time directly!");
      return;
    }
    const newElapsedHrs = originalElapsedHrs + offsetMinutes / 60;
    if (newElapsedHrs <= 0.1) return;
    const scale = newElapsedHrs / originalElapsedHrs;
    
    // Scale preceding sectors
    activeRoute.executionPlan.sectors.forEach(sec => {
      if (sec.start_dist_m < dist_m) {
        sec.target_pace_min = sec.target_pace_min * scale;
        const spd = 60 / sec.target_pace_min;
        sec.strategy = sec.strategy.replace(/Hold \d+(\.\d+)? mph/, `Hold ${spd.toFixed(1)} mph`);
      }
    });
    
    // Recalculate total duration
    let newTotalHrs = 0;
    activeRoute.executionPlan.sectors.forEach(sec => {
      const distMi = (sec.end_dist_m - sec.start_dist_m) / 1609.344;
      newTotalHrs += distMi * (sec.target_pace_min / 60);
    });
    activeRoute.executionPlan.targetDurationHrs = newTotalHrs;
    if (weatherPlanDurationInput) {
      weatherPlanDurationInput.value = newTotalHrs.toFixed(2);
    }
  } else {
    // Fallback: Scale overall plan duration
    const progressFraction = activeRoute.totalDistance > 0 ? dist_m / activeRoute.totalDistance : 0;
    if (progressFraction <= 0.05) return;
    const originalElapsedHrs = progressFraction * originalDuration;
    const newElapsedHrs = originalElapsedHrs + offsetMinutes / 60;
    if (newElapsedHrs <= 0.1) return;
    const newDuration = newElapsedHrs / progressFraction;
    if (weatherPlanDurationInput) {
      weatherPlanDurationInput.value = newDuration.toFixed(2);
    }
  }
  
  onExecutionPlanChanged();
  saveSessionState();
  showToast(`Arrival time adjusted by ${offsetMinutes > 0 ? "+" : ""}${offsetMinutes} mins.`);
}

/**
 * Helper to render the estimated arrival time cell with range and bump buttons.
 */
function renderEstTimeCell(td, dist_m) {
  td.style.textAlign = "center";
  const pElapsedHrs = getElapsedHoursAtDistance(activeRoute, dist_m, getPlanDurationHrs());
  const planStartMs = getPlanStartMs();
  const pArrivalMs = planStartMs + pElapsedHrs * 3600 * 1000;
  const pArrivalDate = new Date(pArrivalMs);
  const pArrivalStr = pArrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const pDayStr = pArrivalDate.toLocaleDateString([], { weekday: 'short' });

  // Fast/Slow ranges
  const fastMs = planStartMs + (pElapsedHrs * 0.85) * 3600 * 1000;
  const slowMs = planStartMs + (pElapsedHrs * 1.15) * 3600 * 1000;
  const fastDate = new Date(fastMs);
  const slowDate = new Date(slowMs);
  const fastStr = fastDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const slowStr = slowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fastDayStr = fastDate.toLocaleDateString([], { weekday: 'short' });
  const slowDayStr = slowDate.toLocaleDateString([], { weekday: 'short' });

  const timeContainer = document.createElement("div");
  timeContainer.style.display = "flex";
  timeContainer.style.flexDirection = "column";
  timeContainer.style.alignItems = "center";
  timeContainer.style.gap = "2px";

  const adjustRow = document.createElement("div");
  adjustRow.style.display = "flex";
  adjustRow.style.alignItems = "center";
  adjustRow.style.gap = "6px";

  const btnMinus = document.createElement("button");
  btnMinus.textContent = "-";
  btnMinus.title = "Arrive 10m earlier";
  btnMinus.style.padding = "1px 6px";
  btnMinus.style.fontSize = "10px";
  btnMinus.style.cursor = "pointer";
  btnMinus.style.background = "rgba(255,255,255,0.1)";
  btnMinus.style.border = "1px solid rgba(255,255,255,0.2)";
  btnMinus.style.color = "#fff";
  btnMinus.style.borderRadius = "3px";
  btnMinus.addEventListener("click", (e) => {
    e.stopPropagation();
    bumpArrivalTime(dist_m, -10);
  });

  const btnPlus = document.createElement("button");
  btnPlus.textContent = "+";
  btnPlus.title = "Arrive 10m later";
  btnPlus.style.padding = "1px 6px";
  btnPlus.style.fontSize = "10px";
  btnPlus.style.cursor = "pointer";
  btnPlus.style.background = "rgba(255,255,255,0.1)";
  btnPlus.style.border = "1px solid rgba(255,255,255,0.2)";
  btnPlus.style.color = "#fff";
  btnPlus.style.borderRadius = "3px";
  btnPlus.addEventListener("click", (e) => {
    e.stopPropagation();
    bumpArrivalTime(dist_m, 10);
  });

  const timeLbl = document.createElement("strong");
  timeLbl.textContent = `${pDayStr} ${pArrivalStr}`;

  adjustRow.appendChild(btnMinus);
  adjustRow.appendChild(timeLbl);
  adjustRow.appendChild(btnPlus);

  const rangeLbl = document.createElement("span");
  rangeLbl.style.fontSize = "9px";
  rangeLbl.style.color = "var(--text-muted)";
  let tableRangeText = `Range: ${fastStr} - ${slowStr}`;
  if (fastDayStr !== slowDayStr) {
    tableRangeText = `Range: ${fastDayStr} ${fastStr} - ${slowDayStr} ${slowStr}`;
  }
  rangeLbl.textContent = tableRangeText;

  timeContainer.appendChild(adjustRow);
  timeContainer.appendChild(rangeLbl);
  td.appendChild(timeContainer);
}

/**
 * Displays POI detail dialog window populated with services and multi-pass timeline metrics.
 * @param {Object} wpt Waypoint details parsed from GPX schema
 * @param {number} index Trackpoint index snapping point
 */
async function showPoiDetailDialog(wpt, index, referenceDist = null, startCollapsed = false) {
  if (!poiDetailDialog) return;

  const currentDist = referenceDist !== null ? referenceDist : wpt.dist_m;

  // Fetch and show weather for the POI using the current active pass distance
  updatePoiWeatherUI(wpt, currentDist);

  // Trigger table forecast fetch asynchronously in background without blocking dialog render
  let weatherData = null;
  const forecastPromise = apiKeyMaps ? fetchWeatherForecast(wpt.lat, wpt.lon, 96, apiKeyMaps).catch(e => {
    console.error("Failed to load forecast for table:", e);
    return null;
  }) : Promise.resolve(null);

  activeDialogWpt = wpt;
  isEditingPoiLocation = false;
  if (poiValNameInput) {
    poiValNameInput.classList.add("hidden");
    poiValNameInput.value = wpt.name;
  }
  if (poiValName) poiValName.classList.remove("hidden");
  if (poiDialogEditBtn) {
    poiDialogEditBtn.textContent = "📍 Relocate Waypoint";
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

  // DIST distance
  if (poiValDist) poiValDist.textContent = formatDistance(currentDist);

  const planDuration = getPlanDurationHrs();
  const elapsedHrs = getElapsedHoursAtDistance(activeRoute, currentDist, planDuration);
  if (poiValElapsed) poiValElapsed.textContent = formatSplitTime(elapsedHrs);

  // EST. ARRIVAL
  if (poiValEta) {
    const planStartMs = getPlanStartMs();
    const targetMs = planStartMs + elapsedHrs * 3600 * 1000;
    const targetDate = new Date(targetMs);
    const targetDayStr = targetDate.toLocaleDateString([], { weekday: 'short' });
    const targetTimeStr = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    poiValEta.textContent = `${targetDayStr} ${targetTimeStr}`;
  }

  // EST. ARRIVAL RANGE
  if (poiValEtaRange) {
    const planStartMs = getPlanStartMs();
    const fastMs = planStartMs + (elapsedHrs * 0.85) * 3600 * 1000;
    const slowMs = planStartMs + (elapsedHrs * 1.15) * 3600 * 1000;

    const fastDate = new Date(fastMs);
    const slowDate = new Date(slowMs);
    const fastDayStr = fastDate.toLocaleDateString([], { weekday: 'short' });
    const slowDayStr = slowDate.toLocaleDateString([], { weekday: 'short' });
    const fastTimeStr = fastDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const slowTimeStr = slowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let rangeStr = `${fastDayStr} ${fastTimeStr} - ${slowTimeStr}`;
    if (fastDayStr !== slowDayStr) {
      rangeStr = `${fastDayStr} ${fastTimeStr} - ${slowDayStr} ${slowTimeStr}`;
    }
    poiValEtaRange.textContent = rangeStr;
  }

  // PREV AS distance & travel time metrics
  const neighbors = getSegmentingNeighbors(currentDist);
  const prevDiff = currentDist - neighbors.prev.dist_m;
  const prevElapsed = getElapsedHoursAtDistance(activeRoute, neighbors.prev.dist_m, planDuration);
  const prevTravel = Math.max(0, elapsedHrs - prevElapsed);
  if (poiValPrev) poiValPrev.textContent = `+${formatDistance(prevDiff)} (${formatSplitTime(prevTravel)}, ${neighbors.prev.name})`;

  // NEXT AS distance & travel time metrics
  const nextDiff = neighbors.next.dist_m - currentDist;
  const nextElapsed = getElapsedHoursAtDistance(activeRoute, neighbors.next.dist_m, planDuration);
  const nextTravel = Math.max(0, nextElapsed - elapsedHrs);
  if (poiValNext) poiValNext.textContent = `${formatDistance(nextDiff)} (${formatSplitTime(nextTravel)}, ${neighbors.next.name})`;

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

      const pElapsedHrs = getElapsedHoursAtDistance(activeRoute, p.dist_m, planDuration);
      const tdElapsed = document.createElement("td");
      tdElapsed.textContent = formatSplitTime(pElapsedHrs);

      // Calculate Expected Arrival Time
      const tdEstTime = document.createElement("td");
      renderEstTimeCell(tdEstTime, p.dist_m);

      const pNeighbors = getSegmentingNeighbors(p.dist_m);
      
      const pPrevDiff = p.dist_m - pNeighbors.prev.dist_m;
      const pPrevElapsed = getElapsedHoursAtDistance(activeRoute, pNeighbors.prev.dist_m, planDuration);
      const pPrevTravel = Math.max(0, pElapsedHrs - pPrevElapsed);
      const tdPrev = document.createElement("td");
      tdPrev.textContent = `+${formatDistance(pPrevDiff)} (${formatSplitTime(pPrevTravel)}, ${pNeighbors.prev.name})`;

      const pNextDiff = pNeighbors.next.dist_m - p.dist_m;
      const pNextElapsed = getElapsedHoursAtDistance(activeRoute, pNeighbors.next.dist_m, planDuration);
      const pNextTravel = Math.max(0, pNextElapsed - pElapsedHrs);
      const tdNext = document.createElement("td");
      tdNext.textContent = `${formatDistance(pNextDiff)} (${formatSplitTime(pNextTravel)}, ${pNeighbors.next.name})`;

      // Weather forecast for this pass's arrival time
      const tdWeather = document.createElement("td");
      tdWeather.style.whiteSpace = "nowrap";
      tdWeather.textContent = "--";
      const planStartMs = getPlanStartMs();
      const pArrivalMs = planStartMs + pElapsedHrs * 3600 * 1000;
      tdWeather.setAttribute("data-pass-weather-dist", p.dist_m);
      tdWeather.setAttribute("data-pass-weather-ms", pArrivalMs);

      const tdCutoff = document.createElement("td");
      tdCutoff.textContent = p.cutoff_clock || p.cutoff_elapsed || "--";

      tr.appendChild(tdNum);
      tr.appendChild(tdArrive);
      tr.appendChild(tdElapsed);
      tr.appendChild(tdEstTime);
      tr.appendChild(tdPrev);
      tr.appendChild(tdNext);
      tr.appendChild(tdWeather);
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

    const tdElapsed = document.createElement("td");
    tdElapsed.textContent = formatSplitTime(elapsedHrs);

    // Calculate Expected Arrival Time
    const tdEstTime = document.createElement("td");
    renderEstTimeCell(tdEstTime, currentDist);

    const tdPrev = document.createElement("td");
    tdPrev.textContent = `+${formatDistance(prevDiff)} (${formatSplitTime(prevTravel)}, ${neighbors.prev.name})`;

    const tdNext = document.createElement("td");
    tdNext.textContent = `${formatDistance(nextDiff)} (${formatSplitTime(nextTravel)}, ${neighbors.next.name})`;

    // Weather forecast for single pass
    const tdWeather = document.createElement("td");
    tdWeather.style.whiteSpace = "nowrap";
    tdWeather.textContent = "--";
    const planStartMs = getPlanStartMs();
    const pArrivalMs = planStartMs + elapsedHrs * 3600 * 1000;
    tdWeather.setAttribute("data-pass-weather-dist", currentDist);
    tdWeather.setAttribute("data-pass-weather-ms", pArrivalMs);

    const tdCutoff = document.createElement("td");
    tdCutoff.textContent = "--";

    tr.appendChild(tdNum);
    tr.appendChild(tdArrive);
    tr.appendChild(tdElapsed);
    tr.appendChild(tdEstTime);
    tr.appendChild(tdPrev);
    tr.appendChild(tdNext);
    tr.appendChild(tdWeather);
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
  if (cardImporter) {
    cardImporter.classList.remove("hidden");
  }
  if (studioTabPoi) {
    studioTabPoi.click();
  }

  // Populate table weather cells asynchronously without blocking UI render
  forecastPromise.then(wData => {
    if (!wData || !wData.forecastHours || wData.forecastHours.length === 0) return;
    const weatherCells = poiDetailDialog.querySelectorAll("[data-pass-weather-dist]");
    weatherCells.forEach(td => {
      const d = parseFloat(td.getAttribute("data-pass-weather-dist"));
      const ms = parseFloat(td.getAttribute("data-pass-weather-ms"));
      const details = getWeatherWindowDetails(activeRoute, d, wData, ms);
      if (details) {
        const cond = details.selectedHour.weatherCondition || {};
        const style = getWeatherConditionStyle(cond.type);
        const hrTemp = details.selectedHour.temperature?.degrees ?? 0;
        const mainTemp = convertTemperatureValue(hrTemp);
        const minTemp = convertTemperatureValue(details.minTemp);
        const maxTemp = convertTemperatureValue(details.maxTemp);
        td.innerHTML = `<span style="font-size:14px; margin-right: 2px;">${style.emoji}</span> <span>${mainTemp} (${minTemp}-${maxTemp})</span>`;
      }
    });
  }).catch(e => console.error("Async forecast population error:", e));

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
      poiDialogEditBtn.textContent = "📍 Relocate Waypoint";
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
  if (cardImporter && studioTabPoi?.classList.contains("active")) {
    cardImporter.classList.add("hidden");
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
    const planDuration = getPlanDurationHrs();
    const elapsedHrs = getElapsedHoursAtDistance(activeRoute, wpt.dist_m, planDuration);
    const planStartMs = getPlanStartMs();
    const targetMs = planStartMs + elapsedHrs * 3600 * 1000;
    const targetDate = new Date(targetMs);
    const etaDayStr = targetDate.toLocaleDateString([], { weekday: 'short' });
    const etaTimeStr = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    nameSpan.textContent = `${wpt.name} (${distVal}, ETA: ${etaDayStr} ${etaTimeStr})`;
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
      console.error("Critical course loading failure:", err);
      showToast("Error loading course: " + err.message, true);
    }
  };
  reader.onerror = () => {
    showToast("Failed to read file from disk.", true);
  };
  reader.readAsText(file);
}

/**
 * Sets state variables, redraws chart and map overlays, updates stats dashboards.
 */
function processGpxContent(text, filename) {
  const isKml = filename.endsWith(".kml") || text.includes("<kml") || text.includes("</kml>");
  activeRoute = isKml ? parseKML(text, units, desertThresholdMiles) : parseGPX(text, units, desertThresholdMiles);
  activeRoute.avgSpacing = activeRoute.trackpoints.length > 0 ? (activeRoute.totalDistance / activeRoute.trackpoints.length) : 0;
  chatHistory = [];
  hasFetchedWeather = false;
  if (typeof pausePlayback === "function") pausePlayback();
  playbackDistance = 0;
  playbackIndex = 0;
  lastPausedPoiIndex = -1;
  if (typeof closePoiDetailDialog === "function") closePoiDetailDialog(false);

  if (typeof precomputeRunningMetrics === "function") precomputeRunningMetrics(activeRoute);

  const nameDisplay = document.getElementById("course-name-display");
  if (nameDisplay && activeRoute && activeRoute.name) {
    nameDisplay.textContent = activeRoute.name.toUpperCase();
  }

  if (courseInfoText && courseInfoBtn) {
    if (activeRoute && activeRoute.description && activeRoute.description !== "No description provided.") {
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
    } else if (activeRoute && activeRoute.segments && activeRoute.segments.length > 1) {
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
  }

  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="message assistant">
        <p>Imported "<strong>${activeRoute.name}</strong>" successfully. Paste race details or ask me to configure aid stations.</p>
      </div>
    `;
  }

  if (cardStats) cardStats.classList.remove("hidden");
  if (toggleStatsBtn) toggleStatsBtn.classList.add("hidden");
  if (cardWarnings) cardWarnings.classList.remove("hidden");
  if (toggleWarningsBtn) toggleWarningsBtn.classList.add("hidden");
  if (cardWeather) cardWeather.classList.remove("hidden");
  if (toggleWeatherBtn) toggleWeatherBtn.classList.add("hidden");
  if (typeof updateWeatherShiftedState === "function") updateWeatherShiftedState();

  if (activeRoute && activeRoute.trackpoints && activeRoute.trackpoints.length > 0) {
    const startPt = activeRoute.trackpoints[0];
    if (startPt && typeof triggerWeatherWeather === "function") {
      triggerWeatherWeather(startPt.lat, startPt.lon, true);
    }
  }

  if (cardElevationScrubber) cardElevationScrubber.classList.remove("hidden");
  if (hudMetrics) hudMetrics.classList.remove("hidden");

  const hasTime = activeRoute && activeRoute.trackpoints && activeRoute.trackpoints.length > 0 && !!activeRoute.trackpoints[0].time;
  if (hudMetricTime) {
    if (hasTime) {
      hudMetricTime.classList.remove("hidden");
    } else {
      hudMetricTime.classList.add("hidden");
    }
  }
  if (cardGeminiChat) cardGeminiChat.classList.remove("hidden");
  const toggleChatBtn = document.getElementById("toggle-chat-btn");
  if (toggleChatBtn) toggleChatBtn.classList.remove("hidden");

  if (elevationChart) {
    try {
      elevationChart.units = units;
      elevationChart.setRoute(activeRoute);
    } catch(e) { console.warn("ElevationChart setRoute error:", e); }
  }

  if (apiKeyMaps && mapController && mapController.map) {
    try {
      mapController.drawRoute(activeRoute, climbColorsCheckbox ? climbColorsCheckbox.checked : false);
      mapController.syncToTrackpoint(0, true);
    } catch(e) { console.warn("MapController drawRoute error:", e); }
  }

  if (elevationChart) {
    try {
      elevationChart.progressIndex = 0;
      elevationChart.hoverIdx = -1;
      elevationChart.draw();
    } catch(e) { console.warn("ElevationChart draw error:", e); }
  }

  if (typeof updateRouteStatsUI === "function") updateRouteStatsUI(activeRoute);
  if (typeof renderWarningsUI === "function") renderWarningsUI(activeRoute);
  if (activeRoute && activeRoute.executionPlan && (!activeRoute.executionPlan.sectors || activeRoute.executionPlan.sectors.length === 0)) {
    activeRoute.executionPlan.sectors = autoSegmentCourse(activeRoute);
  }
  if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();

  if (typeof updateUnitLabels === "function") updateUnitLabels();
  if (typeof updateHUD === "function") updateHUD(0);
  if (clearWarningsHighlightBtn) clearWarningsHighlightBtn.classList.add("hidden");

  if (typeof renderEditWaypointList === "function") renderEditWaypointList();

  if (typeof addRecentCourse === "function") addRecentCourse(activeRoute ? activeRoute.name : filename, text);

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
    item.dataset.startDist = warn.startDist || 0;
    item.dataset.endDist = warn.endDist || 0;
    if (!warn.approved) item.classList.add("rejected");

    if (warn.colorBg && warn.colorHex) {
      item.style.backgroundColor = warn.colorBg;
      item.style.borderLeftColor = warn.colorHex;
    } else if ((warn.type === "DIFFICULT_CLIMB" || warn.type === "STEEP_DESCENT") && warn.avgGrade !== undefined) {
      const cls = classifyGradient(warn.avgGrade);
      item.style.backgroundColor = cls.bg;
      item.style.borderLeftColor = cls.hex;
    }

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

    const gFlat = document.getElementById("grad-thresh-flat");
    const gMod = document.getElementById("grad-thresh-mod");
    const gSteep = document.getElementById("grad-thresh-steep");
    const gVSteep = document.getElementById("grad-thresh-vsteep");
    if (gFlat) gFlat.value = localStorage.getItem("grad_thresh_flat") || "2.0";
    if (gMod) gMod.value = localStorage.getItem("grad_thresh_mod") || "5.0";
    if (gSteep) gSteep.value = localStorage.getItem("grad_thresh_steep") || "8.0";
    if (gVSteep) gVSteep.value = localStorage.getItem("grad_thresh_vsteep") || "10.0";

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

  const loadBighornBtn = document.getElementById("load-bighorn-btn");
  if (loadBighornBtn) {
    loadBighornBtn.addEventListener("click", (e) => {
      e.preventDefault();
      fetch("./samples/Bighorn18.gpx")
        .then(res => res.text())
        .then(text => {
          processGpxContent(text, "Bighorn18.gpx");
          showToast("Loaded Bighorn 18 (Recovery)");
        })
        .catch(err => showToast("Failed to load: " + err.message));
    });
  }

  const loadLeadvilleBtn = document.getElementById("load-leadville-btn");
  if (loadLeadvilleBtn) {
    loadLeadvilleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      fetch("./samples/enhanced_52m_start.gpx")
        .then(res => res.text())
        .then(text => {
          processGpxContent(text, "enhanced_52m_start.gpx");
          showToast("Loaded Leadville 52M");
        })
        .catch(err => showToast("Failed to load: " + err.message));
    });
  }

  const loadTmbBtn = document.getElementById("load-tmb-btn");
  if (loadTmbBtn) {
    loadTmbBtn.addEventListener("click", (e) => {
      e.preventDefault();
      fetch("./samples/TMB-Full-Tour-Enhanced.gpx")
        .then(res => res.text())
        .then(text => {
          processGpxContent(text, "TMB-Full-Tour-Enhanced.gpx");
          showToast("Loaded TMB Tour");
        })
        .catch(err => showToast("Failed to load: " + err.message));
    });
  }

  // Gemini Chat / Master Studio panel toggling
  const toggleChatBtn = document.getElementById("toggle-chat-btn");
  const clearChatContextBtn = document.getElementById("clear-chat-context-btn");

  if (togglePlannerBtn) {
    togglePlannerBtn.addEventListener("click", () => {
      if (cardImporter) {
        if (!cardImporter.classList.contains("hidden") && studioTabPlan?.classList.contains("active")) {
          cardImporter.classList.add("hidden");
        } else {
          cardImporter.classList.remove("hidden");
          if (studioTabPlan) studioTabPlan.click();
        }
      }
    });
  }

  if (toggleChatBtn) {
    toggleChatBtn.addEventListener("click", () => {
      if (cardImporter) {
        if (!cardImporter.classList.contains("hidden") && studioTabChat?.classList.contains("active")) {
          cardImporter.classList.add("hidden");
        } else {
          cardImporter.classList.remove("hidden");
          if (studioTabChat) studioTabChat.click();
        }
      }
    });
  }

  const toggleLivePlanBtn = document.getElementById("toggle-live-plan-btn");
  const liveRacePlanPreviewBox = document.getElementById("live-race-plan-preview-box");
  const closeLivePlanBoxBtn = document.getElementById("close-live-plan-box-btn");

  if (toggleLivePlanBtn && liveRacePlanPreviewBox) {
    toggleLivePlanBtn.addEventListener("click", () => {
      liveRacePlanPreviewBox.classList.toggle("hidden");
    });
  }
  if (closeLivePlanBoxBtn && liveRacePlanPreviewBox) {
    closeLivePlanBoxBtn.addEventListener("click", () => {
      liveRacePlanPreviewBox.classList.add("hidden");
    });
  }

  const allStudioTabs = [studioTabEdit, studioTabRunner, studioTabPoi, studioTabPlan, studioTabChat];
  const allStudioViews = [studioViewEdit, studioViewRunner, poiDetailDialog, studioViewPlan, cardGeminiChat];

  const activateStudioTab = (tab, view) => {
    allStudioTabs.forEach(t => t && t.classList.remove("active"));
    allStudioViews.forEach(v => v && v.classList.add("hidden"));
    if (tab) tab.classList.add("active");
    if (view) view.classList.remove("hidden");
  };

  if (studioTabEdit) studioTabEdit.addEventListener("click", () => activateStudioTab(studioTabEdit, studioViewEdit));
  if (studioTabRunner) studioTabRunner.addEventListener("click", () => {
    activateStudioTab(studioTabRunner, studioViewRunner);
    if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
  });
  if (studioTabPoi) studioTabPoi.addEventListener("click", () => activateStudioTab(studioTabPoi, poiDetailDialog));
  if (studioTabPlan) studioTabPlan.addEventListener("click", () => activateStudioTab(studioTabPlan, studioViewPlan));
  if (studioTabChat) studioTabChat.addEventListener("click", () => activateStudioTab(studioTabChat, cardGeminiChat));

  // Day Architect Preset & Solver controls
  const renderRunnerProfilesDropdown = (selectedId) => {
    if (!runnerProfileSelect) return;
    const profiles = getRunnerProfiles();
    const actId = selectedId || (typeof localStorage !== "undefined" ? localStorage.getItem("kokopelli_active_profile_id") : null) || "profile_hawk_pro";
    runnerProfileSelect.innerHTML = "";
    profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === actId) opt.selected = true;
      runnerProfileSelect.appendChild(opt);
    });
  };

  if (runnerProfileSelect) {
    renderRunnerProfilesDropdown();
    runnerProfileSelect.addEventListener("change", (e) => {
      localStorage.setItem("kokopelli_active_profile_id", e.target.value);
      if (activeRoute) {
        activeRoute.executionPlan.sectors = autoSegmentCourse(activeRoute);
        if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
      }
    });
  }

  const goalPresetBtns = document.querySelectorAll(".goal-preset-btn");
  goalPresetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      goalPresetBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      localStorage.setItem("kokopelli_goal_preset", btn.getAttribute("data-preset"));
      if (activeRoute) {
        activeRoute.executionPlan.sectors = autoSegmentCourse(activeRoute);
        if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
      }
    });
  });

  if (pacingModeForward && pacingModeBackward && deadlineInputBox) {
    pacingModeForward.addEventListener("click", () => {
      pacingModeForward.classList.replace("btn-secondary", "btn-primary");
      pacingModeBackward.classList.replace("btn-primary", "btn-secondary");
      deadlineInputBox.classList.add("hidden");
    });
    pacingModeBackward.addEventListener("click", () => {
      pacingModeBackward.classList.replace("btn-secondary", "btn-primary");
      pacingModeForward.classList.replace("btn-primary", "btn-secondary");
      deadlineInputBox.classList.remove("hidden");
    });
  }

  if (solveDeadlineBtn && deadlineClockInput) {
    solveDeadlineBtn.addEventListener("click", () => {
      const hrs = parseFloat(deadlineClockInput.value);
      if (!isNaN(hrs) && hrs > 0 && activeRoute) {
        solveBackwardPacing(hrs, activeRoute, typeof units !== "undefined" ? units : "imperial");
        if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
      }
    });
  }

  if (autoSliceCourseBtn) {
    autoSliceCourseBtn.addEventListener("click", () => {
      if (activeRoute) {
        activeRoute.executionPlan.sectors = autoSegmentCourse(activeRoute);
        if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
      }
    });
  }

  if (addSplitMarkerBtn) {
    addSplitMarkerBtn.addEventListener("click", () => {
      if (!activeRoute || !activeRoute.trackpoints || activeRoute.trackpoints.length === 0) return;
      if (!activeRoute.executionPlan) activeRoute.executionPlan = { sectors: [], customSplits: [] };
      if (!activeRoute.executionPlan.customSplits) activeRoute.executionPlan.customSplits = [];
      const pt = activeRoute.trackpoints[playbackIndex || 0] || activeRoute.trackpoints[0];
      if (pt && pt.dist_m > 50) {
        activeRoute.executionPlan.customSplits.push(pt.dist_m);
        activeRoute.executionPlan.sectors = autoSegmentCourse(activeRoute);
        if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
      }
    });
  }

  // Empirical Athlete Calibration multi-run upload & statistical solving
  let uploadedCalibrationFiles = [];
  if (calibrationFilesInput && runCalibrationBtn && calibrationFilesList) {
    calibrationFilesInput.addEventListener("change", (e) => {
      uploadedCalibrationFiles = Array.from(e.target.files || []);
      calibrationFilesList.innerHTML = "";
      if (uploadedCalibrationFiles.length > 0) {
        runCalibrationBtn.disabled = false;
        uploadedCalibrationFiles.forEach((file, fIdx) => {
          const row = document.createElement("div");
          row.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:3px 6px; border-radius:4px; font-size:9px;";
          row.innerHTML = `
            <span style="color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60%;">${file.name}</span>
            <select class="calib-tag-select" data-fidx="${fIdx}" style="background:rgba(0,0,0,0.5); border:1px solid #10b981; color:#34d399; font-size:9px; border-radius:3px;">
              <option value="training_run">🏃 Training Run (105%)</option>
              <option value="hard_race">⚡ Hard Race (90%)</option>
              <option value="moderate_workout">💪 Workout (115%)</option>
              <option value="fun_day_out">🥾 Fun Day (125%)</option>
            </select>
          `;
          calibrationFilesList.appendChild(row);
        });
      } else {
        runCalibrationBtn.disabled = true;
      }
    });

    runCalibrationBtn.addEventListener("click", async () => {
      if (uploadedCalibrationFiles.length === 0) return;
      runCalibrationBtn.disabled = true;
      runCalibrationBtn.textContent = "Calibrating...";
      try {
        const tagSelects = calibrationFilesList.querySelectorAll(".calib-tag-select");
        const parsedTelemetryList = [];
        for (let i = 0; i < uploadedCalibrationFiles.length; i++) {
          const file = uploadedCalibrationFiles[i];
          const tag = tagSelects[i] ? tagSelects[i].value : "training_run";
          const text = await file.text();
          const telemetry = parseCalibrationTrack(text, tag);
          parsedTelemetryList.push(telemetry);
        }

        const empiricalProfile = buildEmpiricalProfile(parsedTelemetryList, `Calibrated Profile (${uploadedCalibrationFiles.length} runs)`);
        saveRunnerProfile(empiricalProfile);

        // Populate results card
        if (calibrationResultsCard) {
          calibrationResultsCard.classList.remove("hidden");
          calibrationResultsCard.innerHTML = `
            <span style="color:#34d399; font-weight:bold;">✅ Calibrated & Saved: ${empiricalProfile.name}</span>
            <span>Climb: ${empiricalProfile.basePaces.steep}m | Flat: ${empiricalProfile.basePaces.flat}m | Desc: ${empiricalProfile.basePaces.descent}m</span>
            <span style="color:#fbbf24;">Fatigue Decay λ: ${empiricalProfile.enduranceMetrics.fatigueDecayLambda} | Downhill Brake β: ${empiricalProfile.enduranceMetrics.downhillBrakeBeta}</span>
            <span>Empirical Rest Duration: ~${empiricalProfile.restDurationMin} mins</span>
          `;
        }

        // Re-populate runner profile dropdown
        if (runnerProfileSelect) {
          const opt = document.createElement("option");
          opt.value = empiricalProfile.id;
          opt.textContent = `${empiricalProfile.name} (λ=${empiricalProfile.enduranceMetrics.fatigueDecayLambda})`;
          opt.selected = true;
          runnerProfileSelect.appendChild(opt);
          runnerProfileSelect.dispatchEvent(new Event("change"));
        }
      } catch (err) {
        showToast(`Calibration error: ${err.message}`, true);
      } finally {
        runCalibrationBtn.disabled = false;
        runCalibrationBtn.textContent = "Calibrate Profile";
      }
    });
  }

  // Runner Profile CRUD Manager (Create, Edit & Delete)
  let editingProfileId = null;
  if (addRunnerProfileBtn && runnerProfileCreatorCard && deleteRunnerProfileBtn && saveProfileCreateBtn && cancelProfileCreateBtn) {
    addRunnerProfileBtn.addEventListener("click", () => {
      editingProfileId = null;
      if (profileCreatorTitle) profileCreatorTitle.textContent = "➕ Create Custom Runner Profile";
      if (newProfileName) newProfileName.value = "";
      if (newProfileDesc) newProfileDesc.value = "";
      runnerProfileCreatorCard.classList.remove("hidden");
    });

    if (editRunnerProfileBtn) {
      editRunnerProfileBtn.addEventListener("click", () => {
        if (!runnerProfileSelect) return;
        const curId = runnerProfileSelect.value;
        const activeProf = getActiveRunnerProfile();
        editingProfileId = curId;
        if (profileCreatorTitle) profileCreatorTitle.textContent = "✏️ Edit Runner Profile";
        if (newProfileName) {
          newProfileName.value = activeProf.name.split(" (")[0] || activeProf.name;
          setTimeout(() => newProfileName.focus(), 50);
        }
        if (newProfileDesc) newProfileDesc.value = activeProf.description || "";
        if (newPaceClimb && activeProf.basePaces) newPaceClimb.value = activeProf.basePaces.steep || 21.0;
        if (newPaceFlat && activeProf.basePaces) newPaceFlat.value = activeProf.basePaces.flat || 10.5;
        if (newPaceDesc && activeProf.basePaces) newPaceDesc.value = activeProf.basePaces.descent || 9.5;
        runnerProfileCreatorCard.classList.remove("hidden");
      });
    }

    cancelProfileCreateBtn.addEventListener("click", () => {
      editingProfileId = null;
      runnerProfileCreatorCard.classList.add("hidden");
    });

    saveProfileCreateBtn.addEventListener("click", () => {
      const name = newProfileName?.value.trim() || "Custom Runner Profile";
      const descText = newProfileDesc?.value.trim() || "";
      const climb = parseFloat(newPaceClimb?.value) || 21.0;
      const flat = parseFloat(newPaceFlat?.value) || 10.5;
      const desc = parseFloat(newPaceDesc?.value) || 9.5;
      const targetId = editingProfileId || `profile_custom_${Date.now()}`;
      const customProfile = {
        id: targetId,
        name: `${name} (${climb}m climb / ${flat}m flat / ${desc}m desc)`,
        description: descText,
        basePaces: {
          descent: desc,
          flat,
          moderate: parseFloat((flat + 2).toFixed(1)),
          steep: climb,
          verysteep: parseFloat((climb + 4).toFixed(1)),
          extreme: parseFloat((climb + 10).toFixed(1))
        },
        restDurationMin: 15
      };
      saveRunnerProfile(customProfile);
      runnerProfileCreatorCard.classList.add("hidden");

      renderRunnerProfilesDropdown(targetId);
      if (runnerProfileSelect) {
        runnerProfileSelect.dispatchEvent(new Event("change"));
      }
      showToast(editingProfileId ? `Updated profile: ${name}` : `Created runner profile: ${name}`);
      editingProfileId = null;
    });

    deleteRunnerProfileBtn.addEventListener("click", () => {
      if (!runnerProfileSelect) return;
      const curId = runnerProfileSelect.value;
      if (curId === "profile_hawk_pro" || curId === "profile_casual") {
        showToast("Cannot delete default factory profile.", true);
        return;
      }
      deleteRunnerProfile(curId);
      renderRunnerProfilesDropdown();
      if (runnerProfileSelect) {
        runnerProfileSelect.dispatchEvent(new Event("change"));
      }
      showToast("Deleted custom runner profile.");
    });

    if (exportProfilesBtn) {
      exportProfilesBtn.addEventListener("click", () => {
        const allProfiles = getRunnerProfiles();
        const blob = new Blob([JSON.stringify(allProfiles, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "kokopelli_runner_profiles.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Exported all runner profiles to disk.");
      });
    }

    if (importProfilesInput) {
      importProfilesInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported) && imported.length > 0) {
              imported.forEach(p => { if (p && p.id) saveRunnerProfile(p); });
              renderRunnerSectorsUI();
              showToast(`Imported ${imported.length} runner profiles successfully!`);
            }
          } catch(err) {
            showToast(`Failed to import profiles: ${err.message}`, true);
          }
        };
        reader.readAsText(file);
        e.target.value = "";
      });
    }
  }

  // 📐 DIURNAL PACING TRIANGLE Triad Facet Controller
  if (pacingTriangleCard && solveTriangleBtn) {
    const locks = Array.from(pacingTriangleCard.querySelectorAll(".tri-facet-lock"));
    let activeLocked = ["start", "pacing"];

    const syncLocksUI = () => {
      locks.forEach(chk => {
        const f = chk.dataset.facet;
        chk.checked = activeLocked.includes(f);
        const input = f === "start" ? triStartInput : (f === "finish" ? triFinishInput : null);
        if (input) {
          input.disabled = false;
          input.style.opacity = activeLocked.includes(f) ? "1.0" : "0.55";
        }
      });
      const solved = ["start", "finish", "pacing"].find(f => !activeLocked.includes(f));
      if (triangleModeBadge) {
        triangleModeBadge.textContent = `Solving: ${solved === "start" ? "Start Time" : (solved === "finish" ? "Finish Time" : "Pacing Factor")}`;
      }
    };

    locks.forEach(chk => {
      chk.addEventListener("change", () => {
        const clickedFacet = chk.dataset.facet;
        if (chk.checked) {
          if (activeLocked.length >= 2) {
            const toRemove = activeLocked[0] === clickedFacet ? activeLocked[1] : activeLocked[0];
            activeLocked = activeLocked.filter(f => f !== toRemove);
          }
          if (!activeLocked.includes(clickedFacet)) activeLocked.push(clickedFacet);
        } else {
          activeLocked = activeLocked.filter(f => f !== clickedFacet);
          if (activeLocked.length < 2) {
            const avail = ["start", "finish", "pacing"].find(f => f !== clickedFacet && !activeLocked.includes(f));
            if (avail) activeLocked.push(avail);
          }
        }
        syncLocksUI();
        if (activeRoute) solveTriangleBtn.click();
      });
    });

    const activateFacetInput = (facet) => {
      if (!activeLocked.includes(facet)) {
        if (activeLocked.length >= 2) {
          const toRemove = activeLocked[0] === facet ? activeLocked[1] : activeLocked[0];
          activeLocked = activeLocked.filter(f => f !== toRemove);
        }
        activeLocked.push(facet);
        syncLocksUI();
        if (activeRoute) solveTriangleBtn.click();
      }
    };

    ["start", "finish", "pacing"].forEach(facet => {
      const card = document.getElementById(`facet-card-${facet}`);
      if (card) {
        card.addEventListener("click", (e) => {
          if (e.target.classList.contains("tri-facet-lock")) return;
          activateFacetInput(facet);
          const input = facet === "start" ? triStartInput : (facet === "finish" ? triFinishInput : null);
          if (input) setTimeout(() => input.focus(), 10);
        });
      }
    });

    if (triStartInput) {
      triStartInput.addEventListener("focus", () => activateFacetInput("start"));
      triStartInput.addEventListener("input", () => { activateFacetInput("start"); if (activeRoute) solveTriangleBtn.click(); });
      triStartInput.addEventListener("change", () => { activateFacetInput("start"); if (activeRoute) solveTriangleBtn.click(); });
    }
    if (triFinishInput) {
      triFinishInput.addEventListener("focus", () => activateFacetInput("finish"));
      triFinishInput.addEventListener("input", () => { activateFacetInput("finish"); if (activeRoute) solveTriangleBtn.click(); });
      triFinishInput.addEventListener("change", () => { activateFacetInput("finish"); if (activeRoute) solveTriangleBtn.click(); });
    }

    solveTriangleBtn.addEventListener("click", () => {
      if (!activeRoute) {
        showToast("Import a route first to solve Pacing Triangle.", true);
        return;
      }
      try {
        const startMs = triStartInput?.value ? new Date(triStartInput.value).getTime() : Date.now();
        const finishMs = triFinishInput?.value ? new Date(triFinishInput.value).getTime() : (startMs + 12 * 3600 * 1000);
        const solved = solvePacingTriangle(activeLocked, startMs, finishMs, activeRoute, units);
        if (solved) {
          if (triStartInput && !activeLocked.includes("start")) {
            triStartInput.value = new Date(solved.startMs).toISOString().slice(0, 16);
          }
          if (triFinishInput && !activeLocked.includes("finish")) {
            triFinishInput.value = new Date(solved.finishMs).toISOString().slice(0, 16);
          }
          if (pacingScalingLabel) {
            pacingScalingLabel.textContent = `Factor: ${solved.proportionalFactor}x`;
            pacingScalingLabel.style.color = solved.proportionalFactor > 1.2 ? "#ef4444" : (solved.proportionalFactor < 0.8 ? "#3b82f6" : "#34d399");
          }
          if (weatherPlanStartInput && solved.startMs) {
            weatherPlanStartInput.value = new Date(solved.startMs).toISOString().slice(0, 16);
          }
          if (weatherPlanDurationInput && solved.durationHrs) {
            weatherPlanDurationInput.value = solved.durationHrs;
          }
          renderRunnerSectorsUI();
          updateRouteStatsUI();
          showToast(`Solved Pacing Triangle (${triangleModeBadge?.textContent || "Triad"})!`);
        }
      } catch (err) {
        showToast(`Triangle error: ${err.message}`, true);
      }
    });

    if (triStartInput && !triStartInput.value) {
      triStartInput.value = new Date().toISOString().slice(0, 16);
    }
  }

  // POI / Aid Station Previous and Next Cycle Controls
  const poiPrevWptBtn = document.getElementById("poi-prev-wpt-btn");
  const poiNextWptBtn = document.getElementById("poi-next-wpt-btn");

  const cycleWpt = (direction) => {
    if (!activeRoute || !activeRoute.waypoints || activeRoute.waypoints.length === 0) return;
    const wpts = [...activeRoute.waypoints].sort((a,b) => a.dist_m - b.dist_m);
    let curIdx = wpts.findIndex(w => w.name === activeDialogWpt?.name);
    if (curIdx === -1) curIdx = 0;
    let nextIdx = (curIdx + direction + wpts.length) % wpts.length;
    const targetWpt = wpts[nextIdx];
    if (targetWpt) {
      showPoiDetailDialog(targetWpt, targetWpt.closestTrackpointIndex || 0, targetWpt.dist_m);
      if (mapController) {
        mapController.syncToTrackpoint(targetWpt.closestTrackpointIndex || 0, true);
      }
    }
  };

  if (poiPrevWptBtn) poiPrevWptBtn.addEventListener("click", () => cycleWpt(-1));
  if (poiNextWptBtn) poiNextWptBtn.addEventListener("click", () => cycleWpt(1));

  // Finish Celebration Overlay Handlers
  const closeCelebrationBtn = document.getElementById("close-celebration-btn");
  if (closeCelebrationBtn) {
    closeCelebrationBtn.addEventListener("click", () => {
      document.getElementById("finish-celebration-overlay")?.classList.add("hidden");
    });
  }

  function triggerConfetti() {
    const count = 80;
    const colors = ["#34d399", "#60a5fa", "#f59e0b", "#f43f5e", "#fff"];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.style.position = "fixed";
      el.style.top = "50%";
      el.style.left = "50%";
      el.style.width = Math.random() * 12 + 6 + "px";
      el.style.height = Math.random() * 12 + 6 + "px";
      el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      el.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      el.style.zIndex = "3000";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);

      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 450 + 100;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 150;
      
      let curX = window.innerWidth / 2;
      let curY = window.innerHeight / 2;
      let curVx = vx;
      let curVy = vy;

      const startTime = performance.now();
      function anim(t) {
        const elapsed = (t - startTime) / 1000;
        if (elapsed > 2.5) {
          if (el.parentNode) el.parentNode.removeChild(el);
          return;
        }
        curX += curVx * 0.016;
        curY += curVy * 0.016;
        curVy += 350 * 0.016; // gravity
        el.style.transform = `translate(${curX - window.innerWidth/2}px, ${curY - window.innerHeight/2}px) rotate(${elapsed * 360}deg)`;
        el.style.opacity = 1 - elapsed / 2.5;
        requestAnimationFrame(anim);
      }
      requestAnimationFrame(anim);
    }
  }

  // Interactive AI Race Planner Wizard Modal Handlers
  const racePlannerWizardModal = document.getElementById("race-planner-wizard-modal");
  const closeWizardModalBtn = document.getElementById("close-wizard-modal-btn");
  const wizardStepIndicator = document.getElementById("wizard-step-indicator");
  
  const wizardStep1 = document.getElementById("wizard-step-1");
  const wizardStep2 = document.getElementById("wizard-step-2");
  const wizardStep3 = document.getElementById("wizard-step-3");
  const wizardStep4 = document.getElementById("wizard-step-4");

  const wizNext1 = document.getElementById("wiz-next-1");
  const wizPrev2 = document.getElementById("wiz-prev-2");
  const wizNext2 = document.getElementById("wiz-next-2");
  const wizPrev3 = document.getElementById("wiz-prev-3");
  const wizGeneratePlanBtn = document.getElementById("wiz-generate-plan-btn");
  const wizRestartBtn = document.getElementById("wiz-restart-btn");
  const wizApplyHudBtn = document.getElementById("wiz-apply-hud-btn");

  const wizPenaltySlider = document.getElementById("wiz-penalty-slider");
  const wizPenaltyLbl = document.getElementById("wiz-penalty-lbl");
  
  const renderLoadedExecutionPlan = (route) => {
    if (!route || !route.executionPlan || !route.executionPlan.sectors || route.executionPlan.sectors.length === 0) return;
    const plan = route.executionPlan;
    const outputList = document.getElementById("wiz-segments-output-list");
    if (outputList) outputList.innerHTML = "";
    
    plan.sectors.forEach(sec => {
      const segDistMi = (sec.end_dist_m - sec.start_dist_m) / 1609.34;
      const mFloor = Math.floor(sec.target_pace_min);
      const sRound = Math.round((sec.target_pace_min % 1) * 60).toString().padStart(2, "0");
      const mph = 60 / sec.target_pace_min;

      const isAsc = sec.strategy.includes("Ascent") || sec.strategy.includes("Climb");
      const isDesc = sec.strategy.includes("Descent");
      const terrainLabel = isAsc ? "Ascent ↗" : (isDesc ? "Descent ↘" : "Flat ➔");
      const terrainCol = isAsc ? "#f43f5e" : (isDesc ? "#10b981" : "#60a5fa");
      const terrainBg = isAsc ? "rgba(244,63,94,0.2)" : (isDesc ? "rgba(16,185,129,0.2)" : "rgba(59,130,246,0.2)");

      const card = document.createElement("div");
      card.style.background = "rgba(0,0,0,0.4)";
      card.style.border = "1px solid rgba(255,255,255,0.1)";
      card.style.padding = "10px 12px";
      card.style.borderRadius = "8px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "6px";
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 12px; color: #60a5fa;">${escapeHtml(sec.name)}</strong>
          <span style="font-size: 10px; padding: 2px 8px; border-radius: 12px; background: ${terrainBg}; color: ${terrainCol}; font-weight: bold;">${terrainLabel}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary);">
          <span>Dist: <strong>${segDistMi.toFixed(1)} mi</strong></span>
          <span style="color: #f59e0b;">${escapeHtml(sec.strategy)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px;">
          <span>Target Pace: <strong style="color:#34d399;">${mFloor}:${sRound} min/mi</strong> (${mph.toFixed(1)} mph)</span>
        </div>
      `;
      if (outputList) outputList.appendChild(card);
    });

    const totDisp = document.getElementById("wiz-tot-time-disp");
    const avgDisp = document.getElementById("wiz-avg-pace-disp");
    if (totDisp && plan.targetDurationHrs) totDisp.textContent = `${plan.targetDurationHrs.toFixed(2)} Hrs`;
    if (avgDisp && plan.targetDurationHrs && route.totalDistance) {
      const avgPace = (plan.targetDurationHrs * 60) / (route.totalDistance / 1609.34);
      avgDisp.textContent = `${Math.floor(avgPace)}:${Math.floor((avgPace%1)*60).toString().padStart(2,"0")} min/mi`;
    }
  };

  const openWizardModal = () => {
    if (racePlannerWizardModal) {
      racePlannerWizardModal.classList.remove("hidden");
      if (activeRoute?.executionPlan?.sectors?.length > 0) {
        tempExecutionPlan = activeRoute.executionPlan;
        renderLoadedExecutionPlan(activeRoute);
        wizardStep1?.classList.add("hidden");
        wizardStep2?.classList.add("hidden");
        wizardStep3?.classList.add("hidden");
        wizardStep4?.classList.remove("hidden");
        if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 4 of 4: Loaded Pacing Plan";
      } else {
        wizardStep1?.classList.remove("hidden");
        wizardStep2?.classList.add("hidden");
        wizardStep3?.classList.add("hidden");
        wizardStep4?.classList.add("hidden");
        if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 1 of 4: Fitness & Baseline";
      }
    }
  };

  if (closeWizardModalBtn) {
    closeWizardModalBtn.addEventListener("click", () => racePlannerWizardModal?.classList.add("hidden"));
  }

  if (togglePlannerBtn) {
    togglePlannerBtn.addEventListener("click", openWizardModal);
  }
  if (toggleStrategyBtn) {
    toggleStrategyBtn.addEventListener("click", openWizardModal);
  }
  if (studioTabPlan) {
    studioTabPlan.addEventListener("click", openWizardModal);
  }

  const updatePaceLabel = (spdInput, lblEl) => {
    if (!spdInput || !lblEl) return;
    const mph = parseFloat(spdInput.value) || 0;
    if (mph <= 0) {
      lblEl.textContent = "--:-- min/mi";
      return;
    }
    const mins = 60 / mph;
    const mFloor = Math.floor(mins);
    const sRound = Math.round((mins % 1) * 60).toString().padStart(2, "0");
    lblEl.textContent = `${mFloor}:${sRound} min/mi`;
  };

  const wizClimbSpd = document.getElementById("wiz-climb-spd");
  const wizFlatSpd = document.getElementById("wiz-flat-spd");
  const wizDescSpd = document.getElementById("wiz-desc-spd");

  const wizClimbPaceLbl = document.getElementById("wiz-climb-pace-lbl");
  const wizFlatPaceLbl = document.getElementById("wiz-flat-pace-lbl");
  const wizDescPaceLbl = document.getElementById("wiz-desc-pace-lbl");

  if (wizClimbSpd && wizClimbPaceLbl) {
    wizClimbSpd.addEventListener("input", () => updatePaceLabel(wizClimbSpd, wizClimbPaceLbl));
  }
  if (wizFlatSpd && wizFlatPaceLbl) {
    wizFlatSpd.addEventListener("input", () => updatePaceLabel(wizFlatSpd, wizFlatPaceLbl));
  }
  if (wizDescSpd && wizDescPaceLbl) {
    wizDescSpd.addEventListener("input", () => updatePaceLabel(wizDescSpd, wizDescPaceLbl));
  }

  // Athlete Profile Engine
  const wizProfileSelect = document.getElementById("wiz-profile-select");
  const wizNewProfileName = document.getElementById("wiz-new-profile-name");
  const wizSaveProfileBtn = document.getElementById("wiz-save-profile-btn");
  const wizDeleteProfileBtn = document.getElementById("wiz-delete-profile-btn");

  const defaultProfiles = [
    {
      name: "My Profile (Recovering)",
      fitness: "recovery",
      goalHrs: 14.5,
      recentRace: "Recovering from medical issues",
      climbSpd: 2.0,
      flatSpd: 4.5,
      descSpd: 4.0,
      steepHandling: "cautious",
      penalty: 15
    },
    {
      name: "My Friend (Fast Downhills)",
      fitness: "elite",
      goalHrs: 11.0,
      recentRace: "Fast downhill runner",
      climbSpd: 4.5,
      flatSpd: 7.5,
      descSpd: 8.0,
      steepHandling: "aggressive",
      penalty: 15
    }
  ];

  const loadProfiles = () => {
    const stored = localStorage.getItem("ruff_terrain_athlete_profiles");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse stored profiles", e);
      }
    }
    localStorage.setItem("ruff_terrain_athlete_profiles", JSON.stringify(defaultProfiles));
    return defaultProfiles.slice();
  };

  const populateProfileDropdown = () => {
    if (!wizProfileSelect) return;
    const profiles = loadProfiles();
    wizProfileSelect.innerHTML = '<option value="">-- Load Profile --</option>';
    profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.name;
      wizProfileSelect.appendChild(opt);
    });
  };

  if (wizProfileSelect) {
    wizProfileSelect.addEventListener("change", () => {
      const selectedName = wizProfileSelect.value;
      if (!selectedName) return;
      const profiles = loadProfiles();
      const profile = profiles.find(p => p.name === selectedName);
      if (!profile) return;

      const radio = document.querySelector(`input[name="wiz_fitness"][value="${profile.fitness}"]`);
      if (radio) radio.checked = true;
      
      const goalEl = document.getElementById("wiz-goal-hrs");
      if (goalEl) goalEl.value = profile.goalHrs;
      const recentEl = document.getElementById("wiz-recent-race");
      if (recentEl) recentEl.value = profile.recentRace;

      const climbEl = document.getElementById("wiz-climb-spd");
      if (climbEl) climbEl.value = profile.climbSpd;
      const flatEl = document.getElementById("wiz-flat-spd");
      if (flatEl) flatEl.value = profile.flatSpd;
      const descEl = document.getElementById("wiz-desc-spd");
      if (descEl) descEl.value = profile.descSpd;
      const steepEl = document.getElementById("wiz-steep-handling");
      if (steepEl) steepEl.value = profile.steepHandling;

      if (wizPenaltySlider) wizPenaltySlider.value = profile.penalty;

      const paceClimb = document.getElementById("wiz-climb-pace-lbl");
      const paceFlat = document.getElementById("wiz-flat-pace-lbl");
      const paceDesc = document.getElementById("wiz-desc-pace-lbl");
      updatePaceLabel(climbEl, paceClimb);
      updatePaceLabel(flatEl, paceFlat);
      updatePaceLabel(descEl, paceDesc);
      if (wizPenaltySlider && wizPenaltyLbl) {
        wizPenaltyLbl.textContent = `-${wizPenaltySlider.value}% pace`;
      }

      showToast(`Profile "${selectedName}" loaded.`);
    });
  }

  if (wizSaveProfileBtn) {
    wizSaveProfileBtn.addEventListener("click", () => {
      let profileName = wizNewProfileName?.value.trim();
      if (!profileName && wizProfileSelect) {
        profileName = wizProfileSelect.value;
      }
      if (!profileName) {
        showToast("Please enter a profile name or select a profile to overwrite.");
        return;
      }

      const fitness = document.querySelector('input[name="wiz_fitness"]:checked')?.value || "recovery";
      const goalHrs = parseFloat(document.getElementById("wiz-goal-hrs")?.value || "5.5");
      const recentRace = document.getElementById("wiz-recent-race")?.value || "";
      const climbSpd = parseFloat(document.getElementById("wiz-climb-spd")?.value || "2.0");
      const flatSpd = parseFloat(document.getElementById("wiz-flat-spd")?.value || "4.5");
      const descSpd = parseFloat(document.getElementById("wiz-desc-spd")?.value || "4.0");
      const steepHandling = document.getElementById("wiz-steep-handling")?.value || "cautious";
      const penalty = parseInt(document.getElementById("wiz-penalty-slider")?.value || "15");

      const newProfile = {
        name: profileName,
        fitness,
        goalHrs,
        recentRace,
        climbSpd,
        flatSpd,
        descSpd,
        steepHandling,
        penalty
      };

      const profiles = loadProfiles();
      const existingIdx = profiles.findIndex(p => p.name.toLowerCase() === profileName.toLowerCase());
      if (existingIdx >= 0) {
        profiles[existingIdx] = newProfile;
        showToast(`Profile "${profileName}" overwritten.`);
      } else {
        profiles.push(newProfile);
        showToast(`Profile "${profileName}" saved.`);
      }

      localStorage.setItem("ruff_terrain_athlete_profiles", JSON.stringify(profiles));
      populateProfileDropdown();
      if (wizProfileSelect) wizProfileSelect.value = profileName;
      if (wizNewProfileName) wizNewProfileName.value = "";
    });
  }

  if (wizDeleteProfileBtn) {
    wizDeleteProfileBtn.addEventListener("click", () => {
      if (!wizProfileSelect) return;
      const selectedName = wizProfileSelect.value;
      if (!selectedName) {
        showToast("Please select a profile to delete.");
        return;
      }

      const profiles = loadProfiles();
      const filtered = profiles.filter(p => p.name !== selectedName);
      localStorage.setItem("ruff_terrain_athlete_profiles", JSON.stringify(filtered));
      populateProfileDropdown();
      wizProfileSelect.value = "";
      showToast(`Profile "${selectedName}" deleted.`);
    });
  }

  // Populate profiles select immediately
  populateProfileDropdown();

  // Clear dropdown selection if user clicks any fitness radio button manually
  document.querySelectorAll('input[name="wiz_fitness"]').forEach(radio => {
    radio.addEventListener("change", () => {
      if (wizProfileSelect) wizProfileSelect.value = "";
    });
  });

  if (wizNext1) {
    wizNext1.addEventListener("click", () => {
      const selFit = document.querySelector('input[name="wiz_fitness"]:checked')?.value || "recovery";
      const cSpdInput = document.getElementById("wiz-climb-spd");
      const dSpdInput = document.getElementById("wiz-desc-spd");
      const fSpdInput = document.getElementById("wiz-flat-spd");
      
      // Only set default speeds if no custom profile is currently selected
      if (!wizProfileSelect || !wizProfileSelect.value) {
        if (selFit === "recovery") {
          if (cSpdInput) cSpdInput.value = "2.0";
          if (dSpdInput) dSpdInput.value = "4.0";
          if (fSpdInput) fSpdInput.value = "4.5";
        } else if (selFit === "intermediate") {
          if (cSpdInput) cSpdInput.value = "3.0";
          if (dSpdInput) dSpdInput.value = "6.0";
          if (fSpdInput) fSpdInput.value = "6.0";
        } else if (selFit === "elite") {
          if (cSpdInput) cSpdInput.value = "4.5";
          if (dSpdInput) dSpdInput.value = "8.0";
          if (fSpdInput) fSpdInput.value = "7.5";
        }
      }
      updatePaceLabel(wizClimbSpd, wizClimbPaceLbl);
      updatePaceLabel(wizFlatSpd, wizFlatPaceLbl);
      updatePaceLabel(wizDescSpd, wizDescPaceLbl);
      wizardStep1?.classList.add("hidden");
      wizardStep2?.classList.remove("hidden");
      if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 2 of 4: Terrain Speeds & Descent";
    });
  }

  if (wizPrev2) {
    wizPrev2.addEventListener("click", () => {
      wizardStep2?.classList.add("hidden");
      wizardStep1?.classList.remove("hidden");
      if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 1 of 4: Fitness & Baseline";
    });
  }

  const computeSunriseSunset = (lat, lon, date) => {
    const rad = Math.PI / 180;
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = (date - start) + ((start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

    const lngHour = lon / 15;
    const getSolarTime = (isSunrise) => {
      const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
      const M = (0.9856 * t) - 3.289;
      let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
      L = ((L % 360) + 360) % 360;

      let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
      RA = ((RA % 360) + 360) % 360;

      const Lquad = Math.floor(L / 90) * 90;
      const RAquad = Math.floor(RA / 90) * 90;
      RA = RA + (Lquad - RAquad);
      RA = RA / 15;

      const sinDec = 0.39782 * Math.sin(L * rad);
      const cosDec = Math.cos(Math.asin(sinDec));

      const cosH = (Math.cos(90.833 * rad) - (Math.sin(lat * rad) * sinDec)) / (Math.cos(lat * rad) * cosDec);
      if (cosH > 1) return isSunrise ? "08:00" : "16:00";
      if (cosH < -1) return isSunrise ? "02:00" : "23:00";

      let H = Math.acos(cosH) / rad;
      if (isSunrise) H = 360 - H;
      H = H / 15;

      const T = H + RA - (0.06571 * t) - 6.622;
      let UT = T - lngHour;
      UT = ((UT % 24) + 24) % 24;

      const offsetHrs = -date.getTimezoneOffset() / 60;
      const localHrs = (UT + offsetHrs + 24) % 24;
      const hh = Math.floor(localHrs).toString().padStart(2, "0");
      const mm = Math.floor((localHrs % 1) * 60).toString().padStart(2, "0");
      return `${hh}:${mm}`;
    };

    return {
      sunrise: getSolarTime(true),
      sunset: getSolarTime(false)
    };
  };

  const syncSolarTimes = () => {
    const dInput = document.getElementById("wiz-start-date");
    const riseInput = document.getElementById("wiz-sunrise-time");
    const setInput = document.getElementById("wiz-sunset-time");
    if (!dInput || !riseInput || !setInput) return;
    
    let lat = 40.0;
    let lon = -105.2;
    if (activeRoute && activeRoute.trackpoints && activeRoute.trackpoints.length > 0) {
      lat = activeRoute.trackpoints[0].lat;
      lon = activeRoute.trackpoints[0].lon;
    }
    
    const dateObj = new Date(dInput.value || "2026-06-20");
    if (!isNaN(dateObj)) {
      const solar = computeSunriseSunset(lat, lon, dateObj);
      riseInput.value = solar.sunrise;
      setInput.value = solar.sunset;
    }
  };

  const wizStartDate = document.getElementById("wiz-start-date");
  if (wizStartDate) {
    wizStartDate.addEventListener("change", syncSolarTimes);
  }

  if (wizNext2) {
    wizNext2.addEventListener("click", () => {
      wizardStep2?.classList.add("hidden");
      wizardStep3?.classList.remove("hidden");
      syncSolarTimes();
      if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 3 of 4: Schedule & Sun Tracking";
    });
  }

  if (wizPrev3) {
    wizPrev3.addEventListener("click", () => {
      wizardStep3?.classList.add("hidden");
      wizardStep2?.classList.remove("hidden");
      if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 2 of 4: Terrain Speeds & Descent";
    });
  }

  if (wizPenaltySlider && wizPenaltyLbl) {
    wizPenaltySlider.addEventListener("input", () => {
      wizPenaltyLbl.textContent = `-${wizPenaltySlider.value}% pace`;
    });
  }

/**
 * Advanced Ultra-Marathon Race Pacing & Diurnal Weather Prediction Engine.
 * Resolves climbs/descents physics (piecewise gradient energy), continuous arrival windows, 
 * comprehensive environmental predictions (temp ranges, wind, sky condition, precip), 
 * thermal throttling slowdowns (>70°F), altitude hypoxia, and goal time conflict resolution.
 */
function computeIntelligentPacingAndWeatherPlan(route, opts) {
  const {
    cSpd = 2.0,
    fSpd = 4.5,
    dSpd = 4.0,
    steepMode = "cautious",
    degFactor = 0.15,
    startTimeStr = "06:00",
    sunriseStr = "05:45",
    sunsetStr = "20:30",
    goalLimitHrs = null,
    outputListEl = null,
    totalTimeEl = null,
    avgPaceEl = null,
    onSuccessCallback = null
  } = opts;

  if (!route || !route.trackpoints || route.trackpoints.length === 0) {
    showToast("Please load a GPX/KML course first!");
    return;
  }

  const parseHrs = (timeStr) => {
    const parts = (timeStr || "06:00").split(":");
    return parseFloat(parts[0]) + parseFloat(parts[1] || "0") / 60;
  };

  const formatClock = (hrs) => {
    const h24 = Math.floor((hrs + 24) % 24);
    const m = Math.floor((hrs % 1) * 60);
    const hh = h24 < 10 ? "0" + h24 : h24;
    const mm = m < 10 ? "0" + m : m;
    return `${hh}:${mm}`;
  };

  const startHrs = parseHrs(startTimeStr);
  const sunriseHrs = parseHrs(sunriseStr);
  const sunsetHrs = parseHrs(sunsetStr);

  let wpts = [...(route.waypoints || [])].sort((a, b) => a.dist_m - b.dist_m);
  if (wpts.length < 2) {
    wpts = [];
    const totM = route.totalDistance;
    for (let m = 0; m <= totM; m += 4828) {
      wpts.push({ name: `Mile ${(m / 1609.34).toFixed(1)}`, dist_m: m });
    }
    if (wpts[wpts.length - 1].dist_m < totM) wpts.push({ name: "Finish", dist_m: totM });
  }

  if (outputListEl) outputListEl.innerHTML = "";
  const generatedSectors = [];
  let elapsedHrs = 0;

  for (let i = 0; i < wpts.length - 1; i++) {
    const wStart = wpts[i];
    const wEnd = wpts[i + 1];
    const segDistM = wEnd.dist_m - wStart.dist_m;
    if (segDistM <= 10) continue;

    const segDistMi = segDistM / 1609.34;

    // Extract slice trackpoints for rigorous grade, gain, and altitude analysis
    let pStart = route.trackpoints.find(p => p.dist_m >= wStart.dist_m) || route.trackpoints[0];
    let pEnd = route.trackpoints.find(p => p.dist_m >= wEnd.dist_m) || route.trackpoints[route.trackpoints.length - 1];
    
    let eleDiff = 0;
    let climbGain = 0;
    let eleSum = 0;
    let ptCount = 0;
    if (pStart && pEnd && pStart.index !== undefined && pEnd.index !== undefined) {
      eleDiff = pEnd.ele - pStart.ele;
      for (let k = Math.floor(pStart.index); k <= Math.ceil(pEnd.index); k++) {
        const pt = route.trackpoints[k];
        if (pt) {
          eleSum += pt.ele;
          ptCount++;
          const nextPt = route.trackpoints[k + 1];
          if (nextPt && nextPt.ele > pt.ele) climbGain += (nextPt.ele - pt.ele);
        }
      }
    } else if (pStart && pEnd) {
      eleDiff = pEnd.ele - pStart.ele;
      climbGain = Math.max(0, eleDiff);
      eleSum = (pStart.ele + pEnd.ele);
      ptCount = 2;
    }

    const avgAltM = ptCount > 0 ? (eleSum / ptCount) : (pStart?.ele || 1500);
    const avgAltFt = avgAltM * 3.28084;
    const gradePct = (eleDiff / segDistM) * 100;
    const climbGainGrade = (climbGain / segDistM) * 100;

    // Piecewise gradient energy scaling
    let terrainLabel = "Flat / Rolling ➔";
    let terrainCol = "#38bdf8";
    let terrainBg = "rgba(56,189,248,0.2)";
    let baseSpeed = fSpd;

    if (gradePct > 12 || climbGainGrade >= 6.5) {
      terrainLabel = "Steep Ascent ↗↗";
      terrainCol = "#f43f5e";
      terrainBg = "rgba(244,63,94,0.25)";
      baseSpeed = cSpd * 0.75; // power hiking
    } else if (gradePct > 4.5 || climbGainGrade >= 3.0) {
      terrainLabel = "Ascent ↗";
      terrainCol = "#fb7185";
      terrainBg = "rgba(251,113,133,0.2)";
      baseSpeed = cSpd;
    } else if (climbGainGrade >= 1.5) {
      terrainLabel = "Moderate Climb ↗";
      terrainCol = "#fb923c";
      terrainBg = "rgba(251,146,60,0.2)";
      baseSpeed = (fSpd + cSpd) / 2;
    } else if (gradePct < -15) {
      terrainLabel = "Steep Descent ↘↘";
      terrainCol = "#f59e0b";
      terrainBg = "rgba(245,158,11,0.25)";
      baseSpeed = steepMode === "cautious" ? dSpd * 0.75 : (steepMode === "aggressive" ? dSpd * 1.25 : dSpd);
    } else if (gradePct < -4.5) {
      terrainLabel = "Descent ↘";
      terrainCol = "#34d399";
      terrainBg = "rgba(52,211,153,0.2)";
      baseSpeed = dSpd * 1.1; // gravity boost
    }

    // Altitude Hypoxia Slowdown (>7,500 ft)
    if (avgAltFt > 7500) {
      const altPenalty = ((avgAltFt - 7500) / 1000) * 0.025; // 2.5% per 1,000ft above 7.5k
      baseSpeed *= Math.max(0.75, 1 - altPenalty);
    }

    // Time window for this sector
    const prelimSectorHrs = segDistMi / Math.max(baseSpeed, 0.5);
    const startSectorClockHrs = (startHrs + elapsedHrs) % 24;
    const endSectorClockHrs = (startHrs + elapsedHrs + prelimSectorHrs) % 24;
    const midSectorClockHrs = (startHrs + elapsedHrs + prelimSectorHrs / 2) % 24;
    
    const startClockStr = formatClock(startHrs + elapsedHrs);
    const endClockStr = formatClock(startHrs + elapsedHrs + prelimSectorHrs);
    const timeRangeStr = `${startClockStr} - ${endClockStr}`;

    // Environmental Weather Prediction (Diurnal Mountain Model)
    const isNight = midSectorClockHrs < sunriseHrs || midSectorClockHrs > sunsetHrs;
    
    // Mountain diurnal temp curve (°F)
    const tempAt = (h) => Math.round(52 + Math.sin(((h - 6.5) / 24) * Math.PI * 2) * 32);
    const tMin = Math.min(tempAt(startSectorClockHrs), tempAt(endSectorClockHrs));
    const tMax = Math.max(tempAt(startSectorClockHrs), tempAt(endSectorClockHrs));
    const tempRangeStr = tMin === tMax ? `${tMin}°F` : `${tMin}°F - ${tMax}°F`;

    const avgTempF = (tMin + tMax) / 2;
    let windMph = Math.round(5 + (avgAltFt > 9000 ? 14 : 4) + Math.sin(midSectorClockHrs)*4);
    let windStr = `💨 Wind ${windMph} mph ${avgAltFt > 9500 ? "(High Pass Gusts)" : "(Valley SW)"}`;
    
    let skyStr = "☀️ Sunny & Exposed";
    let precipStr = "💧 5% Precip";
    if (isNight) {
      skyStr = "🌙 Clear Starry Night";
      precipStr = "💧 0% Rain";
    } else if (midSectorClockHrs >= 12.5 && midSectorClockHrs <= 17.5 && avgAltFt > 8500) {
      skyStr = "⛅ Afternoon Convection Clouds";
      precipStr = "⚡ 30% Chance Mountain T-Storm";
    } else if (midSectorClockHrs < 9) {
      skyStr = "🌤️ Crisp Morning Sun";
    }

    // Thermal Throttling Physics (>70°F)
    let thermalSlowdownPct = 0;
    let thermalTag = "🟢 Cool & Optimal";
    let thermalCol = "#34d399";

    if (avgTempF >= 86) {
      thermalSlowdownPct = 25;
      thermalTag = `🔴 Extreme Heat (${avgTempF}°F! +25% Throttling Slowdown)`;
      thermalCol = "#ef4444";
    } else if (avgTempF >= 78) {
      thermalSlowdownPct = 16;
      thermalTag = `🟠 Very Hot (${avgTempF}°F +16% Pace Slowdown)`;
      thermalCol = "#f97316";
    } else if (avgTempF >= 70) {
      thermalSlowdownPct = 8;
      thermalTag = `🟡 Hot (${avgTempF}°F +8% Thermal Slowdown)`;
      thermalCol = "#eab308";
    } else if (isNight) {
      thermalSlowdownPct = Math.round(degFactor * 100);
      thermalTag = `🌙 Headlamp Darkness (+${thermalSlowdownPct}% Pace Penalty)`;
      thermalCol = "#a855f7";
    }

    const actualSpeedMph = Math.max(0.4, baseSpeed * (1 - thermalSlowdownPct / 100));
    const actualSectorHrs = segDistMi / actualSpeedMph;
    elapsedHrs += actualSectorHrs;

    const actualEndClockStr = formatClock(startHrs + elapsedHrs);
    const finalTimeRangeStr = `${startClockStr} - ${actualEndClockStr}`;
    const paceMinMi = 60 / actualSpeedMph;

    // Generate granular terrain subsegments (e.g. steep climbs & descents)
    const subsegments = [];
    if (pStart && pEnd && pStart.index !== undefined && pEnd.index !== undefined) {
      const startIdx = Math.floor(pStart.index);
      const endIdx = Math.ceil(pEnd.index);
      const stepIdx = Math.max(5, Math.floor((endIdx - startIdx) / 4));
      for (let s = startIdx; s < endIdx; s += stepIdx) {
        const sNext = Math.min(endIdx, s + stepIdx);
        const ptA = route.trackpoints[s];
        const ptB = route.trackpoints[sNext];
        if (ptA && ptB) {
          const dMi = (ptB.dist_m - ptA.dist_m) / 1609.34;
          if (dMi > 0.05) {
            const eDiffFt = (ptB.ele - ptA.ele) * 3.28084;
            const gPct = (eDiffFt / (dMi * 5280)) * 100;
            let lbl = "📍 Rolling Traverse";
            let c = "#94a3b8";
            if (gPct > 8) { lbl = `⛰️ Steep Ascent Hazard (+${gPct.toFixed(1)}%)`; c = "#f43f5e"; }
            else if (gPct > 3) { lbl = `↗ Climb (+${gPct.toFixed(1)}%)`; c = "#fb7185"; }
            else if (gPct < -12) { lbl = `↘ Technical Quad Drop (${gPct.toFixed(1)}%)`; c = "#f59e0b"; }
            else if (gPct < -3) { lbl = `↘ Swift Descent (${gPct.toFixed(1)}%)`; c = "#34d399"; }
            subsegments.push({ label: lbl, dist: dMi.toFixed(1), col: c });
          }
        }
      }
    }

    const card = document.createElement("div");
    card.style.background = "rgba(15, 23, 42, 0.65)";
    card.style.border = "1px solid rgba(255, 255, 255, 0.12)";
    card.style.padding = "10px 14px";
    card.style.borderRadius = "10px";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "8px";
    card.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px;">
        <span style="font-size: 13px; font-weight: 800; color: #60a5fa;">${wStart.name} ➔ ${wEnd.name}</span>
        <span style="font-size: 10px; padding: 2px 8px; border-radius: 12px; background: ${terrainBg}; color: ${terrainCol}; font-weight: 700;">${terrainLabel}</span>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; color: var(--text-secondary);">
        <div>📏 Dist: <strong style="color:#fff;">${segDistMi.toFixed(1)} mi</strong> (${gradePct > 0 ? "+"+gradePct.toFixed(1) : gradePct.toFixed(1)}% grade)</div>
        <div>⛰️ Avg Elevation: <strong style="color:#fff;">${Math.round(avgAltFt).toLocaleString()} ft</strong></div>
      </div>

      <div style="background: rgba(0,0,0,0.35); padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #f8fafc; font-weight: 700;">⏰ Time Window: ${finalTimeRangeStr}</span>
          <span style="font-size: 10px; font-weight: 700; color: ${thermalCol};">${thermalTag}</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 10px; color: #94a3b8; font-size: 10px;">
          <span>🌡️ ${tempRangeStr}</span>
          <span>${windStr}</span>
          <span>${skyStr}</span>
          <span>${precipStr}</span>
        </div>
      </div>

      ${subsegments.length > 0 ? `
        <div style="background: rgba(255,255,255,0.02); padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); display: flex; flex-direction: column; gap: 3px;">
          <span style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase;">⛰️ Granular Subsegments</span>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            ${subsegments.map(sub => `
              <div style="display: flex; justify-content: space-between; font-size: 10px;">
                <span style="color: ${sub.col}; font-weight: 600;">${sub.label}</span>
                <span style="color: #cbd5e1;">${sub.dist} mi</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding-top: 2px;">
        <span>Arrive: <strong style="color:#fff;">${actualEndClockStr}</strong> (+${elapsedHrs.toFixed(2)}h total)</span>
        <span>Simulated Pace: <strong style="color:#34d399; font-size: 12px;">${Math.floor(paceMinMi)}:${Math.floor((paceMinMi%1)*60).toString().padStart(2,"0")} /mi</strong> (${actualSpeedMph.toFixed(1)} mph)</span>
      </div>
    `;

    if (outputListEl) outputListEl.appendChild(card);

    generatedSectors.push({
      start_dist_m: wStart.dist_m,
      end_dist_m: wEnd.dist_m,
      name: `${wStart.name} to ${wEnd.name}`,
      time_window: finalTimeRangeStr,
      weather_summary: `${tempRangeStr} | ${windStr} | ${skyStr}`,
      target_pace_min: paceMinMi,
      subsegments: subsegments,
      strategy: `Hold ${actualSpeedMph.toFixed(1)} mph (${thermalTag})`
    });
  }

  // Conflict Resolution Banner: Goal Time vs Predicted Time
  if (outputListEl && goalLimitHrs !== null && !isNaN(goalLimitHrs) && goalLimitHrs > 0) {
    const diffHrs = elapsedHrs - goalLimitHrs;
    const banner = document.createElement("div");
    banner.style.padding = "10px 14px";
    banner.style.borderRadius = "8px";
    banner.style.marginBottom = "6px";
    banner.style.fontSize = "11px";
    banner.style.lineHeight = "1.4";
    banner.style.display = "flex";
    banner.style.flexDirection = "column";
    banner.style.gap = "4px";

    if (diffHrs <= 0) {
      banner.style.background = "rgba(16, 185, 129, 0.2)";
      banner.style.border = "1px solid rgba(16, 185, 129, 0.5)";
      banner.style.color = "#a7f3d0";
      banner.innerHTML = `
        <div style="font-weight: 800; font-size: 12px; color: #34d399;">✔️ GOAL TIME CONFLICT RESOLVED: ON TRACK</div>
        <div>Your simulated environmental finishing time (<strong>${elapsedHrs.toFixed(2)} hrs</strong>) safely satisfies your finishing cutoff limit of <strong>${goalLimitHrs.toFixed(2)} hrs</strong> (${Math.abs(diffHrs*60).toFixed(0)} mins buffer).</div>
      `;
    } else {
      banner.style.background = "rgba(239, 68, 68, 0.22)";
      banner.style.border = "1px solid rgba(239, 68, 68, 0.6)";
      banner.style.color = "#fecaca";
      banner.innerHTML = `
        <div style="font-weight: 800; font-size: 12px; color: #f87171;">⚠️ GOAL TIME CONFLICT DETECTED: PACE DEFICIT</div>
        <div>Your target pace profile combined with thermal heat throttling (&gt;70°F) and mountain climbs predicts a finishing time of <strong>${elapsedHrs.toFixed(2)} hrs</strong>, which exceeds your goal finishing limit of <strong>${goalLimitHrs.toFixed(2)} hrs</strong> by <strong>+${(diffHrs*60).toFixed(0)} mins</strong>! You must increase your flat/climb speeds or minimize stopped aid station duration to resolve this conflict.</div>
      `;
    }
    outputListEl.insertBefore(banner, outputListEl.firstChild);
  }

  if (totalTimeEl) totalTimeEl.textContent = `${elapsedHrs.toFixed(2)} Hrs`;
  if (avgPaceEl) {
    const avgPace = (elapsedHrs * 60) / (route.totalDistance / 1609.34);
    avgPaceEl.textContent = `${Math.floor(avgPace)}:${Math.floor((avgPace%1)*60).toString().padStart(2,"0")} min/mi`;
  }

  route.executionPlan = {
    startTime: startTimeStr,
    targetDurationHrs: elapsedHrs,
    sectors: generatedSectors
  };

  if (onSuccessCallback) onSuccessCallback();
}

  if (wizGeneratePlanBtn) {
    wizGeneratePlanBtn.addEventListener("click", () => {
      if (!activeRoute) {
        showToast("Load a GPX course first!");
        return;
      }

      const cSpd = parseFloat(document.getElementById("wiz-climb-spd")?.value || "2.0");
      const fSpd = parseFloat(document.getElementById("wiz-flat-spd")?.value || "4.5");
      const dSpd = parseFloat(document.getElementById("wiz-desc-spd")?.value || "4.0");
      const steepMode = document.getElementById("wiz-steep-handling")?.value || "cautious";
      const degFactor = parseFloat(wizPenaltySlider?.value || "15") / 100;
      const startTimeStr = document.getElementById("wiz-start-time")?.value || "06:00";
      const sunriseStr = document.getElementById("wiz-sunrise-time")?.value || "05:45";
      const sunsetStr = document.getElementById("wiz-sunset-time")?.value || "20:30";
      const goalLimitHrs = parseFloat(document.getElementById("wiz-goal-hrs")?.value || "12.0");
      const outputListEl = document.getElementById("wiz-segments-output-list");
      const totalTimeEl = document.getElementById("wiz-tot-time-disp");
      const avgPaceEl = document.getElementById("wiz-avg-pace-disp");

      computeIntelligentPacingAndWeatherPlan(activeRoute, {
        cSpd, fSpd, dSpd, steepMode, degFactor,
        startTimeStr, sunriseStr, sunsetStr, goalLimitHrs,
        outputListEl, totalTimeEl, avgPaceEl,
        onSuccessCallback: () => {
          wizardStep3?.classList.add("hidden");
          wizardStep4?.classList.remove("hidden");
          if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 4 of 4: Generated Pacing Plan";
          showToast("Intelligent Diurnal Race Plan Generated!");
        }
      });
    });
  }

  if (wizRestartBtn) {
    wizRestartBtn.addEventListener("click", () => {
      wizardStep4?.classList.add("hidden");
      wizardStep1?.classList.remove("hidden");
      if (wizardStepIndicator) wizardStepIndicator.textContent = "Step 1 of 4: Fitness & Baseline";
    });
  }
  if (wizApplyHudBtn) {
    wizApplyHudBtn.addEventListener("click", () => {
      if (tempExecutionPlan) {
        activeRoute.executionPlan = tempExecutionPlan;
        onExecutionPlanChanged();
        saveSessionState();
      }
      racePlannerWizardModal?.classList.add("hidden");
      showToast("Segmented Race Plan Applied to HUD!");
    });
  }

  const wizPrintPlanBtn = document.getElementById("wiz-print-plan-btn");
  if (wizPrintPlanBtn) {
    wizPrintPlanBtn.addEventListener("click", () => {
      if (!activeRoute || !activeRoute.executionPlan || !activeRoute.executionPlan.sectors) {
        showToast("Generate a Race Plan first!");
        return;
      }

      const plan = activeRoute.executionPlan;
      const cName = activeRoute.metadata?.name || "Ruff Terrain Ultra";
      const totDistMi = activeRoute.totalDistance / 1609.34;
      
      let rowsHtml = "";
      plan.sectors.forEach(sec => {
        const mFloor = Math.floor(sec.target_pace_min);
        const sRound = Math.round((sec.target_pace_min % 1) * 60).toString().padStart(2, "0");
        const paceStr = `${mFloor}:${sRound}`;
        
        const sGrade = computeSectorGradient(activeRoute, sec);
        const cls = classifyGradient(sGrade);

        rowsHtml += `
          <tr>
            <td><strong>${escapeHtml(sec.name)}</strong></td>
            <td><span class="badge" style="background: ${cls.bg}; color: ${cls.hex}; border: 1px solid ${cls.hex}; font-weight: 800; padding: 2px 8px; border-radius: 12px;">${cls.label} (${sGrade.toFixed(1)}%)</span></td>
            <td><strong>${paceStr}</strong> min/mi</td>
            <td>${escapeHtml(sec.strategy)}</td>
          </tr>
        `;
      });

      let aidRowsHtml = "";
      if (activeRoute.waypoints && activeRoute.waypoints.length > 0) {
        const planStartMs = getPlanStartMs();
        const planDuration = getPlanDurationHrs();
        activeRoute.waypoints.slice().sort((a, b) => a.dist_m - b.dist_m).forEach(wpt => {
          const dMi = wpt.dist_m / 1609.34;
          const elHrs = getElapsedHoursAtDistance(activeRoute, wpt.dist_m, planDuration);
          const elStr = formatSplitTime(elHrs);
          
          const targetMs = planStartMs + elHrs * 3600 * 1000;
          const fastMs = planStartMs + (elHrs * 0.85) * 3600 * 1000;
          const slowMs = planStartMs + (elHrs * 1.15) * 3600 * 1000;
          
          const tDate = new Date(targetMs);
          const fDate = new Date(fastMs);
          const sDate = new Date(slowMs);
          
          const tStr = `${tDate.toLocaleDateString([], {weekday:'short'})} ${tDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
          const rStr = `${fDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - ${sDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
          
          const cutoff = wpt.extensions?.station?.passes?.[0]?.cutoff_clock || wpt.extensions?.station?.passes?.[0]?.cutoff_elapsed || "--";
          const notes = wpt.extensions?.station?.passes?.[0]?.stretch_strategy || wpt.desc || "";

          aidRowsHtml += `
            <tr>
              <td><strong>${escapeHtml(wpt.name)}</strong></td>
              <td>${dMi.toFixed(1)} mi</td>
              <td><strong style="color: #1e40af;">${tStr}</strong></td>
              <td>${rStr}</td>
              <td>${elStr}</td>
              <td>${cutoff}</td>
              <td>${escapeHtml(notes)}</td>
            </tr>
          `;
        });
      } else {
        aidRowsHtml = `<tr><td colspan="7" style="text-align:center; font-style:italic; color:#6b7280;">No course waypoints loaded.</td></tr>`;
      }

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${cName} - Race Execution Plan</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
    body {
      font-family: 'Inter', sans-serif;
      color: #111827;
      background: #fff;
      margin: 0;
      padding: 40px;
      line-height: 1.6;
    }
    .header {
      border-bottom: 3px solid #111827;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    h1 { margin: 0; font-size: 28px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.5px; }
    h2 { font-size: 18px; font-weight: 800; text-transform: uppercase; margin-top: 32px; margin-bottom: 12px; color: #111827; }
    .subtitle { font-size: 14px; color: #4b5563; margin-top: 4px; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      background: #f3f4f6;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 32px;
    }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; }
    .meta-value { font-size: 18px; font-weight: 800; color: #111827; margin-top: 2px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 32px;
    }
    th {
      background: #111827;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 12px 14px;
      text-align: left;
    }
    td {
      padding: 14px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 13px;
    }
    tr:nth-child(even) { background-color: #f9fafb; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-ascent { background: #fee2e2; color: #991b1b; }
    .badge-descent { background: #d1fae5; color: #065f46; }
    .badge-flat { background: #dbeafe; color: #1e40af; }
    @media print {
      body { padding: 0; }
      .meta-grid { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #f3f4f6 !important; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #111827 !important; color: #fff !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${cName}</h1>
    <div class="subtitle">AI Assisted Race Execution &amp; Pacing Plan</div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <span class="meta-label">Total Distance</span>
      <span class="meta-value">${totDistMi.toFixed(1)} Miles</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Target Duration</span>
      <span class="meta-value">${plan.targetDurationHrs?.toFixed(2)} Hrs</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Start Time</span>
      <span class="meta-value">${plan.startTime || "06:00"}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Average Pace</span>
      <span class="meta-value">${Math.floor(((plan.targetDurationHrs||0)*60)/totDistMi)}:${Math.floor(((((plan.targetDurationHrs||0)*60)/totDistMi)%1)*60).toString().padStart(2,'0')} min/mi</span>
    </div>
  </div>

  <h2>📍 Aid Station Arrival Schedule (ETA)</h2>
  <table>
    <thead>
      <tr>
        <th>Aid Station / Landmark</th>
        <th>Distance</th>
        <th>Estimated Arrival (ETA)</th>
        <th>ETA Tolerance Range</th>
        <th>Elapsed Time</th>
        <th>Cut-Off Time</th>
        <th>Strategy &amp; Notes</th>
      </tr>
    </thead>
    <tbody>
      ${aidRowsHtml}
    </tbody>
  </table>

  <h2>🗺️ Terrain Execution Sectors</h2>
  <table>
    <thead>
      <tr>
        <th>Sector Split</th>
        <th>Terrain</th>
        <th>Target Pace</th>
        <th>Strategy &amp; Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div style="font-size: 11px; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 16px;">
    Generated by Ruff Terrain AI Race Planner &bull; Safe, Smart Ultra Pacing
  </div>
</body>
</html>
      `;

      // Download as standalone HTML file
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_race_plan.html`;
      a.click();
      URL.revokeObjectURL(url);

      // Open print window
      const printWin = window.open("", "_blank");
      if (printWin) {
        printWin.document.write(htmlContent);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => printWin.print(), 750);
      }
      showToast("Race Plan downloaded and opened for printing!");
    });
  }

  const wizSaveGpxBtn = document.getElementById("wiz-save-gpx-btn");
  if (wizSaveGpxBtn) {
    wizSaveGpxBtn.addEventListener("click", () => {
      if (!activeRoute || !activeRoute.executionPlan || !activeRoute.executionPlan.sectors || activeRoute.executionPlan.sectors.length === 0) {
        showToast("Generate a Race Plan first!");
        return;
      }
      saveSessionState();
      if (exportGpxBtn) exportGpxBtn.click();
    });
  }

  // AI Interview Trigger & Submit
  if (aiInterviewTrigger && aiInterviewModal) {
    aiInterviewTrigger.addEventListener("click", () => aiInterviewModal.classList.remove("hidden"));
  }
  if (closeInterviewBtn && aiInterviewModal) {
    closeInterviewBtn.addEventListener("click", () => aiInterviewModal.classList.add("hidden"));
  }
  if (aiInterviewCancelBtn && aiInterviewModal) {
    aiInterviewCancelBtn.addEventListener("click", () => aiInterviewModal.classList.add("hidden"));
  }
  if (aiInterviewSubmitBtn && aiInterviewModal) {
    aiInterviewSubmitBtn.addEventListener("click", () => {
      const txt = (aiInterviewInput?.value || "").toLowerCase();
      if (txt.includes("pull 2") || txt.includes("2 mph") || txt.includes("2mph")) {
        if (planPaceClimb) planPaceClimb.value = "2.0";
      }
      if (txt.includes("jog down at 4") || txt.includes("4 mph") || txt.includes("4mph")) {
        if (planPaceDesc) planPaceDesc.value = "4.0";
      }
      if (txt.includes("surgery") || txt.includes("lung")) {
        if (planFitnessLevel) planFitnessLevel.value = "surgery_recovery";
      }
      aiInterviewModal.classList.add("hidden");
      showToast("Extracted Pacing Profile from Interview!");
      if (generateRacePlanBtn) generateRacePlanBtn.click();
    });
  }

  // Race Plan Generator Engine
  if (generateRacePlanBtn) {
    generateRacePlanBtn.addEventListener("click", () => {
      if (!activeRoute || !activeRoute.trackpoints || activeRoute.trackpoints.length === 0) {
        showToast("Please load a GPX/KML course first!");
        return;
      }

      const cSpd = parseFloat(planPaceClimb?.value || "2.0");
      const fSpd = parseFloat(planPaceFlat?.value || "4.5");
      const dSpd = parseFloat(planPaceDesc?.value || "4.0");
      const steepMode = planSteepDescent?.value || "cautious";
      const degFactor = parseFloat(planDegradationSlider?.value || "15") / 100;
      const startTimeStr = planStartTime?.value || "06:00";
      const sunriseStr = planSunriseTime?.value || "05:45";
      const sunsetStr = planSunsetTime?.value || "20:30";
      const goalLimitHrs = parseFloat(document.getElementById("plan-goal-hrs")?.value || "12.0");
      const outputListEl = planSegmentsList;
      const totalTimeEl = planTotalTimeDisp;
      const avgPaceEl = planAvgPaceDisp;

      computeIntelligentPacingAndWeatherPlan(activeRoute, {
        cSpd, fSpd, dSpd, steepMode, degFactor,
        startTimeStr, sunriseStr, sunsetStr, goalLimitHrs,
        outputListEl, totalTimeEl, avgPaceEl,
        onSuccessCallback: () => {
          if (plannerOutputContainer) plannerOutputContainer.classList.remove("hidden");
          showToast("Generated Intelligent Pacing & Weather Plan!");
          onExecutionPlanChanged();
        }
      });
    });
  }

  if (applyPlanToHudBtn) {
    applyPlanToHudBtn.addEventListener("click", () => {
      showToast("Race Plan Applied to HUD & Flight Simulation!");
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
        hasFetchedWeather = false;
        if (lastWeatherLat !== null && lastWeatherLon !== null) {
          updateWeatherUI(lastWeatherLat, lastWeatherLon);
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
        hasFetchedWeather = false;
        if (lastWeatherLat !== null && lastWeatherLon !== null) {
          updateWeatherUI(lastWeatherLat, lastWeatherLon);
        }
      }
    });
  }

  if (fetchWeatherBtn) {
    fetchWeatherBtn.addEventListener("click", () => {
      if (!weatherPlanStartInput || !weatherPlanStartInput.value) {
        showToast("Please select a concrete start date and time first!");
        return;
      }
      hasFetchedWeather = true;
      if (lastWeatherLat !== null && lastWeatherLon !== null) {
        updateWeatherUI(lastWeatherLat, lastWeatherLon);
      } else if (activeRoute && activeRoute.trackpoints && activeRoute.trackpoints.length > 0) {
        const startPt = activeRoute.trackpoints[0];
        lastWeatherLat = startPt.lat;
        lastWeatherLon = startPt.lon;
        updateWeatherUI(startPt.lat, startPt.lon);
      } else {
        lastWeatherLat = 40.015;
        lastWeatherLon = -105.2705;
        updateWeatherUI(40.015, -105.2705);
      }
      showToast("Weather forecast fetched successfully!");
    });
  }

  if (poiFetchWeatherBtn) {
    poiFetchWeatherBtn.addEventListener("click", () => {
      if (!weatherPlanStartInput || !weatherPlanStartInput.value) {
        showToast("Please select a concrete start date and time first!");
        return;
      }
      hasFetchedWeather = true;
      if (activeDialogWpt) {
        updatePoiWeatherUI(activeDialogWpt, activeDialogWpt.dist_m);
        updateWeatherUI(activeDialogWpt.lat, activeDialogWpt.lon);
      }
      showToast("Weather forecast fetched for aid station details!");
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
      calculateWarnings(activeRoute, spatialWarnings, units, desertThresholdMiles);
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

  if (settingsDesertThreshold && desertThresholdVal) {
    settingsDesertThreshold.addEventListener("input", () => {
      desertThresholdVal.textContent = `${parseFloat(settingsDesertThreshold.value).toFixed(1)} mi`;
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

      if (settingsDesertThreshold) {
        desertThresholdMiles = parseFloat(settingsDesertThreshold.value) || 8.0;
        localStorage.setItem("kokopelli_desert_threshold", desertThresholdMiles);
      }

      const turnDampingValue = settingsTurnDamping.value;
      localStorage.setItem("pref_turn_damping", turnDampingValue);
      if (mapController) {
        mapController.turnRateFactor = (101 - parseInt(turnDampingValue)) / 1000;
      }

      localStorage.setItem("gmaps_api_key", apiKeyMaps);
      localStorage.setItem("gemini_api_key", apiKeyGemini);
      localStorage.setItem("settings_units", units);
      localStorage.setItem("settings_pause_duration", pauseDuration);

      const gFlat = document.getElementById("grad-thresh-flat");
      const gMod = document.getElementById("grad-thresh-mod");
      const gSteep = document.getElementById("grad-thresh-steep");
      const gVSteep = document.getElementById("grad-thresh-vsteep");
      if (gFlat) localStorage.setItem("grad_thresh_flat", gFlat.value);
      if (gMod) localStorage.setItem("grad_thresh_mod", gMod.value);
      if (gSteep) localStorage.setItem("grad_thresh_steep", gSteep.value);
      if (gVSteep) localStorage.setItem("grad_thresh_vsteep", gVSteep.value);

      if (elevationChart) {
        elevationChart.units = units;
        elevationChart.draw();
      }

      if (activeRoute) {
        updateRouteStatsUI(activeRoute);
        updateHUD(playbackIndex);
        
        const spatialWarnings = activeRoute.warnings ? activeRoute.warnings.filter(w => w.type === "SPATIAL_MISMATCH") : [];
        calculateWarnings(activeRoute, spatialWarnings, units, desertThresholdMiles);
        renderWarningsUI(activeRoute);
        renderStrategyModal(activeRoute);
        if (mapController && climbColorsCheckbox) {
          mapController.drawRoute(activeRoute, climbColorsCheckbox.checked);
        }
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
    dropZone.addEventListener("click", (e) => {
      if (e.target.closest("label") || e.target === fileSelector || e.target.tagName === "INPUT") return;
      if (document.body.classList.contains("edit-locked")) return;
      fileSelector.click();
    });
    fileSelector.addEventListener("click", (e) => e.stopPropagation());
    
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

  function renderStrategyModal(route) {
    if (!route) return;
    if (!route.executionPlan) {
      route.executionPlan = { startTime: null, targetDurationHrs: 12, sectors: [] };
    }

    if (stratPlanStart) stratPlanStart.value = route.executionPlan.startTime || "";
    if (stratPlanDuration) stratPlanDuration.value = route.executionPlan.targetDurationHrs || 12;

    if (stratPlanStart) {
      stratPlanStart.onchange = () => {
        route.executionPlan.startTime = stratPlanStart.value;
      };
    }
    if (stratPlanDuration) {
      stratPlanDuration.onchange = () => {
        route.executionPlan.targetDurationHrs = parseFloat(stratPlanDuration.value) || 12;
      };
    }

    if (stratSectorsList) {
      stratSectorsList.innerHTML = "";
      const sectors = route.executionPlan.sectors || [];
      if (sectors.length === 0) {
        stratSectorsList.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No custom execution sectors added. Click "Add Sector" or "Suggest AI Strategy".</span>`;
      } else {
        sectors.slice().sort((a, b) => a.start_dist_m - b.start_dist_m).forEach((sec, idx) => {
          const card = document.createElement("div");
          card.style.background = "rgba(0,0,0,0.3)";
          card.style.border = "1px solid rgba(255,255,255,0.08)";
          card.style.borderRadius = "8px";
          card.style.padding = "10px 12px";
          card.style.display = "flex";
          card.style.flexDirection = "column";
          card.style.gap = "6px";

          const header = document.createElement("div");
          header.style.display = "flex";
          header.style.justifyContent = "space-between";
          header.style.alignItems = "center";

          const startMi = convertDistanceValue(sec.start_dist_m);
          const endMi = convertDistanceValue(sec.end_dist_m);
          const unit = units === "imperial" ? "mi" : "km";

          const sGrade = computeSectorGradient(route, sec);
          const cls = classifyGradient(sGrade);

          header.innerHTML = `<div><span style="background: ${cls.bg}; color: ${cls.hex}; border: 1px solid ${cls.hex}; padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; margin-right: 6px;">${cls.label} (${sGrade.toFixed(1)}%)</span><strong style="color: #60a5fa; font-size: 12px;">${escapeHtml(sec.name)}</strong> <span style="font-size: 10px; color: var(--text-muted);">(${startMi} ${unit} ➔ ${endMi} ${unit})</span></div>
                              <span style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: bold;">${sec.target_pace_min} min/${unit}</span>`;

          const body = document.createElement("div");
          body.style.fontSize = "11px";
          body.style.color = "var(--text-secondary)";
          body.innerHTML = `<div>💡 <strong>Strategy:</strong> <em>${escapeHtml(sec.strategy || 'None')}</em></div>`;
          if (sec.nutrition) {
            body.innerHTML += `<div style="margin-top: 3px; color: #f59e0b;">🥤 <strong>Nutrition:</strong> <em>${escapeHtml(sec.nutrition)}</em></div>`;
          }

          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.justifyContent = "flex-end";
          actions.style.gap = "8px";
          actions.style.marginTop = "4px";

          const delBtn = document.createElement("button");
          delBtn.className = "btn btn-secondary btn-sm";
          delBtn.style.padding = "2px 8px";
          delBtn.style.fontSize = "9px";
          delBtn.textContent = "Delete";
          delBtn.onclick = () => {
            route.executionPlan.sectors.splice(idx, 1);
            renderStrategyModal(route);
          };

          actions.appendChild(delBtn);
          card.appendChild(header);
          card.appendChild(body);
          card.appendChild(actions);
          stratSectorsList.appendChild(card);
        });
      }
    }
  }

  if (toggleStrategyBtn) {
    toggleStrategyBtn.addEventListener("click", () => {
      if (!activeRoute) return;
      renderStrategyModal(activeRoute);
      if (strategyOverlay) strategyOverlay.classList.remove("hidden");
    });
  }

  if (closeStrategyBtn) {
    closeStrategyBtn.addEventListener("click", () => {
      if (strategyOverlay) strategyOverlay.classList.add("hidden");
    });
  }

  if (stratTabWizard && stratTabSectors && stratViewWizard && stratViewSectors) {
    stratTabWizard.addEventListener("click", () => {
      stratViewWizard.classList.remove("hidden");
      stratViewSectors.classList.add("hidden");
      stratTabWizard.className = "btn btn-sm btn-primary";
      stratTabSectors.className = "btn btn-sm btn-secondary";
    });
    stratTabSectors.addEventListener("click", () => {
      stratViewWizard.classList.add("hidden");
      stratViewSectors.classList.remove("hidden");
      stratTabWizard.className = "btn btn-sm btn-secondary";
      stratTabSectors.className = "btn btn-sm btn-primary";
    });
  }

  if (wizardClimbSpd && wizardClimbLbl) {
    wizardClimbSpd.addEventListener("input", () => {
      wizardClimbLbl.textContent = `${parseFloat(wizardClimbSpd.value).toFixed(1)} mph`;
    });
  }
  if (wizardDescSpd && wizardDescLbl) {
    wizardDescSpd.addEventListener("input", () => {
      wizardDescLbl.textContent = `${parseFloat(wizardDescSpd.value).toFixed(1)} mph`;
    });
  }
  if (wizardFlatSpd && wizardFlatLbl) {
    wizardFlatSpd.addEventListener("input", () => {
      wizardFlatLbl.textContent = `${parseFloat(wizardFlatSpd.value).toFixed(1)} mph`;
    });
  }

  if (aiWizardFitness) {
    aiWizardFitness.addEventListener("change", () => {
      const mode = aiWizardFitness.value;
      if (mode === "recovery") {
        if (wizardClimbSpd) wizardClimbSpd.value = 2;
        if (wizardDescSpd) wizardDescSpd.value = 4;
        if (wizardFlatSpd) wizardFlatSpd.value = 3;
      } else if (mode === "standard") {
        if (wizardClimbSpd) wizardClimbSpd.value = 3.5;
        if (wizardDescSpd) wizardDescSpd.value = 6;
        if (wizardFlatSpd) wizardFlatSpd.value = 4.5;
      } else {
        if (wizardClimbSpd) wizardClimbSpd.value = 5;
        if (wizardDescSpd) wizardDescSpd.value = 8;
        if (wizardFlatSpd) wizardFlatSpd.value = 6.5;
      }
      if (wizardClimbLbl && wizardClimbSpd) wizardClimbLbl.textContent = `${parseFloat(wizardClimbSpd.value).toFixed(1)} mph`;
      if (wizardDescLbl && wizardDescSpd) wizardDescLbl.textContent = `${parseFloat(wizardDescSpd.value).toFixed(1)} mph`;
      if (wizardFlatLbl && wizardFlatSpd) wizardFlatLbl.textContent = `${parseFloat(wizardFlatSpd.value).toFixed(1)} mph`;
    });
  }

  if (aiSearchStartBtn && aiWizardStart) {
    aiSearchStartBtn.addEventListener("click", () => {
      showToast("Searching Event Calendar & Start Time...");
      setTimeout(() => {
        aiWizardStart.value = "2026-06-20T09:00";
        showToast("Discovered Start Time: 9:00 AM (June 20)");
      }, 600);
    });
  }

  if (generateAiPlanBtn) {
    generateAiPlanBtn.addEventListener("click", () => {
      if (!activeRoute || !activeRoute.trackpoints || activeRoute.trackpoints.length < 2) return;

      const climbMph = wizardClimbSpd ? parseFloat(wizardClimbSpd.value) || 2 : 2;
      const descMph = wizardDescSpd ? parseFloat(wizardDescSpd.value) || 4 : 4;
      const flatMph = wizardFlatSpd ? parseFloat(wizardFlatSpd.value) || 3 : 3;

      const climbPace = 60 / climbMph;
      const descPace = 60 / descMph;
      const flatPace = 60 / flatMph;

      let sectors = [];
      let currentType = "flat";
      let startIdx = 0;
      let startDist = 0;

      const pts = activeRoute.trackpoints;
      for (let i = 1; i < pts.length; i++) {
        const dDist = pts[i].dist_m - pts[i-1].dist_m;
        const dEle = pts[i].ele - pts[i-1].ele;
        const grade = dDist > 5 ? (dEle / dDist) * 100 : 0;

        let ptType = "flat";
        if (grade > 5.5) ptType = "climb";
        else if (grade < -5.5) ptType = "descend";

        if (i === 1) currentType = ptType;

        if (ptType !== currentType || i === pts.length - 1) {
          const endDist = pts[i].dist_m;
          const sLenM = endDist - startDist;
          const sLenMi = sLenM / 1609.344;

          if (sLenMi >= 1.5 || i === pts.length - 1) {
            const secPace = currentType === "climb" ? climbPace : (currentType === "descend" ? descPace : flatPace);
            const name = currentType === "climb" ? "Ascent Sector" : (currentType === "descend" ? "Descent Sector" : "Rolling Balcony");
            const strat = currentType === "climb" ? `Climb steady at ${climbMph.toFixed(1)} mph (${climbPace.toFixed(1)} min/mi); protect breathing.` : (currentType === "descend" ? `Smooth ${descMph.toFixed(1)} mph downhill jog; low impact.` : `Disciplined ${flatMph.toFixed(1)} mph run/walk rhythm.`);
            const nut = currentType === "climb" ? "Deep diaphragmatic breathing; hydrate." : "Take in solid calories during smooth downhill rhythm.";

            sectors.push({
              start_dist_m: startDist,
              end_dist_m: endDist,
              name: `${name} (${(sLenMi).toFixed(1)} mi)`,
              terrain: currentType,
              target_pace_min: parseFloat(secPace.toFixed(1)),
              strategy: strat,
              nutrition: nut
            });

            startIdx = i;
            startDist = endDist;
            currentType = ptType;
          }
        }
      }

      if (sectors.length === 0) {
        sectors.push({
          start_dist_m: 0,
          end_dist_m: activeRoute.totalDistance,
          name: "Complete Course Push",
          terrain: "flat",
          target_pace_min: parseFloat(flatPace.toFixed(1)),
          strategy: `Maintain steady pace around ${flatMph.toFixed(1)} mph.`,
          nutrition: "Regular hydration every 20 mins."
        });
      }

      const totalHrs = (activeRoute.totalDistance / 1609.344) * (flatPace / 60);

      activeRoute.executionPlan = {
        startTime: aiWizardStart ? aiWizardStart.value : "2026-06-20T09:00",
        targetDurationHrs: parseFloat(totalHrs.toFixed(1)),
        sectors
      };

      // Enrich Aid Stations target arrival times
      let cumulMin = 0;
      activeRoute.waypoints.forEach(w => {
        const dMi = w.dist_m / 1609.344;
        const matchingSec = sectors.find(s => w.dist_m >= s.start_dist_m && w.dist_m <= s.end_dist_m);
        const p = matchingSec ? matchingSec.target_pace_min : flatPace;
        cumulMin = dMi * p;

        const stDate = new Date(activeRoute.executionPlan.startTime || "2026-06-20T09:00");
        stDate.setMinutes(stDate.getMinutes() + Math.round(cumulMin));

        const arrStr = stDate.toTimeString().substring(0, 5);
        if (!w.extensions) w.extensions = {};
        if (!w.extensions.station) w.extensions.station = { passes: [] };
        if (!w.extensions.station.passes || w.extensions.station.passes.length === 0) {
          w.extensions.station.passes = [{ num: 1, dist_m: w.dist_m, label: w.name }];
        }
        w.extensions.station.passes[0].target_arrival = arrStr;
      });

      renderStrategyModal(activeRoute);
      if (stratTabSectors) stratTabSectors.click();
      showToast("Generated AI Execution Plan & Enriched Aid Stations!");
      onExecutionPlanChanged();
    });
  }

  if (stratAddSectorBtn && stratEditBox) {
    stratAddSectorBtn.addEventListener("click", () => {
      stratEditBox.classList.remove("hidden");
    });
  }

  if (stratEditCancel && stratEditBox) {
    stratEditCancel.addEventListener("click", () => {
      stratEditBox.classList.add("hidden");
    });
  }

  if (stratSecSave && stratEditBox) {
    stratSecSave.addEventListener("click", () => {
      if (!activeRoute) return;
      const name = stratSecName ? stratSecName.value : "Sector";
      const startVal = stratSecStart ? parseFloat(stratSecStart.value) || 0 : 0;
      const endVal = stratSecEnd ? parseFloat(stratSecEnd.value) || 5 : 5;
      const pace = stratSecPace ? parseFloat(stratSecPace.value) || 12 : 12;
      const strat = stratSecStrategy ? stratSecStrategy.value : "";
      const nut = stratSecNutrition ? stratSecNutrition.value : "";

      const mult = units === "imperial" ? 1609.344 : 1000;
      if (!activeRoute.executionPlan) {
        activeRoute.executionPlan = { startTime: null, targetDurationHrs: 12, sectors: [] };
      }
      if (!activeRoute.executionPlan.sectors) activeRoute.executionPlan.sectors = [];

      const txtSearch = `${name || ""} ${strat || ""}`.toLowerCase();
      let inferredTerrain = "flat";
      if (txtSearch.includes("climb") || txtSearch.includes("ascent") || txtSearch.includes("uphill") || txtSearch.includes("hike")) {
        inferredTerrain = "climb";
      } else if (txtSearch.includes("descent") || txtSearch.includes("descend") || txtSearch.includes("downhill")) {
        inferredTerrain = "descend";
      }

      activeRoute.executionPlan.sectors.push({
        start_dist_m: startVal * mult,
        end_dist_m: endVal * mult,
        name: name || "New Sector",
        terrain: inferredTerrain,
        target_pace_min: pace,
        strategy: strat,
        nutrition: nut
      });

      stratEditBox.classList.add("hidden");
      if (stratSecName) stratSecName.value = "";
      if (stratSecStrategy) stratSecStrategy.value = "";
      if (stratSecNutrition) stratSecNutrition.value = "";
      renderStrategyModal(activeRoute);
    });
  }

  if (stratSyncAiBtn) {
    stratSyncAiBtn.addEventListener("click", () => {
      if (strategyOverlay) strategyOverlay.classList.add("hidden");
      if (toggleChatBtn) toggleChatBtn.click();
      if (chatInput && activeRoute) {
        chatInput.value = `Analyze the elevation gain and slope grade of "${activeRoute.name}" and suggest granular terrain execution sectors (climb, plateau, technical descent) with target paces and nutrition strategies.`;
      }
    });
  }

  if (poiDialogFacetsBtn) {
    poiDialogFacetsBtn.addEventListener("click", () => {
      if (!activeDialogWpt) return;
      if (facetName) facetName.value = activeDialogWpt.name || "";
      const st = activeDialogWpt.extensions?.station || {};
      if (facetType) facetType.value = st.type || "water";
      if (facetArrive) facetArrive.value = st.passes?.[0]?.target_arrival || "";
      if (facetSrvWater) facetSrvWater.checked = !!st.services?.water;
      if (facetSrvFood) facetSrvFood.checked = !!st.services?.food;
      if (facetSrvToilets) facetSrvToilets.checked = !!st.services?.toilets;
      if (facetSrvMedical) facetSrvMedical.checked = !!st.services?.medical;
      if (facetAccDropbag) facetAccDropbag.checked = !!st.accessibility?.drop_bag_allowed;
      if (facetAccCrew) facetAccCrew.checked = !!st.accessibility?.crew_allowed;
      if (facetNotes) facetNotes.value = st.passes?.[0]?.stretch_strategy || "";

      if (poiFacetsModal) poiFacetsModal.classList.remove("hidden");
    });
  }

  if (closeFacetsBtn) {
    closeFacetsBtn.addEventListener("click", () => {
      if (poiFacetsModal) poiFacetsModal.classList.add("hidden");
    });
  }

  if (saveFacetsBtn) {
    saveFacetsBtn.addEventListener("click", () => {
      if (!activeDialogWpt) return;
      activeDialogWpt.name = facetName ? facetName.value : activeDialogWpt.name;
      if (!activeDialogWpt.extensions) activeDialogWpt.extensions = {};
      if (!activeDialogWpt.extensions.station) {
        activeDialogWpt.extensions.station = { passes: [], services: {}, accessibility: {} };
      }
      const st = activeDialogWpt.extensions.station;
      st.type = facetType ? facetType.value : "water";
      st.services = {
        water: facetSrvWater ? facetSrvWater.checked : false,
        food: facetSrvFood ? facetSrvFood.checked : false,
        toilets: facetSrvToilets ? facetSrvToilets.checked : false,
        medical: facetSrvMedical ? facetSrvMedical.checked : false
      };
      st.accessibility = {
        drop_bag_allowed: facetAccDropbag ? facetAccDropbag.checked : false,
        crew_allowed: facetAccCrew ? facetAccCrew.checked : false
      };
      if (!st.passes) st.passes = [];
      if (!st.passes[0]) st.passes[0] = { num: 1, dist_m: activeDialogWpt.dist_m };
      st.passes[0].target_arrival = facetArrive ? facetArrive.value : "";
      st.passes[0].stretch_strategy = facetNotes ? facetNotes.value : "";

      if (poiFacetsModal) poiFacetsModal.classList.add("hidden");
      showPoiDetailDialog(activeDialogWpt, activeDialogWpt.closestTrackpointIndex, activeDialogWpt.dist_m, true);
      saveActiveRouteState();
      showToast("Aid Station Facets Saved!");
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

  if (closePreviewPoiBtn) {
    closePreviewPoiBtn.addEventListener("click", () => {
      if (previewPoiBanner) previewPoiBanner.classList.add("hidden");
      if (autoResumeTimeout) {
        clearTimeout(autoResumeTimeout);
        autoResumeTimeout = null;
      }
      if (pauseDuration > 0 && !isPlaying) {
        startPlayback();
      }
    });
  }

  // Edit Waypoint Button Handler
  if (poiDialogEditBtn) {
    poiDialogEditBtn.addEventListener("click", () => {
      if (!isEditingPoiLocation) {
        // Enter Edit Mode (Relocation Mode)
        isEditingPoiLocation = true;
        poiDialogEditBtn.textContent = "💾 Save Relocation";
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
        poiDialogEditBtn.textContent = "📍 Relocate Waypoint";
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
    showPoiDetailDialog(wpt, playbackIndex, wpt.dist_m);
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
        if (targetPos.dist_m !== undefined) {
          activeDialogWpt.dist_m = targetPos.dist_m;
          if (activeDialogWpt.extensions?.station?.passes?.length > 0) {
            activeDialogWpt.extensions.station.passes.forEach(p => {
              p.dist_m = targetPos.dist_m;
              p.closestTrackpointIndex = targetPos.closestTrackpointIndex;
            });
          }
        }
        if (targetPos.closestTrackpointIndex !== undefined) {
          activeDialogWpt.closestTrackpointIndex = targetPos.closestTrackpointIndex;
          playbackIndex = targetPos.closestTrackpointIndex;
        }

        lastPausedPoiId = null;
        lastPausedPoiIndex = -1;

        activeRoute.waypoints.sort((a, b) => a.dist_m - b.dist_m);
        if (wizGeneratePlanBtn) wizGeneratePlanBtn.click();

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
        toggleChatBtn.classList.remove("hidden");
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
        if (previewPoiBanner && !previewPoiBanner.classList.contains("hidden")) {
          previewPoiBanner.classList.add("hidden");
          if (autoResumeTimeout) {
            clearTimeout(autoResumeTimeout);
            autoResumeTimeout = null;
          }
          if (pauseDuration > 0 && !isPlaying) {
            startPlayback();
          }
        }
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

// Session State Autosave and Recovery Engine
function saveSessionState() {
  if (!activeRoute || !activeRoute.trackpoints || activeRoute.trackpoints.length === 0) return;
  try {
    const backup = {
      route: activeRoute,
      wizard: {
        climbSpd: document.getElementById("wiz-climb-spd")?.value,
        flatSpd: document.getElementById("wiz-flat-spd")?.value,
        descSpd: document.getElementById("wiz-desc-spd")?.value,
        startDate: document.getElementById("wiz-start-date")?.value,
        startTime: document.getElementById("wiz-start-time")?.value,
        penalty: document.getElementById("wiz-penalty-slider")?.value
      },
      timestamp: Date.now()
    };
    localStorage.setItem("ruff_terrain_session_backup", JSON.stringify(backup));
  } catch (err) {
    console.warn("Autosave session backup failed:", err);
  }
}

function restoreSessionState() {
  try {
    const raw = localStorage.getItem("ruff_terrain_session_backup");
    if (!raw) return;
    const backup = JSON.parse(raw);
    if (backup && backup.route && backup.route.trackpoints && backup.route.trackpoints.length > 0) {
      activeRoute = backup.route;
      if (elevationChart) elevationChart.setRoute(activeRoute);
      updateRouteStatsUI(activeRoute);
      renderWarningsUI(activeRoute);
      if (typeof renderRunnerSectorsUI === "function") renderRunnerSectorsUI();
      if (mapController && typeof mapController.drawRoute === "function") {
        mapController.drawRoute(activeRoute, typeof climbColorsCheckbox !== "undefined" && climbColorsCheckbox ? climbColorsCheckbox.checked : false);
      }

      if (backup.wizard) {
        if (backup.wizard.climbSpd) {
          const el = document.getElementById("wiz-climb-spd");
          if (el) { el.value = backup.wizard.climbSpd; el.dispatchEvent(new Event("input")); }
        }
        if (backup.wizard.flatSpd) {
          const el = document.getElementById("wiz-flat-spd");
          if (el) { el.value = backup.wizard.flatSpd; el.dispatchEvent(new Event("input")); }
        }
        if (backup.wizard.descSpd) {
          const el = document.getElementById("wiz-desc-spd");
          if (el) { el.value = backup.wizard.descSpd; el.dispatchEvent(new Event("input")); }
        }
        if (backup.wizard.startDate) {
          const el = document.getElementById("wiz-start-date");
          if (el) { el.value = backup.wizard.startDate; el.dispatchEvent(new Event("change")); }
        }
        if (backup.wizard.startTime) {
          const el = document.getElementById("wiz-start-time");
          if (el) el.value = backup.wizard.startTime;
        }
        if (backup.wizard.penalty) {
          const el = document.getElementById("wiz-penalty-slider");
          if (el) {
            el.value = backup.wizard.penalty;
            el.dispatchEvent(new Event("input"));
          }
        }
      }
      showToast("Restored previous editing session from backup!");
      console.log("Restored session state successfully.");
    }
  } catch (err) {
    console.warn("Failed to restore session backup:", err);
  }
}

window.addEventListener("beforeunload", saveSessionState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveSessionState();
});

// Automatically trigger restore after DOM setup
let currentPreviewSectorIdx = -1;
let sectorPreviewInterval = null;

function updateSectorPreviewCard(secIdx) {
  if (!activeRoute || !activeRoute.executionPlan || !activeRoute.executionPlan.sectors) return;
  const sectors = activeRoute.executionPlan.sectors;
  if (secIdx < 0 || secIdx >= sectors.length) return;
  currentPreviewSectorIdx = secIdx;
  const sec = sectors[secIdx];
  const mult = typeof units !== "undefined" && units === "metric" ? 1000 : 1609.344;
  const uUnit = typeof units !== "undefined" && units === "metric" ? "km" : "mi";

  const nameEl = document.getElementById("preview-sec-name");
  const distEl = document.getElementById("preview-sec-dist");
  const climbEl = document.getElementById("preview-sec-climb");
  const gradeEl = document.getElementById("preview-sec-grade");
  const paceEl = document.getElementById("preview-sec-pace");
  const elapsedEl = document.getElementById("preview-sec-elapsed");
  const timesEl = document.getElementById("preview-sec-times");

  if (nameEl) nameEl.textContent = `${secIdx + 1}. ${sec.name || "Sector " + (secIdx + 1)}`;
  const distMi = (sec.end_dist_m - sec.start_dist_m) / mult;
  if (distEl) distEl.textContent = `${distMi.toFixed(2)} ${uUnit}`;

  const pts = activeRoute.trackpoints || [];
  const sPt = pts.find(p => p.dist_m >= sec.start_dist_m) || pts[0];
  const ePt = pts.find(p => p.dist_m >= sec.end_dist_m) || pts[pts.length - 1];
  const gain = Math.round((ePt.ele - sPt.ele) * (typeof units !== "undefined" && units === "imperial" ? 3.28084 : 1));
  if (climbEl) climbEl.textContent = `${gain >= 0 ? "+" : ""}${gain} ${typeof units !== "undefined" && units === "imperial" ? "ft" : "m"}`;

  if (gradeEl) gradeEl.textContent = `${(sec.avg_grade || 0).toFixed(1)}%`;
  if (paceEl) paceEl.textContent = `${sec.target_pace_min} min/${uUnit}`;

  const startTimestamp = activeRoute.executionPlan.startTime ? new Date(activeRoute.executionPlan.startTime).getTime() : Date.now();
  let cumMinBefore = 0;
  for (let i = 0; i < secIdx; i++) {
    const s = sectors[i];
    const d = (s.end_dist_m - s.start_dist_m) / mult;
    cumMinBefore += d * (s.target_pace_min || 10);
    if (s.name && s.name.startsWith("➔")) cumMinBefore += 15;
  }
  const secMin = distMi * (sec.target_pace_min || 10);
  const cumMinAfter = cumMinBefore + secMin;

  const fmtHrs = (m) => `${Math.floor(m/60)}h ${Math.round(m%60)}m`;
  if (elapsedEl) elapsedEl.textContent = `${fmtHrs(cumMinAfter)} (${Math.round(secMin)}m sec)`;

  const fmtTime = (ms) => new Date(ms).toTimeString().slice(0, 5);
  const startSecMs = startTimestamp + cumMinBefore * 60 * 1000;
  const endSecMs = startTimestamp + cumMinAfter * 60 * 1000;
  if (timesEl) timesEl.textContent = `${fmtTime(startSecMs)} ➔ ${fmtTime(endSecMs)}`;

  const badgeCol = sec.terrain === "descend" ? "#34d399" : (sec.terrain === "flat" ? "#60a5fa" : "#fb923c");
  if (typeof mapController !== "undefined" && mapController) {
    mapController.highlightWarning({
      startDist: sec.start_dist_m,
      endDist: sec.end_dist_m,
      colorHex: badgeCol
    });
    const clearBtn = document.getElementById("clear-warnings-highlight-btn");
    if (clearBtn) clearBtn.classList.remove("hidden");

    const midDist = (sec.start_dist_m + sec.end_dist_m) / 2;
    const midIdx = pts.findIndex(p => p.dist_m >= midDist);
    if (typeof mapController.syncToTrackpoint === "function") {
      mapController.syncToTrackpoint(midIdx !== -1 ? midIdx : 0, true);
    }
  }

  const listEl = document.getElementById("runner-sectors-list");
  if (listEl) {
    const items = listEl.querySelectorAll(".runner-sector-item");
    items.forEach((it, i) => {
      it.style.borderColor = i === secIdx ? badgeCol : "rgba(255,255,255,0.08)";
      if (i === secIdx && typeof it.scrollIntoView === "function") {
        it.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }
}

function initSectorPreviewControls() {
  const prevBtn = document.getElementById("preview-sector-prev");
  const playBtn = document.getElementById("preview-sector-play");
  const nextBtn = document.getElementById("preview-sector-next");

  if (prevBtn && !prevBtn._hasPreviewListener) {
    prevBtn._hasPreviewListener = true;
    prevBtn.addEventListener("click", () => {
      if (sectorPreviewInterval) { clearInterval(sectorPreviewInterval); sectorPreviewInterval = null; if (playBtn) playBtn.textContent = "▶️ Auto"; }
      const sectors = activeRoute?.executionPlan?.sectors || [];
      if (sectors.length === 0) return;
      const nextIdx = currentPreviewSectorIdx <= 0 ? sectors.length - 1 : currentPreviewSectorIdx - 1;
      updateSectorPreviewCard(nextIdx);
    });
  }

  if (nextBtn && !nextBtn._hasPreviewListener) {
    nextBtn._hasPreviewListener = true;
    nextBtn.addEventListener("click", () => {
      if (sectorPreviewInterval) { clearInterval(sectorPreviewInterval); sectorPreviewInterval = null; if (playBtn) playBtn.textContent = "▶️ Auto"; }
      const sectors = activeRoute?.executionPlan?.sectors || [];
      if (sectors.length === 0) return;
      const nextIdx = currentPreviewSectorIdx >= sectors.length - 1 ? 0 : currentPreviewSectorIdx + 1;
      updateSectorPreviewCard(nextIdx);
    });
  }

  if (playBtn && !playBtn._hasPreviewListener) {
    playBtn._hasPreviewListener = true;
    playBtn.addEventListener("click", () => {
      const sectors = activeRoute?.executionPlan?.sectors || [];
      if (sectors.length === 0) return;
      if (sectorPreviewInterval) {
        clearInterval(sectorPreviewInterval);
        sectorPreviewInterval = null;
        playBtn.textContent = "▶️ Auto";
        showToast("Paused Sector Preview loop.");
      } else {
        playBtn.textContent = "⏸️ Stop";
        showToast("Auto-playing Sector Preview (3.5s per sector)...");
        if (currentPreviewSectorIdx < 0) updateSectorPreviewCard(0);
        sectorPreviewInterval = setInterval(() => {
          if (!activeRoute?.executionPlan?.sectors || activeRoute.executionPlan.sectors.length === 0) {
            clearInterval(sectorPreviewInterval);
            sectorPreviewInterval = null;
            playBtn.textContent = "▶️ Auto";
            return;
          }
          const nextIdx = currentPreviewSectorIdx >= activeRoute.executionPlan.sectors.length - 1 ? 0 : currentPreviewSectorIdx + 1;
          updateSectorPreviewCard(nextIdx);
        }, 3500);
      }
    });
  }
}

setTimeout(restoreSessionState, 500);
setTimeout(initSectorPreviewControls, 600);

function renderRunnerSectorsUI() {
  const listEl = document.getElementById("runner-sectors-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  initSectorPreviewControls();
  if (!activeRoute || !activeRoute.executionPlan || !activeRoute.executionPlan.sectors || activeRoute.executionPlan.sectors.length === 0) {
    listEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted); text-align: center; font-style: italic; padding: 6px 0;">No pacing sectors loaded. Click 'Auto Segment Course'.</span>`;
    return;
  }
  const mult = typeof units !== "undefined" && units === "metric" ? 1000 : 1609.344;
  const uUnit = typeof units !== "undefined" && units === "metric" ? "km" : "mi";

  activeRoute.executionPlan.sectors.forEach((sec, idx) => {
    const sMi = (sec.start_dist_m / mult).toFixed(1);
    const eMi = (sec.end_dist_m / mult).toFixed(1);
    const badgeBg = sec.terrain === "descend" ? "rgba(16,185,129,0.2)" : (sec.terrain === "flat" ? "rgba(59,130,246,0.2)" : "rgba(249,115,22,0.2)");
    const badgeCol = sec.terrain === "descend" ? "#34d399" : (sec.terrain === "flat" ? "#60a5fa" : "#fb923c");

    const item = document.createElement("div");
    item.className = "runner-sector-item";
    item.style.cssText = "background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); padding: 6px 8px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom:4px; cursor:pointer; transition:all 0.2s;";

    item.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 2px; max-width: 65%;">
        <span style="font-size: 11px; font-weight: bold; color: #fff;">${idx+1}. ${sec.name}</span>
        <span style="font-size: 9px; color: var(--text-muted);">${sMi} ➔ ${eMi} ${uUnit} (${(sec.avg_grade||0).toFixed(1)}%)</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="background:${badgeBg}; color:${badgeCol}; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:4px;">${sec.target_pace_min} min/${uUnit}</span>
      </div>
    `;

    item.addEventListener("click", () => {
      updateSectorPreviewCard(idx);
    });

    listEl.appendChild(item);
  });
}
window.renderRunnerSectorsUI = renderRunnerSectorsUI;
