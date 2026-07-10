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

import { VerticalTerrainVisualizer } from "./gradient-bars.js";

/**
 * Interactive Canvas-based elevation profile chart.
 */
export class ElevationChart {
  /**
   * @param {HTMLCanvasElement} canvas The canvas element to draw on
   * @param {Function} onScrubCallback Callback invoked when user scrubs { index, isClick }
   */
  constructor(canvas, onScrubCallback) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onScrub = onScrubCallback;
    this.route = null;
    this.hoverIdx = -1;
    this.hoverWaypoint = null;
    
    // Playback Progress Marker
    this.progressIndex = -1;

    // Display Units System ('metric' or 'imperial')
    this.units = "imperial";
    
    this.padding = { top: 30, right: 20, bottom: 35, left: 65 };
    this.chartWidth = 0;
    this.chartHeight = 0;

    const gCanvas = document.getElementById("vertical-grade-canvas");
    const pCanvas = document.getElementById("vertical-pace-canvas");
    const gReadout = document.getElementById("vertical-grade-readout");
    const pReadout = document.getElementById("vertical-pace-readout");
    this.terrainVisualizer = new VerticalTerrainVisualizer(gCanvas, pCanvas, gReadout, pReadout);

    this.setupListeners();
  }

  /**
   * Set up resizing, mouse movement, and click event listeners.
   */
  setupListeners() {
    // Resize handler
    let resizeTimer;
    window.addEventListener('resize', () => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = window.requestAnimationFrame(() => this.resize());
    });

    // Coordinate translation helper
    const getScrubIdx = (clientX) => {
      if (!this.route || this.route.trackpoints.length === 0) return -1;
      
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const chartX = x - this.padding.left;
      
      if (chartX < 0 || chartX > this.chartWidth) return -1;

      const fraction = chartX / this.chartWidth;
      const targetDist = fraction * this.route.totalDistance;

      // Find closest trackpoint by distance
      let closestIdx = 0;
      let minDiff = Infinity;
      this.route.trackpoints.forEach((pt, idx) => {
        const diff = Math.abs(pt.dist_m - targetDist);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      });
      return closestIdx;
    };

    // Check if mouse is hovering near a waypoint
    const checkWaypointHover = (clientX, clientY) => {
      if (!this.route || !this.route.waypoints) return null;
      
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      const pts = this.route.trackpoints;
      let minEle = Infinity;
      let maxEle = -Infinity;
      pts.forEach((pt) => {
        if (pt.ele < minEle) minEle = pt.ele;
        if (pt.ele > maxEle) maxEle = pt.ele;
      });
      const eleDiff = maxEle - minEle;
      const yBuffer = eleDiff > 0 ? eleDiff * 0.15 : 50;
      const yMin = Math.max(0, minEle - yBuffer);
      const yMax = maxEle + yBuffer;

      const getX = (dist) => this.padding.left + (dist / this.route.totalDistance) * this.chartWidth;
      const getY = (ele) => this.padding.top + this.chartHeight - ((ele - yMin) / (yMax - yMin)) * this.chartHeight;

      let hoveredWpt = null;
      const hoverRadius = 15; // 15px radius for easy hover activation

      this.route.waypoints.forEach((wpt) => {
        const passes = wpt.extensions?.station?.passes || [];
        if (passes.length > 0) {
          passes.forEach((pass) => {
            let low = 0, high = pts.length - 1;
            let closestIdx = 0;
            let minDiff = Infinity;
            while (low <= high) {
              let mid = Math.floor((low + high) / 2);
              let diff = Math.abs(pts[mid].dist_m - pass.dist_m);
              if (diff < minDiff) {
                minDiff = diff;
                closestIdx = mid;
              }
              if (pts[mid].dist_m < pass.dist_m) {
                low = mid + 1;
              } else {
                high = mid - 1;
              }
            }
            const pt = pts[closestIdx];
            const wx = getX(pt.dist_m);
            const wy = getY(pt.ele);
            const distance = Math.hypot(mouseX - wx, mouseY - wy);
            if (distance < hoverRadius) {
              hoveredWpt = {
                ...wpt,
                dist_m: pt.dist_m,
                ele: pt.ele,
                name: pass.label ? `${wpt.name} (${pass.label})` : (passes.length > 1 ? `${wpt.name} (P${pass.num})` : wpt.name)
              };
            }
          });
        } else {
          const wx = getX(wpt.dist_m);
          const wy = getY(wpt.ele);
          const distance = Math.hypot(mouseX - wx, mouseY - wy);
          if (distance < hoverRadius) {
            hoveredWpt = wpt;
          }
        }
      });

      return hoveredWpt;
    };

    const handleMove = (e) => {
      if (!this.route) return;

      const wpHover = checkWaypointHover(e.clientX, e.clientY);
      if (wpHover) {
        if (this.hoverWaypoint !== wpHover || this.hoverIdx !== -1) {
          this.hoverWaypoint = wpHover;
          this.hoverIdx = -1;
          this.draw();
        }
        return;
      }

      const closestIdx = getScrubIdx(e.clientX);
      if (closestIdx !== -1) {
        if (this.hoverWaypoint !== null || this.hoverIdx !== closestIdx) {
          this.hoverWaypoint = null;
          this.hoverIdx = closestIdx;
          this.draw();
          if (this.onScrub) {
            this.onScrub(closestIdx, false); // false = scrub move (not click locking)
          }
        }
      }
    };

    this.canvas.addEventListener("mousemove", handleMove);
    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0]);
        e.preventDefault();
      }
    }, { passive: false });

    // Handle click to jump to a location
    this.canvas.addEventListener("click", (e) => {
      const closestIdx = getScrubIdx(e.clientX);
      if (closestIdx !== -1 && this.onScrub) {
        this.onScrub(closestIdx, true); // true = click to lock location
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.hoverIdx = -1;
      this.hoverWaypoint = null;
      this.draw();
    });
  }

  /**
   * Adjusts the canvas coordinates for retina displays and size changes.
   */
  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    // Let CSS width/height: 100% handle the actual visual size to prevent flexbox minimum size lockups

    this.ctx.scale(dpr, dpr);

    this.chartWidth = width - this.padding.left - this.padding.right;
    this.chartHeight = height - this.padding.top - this.padding.bottom;

    this.draw();
  }

  /**
   * Binds a route object and redraws.
   * @param {Object} route Route object
   */
  setRoute(route) {
    this.route = route;
    this.hoverIdx = -1;
    this.hoverWaypoint = null;
    this.progressIndex = -1;
    this.resize();
  }

  /**
   * Draws the elevation profile, axis markers, warnings regions, and cursor elements.
   */
  draw() {
    if (!this.route || !this.route.trackpoints || this.route.trackpoints.length === 0) {
      this.drawEmptyState();
      return;
    }

    const ctx = this.ctx;
    const pts = this.route.trackpoints;
    const N = pts.length;
    const totalDist = this.route.totalDistance;

    // Clear canvas
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Calculate elevation bounds
    let minEle = Infinity;
    let maxEle = -Infinity;
    pts.forEach((pt) => {
      if (pt.ele < minEle) minEle = pt.ele;
      if (pt.ele > maxEle) maxEle = pt.ele;
    });

    // Provide buffer
    const eleDiff = maxEle - minEle;
    const yBuffer = eleDiff > 0 ? eleDiff * 0.15 : 50;
    const yMin = Math.max(0, minEle - yBuffer);
    const yMax = maxEle + yBuffer;

    // Coordinate mapping functions
    const getX = (dist) => this.padding.left + (dist / totalDist) * this.chartWidth;
    const getY = (ele) => this.padding.top + this.chartHeight - ((ele - yMin) / (yMax - yMin)) * this.chartHeight;

    // Metric vs Imperial translations
    const isImperial = this.units === "imperial";
    const distScale = isImperial ? 0.000621371 : 0.001; // meters to miles vs meters to km
    const distUnit = isImperial ? "mi" : "km";
    const eleScale = isImperial ? 3.28084 : 1.0; // meters to feet vs meters to meters
    const eleUnit = isImperial ? "ft" : "m";

    // 1. Draw Grid Lines and Axes Labels
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "12px Outfit, Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    // Elevation Y Grid (4 divisions)
    const yGridLines = 4;
    for (let i = 0; i <= yGridLines; i++) {
      const fraction = i / yGridLines;
      const eleVal = yMin + fraction * (yMax - yMin);
      const y = getY(eleVal);

      // Draw grid line
      ctx.beginPath();
      ctx.moveTo(this.padding.left, y);
      ctx.lineTo(this.padding.left + this.chartWidth, y);
      ctx.stroke();

      // Convert elevation representation
      const convertedVal = Math.round(eleVal * eleScale);
      ctx.fillText(`${convertedVal} ${eleUnit}`, this.padding.left - 8, y);
    }

    // Distance X Grid (5 divisions)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xGridLines = 5;
    for (let i = 0; i <= xGridLines; i++) {
      const fraction = i / xGridLines;
      const distVal = fraction * totalDist;
      const x = getX(distVal);

      // Draw vertical grid line
      ctx.beginPath();
      ctx.moveTo(x, this.padding.top);
      ctx.lineTo(x, this.padding.top + this.chartHeight);
      ctx.stroke();

      const convertedDist = (distVal * distScale).toFixed(1);
      ctx.fillText(`${convertedDist} ${distUnit}`, x, this.padding.top + this.chartHeight + 6);
    }

    // 2. Draw Safety Warning Highlight Regions
    if (this.route.warnings) {
      this.route.warnings.forEach((warn) => {
        if (!warn.approved) return;

        const xStart = getX(warn.startDist);
        const xEnd = getX(warn.endDist);
        const width = xEnd - xStart;

        if (warn.type === "DIFFICULT_CLIMB") {
          ctx.fillStyle = "rgba(255, 78, 78, 0.06)";
          ctx.fillRect(xStart, this.padding.top, width, this.chartHeight);
          
          // Warning borders
          ctx.strokeStyle = "rgba(255, 78, 78, 0.15)";
          ctx.beginPath();
          ctx.moveTo(xStart, this.padding.top);
          ctx.lineTo(xStart, this.padding.top + this.chartHeight);
          ctx.moveTo(xEnd, this.padding.top);
          ctx.lineTo(xEnd, this.padding.top + this.chartHeight);
          ctx.stroke();
        } else if (warn.type === "EXPOSURE_RISK") {
          ctx.fillStyle = "rgba(255, 184, 52, 0.05)";
          ctx.fillRect(xStart, this.padding.top, width, this.chartHeight);
        } else if (warn.type === "RESOURCE_DESERT") {
          ctx.fillStyle = "rgba(62, 164, 255, 0.03)";
          ctx.fillRect(xStart, this.padding.top, width, this.chartHeight);
        }
      });
    }

    // 3. Draw Fills Under Elevation Profile Line (Indicating Playback Progress)
    const activeProgressIdx = (this.progressIndex !== -1) ? this.progressIndex : 0;

    // PART A: COMPLETED REGION (Index 0 to activeProgressIdx)
    if (activeProgressIdx > 0) {
      ctx.beginPath();
      ctx.moveTo(getX(pts[0].dist_m), getY(pts[0].ele));
      for (let i = 1; i <= activeProgressIdx; i++) {
        ctx.lineTo(getX(pts[i].dist_m), getY(pts[i].ele));
      }
      ctx.lineTo(getX(pts[activeProgressIdx].dist_m), this.padding.top + this.chartHeight);
      ctx.lineTo(getX(pts[0].dist_m), this.padding.top + this.chartHeight);
      ctx.closePath();

      const progressGradient = ctx.createLinearGradient(0, this.padding.top, 0, this.padding.top + this.chartHeight);
      progressGradient.addColorStop(0, "rgba(0, 210, 255, 0.3)");
      progressGradient.addColorStop(1, "rgba(0, 210, 255, 0.01)");
      ctx.fillStyle = progressGradient;
      ctx.fill();
    }

    // PART B: REMAINING REGION (activeProgressIdx to End N-1)
    if (activeProgressIdx < N - 1) {
      ctx.beginPath();
      ctx.moveTo(getX(pts[activeProgressIdx].dist_m), getY(pts[activeProgressIdx].ele));
      for (let i = activeProgressIdx + 1; i < N; i++) {
        ctx.lineTo(getX(pts[i].dist_m), getY(pts[i].ele));
      }
      ctx.lineTo(getX(pts[N - 1].dist_m), this.padding.top + this.chartHeight);
      ctx.lineTo(getX(pts[activeProgressIdx].dist_m), this.padding.top + this.chartHeight);
      ctx.closePath();

      const remainingGradient = ctx.createLinearGradient(0, this.padding.top, 0, this.padding.top + this.chartHeight);
      remainingGradient.addColorStop(0, "rgba(255, 255, 255, 0.08)");
      remainingGradient.addColorStop(1, "rgba(255, 255, 255, 0.005)");
      ctx.fillStyle = remainingGradient;
      ctx.fill();
    }

    // 4. Draw the Stroke Profiles
    // Completed stroke highlighted in cyan
    if (activeProgressIdx > 0) {
      ctx.beginPath();
      ctx.moveTo(getX(pts[0].dist_m), getY(pts[0].ele));
      for (let i = 1; i <= activeProgressIdx; i++) {
        ctx.lineTo(getX(pts[i].dist_m), getY(pts[i].ele));
      }
      ctx.strokeStyle = "#00d2ff";
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    // Remaining stroke in translucent grey
    if (activeProgressIdx < N - 1) {
      ctx.beginPath();
      ctx.moveTo(getX(pts[activeProgressIdx].dist_m), getY(pts[activeProgressIdx].ele));
      for (let i = activeProgressIdx + 1; i < N; i++) {
        ctx.lineTo(getX(pts[i].dist_m), getY(pts[i].ele));
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 3.0;
      ctx.stroke();
    }

    // 5. Draw Waypoint / Station Indicators along the line
    this.route.waypoints.forEach((wpt) => {
      const passes = wpt.extensions?.station?.passes || [];
      if (passes.length > 0) {
        passes.forEach((pass) => {
          let low = 0, high = pts.length - 1;
          let closestIdx = 0;
          let minDiff = Infinity;
          while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            let diff = Math.abs(pts[mid].dist_m - pass.dist_m);
            if (diff < minDiff) {
              minDiff = diff;
              closestIdx = mid;
            }
            if (pts[mid].dist_m < pass.dist_m) {
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
          const pt = pts[closestIdx];
          const x = getX(pt.dist_m);
          const y = getY(pt.ele);

          ctx.beginPath();
          ctx.arc(x, y, 5, 0, 2 * Math.PI);
          ctx.fillStyle = wpt.sym.includes("start") ? "#52e098" : wpt.sym.includes("finish") ? "#ff4e4e" : "#ffb834";
          ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          ctx.save();
          ctx.font = "12px Outfit, Inter, sans-serif";
          ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
          ctx.textAlign = "left";
          ctx.translate(x + 5, y - 6);
          ctx.rotate(-Math.PI / 6);
          
          const baseName = getSimpleName(wpt.name);
          const labelText = pass.label ? `${baseName} (${pass.label})` : (passes.length > 1 ? `${baseName} (P${pass.num})` : baseName);
          ctx.fillText(labelText.substring(0, 22), 0, 0);
          ctx.restore();
        });
      } else {
        const x = getX(wpt.dist_m);
        const y = getY(wpt.ele);

        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = wpt.sym.includes("start") ? "#52e098" : wpt.sym.includes("finish") ? "#ff4e4e" : "#ffb834";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.font = "12px Outfit, Inter, sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.textAlign = "left";
        ctx.translate(x + 5, y - 6);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(getSimpleName(wpt.name).substring(0, 22), 0, 0);
        ctx.restore();
      }
    });

    // 6. Draw Interactive Scrub Cursor
    if (this.hoverIdx !== -1 && this.hoverIdx < N) {
      const hoverPt = pts[this.hoverIdx];
      const hx = getX(hoverPt.dist_m);
      const hy = getY(hoverPt.ele);

      // Vertical scrub line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx, this.padding.top);
      ctx.lineTo(hx, this.padding.top + this.chartHeight);
      ctx.stroke();

      // Focal dot
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 4;
      ctx.fill();
      ctx.shadowBlur = 0; // reset

      // Tooltip Card info translation
      const valText = `${Math.round(hoverPt.ele * eleScale)} ${eleUnit}`;
      const distText = `${(hoverPt.dist_m * distScale).toFixed(2)} ${distUnit}`;
      const gradeText = `${hoverPt.grade.toFixed(1)}%`;

      ctx.fillStyle = "rgba(20, 20, 20, 0.85)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      
      const cardWidth = 120;
      const cardHeight = 62;
      let cardX = hx + 10;
      
      // Prevent edge cutting off (right border constraint)
      if (cardX + cardWidth > this.padding.left + this.chartWidth) {
        cardX = hx - cardWidth - 10;
      }
      // Left border constraint
      if (cardX < this.padding.left) {
        cardX = this.padding.left + 5;
      }

      const cardY = Math.max(this.padding.top, Math.min(hy - cardHeight / 2, this.padding.top + this.chartHeight - cardHeight));

      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 6);
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 12px Outfit, Inter, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(`Dist: ${distText}`, cardX + 8, cardY + 16);
      ctx.fillText(`Ele: ${valText}`, cardX + 8, cardY + 34);
      ctx.fillText(`Grade: ${gradeText}`, cardX + 8, cardY + 52);
    }

    // 7. Draw Waypoint Hover Popover Pane
    if (this.hoverWaypoint) {
      const hx = getX(this.hoverWaypoint.dist_m);
      const hy = getY(this.hoverWaypoint.ele);

      ctx.beginPath();
      ctx.arc(hx, hy, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Tooltip Card layout details
      ctx.fillStyle = "rgba(12, 17, 28, 0.95)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1;

      const cardWidth = 230;
      const cardHeight = 95;
      let cardX = hx + 12;

      // Check right boundary
      if (cardX + cardWidth > this.padding.left + this.chartWidth) {
        cardX = hx - cardWidth - 12;
      }
      // Check left boundary
      if (cardX < this.padding.left) {
        cardX = this.padding.left + 5;
      }

      const cardY = Math.max(this.padding.top, Math.min(hy - cardHeight / 2, this.padding.top + this.chartHeight - cardHeight));

      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 8);
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 14px Outfit, Inter, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(getSimpleName(this.hoverWaypoint.name), cardX + 10, cardY + 20);

      ctx.font = "12px Outfit, Inter, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      const distConverted = (this.hoverWaypoint.dist_m * distScale).toFixed(2);
      const eleConverted = Math.round(this.hoverWaypoint.ele * eleScale);
      ctx.fillText(`Dist: ${distConverted} ${distUnit} | Ele: ${eleConverted} ${eleUnit}`, cardX + 10, cardY + 38);

      // Display custom services/amenities icons if present
      const station = this.hoverWaypoint.extensions?.station;
      let serviceIconsText = "";
      if (station?.services) {
        const s = station.services;
        if (s.water || s.unmanaged_water) serviceIconsText += " 💧 Water";
        if (s.food || s.hot_food) serviceIconsText += " 🍔 Food";
        if (s.toilets) serviceIconsText += " 🚾 WC";
        if (s.medical) serviceIconsText += " ➕ Medical";
        if (s.sleep_area) serviceIconsText += " 🛌 Sleep";
      } else {
        serviceIconsText = " Waypoint Marker";
      }

      if (station?.passes?.[0]?.cutoff_clock) {
        ctx.fillStyle = "rgba(255, 78, 78, 1.0)";
        ctx.fillText(`⚠️ Cutoff: ${station.passes[0].cutoff_clock}`, cardX + 10, cardY + 56);
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.fillText(this.hoverWaypoint.desc ? this.hoverWaypoint.desc.substring(0, 32) : "POI waypoint description", cardX + 10, cardY + 56);
      }

      ctx.fillStyle = "var(--primary-color)";
      ctx.fillText(serviceIconsText.trim().substring(0, 30) || "POI Waypoint", cardX + 10, cardY + 76);
    }

    if (this.terrainVisualizer && this.route && this.route.trackpoints && this.route.trackpoints.length > 0) {
      const activeIdx = Math.max(0, Math.min(this.route.trackpoints.length - 1, this.progressIndex >= 0 ? this.progressIndex : (this.hoverIdx >= 0 ? this.hoverIdx : 0)));
      const pt = this.route.trackpoints[activeIdx];
      const grade = pt ? (pt.grade || 0) : 0;
      
      // Why extract target pace?
      // During camera fly-through playback or scrubber dragging, runners want to see their
      // authoritative target pace alongside grade. We lookup the active sector by distance
      // (or fallback to nominal 10.0 min/unit) to keep both vertical side visualizers synchronized.
      let targetPace = 10.0;
      if (this.route.executionPlan && this.route.executionPlan.sectors && this.route.executionPlan.sectors.length > 0) {
        const matchingSec = this.route.executionPlan.sectors.find(s => pt && pt.dist_m >= s.start_dist_m && pt.dist_m <= s.end_dist_m) || this.route.executionPlan.sectors[0];
        if (matchingSec && matchingSec.target_pace_min) {
          targetPace = matchingSec.target_pace_min;
        }
      }
      this.terrainVisualizer.update(grade, targetPace, this.units);
    }
  }

  /**
   * Draws empty state visual.
   */
  drawEmptyState() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "italic 12px Outfit, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Import a GPX route to visualize the elevation profile", this.canvas.width / 2 / (window.devicePixelRatio || 1), this.canvas.height / 2 / (window.devicePixelRatio || 1));
  }
}

/**
 * Strips common suffix labels from waypoint names for cleaner profile rendering.
 * @param {string} name Original name
 * @returns {string} Simplified name
 */
function getSimpleName(name) {
  if (!name) return "";
  return name
    .replace(/\s+(Out|In|Return|AS|Aid Station|Pass\s+\d+|P\d+)\b/gi, "")
    .trim();
}
