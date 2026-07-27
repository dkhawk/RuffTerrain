import { TMB_STAGES } from "./tmb-story-data.js";
import { parseGPX } from "./gpx-parser.js";
import { loadGoogleMaps, calculateBearing } from "./map-3d.js";

// Global application state
let activeDay = 1;
let googleMapsInstance = null;
let activeMap3D = null;
let activePolyline = null;
let activeMarkers = [];
let elevationChart = null;
let parsedRoute = null;

// Carousel state variables
let activeCluster = null;
let activePhotoIndex = 0;

// Cinematic flight states
let flightInterval = null;
let flightIndex = 0;
let isFlightPlaying = false;
let isFlightRecording = false;
let mediaRecorder = null;
let recordedChunks = [];

// Initialize application on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initTimeline();
  setupEventListeners();
  checkApiKeyAndInit();
});

// 1. API Key Check & Map Bootstrapping
function checkApiKeyAndInit() {
  // Try retrieving key from localStorage or Vite env
  const apiKey = localStorage.getItem("tmb_gmaps_key") || import.meta.env.VITE_GMAPS_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  if (apiKey && apiKey.length > 5) {
    document.getElementById("map-loader-state").innerHTML = `
      <div style="text-align: center;">
        <h2 style="font-family: 'Outfit'; font-size: 20px; margin-bottom: 12px;">Loading 3D Satellite Map...</h2>
        <div class="loader-spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #60a5fa; border-radius: 50%; margin: 0 auto; animation: spin 1s linear infinite;"></div>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    
    loadGoogleMaps(apiKey)
      .then((maps) => {
        googleMapsInstance = maps;
        document.getElementById("map-loader-state").classList.add("hidden");
        init3DMap();
        loadStage(activeDay);
      })
      .catch((err) => {
        console.error(err);
        showWelcomeBox("Failed to load Google Maps API. Please check your key or connection.");
      });
  } else {
    showWelcomeBox();
  }
}

function showWelcomeBox(errorMsg = null) {
  const container = document.getElementById("map-loader-state");
  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="welcome-box">
      <h1>Tour du Mont Blanc 3D Storytelling Experience</h1>
      <p>${errorMsg || "Enter your Google Maps Platform API Key (with Photorealistic 3D Maps enabled) to explore the 170+ km legendary trek."}</p>
      <div class="input-group">
        <label for="gmaps-key-input">Google Maps API Key:</label>
        <input type="password" id="gmaps-key-input" placeholder="AIzaSy..." />
        <button id="save-key-btn" class="btn btn-primary" style="margin-top: 12px; width: 100%;">Initialize Explorer</button>
      </div>
    </div>
  `;
  
  document.getElementById("save-key-btn").addEventListener("click", () => {
    const key = document.getElementById("gmaps-key-input").value.trim();
    if (key.length > 5) {
      localStorage.setItem("tmb_gmaps_key", key);
      window.location.reload();
    } else {
      alert("Please enter a valid Google Maps API Key.");
    }
  });
}

// Initialize the 3D Map Viewport container
function init3DMap() {
  const viewport = document.getElementById("map-viewport");
  
  // Create photorealistic 3D map element
  activeMap3D = new googleMapsInstance.maps3d.Map3DElement({
    center: { lat: 45.92349, lng: 6.86898, altitude: 4000 },
    tilt: 60,
    heading: 0,
    range: 8000
  });
  
  viewport.appendChild(activeMap3D);
}

// 2. Build Horizontal Timeline Day Selector
function initTimeline() {
  const timeline = document.getElementById("timeline-days");
  timeline.innerHTML = "";
  
  TMB_STAGES.forEach((stage) => {
    const pill = document.createElement("button");
    pill.className = `day-pill ${stage.restDay ? 'rest-day-pill' : ''}`;
    pill.id = `pill-day-${stage.day}`;
    pill.innerHTML = `<span>D${stage.day}</span> ${stage.restDay ? '💤' : '🥾'}`;
    pill.title = stage.title;
    
    pill.addEventListener("click", () => {
      selectDay(stage.day);
    });
    
    timeline.appendChild(pill);
  });
}

// Handle switching stage selection
function selectDay(day) {
  if (isFlightPlaying) {
    stopGuidedTour();
  }
  
  activeDay = day;
  
  // Highlight active pill
  document.querySelectorAll(".day-pill").forEach(p => p.classList.remove("active"));
  const activePill = document.getElementById(`pill-day-${day}`);
  if (activePill) activePill.classList.add("active");
  
  loadStage(day);
}

// Load GPX, stats, and markers for the active day
function loadStage(day) {
  const stage = TMB_STAGES.find(s => s.day === day);
  if (!stage) return;
  
  // Update Stats Cards
  document.getElementById("stage-day-title").textContent = stage.title;
  document.getElementById("stat-dist").textContent = stage.stats.distance;
  document.getElementById("stat-gain").textContent = stage.stats.gain;
  document.getElementById("stat-loss").textContent = stage.stats.loss;
  document.getElementById("stat-peak").textContent = stage.stats.peak;
  document.getElementById("stat-duration").textContent = stage.stats.duration;
  document.getElementById("stage-route-desc").textContent = stage.photos[0]?.desc || "Exploring the Alps.";
  document.getElementById("stage-card").classList.remove("hidden");
  
  // Close existing photo popover
  document.getElementById("photo-viewer").classList.add("hidden");
  
  // Clear previous rendering layers
  clearMapLayers();
  
  // Render photo thumbnails strip at bottom
  renderThumbnailCarousel(stage);
  
  if (stage.restDay) {
    // Show Rest Day Card
    document.getElementById("rest-day-overlay").classList.remove("hidden");
    document.getElementById("bottom-panel").classList.add("hidden");
    
    // Reposition 3D camera to showcase Courmayeur town center beautifully
    if (activeMap3D) {
      activeMap3D.center = { lat: 45.79062, lng: 6.97197, altitude: 2000 };
      activeMap3D.heading = 45;
      activeMap3D.tilt = 65;
      activeMap3D.range = 3000;
    }
  } else {
    // Hide Rest Day overlay
    document.getElementById("rest-day-overlay").classList.add("hidden");
    document.getElementById("bottom-panel").classList.remove("hidden");
    
    // Load and Parse GPX file
    fetch(stage.gpxFile)
      .then(res => {
        if (!res.ok) throw new Error("GPX file failed to load: " + res.statusText);
        return res.text();
      })
      .then(gpxText => {
        parsedRoute = parseGPX(gpxText);
        updateStatsDynamically(parsedRoute, stage);
        renderRouteOn3DMap(parsedRoute, stage);
        renderElevationProfile(parsedRoute);
      })
      .catch(err => {
        console.error("Error loading stage GPX:", err);
      });
  }
}

function updateStatsDynamically(route, stage) {
  // Convert meters to miles
  const distanceMi = (route.totalDistance / 1609.34).toFixed(2) + " mi";
  
  // Convert meters to feet
  const gainFt = "+" + Math.round(route.totalElevationGain * 3.28084).toLocaleString() + " ft";
  const lossFt = "-" + Math.round(route.totalElevationLoss * 3.28084).toLocaleString() + " ft";
  
  // Convert peak elevation from meters to feet
  const maxEleFt = Math.round(route.maxElevation * 3.28084).toLocaleString() + " ft";
  
  // Extract peak name from stage or fallback
  let peakName = stage.stats.peak.split(" (")[0] || "Peak";
  const peakText = `${peakName} (${maxEleFt})`;
  
  // Duration based on timestamps
  let durationText = stage.stats.duration; // fallback to estimation
  if (route.trackpoints.length > 1) {
    const firstPt = route.trackpoints[0];
    const lastPt = route.trackpoints[route.trackpoints.length - 1];
    if (firstPt.time && lastPt.time) {
      const start = new Date(firstPt.time);
      const end = new Date(lastPt.time);
      const diffMs = end - start;
      if (diffMs > 0) {
        const diffHrs = diffMs / (1000 * 60 * 60);
        const hrs = Math.floor(diffHrs);
        const mins = Math.round((diffHrs - hrs) * 60);
        durationText = `${hrs}h ${mins}m`;
      }
    }
  }
  
  document.getElementById("stat-dist").textContent = distanceMi;
  document.getElementById("stat-gain").textContent = gainFt;
  document.getElementById("stat-loss").textContent = lossFt;
  document.getElementById("stat-peak").textContent = peakText;
  document.getElementById("stat-duration").textContent = durationText;
}

// 3. Render 3D Route Line & Photo Pins
function renderRouteOn3DMap(route, stage) {
  if (!googleMapsInstance || !activeMap3D || !route.trackpoints.length) return;
  
  const coordinates = route.trackpoints.map(pt => ({
    lat: pt.lat,
    lng: pt.lon,
    altitude: pt.ele + 10 // slightly offset from ground to prevent z-fighting
  }));
  
  // Draw polyline route using standard web component creation
  activePolyline = document.createElement("gmp-polyline-3d");
  activePolyline.path = coordinates;
  activePolyline.strokeColor = "#60a5fa";
  activePolyline.strokeWidth = 8;
  activePolyline.altitudeMode = "CLAMP_TO_GROUND";
  activeMap3D.appendChild(activePolyline);
  
  // Reposition camera centered around start of the stage
  const startPt = route.trackpoints[0];
  const nextPt = route.trackpoints[Math.min(10, route.trackpoints.length - 1)];
  const bearing = calculateBearing(startPt.lat, startPt.lon, nextPt.lat, nextPt.lon);
  
  activeMap3D.center = { lat: startPt.lat, lng: startPt.lon, altitude: startPt.ele };
  activeMap3D.tilt = 65;
  activeMap3D.heading = bearing;
  activeMap3D.range = 2500;
  
  // Helper to generate a beautiful custom SVG photo pin
  const createCameraSvg = (color = "#f59e0b") => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "36");
    svg.setAttribute("height", "36");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.style.display = "block";
    svg.style.cursor = "pointer";
    svg.style.filter = "drop-shadow(0px 4px 8px rgba(0, 0, 0, 0.6))";

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bg.setAttribute("cx", "18");
    bg.setAttribute("cy", "18");
    bg.setAttribute("r", "16");
    bg.setAttribute("fill", "#0f172a");
    bg.setAttribute("stroke", color);
    bg.setAttribute("stroke-width", "3");

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "18");
    text.setAttribute("y", "23");
    text.setAttribute("font-size", "18");
    text.setAttribute("text-anchor", "middle");
    text.textContent = "📸";

    svg.appendChild(bg);
    svg.appendChild(text);
    return svg;
  };

  // Proximity clustering algorithm (within 400m)
  const clusters = [];
  stage.photos.forEach(photo => {
    let matchedCluster = null;
    for (let c of clusters) {
      const dist = calculateDistance(photo.lat, photo.lon, c.lat, c.lon);
      if (dist <= 400) {
        matchedCluster = c;
        break;
      }
    }
    if (matchedCluster) {
      matchedCluster.photos.push(photo);
    } else {
      clusters.push({
        id: photo.id,
        lat: photo.lat,
        lon: photo.lon,
        ele: photo.ele || 0,
        title: photo.title,
        photos: [photo]
      });
    }
  });

  // Place interactive Photo Pins for each cluster
  clusters.forEach(cluster => {
    const marker = document.createElement("gmp-marker-3d-interactive");
    marker.position = { lat: cluster.lat, lng: cluster.lon, altitude: 0 };
    marker.altitudeMode = "RELATIVE_TO_GROUND";
    
    // Choose color depending on whether it's a multi-photo cluster stop (green) or single photo (orange)
    const pinColor = cluster.photos.length > 1 ? "#10b981" : "#f59e0b";
    const svgElement = createCameraSvg(pinColor);
    const template = document.createElement("template");
    template.content.appendChild(svgElement);
    marker.appendChild(template);
    
    // Smooth rotate & zoom camera towards photo landmark when clicked
    marker.addEventListener("gmp-click", () => {
      showPhotoClusterDetails(cluster);
      activeMap3D.center = { lat: cluster.lat, lng: cluster.lon, altitude: cluster.lat === 45.74483 ? 2800 : 2200 };
      activeMap3D.heading = 315; // default scenic angle
      activeMap3D.tilt = 68;
      activeMap3D.range = 600;
    });
    
    activeMap3D.appendChild(marker);
    activeMarkers.push(marker);
  });
}

function showPhotoClusterDetails(cluster) {
  activeCluster = cluster;
  activePhotoIndex = 0;
  updatePhotoDisplay();
}

function updatePhotoDisplay() {
  if (!activeCluster || !activeCluster.photos.length) return;
  const photo = activeCluster.photos[activePhotoIndex];
  
  const popover = document.getElementById("photo-viewer");
  document.getElementById("photo-display").src = photo.img;
  document.getElementById("photo-time").textContent = `${photo.timestamp} (${activePhotoIndex + 1}/${activeCluster.photos.length})`;
  document.getElementById("photo-title").textContent = photo.title;
  document.getElementById("photo-desc").textContent = photo.desc;
  popover.classList.remove("hidden");
  
  // Highlight active thumbnail in bottom carousel
  if (typeof highlightActiveThumbnail === "function") {
    highlightActiveThumbnail(photo.id);
  }
  
  const prevBtn = document.getElementById("prev-photo-btn");
  const nextBtn = document.getElementById("next-photo-btn");
  
  if (activeCluster.photos.length > 1) {
    prevBtn.classList.remove("hidden");
    nextBtn.classList.remove("hidden");
  } else {
    prevBtn.classList.add("hidden");
    nextBtn.classList.add("hidden");
  }
}

function clearMapLayers() {
  if (activePolyline && activeMap3D) {
    activeMap3D.removeChild(activePolyline);
    activePolyline = null;
  }
  activeMarkers.forEach(marker => {
    if (activeMap3D) activeMap3D.removeChild(marker);
  });
  activeMarkers = [];
}

// 4. Render Dynamic Elevation Chart Sync with Scrubber
function renderElevationProfile(route) {
  const ctx = document.getElementById("elevation-chart-canvas").getContext("2d");
  
  // Clean up existing chart instances
  if (elevationChart) {
    elevationChart.destroy();
  }
  
  const distances = route.trackpoints.map(pt => (pt.dist_m / 1609.34).toFixed(2)); // convert to miles
  const elevations = route.trackpoints.map(pt => (pt.ele * 3.28084).toFixed(0)); // convert to feet
  
  // Custom linear gradient background
  const chartGlow = ctx.createLinearGradient(0, 0, 0, 80);
  chartGlow.addColorStop(0, "rgba(96, 165, 250, 0.4)");
  chartGlow.addColorStop(1, "rgba(96, 165, 250, 0.0)");

  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: distances,
      datasets: [{
        label: "Elevation (ft)",
        data: elevations,
        borderColor: "#60a5fa",
        borderWidth: 2,
        fill: true,
        backgroundColor: chartGlow,
        tension: 0.3,
        pointRadius: 0,
        hoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} ft`
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { maxTicksLimit: 10, color: "#94a3b8", font: { size: 9 } }
        },
        y: {
          display: false
        }
      },
      onHover: (e, elements) => {
        // Scrub 3D camera to snap position along trail when hovering elevation profile
        if (elements.length > 0) {
          const index = elements[0].index;
          const pt = route.trackpoints[index];
          if (pt && activeMap3D && !isFlightPlaying) {
            activeMap3D.center = { lat: pt.lat, lng: pt.lon, altitude: pt.ele };
            activeMap3D.range = 2000;
            
            // Sync scrubber position with closest photo
            if (typeof syncScrubberWithPhotos === "function") {
              syncScrubberWithPhotos(pt);
            }
          }
        }
      }
    }
  });
}

// 5. Automated Cinematic Guided Tour
function startGuidedTour() {
  if (!parsedRoute || !parsedRoute.trackpoints.length) return;
  isFlightPlaying = true;
  flightIndex = 0;
  
  const playBtn = document.getElementById("guided-tour-btn");
  playBtn.innerHTML = `<span class="play-icon">⏸</span> Pause Flight`;
  playBtn.classList.add("recording");
  
  // Smoothly pan camera through trail points at a fast pacing rate
  const ptCount = parsedRoute.trackpoints.length;
  
  flightInterval = setInterval(() => {
    if (flightIndex >= ptCount) {
      stopGuidedTour();
      return;
    }
    
    const pt = parsedRoute.trackpoints[flightIndex];
    const lookAheadIndex = Math.min(flightIndex + 12, ptCount - 1);
    const targetPt = parsedRoute.trackpoints[lookAheadIndex];
    
    // Smart camera look-ahead calculations
    const bearing = calculateBearing(pt.lat, pt.lon, targetPt.lat, targetPt.lon);
    
    // Slopes banking
    const elevationSlope = (targetPt.ele - pt.ele) / (targetPt.dist_m - pt.dist_m || 1);
    const cameraTilt = elevationSlope < -0.1 ? 75 : (elevationSlope > 0.1 ? 55 : 65);
    
    // Smooth fly
    if (activeMap3D) {
      activeMap3D.center = { lat: pt.lat, lng: pt.lon, altitude: pt.ele };
      activeMap3D.heading = bearing;
      activeMap3D.tilt = cameraTilt;
      activeMap3D.range = 1600;
    }
    
    // Scrubber chart indicator synchronization
    if (elevationChart && flightIndex % 4 === 0) {
      elevationChart.setActiveElements([{
        datasetIndex: 0,
        index: flightIndex
      }]);
      elevationChart.update();
      
      // Highlight closest photo milestone thumbnail as we fly
      if (typeof syncScrubberWithPhotos === "function") {
        syncScrubberWithPhotos(pt);
      }
    }
    
    // Pause automatically if approaching near photo stops
    checkNearbyPhotoTrigger(pt);
    
    // Increment flight cursor
    flightIndex += Math.max(1, Math.round(ptCount / 600)); // complete flight in ~30 seconds
  }, 50);
}

function checkNearbyPhotoTrigger(point) {
  const stage = TMB_STAGES.find(s => s.day === activeDay);
  if (!stage) return;
  
  // Re-generate clusters dynamically to scan proximity
  const clusters = [];
  stage.photos.forEach(photo => {
    let matchedCluster = null;
    for (let c of clusters) {
      const dist = calculateDistance(photo.lat, photo.lon, c.lat, c.lon);
      if (dist <= 400) {
        matchedCluster = c;
        break;
      }
    }
    if (matchedCluster) {
      matchedCluster.photos.push(photo);
    } else {
      clusters.push({
        id: photo.id,
        lat: photo.lat,
        lon: photo.lon,
        ele: photo.ele || 0,
        title: photo.title,
        photos: [photo]
      });
    }
  });

  clusters.forEach(cluster => {
    const distanceM = calculateDistance(point.lat, point.lon, cluster.lat, cluster.lon);
    if (distanceM <= 120 && !isPhotoOpenedRecently(cluster.id)) {
      pauseFlightForCluster(cluster);
    }
  });
}

const openedPhotoIds = new Set();
function isPhotoOpenedRecently(id) {
  return openedPhotoIds.has(id);
}

function pauseFlightForCluster(cluster) {
  openedPhotoIds.add(cluster.id);
  clearInterval(flightInterval);
  
  showPhotoClusterDetails(cluster);
  if (activeMap3D) {
    activeMap3D.center = { lat: cluster.lat, lng: cluster.lon, altitude: cluster.ele };
    activeMap3D.range = 800;
  }
  
  // If multiple photos exist, let the slideshow progress automatically during the pause!
  let carouselTimer = null;
  if (cluster.photos.length > 1) {
    let slideCount = 0;
    carouselTimer = setInterval(() => {
      if (slideCount < cluster.photos.length - 1) {
        activePhotoIndex++;
        updatePhotoDisplay();
        slideCount++;
      } else {
        clearInterval(carouselTimer);
      }
    }, 2000); // cycle slide every 2 seconds
  }
  
  const pauseDuration = Math.max(4000, cluster.photos.length * 2000);
  
  setTimeout(() => {
    if (carouselTimer) clearInterval(carouselTimer);
    document.getElementById("photo-viewer").classList.add("hidden");
    if (isFlightPlaying) {
      startGuidedTourResume();
    }
  }, pauseDuration);
}

function startGuidedTourResume() {
  const ptCount = parsedRoute.trackpoints.length;
  flightInterval = setInterval(() => {
    if (flightIndex >= ptCount) {
      stopGuidedTour();
      return;
    }
    
    const pt = parsedRoute.trackpoints[flightIndex];
    const lookAheadIndex = Math.min(flightIndex + 12, ptCount - 1);
    const targetPt = parsedRoute.trackpoints[lookAheadIndex];
    const bearing = calculateBearing(pt.lat, pt.lon, targetPt.lat, targetPt.lon);
    
    if (activeMap3D) {
      activeMap3D.center = { lat: pt.lat, lng: pt.lon, altitude: pt.ele };
      activeMap3D.heading = bearing;
      activeMap3D.range = 1600;
    }
    
    checkNearbyPhotoTrigger(pt);
    flightIndex += Math.max(1, Math.round(ptCount / 600));
  }, 50);
}

function stopGuidedTour() {
  isFlightPlaying = false;
  clearInterval(flightInterval);
  openedPhotoIds.clear();
  
  const playBtn = document.getElementById("guided-tour-btn");
  playBtn.innerHTML = `<span class="play-icon">▶</span> Play Guided Tour`;
  playBtn.classList.remove("recording");
  
  if (isFlightRecording) {
    stopRecording();
  }
}

// 6. Flythrough Video Recording Module (WebGL context capture)
function startRecording() {
  const canvas = document.querySelector("#map-viewport canvas") || document.querySelector("canvas");
  if (!canvas) {
    alert("WebGL canvas not found. Make sure map has loaded first!");
    return;
  }
  
  recordedChunks = [];
  const stream = canvas.captureStream(30); // 30 FPS stream capture
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
  
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };
  
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    
    // Save/Download video file
    const a = document.createElement("a");
    a.href = url;
    a.download = `TMB-Day-${activeDay}-Flythrough.webm`;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  };
  
  mediaRecorder.start();
  isFlightRecording = true;
  document.getElementById("recording-indicator").classList.remove("hidden");
  document.getElementById("record-flythrough-btn").textContent = "⏹️ Stop Recording";
  
  // Autostart flight
  if (!isFlightPlaying) {
    startGuidedTour();
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  isFlightRecording = false;
  document.getElementById("recording-indicator").classList.add("hidden");
  document.getElementById("record-flythrough-btn").textContent = "🔴 Record Tour";
}

// Basic math distance utilities
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 7. Click Handlers & Configurations Setup
function setupEventListeners() {
  // Play guided flight
  document.getElementById("guided-tour-btn").addEventListener("click", () => {
    if (isFlightPlaying) {
      stopGuidedTour();
    } else {
      startGuidedTour();
    }
  });
  
  // Record canvas video
  document.getElementById("record-flythrough-btn").addEventListener("click", () => {
    if (isFlightRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
  
  // Close photo overlay
  document.getElementById("close-photo-btn").addEventListener("click", () => {
    document.getElementById("photo-viewer").classList.add("hidden");
  });
  
  // Carousel controls
  document.getElementById("prev-photo-btn").addEventListener("click", () => {
    if (!activeCluster) return;
    activePhotoIndex = (activePhotoIndex - 1 + activeCluster.photos.length) % activeCluster.photos.length;
    updatePhotoDisplay();
  });
  
  document.getElementById("next-photo-btn").addEventListener("click", () => {
    if (!activeCluster) return;
    activePhotoIndex = (activePhotoIndex + 1) % activeCluster.photos.length;
    updatePhotoDisplay();
  });
  
  // Setup configuration dialogs
  document.getElementById("settings-trigger-btn").addEventListener("click", () => {
    const dialog = document.getElementById("settings-dialog");
    const currentKey = localStorage.getItem("tmb_gmaps_key") || "";
    document.getElementById("gmaps-key-dialog").value = currentKey;
    dialog.classList.remove("hidden");
  });
  
  document.getElementById("close-settings-btn").addEventListener("click", () => {
    document.getElementById("settings-dialog").classList.add("hidden");
  });
  
  document.getElementById("save-settings-btn").addEventListener("click", () => {
    const newKey = document.getElementById("gmaps-key-dialog").value.trim();
    if (newKey.length > 5) {
      localStorage.setItem("tmb_gmaps_key", newKey);
    } else {
      localStorage.removeItem("tmb_gmaps_key");
    }
    window.location.reload();
  });
}

// --- PHOTO THUMBNAIL CAROUSEL HELPERS ---

function renderThumbnailCarousel(stage) {
  const carousel = document.getElementById("photo-thumbnail-carousel");
  const container = document.getElementById("carousel-thumbnails-container");
  container.innerHTML = "";
  
  if (stage.restDay || !stage.photos || stage.photos.length === 0) {
    carousel.classList.add("hidden");
    return;
  }
  
  carousel.classList.remove("hidden");
  
  stage.photos.forEach(photo => {
    const item = document.createElement("div");
    item.className = "thumbnail-item";
    item.id = `thumb-${photo.id}`;
    
    const img = document.createElement("img");
    img.src = photo.img;
    img.alt = photo.title;
    
    const timeSpan = document.createElement("div");
    timeSpan.className = "thumbnail-time";
    timeSpan.textContent = photo.timestamp.split(" ")[0];
    
    item.appendChild(img);
    item.appendChild(timeSpan);
    
    // Thumbnail click zooms camera and opens high-res detail overlay
    item.addEventListener("click", () => {
      const clusters = getStageClusters(stage);
      const cluster = clusters.find(c => c.photos.some(p => p.id === photo.id));
      if (cluster) {
        showPhotoClusterDetails(cluster);
        activePhotoIndex = cluster.photos.findIndex(p => p.id === photo.id);
        updatePhotoDisplay();
        
        highlightActiveThumbnail(photo.id);
        
        if (activeMap3D) {
          activeMap3D.center = { lat: cluster.lat, lng: cluster.lon, altitude: cluster.lat === 45.74483 ? 2800 : 2200 };
          activeMap3D.heading = 315;
          activeMap3D.tilt = 68;
          activeMap3D.range = 600;
        }
      }
    });
    
    container.appendChild(item);
  });
}

function getStageClusters(stage) {
  const clusters = [];
  stage.photos.forEach(photo => {
    let matchedCluster = null;
    for (let c of clusters) {
      const dist = calculateDistance(photo.lat, photo.lon, c.lat, c.lon);
      if (dist <= 400) {
        matchedCluster = c;
        break;
      }
    }
    if (matchedCluster) {
      matchedCluster.photos.push(photo);
    } else {
      clusters.push({
        id: photo.id,
        lat: photo.lat,
        lon: photo.lon,
        ele: photo.ele || 0,
        title: photo.title,
        photos: [photo]
      });
    }
  });
  return clusters;
}

function highlightActiveThumbnail(photoId) {
  document.querySelectorAll(".thumbnail-item").forEach(item => item.classList.remove("active"));
  const activeThumb = document.getElementById(`thumb-${photoId}`);
  if (activeThumb) {
    activeThumb.classList.add("active");
    activeThumb.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

function syncScrubberWithPhotos(pt) {
  const stage = TMB_STAGES.find(s => s.day === activeDay);
  if (!stage || !stage.photos || stage.photos.length === 0) return;
  
  let closestPhoto = null;
  let minDistance = Infinity;
  
  stage.photos.forEach(photo => {
    const dist = calculateDistance(pt.lat, pt.lon, photo.lat, photo.lon);
    if (dist < minDistance) {
      minDistance = dist;
      closestPhoto = photo;
    }
  });
  
  // Highlight thumbnail if scrubber is within 1.5 km of a photo milestone
  if (closestPhoto && minDistance < 1500) {
    highlightActiveThumbnail(closestPhoto.id);
  }
}
