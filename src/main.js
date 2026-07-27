import { TMB_STAGES } from "./tmb-story-data.js";
import { parseGPX } from "./gpx-parser.js";
import { loadGoogleMaps, calculateBearing } from "./map-3d.js";

// Global application state
let activeDay = 1;
let googleMapsInstance = null;
let activeMap2D = null;
let activePolyline2D = null;
let activeMarkers2D = [];
let scrubberMarker2D = null;
let elevationChart = null;
let parsedRoute = null;

// Carousel state variables
let activeCluster = null;
let activePhotoIndex = 0;
let activePhoto = null;
let activeHikerFilter = null;

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
        <h2 style="font-family: 'Outfit'; font-size: 20px; margin-bottom: 12px;">Loading Map Explorer...</h2>
        <div class="loader-spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #60a5fa; border-radius: 50%; margin: 0 auto; animation: spin 1s linear infinite;"></div>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    
    loadGoogleMaps(apiKey)
      .then((maps) => {
        googleMapsInstance = maps;
        document.getElementById("map-loader-state").classList.add("hidden");
        init2DMap();
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

function init2DMap() {
  const container = document.getElementById("map-canvas");
  
  // Clean up any existing map div
  const existingMap = document.getElementById("map-2d");
  if (existingMap) existingMap.remove();
  
  const mapDiv = document.createElement("div");
  mapDiv.id = "map-2d";
  mapDiv.style.width = "100%";
  mapDiv.style.height = "100%";
  container.appendChild(mapDiv);
  
  activeMap2D = new googleMapsInstance.Map(mapDiv, {
    center: { lat: 45.92349, lng: 6.86898 },
    zoom: 12,
    mapTypeId: "hybrid",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  });
  
  // Show map type selector panel
  document.getElementById("map-type-selector").classList.remove("hidden");
  
  // Bind type buttons
  const buttons = document.querySelectorAll(".map-type-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const type = btn.getAttribute("data-type");
      if (activeMap2D) {
        activeMap2D.setMapTypeId(type);
      }
    });
  });
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
  
  // Reset hiker filter on stage change
  activeHikerFilter = null;
  renderHikerFilter(stage);
  
  const filtered = getFilteredPhotos(stage);
  activePhoto = filtered.length > 0 ? filtered[0] : null;
  if (activePhoto) {
    updatePhotoDisplay();
  } else {
    document.getElementById("photo-viewer").classList.add("hidden");
  }
  
  // Clear previous rendering layers
  clearMapLayers();
  
  // Render photo thumbnails strip at bottom
  renderThumbnailCarousel(stage);
  
  if (stage.restDay) {
    // Show Rest Day Card
    document.getElementById("rest-day-overlay").classList.remove("hidden");
    document.getElementById("bottom-panel").classList.add("hidden");
    
    // Reposition 2D camera to showcase Courmayeur town center beautifully
    if (activeMap2D) {
      activeMap2D.panTo({ lat: 45.79062, lng: 6.97197 });
      activeMap2D.setZoom(14);
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
        renderRouteOn2DMap(parsedRoute, stage);
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
// 3. Render 2D Route Line & Photo Pins
function renderRouteOn2DMap(route, stage) {
  if (!googleMapsInstance || !activeMap2D || !route.trackpoints.length) return;
  
  const coordinates = route.trackpoints.map(pt => ({
    lat: pt.lat,
    lng: pt.lon
  }));
  
  // Fit 2D map bounds to the route coordinates
  const bounds = new googleMapsInstance.LatLngBounds();
  coordinates.forEach(coord => bounds.extend(coord));
  activeMap2D.fitBounds(bounds);
  
  // Draw polyline route using standard Google Maps 2D Polyline
  activePolyline2D = new googleMapsInstance.Polyline({
    path: coordinates,
    geodesic: true,
    strokeColor: "#60a5fa",
    strokeOpacity: 0.9,
    strokeWeight: 6,
    map: activeMap2D
  });
  
  // Setup Scrubbing Tracker Cursor
  scrubberMarker2D = new googleMapsInstance.Marker({
    position: coordinates[0],
    map: activeMap2D,
    zIndex: 100,
    icon: {
      path: googleMapsInstance.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: "#ffeb3b",
      fillOpacity: 1,
      strokeColor: "#0f172a",
      strokeWeight: 2
    }
  });
  
  setupPhotoPins(getFilteredPhotos(stage));
}

function setupPhotoPins(photos) {
  // Clear existing photo markers
  activeMarkers2D.forEach(marker => {
    marker.setMap(null);
  });
  activeMarkers2D = [];

  if (!activeMap2D || !photos || photos.length === 0) return;

  // Proximity clustering algorithm (within 400m)
  const clusters = [];
  photos.forEach(photo => {
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

  // Place interactive 2D Photo Pins for each cluster
  clusters.forEach(cluster => {
    const pinColor = cluster.photos.length > 1 ? "#10b981" : "#f59e0b";
    
    const marker = new googleMapsInstance.Marker({
      position: { lat: cluster.lat, lng: cluster.lon },
      map: activeMap2D,
      title: cluster.title,
      label: {
        text: "📸",
        fontSize: "11px",
        color: "#ffffff"
      },
      icon: {
        path: googleMapsInstance.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: pinColor,
        fillOpacity: 1,
        strokeColor: "#0f172a",
        strokeWeight: 3
      }
    });
    
    // Smooth zoom towards photo landmark when clicked
    marker.addListener("click", () => {
      showPhotoClusterDetails(cluster);
      activeMap2D.panTo({ lat: cluster.lat, lng: cluster.lon });
      activeMap2D.setZoom(15);
    });
    
    activeMarkers2D.push(marker);
  });
}

function showPhotoClusterDetails(cluster) {
  activeCluster = cluster;
  activePhoto = cluster.photos[0];
  updatePhotoDisplay();
}

function updatePhotoDisplay() {
  if (!activePhoto) return;
  
  const popover = document.getElementById("photo-viewer");
  
  const displayImg = document.getElementById("photo-display");
  displayImg.src = activePhoto.img;
  displayImg.referrerPolicy = "no-referrer";
  
  const photoLink = document.getElementById("photo-link");
  if (photoLink) {
    photoLink.href = activePhoto.img.split('=')[0];
  }
  
  const stage = TMB_STAGES.find(s => s.day === activeDay);
  const filtered = stage ? getFilteredPhotos(stage) : [];
  const curIdx = filtered.findIndex(p => p.id === activePhoto.id);
  
  document.getElementById("photo-time").textContent = `${activePhoto.timestamp} (${curIdx !== -1 ? curIdx + 1 : 1}/${filtered.length})`;
  document.getElementById("photo-title").textContent = activePhoto.title;
  document.getElementById("photo-desc").textContent = activePhoto.desc;
  popover.classList.remove("hidden");
  
  // Highlight active thumbnail in bottom carousel
  if (typeof highlightActiveThumbnail === "function") {
    highlightActiveThumbnail(activePhoto.id);
  }
  
  const prevBtn = document.getElementById("prev-photo-btn");
  const nextBtn = document.getElementById("next-photo-btn");
  
  if (filtered.length > 1) {
    prevBtn.classList.remove("hidden");
    nextBtn.classList.remove("hidden");
  } else {
    prevBtn.classList.add("hidden");
    nextBtn.classList.add("hidden");
  }
}

function clearMapLayers() {
  if (activePolyline2D) {
    activePolyline2D.setMap(null);
    activePolyline2D = null;
  }
  activeMarkers2D.forEach(marker => {
    marker.setMap(null);
  });
  activeMarkers2D = [];
  if (scrubberMarker2D) {
    scrubberMarker2D.setMap(null);
    scrubberMarker2D = null;
  }
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
        // Scrub map camera to snap position along trail when hovering elevation profile
        if (elements.length > 0) {
          const index = elements[0].index;
          const pt = route.trackpoints[index];
          if (pt && activeMap2D && !isFlightPlaying) {
            activeMap2D.panTo({ lat: pt.lat, lng: pt.lon });
            if (scrubberMarker2D) {
              scrubberMarker2D.setPosition({ lat: pt.lat, lng: pt.lon });
            }
            
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
    if (activeMap2D) {
      activeMap2D.panTo({ lat: pt.lat, lng: pt.lon });
      if (scrubberMarker2D) {
        scrubberMarker2D.setPosition({ lat: pt.lat, lng: pt.lon });
      }
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
  if (activeMap2D) {
    activeMap2D.panTo({ lat: cluster.lat, lng: cluster.lon });
    activeMap2D.setZoom(15);
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
    
    if (activeMap2D) {
      activeMap2D.panTo({ lat: pt.lat, lng: pt.lon });
      if (scrubberMarker2D) {
        scrubberMarker2D.setPosition({ lat: pt.lat, lng: pt.lon });
      }
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
  
  // Carousel controls (chronological chronological stepping across the day)
  document.getElementById("prev-photo-btn").addEventListener("click", () => {
    const stage = TMB_STAGES.find(s => s.day === activeDay);
    if (!stage) return;
    const filtered = getFilteredPhotos(stage);
    if (filtered.length <= 1) return;
    
    const curIdx = filtered.findIndex(p => p.id === activePhoto.id);
    const prevIdx = (curIdx - 1 + filtered.length) % filtered.length;
    activePhoto = filtered[prevIdx];
    updatePhotoDisplay();
    panMapToPhoto(activePhoto);
  });
  
  document.getElementById("next-photo-btn").addEventListener("click", () => {
    const stage = TMB_STAGES.find(s => s.day === activeDay);
    if (!stage) return;
    const filtered = getFilteredPhotos(stage);
    if (filtered.length <= 1) return;
    
    const curIdx = filtered.findIndex(p => p.id === activePhoto.id);
    const nextIdx = (curIdx + 1) % filtered.length;
    activePhoto = filtered[nextIdx];
    updatePhotoDisplay();
    panMapToPhoto(activePhoto);
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
  
  const filtered = getFilteredPhotos(stage);
  if (stage.restDay || filtered.length === 0) {
    carousel.classList.add("hidden");
    return;
  }
  
  carousel.classList.remove("hidden");
  
  filtered.forEach(photo => {
    const item = document.createElement("div");
    item.className = "thumbnail-item";
    item.id = `thumb-${photo.id}`;
    if (activePhoto && activePhoto.id === photo.id) {
      item.classList.add("active");
    }
    
    const img = document.createElement("img");
    img.src = photo.img;
    img.referrerPolicy = "no-referrer";
    img.alt = photo.title;
    
    const timeSpan = document.createElement("div");
    timeSpan.className = "thumbnail-time";
    timeSpan.textContent = photo.timestamp.split(" ")[0];
    
    item.appendChild(img);
    item.appendChild(timeSpan);
    
    // Thumbnail click zooms camera and opens high-res detail overlay
    item.addEventListener("click", () => {
      activePhoto = photo;
      updatePhotoDisplay();
      panMapToPhoto(photo);
    });
    
    container.appendChild(item);
  });
}

function getStageClusters(stage) {
  const clusters = [];
  const filtered = getFilteredPhotos(stage);
  filtered.forEach(photo => {
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
  if (!stage) return;
  const filtered = getFilteredPhotos(stage);
  if (filtered.length === 0) return;
  
  let closestPhoto = null;
  let minDistance = Infinity;
  
  filtered.forEach(photo => {
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

// --- HIKER FACE FILTER HELPERS ---

function getFilteredPhotos(stage) {
  if (!stage.photos) return [];
  if (!activeHikerFilter) return stage.photos;
  return stage.photos.filter(p => p.ownerName === activeHikerFilter);
}

function renderHikerFilter(stage) {
  const panel = document.getElementById("face-filter-panel");
  const container = document.getElementById("faces-row-container");
  container.innerHTML = "";
  
  if (stage.restDay || !stage.photos || stage.photos.length === 0) {
    panel.classList.add("hidden");
    return;
  }
  
  // Extract unique owner names and their avatars
  const owners = {};
  stage.photos.forEach(photo => {
    if (photo.ownerName && photo.ownerAvatar) {
      owners[photo.ownerName] = photo.ownerAvatar;
    }
  });
  
  const ownerNames = Object.keys(owners);
  if (ownerNames.length <= 1) {
    panel.classList.add("hidden");
    return;
  }
  
  panel.classList.remove("hidden");
  
  ownerNames.forEach(name => {
    const item = document.createElement("div");
    item.className = "face-avatar-item";
    if (activeHikerFilter === name) {
      item.classList.add("active");
    }
    item.title = `Show photos by ${name}`;
    
    const img = document.createElement("img");
    img.src = owners[name];
    img.referrerPolicy = "no-referrer";
    img.alt = name;
    
    item.appendChild(img);
    
    item.addEventListener("click", () => {
      if (activeHikerFilter === name) {
        activeHikerFilter = null;
        item.classList.remove("active");
      } else {
        activeHikerFilter = name;
        document.querySelectorAll(".face-avatar-item").forEach(el => el.classList.remove("active"));
        item.classList.add("active");
      }
      
      applyPhotoFiltersAndRefresh(stage);
    });
    
    container.appendChild(item);
  });
}

function applyPhotoFiltersAndRefresh(stage) {
  const filtered = getFilteredPhotos(stage);
  
  // 1. Re-render Map Markers/Pins
  setupPhotoPins(filtered);
  
  // 2. Re-render bottom carousel
  renderThumbnailCarousel(stage);
  
  // 3. Reset activePhoto if it's no longer in the filtered set
  if (activePhoto) {
    const stillValid = filtered.some(p => p.id === activePhoto.id);
    if (!stillValid) {
      if (filtered.length > 0) {
        activePhoto = filtered[0];
        updatePhotoDisplay();
        panMapToPhoto(activePhoto);
      } else {
        activePhoto = null;
        document.getElementById("photo-viewer").classList.add("hidden");
      }
    } else {
      updatePhotoDisplay();
    }
  }
}

function panMapToPhoto(photo) {
  if (!photo || !photo.lat || !photo.lon) return;
  
  if (activeMap2D) {
    activeMap2D.panTo({ lat: photo.lat, lng: photo.lon });
    activeMap2D.setZoom(15);
    if (scrubberMarker2D) {
      scrubberMarker2D.setPosition({ lat: photo.lat, lng: photo.lon });
    }
  }
}
