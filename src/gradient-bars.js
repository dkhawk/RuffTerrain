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

import { classifyGradient } from "./gpx-parser.js";

/**
 * Classifies target pace (min/mi or min/km) into tier styling info (color, background).
 * Why classify pace?
 * Just like terrain grade, target pace varies across steepness. By aligning pace colors with
 * the hazard alert and segment color scheme, runners instantly correlate hiking exertion on steep
 * climbs (Red/Orange) versus fast level/downhill cruising (Blue/Green).
 * 
 * @param {number} paceMin Target pace in minutes per distance unit.
 * @param {string} units 'metric' or 'imperial'.
 */
export function classifyPace(paceMin, units = "imperial") {
  if (paceMin === null || paceMin === undefined || isNaN(paceMin)) {
    return { label: "FLAT", hex: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" };
  }
  // Adjust thresholds based on imperial (min/mi) vs metric (min/km)
  const isImperial = units === "imperial";
  const fastThresh = isImperial ? 8.0 : 5.0;
  const modThresh = isImperial ? 11.0 : 7.0;
  const hikeThresh = isImperial ? 15.0 : 9.5;
  const steepHikeThresh = isImperial ? 20.0 : 12.5;

  if (paceMin <= fastThresh) {
    return { label: "FAST CRUISE", hex: "#10b981", bg: "rgba(16, 185, 129, 0.15)" }; // Emerald Green
  } else if (paceMin <= modThresh) {
    return { label: "STEADY PACE", hex: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" }; // Level Blue
  } else if (paceMin <= hikeThresh) {
    return { label: "MODERATE HIKE", hex: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" }; // Amber
  } else if (paceMin <= steepHikeThresh) {
    return { label: "STEEP HIKE", hex: "#f97316", bg: "rgba(249, 115, 22, 0.15)" }; // Orange
  }
  return { label: "POWER HIKE", hex: "#ef4444", bg: "rgba(239, 68, 68, 0.15)" }; // Red
}

/**
 * VerticalTerrainVisualizer
 * 
 * A dual vertical HTML5 Canvas visualization suite positioned on the side of the 3D map viewport.
 * 
 * Why vertical dual columns?
 * Classic 80s/90s stereo graphic equalizers and VU volume meters displayed paired left/right audio
 * channels using vertical stacks of illuminated LED blocks. By placing paired vertical LED columns
 * representing instantaneous GRADIENT and TARGET PACE on the side of the map, runners get
 * continuous, at-a-glance telemetry feedback without cluttering the bottom elevation profile chart.
 */
export class VerticalTerrainVisualizer {
  /**
   * @param {HTMLCanvasElement} gradeCanvas The vertical gradient VU meter canvas.
   * @param {HTMLCanvasElement} paceCanvas The vertical target pace VU meter canvas.
   * @param {HTMLElement} gradeReadoutEl Text readout for gradient percentage.
   * @param {HTMLElement} paceReadoutEl Text readout for target pace.
   */
  constructor(gradeCanvas, paceCanvas, gradeReadoutEl, paceReadoutEl) {
    this.gradeCanvas = gradeCanvas;
    this.gradeCtx = gradeCanvas ? gradeCanvas.getContext("2d") : null;
    this.paceCanvas = paceCanvas;
    this.paceCtx = paceCanvas ? paceCanvas.getContext("2d") : null;
    this.gradeReadoutEl = gradeReadoutEl;
    this.paceReadoutEl = paceReadoutEl;

    this.currentGrade = 0;
    this.currentPaceMin = 10.0;
    this.units = "imperial";

    this.setupListeners();
  }

  /**
   * Binds window resize handling to ensure high DPI / retina sharpness on canvas resize.
   */
  setupListeners() {
    let resizeTimer;
    window.addEventListener("resize", () => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = window.requestAnimationFrame(() => this.resize());
    });
  }

  /**
   * Resizes both canvases to match their CSS container dimensions under devicePixelRatio.
   */
  resize() {
    this.resizeCanvas(this.gradeCanvas);
    this.resizeCanvas(this.paceCanvas);
    this.draw();
  }

  /**
   * Helper to scale canvas backing store to devicePixelRatio.
   */
  resizeCanvas(canvas) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  /**
   * Updates current grade, target pace, and measurement units, then redraws canvases.
   */
  update(currentGrade, currentPaceMin, units = "imperial") {
    if (typeof currentGrade === "number" && !isNaN(currentGrade)) {
      this.currentGrade = currentGrade;
    }
    if (typeof currentPaceMin === "number" && !isNaN(currentPaceMin) && currentPaceMin > 0) {
      this.currentPaceMin = currentPaceMin;
    }
    if (units) this.units = units;
    this.draw();
  }

  /**
   * Redraws both vertical VU meter columns.
   */
  draw() {
    this.drawVerticalGradeVu();
    this.drawVerticalPaceVu();
  }

  /**
   * Renders a vertical retro stereo VU LED column representing instantaneous terrain gradient.
   * 
   * Why center-zero vertical blocks?
   * On 80s/90s bidirectional stereo VU displays, signal intensity illuminated LED blocks upward or
   * downward from a central zero reference. Here, a central white baseline marks 0% grade.
   * - Positive climb grades (> 0%) illuminate LED blocks upward from center (Amber/Orange/Red).
   * - Negative descent grades (< 0%) illuminate LED blocks downward from center in Emerald Green.
   */
  drawVerticalGradeVu() {
    const canvas = this.gradeCanvas;
    const ctx = this.gradeCtx;
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // We establish a gradient span from -16% (bottom) to +24% (top). Total span = 40 discrete blocks.
    const minGrade = -16;
    const totalBlocks = 40;
    const gapPx = Math.max(1, Math.floor(height * 0.005));
    const blockHeight = (height - (gapPx * (totalBlocks - 1))) / totalBlocks;
    const zeroIndex = Math.abs(minGrade); // block index 16 (from bottom) corresponds to 0%

    const current = this.currentGrade;
    const tier = classifyGradient(current);

    // Update retro readout header
    if (this.gradeReadoutEl) {
      const arrow = current > 2.0 ? "▲" : (current < -2.0 ? "▼" : "■");
      this.gradeReadoutEl.textContent = `${arrow} ${current > 0 ? "+" : ""}${current.toFixed(1)}%`;
      this.gradeReadoutEl.style.color = tier.hex;
    }

    for (let i = 0; i < totalBlocks; i++) {
      const blockGrade = minGrade + i;
      const blockTier = classifyGradient(blockGrade);
      
      // Canvas coordinate y runs from top (0) to bottom (height).
      // Block index i=0 corresponds to minGrade (-16%) at the bottom.
      const y = height - ((i + 1) * blockHeight) - (i * gapPx);

      // Determine if this discrete LED block is currently illuminated based on active grade.
      let isIlluminated = false;
      if (current > 0.5) {
        // Positive climb: illuminate blocks between zeroIndex and zeroIndex + ceil(current)
        isIlluminated = i >= zeroIndex && i <= Math.min(totalBlocks - 1, zeroIndex + Math.ceil(current));
      } else if (current < -0.5) {
        // Negative descent: illuminate blocks between zeroIndex + floor(current) and zeroIndex
        isIlluminated = i <= zeroIndex && i >= Math.max(0, zeroIndex + Math.floor(current));
      } else {
        isIlluminated = i === zeroIndex;
      }

      ctx.fillStyle = isIlluminated ? blockTier.hex : blockTier.bg;
      ctx.fillRect(Math.floor(width * 0.1), y, Math.floor(width * 0.8), blockHeight);
    }

    // Draw crisp horizontal Zero (0%) baseline mark across the zero block
    const zeroY = height - ((zeroIndex + 0.5) * blockHeight) - (zeroIndex * gapPx);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2, Math.floor(height * 0.004));
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width, zeroY);
    ctx.stroke();
  }

  /**
   * Renders a vertical retro stereo VU LED column representing instantaneous Target Pace.
   * 
   * Why vertical pace representation?
   * Paired right beside the vertical gradient column on the side of the map, stacking 30 discrete
   * LED blocks from fast cruising pace at the top down to steep mountain power hiking at the bottom
   * gives runners an intuitive visual representation of pacing expectations.
   */
  drawVerticalPaceVu() {
    const canvas = this.paceCanvas;
    const ctx = this.paceCtx;
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const pace = this.currentPaceMin;
    const tier = classifyPace(pace, this.units);

    const isImperial = this.units === "imperial";
    const minPace = isImperial ? 5.0 : 3.0; // fastest pace displayed at top
    const maxPace = isImperial ? 25.0 : 16.0; // slowest power hike displayed at bottom
    const totalBlocks = 30;
    const gapPx = Math.max(1, Math.floor(height * 0.005));
    const blockHeight = (height - (gapPx * (totalBlocks - 1))) / totalBlocks;
    const paceRange = Math.max(1, maxPace - minPace);

    // Update retro pace readout
    if (this.paceReadoutEl) {
      const pFloor = Math.floor(pace);
      const pSec = Math.round((pace % 1) * 60).toString().padStart(2, "0");
      this.paceReadoutEl.textContent = `${pFloor}:${pSec}`;
      this.paceReadoutEl.style.color = tier.hex;
    }

    for (let i = 0; i < totalBlocks; i++) {
      // i=0 is at the bottom (slowest pace); i=totalBlocks-1 is at the top (fastest pace)
      const blockPace = maxPace - (i / (totalBlocks - 1)) * paceRange;
      const blockTier = classifyPace(blockPace, this.units);
      
      const y = height - ((i + 1) * blockHeight) - (i * gapPx);

      // Illuminate LED blocks from slowest (bottom) up to current runner pace
      const isIlluminated = pace <= blockPace;

      ctx.fillStyle = isIlluminated ? blockTier.hex : blockTier.bg;
      ctx.fillRect(Math.floor(width * 0.1), y, Math.floor(width * 0.8), blockHeight);
    }
  }
}
