/**
 * @fileoverview Empirical Athlete Calibration Engine
 * Ingests historical GPS tracking archives (GPX), normalizes observed speeds against
 * user-tagged exertion presets, and computes empirical 6-tier baseline paces,
 * Vertical Fatigue Decay Coefficient (lambda), Technical Downhill Brake Factor (beta),
 * and empirical aid station rest break duration distributions.
 */

import { parseGPX, classifyGradient, GOAL_PRESETS } from './gpx-parser.js';

/**
 * Parses a historical GPX track and extracts exertion-normalized telemetry.
 * @param {string} gpxText Raw GPX XML string
 * @param {string} exertionTag Preset key (e.g. "hard_race", "training_run", "moderate_workout", "fun_day_out")
 * @returns {object} Parsed multi-variable telemetry stats
 */
export function parseCalibrationTrack(gpxText, exertionTag = "training_run") {
  const route = parseGPX(gpxText, "imperial");
  if (!route || !route.trackpoints || route.trackpoints.length < 10) {
    throw new Error("Invalid GPX track or insufficient trackpoints for statistical calibration.");
  }

  const pts = route.trackpoints;
  const preset = GOAL_PRESETS[exertionTag] || GOAL_PRESETS.training_run;
  const mult = preset.mult || 1.0; // Pacing multiplier (e.g. 0.9 for hard race, 1.05 for training run)

  const slopeBins = {
    descent: [],
    flat: [],
    moderate: [],
    steep: [],
    verysteep: [],
    extreme: []
  };

  const fatigueSamples = []; // [{ cumVertGainM, basePaceMinMi }]
  const stationaryPausesSec = [];
  let currentPauseSec = 0;
  let cumulativeVertGainM = 0;

  for (let i = 1; i < pts.length; i++) {
    const pPrev = pts[i - 1];
    const pCurr = pts[i];

    const dDist = pCurr.dist_m - pPrev.dist_m;
    const dEle = pCurr.ele - pPrev.ele;
    if (dEle > 0) cumulativeVertGainM += dEle;

    if (!pPrev.time || !pCurr.time) continue;
    const tPrev = new Date(pPrev.time).getTime();
    const tCurr = new Date(pCurr.time).getTime();
    if (isNaN(tPrev) || isNaN(tCurr)) continue;

    const dTimeSec = (tCurr - tPrev) / 1000;
    if (dTimeSec <= 0 || dTimeSec > 300) continue; // Skip timestamps out of order or gaps > 5 mins

    const speedMs = dDist / dTimeSec;

    // Detect stationary pauses (e.g. aid station rest stops < 0.2 m/s)
    if (speedMs < 0.2) {
      currentPauseSec += dTimeSec;
      continue;
    } else if (currentPauseSec > 0) {
      if (currentPauseSec >= 60) {
        stationaryPausesSec.push(currentPauseSec);
      }
      currentPauseSec = 0;
    }

    // Filter GPS drift spikes (> 10 m/s ~ 2.6 min/mi running pace)
    if (speedMs > 10.0 || dDist <= 0.5) continue;

    // Compute observed pace (min/mi) and standardize to 100% baseline effort
    // Pace (min/mi) = (dTimeSec / 60) / (dDist / 1609.344) = 26.8224 * (dTimeSec / dDist)
    const obsPaceMinMi = 26.8224 * (dTimeSec / dDist);
    const basePaceMinMi = obsPaceMinMi / mult;

    const cls = classifyGradient(pCurr.grade || 0);
    if (slopeBins[cls.key]) {
      slopeBins[cls.key].push(basePaceMinMi);
    }

    // Collect uphill fatigue progression samples
    if (pCurr.grade >= 4.0 && basePaceMinMi < 45.0) {
      fatigueSamples.push({
        cumVertGainM: cumulativeVertGainM,
        basePaceMinMi
      });
    }
  }

  return {
    slopeBins,
    fatigueSamples,
    stationaryPausesSec,
    totalDistanceM: route.totalDistance || 0,
    cumulativeVertGainM
  };
}

/**
 * Computes median baseline pace for a gradient tier.
 * Using median rather than mean protects against residual GPS jitter and pause outliers.
 */
function computeMedian(arr, fallback) {
  if (!arr || arr.length === 0) return fallback;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return parseFloat(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
  }
  return parseFloat(sorted[mid].toFixed(1));
}

/**
 * Derives exponential Vertical Fatigue Decay Coefficient (lambda) via log-linear regression.
 * P_climb(h) = P_0 * e^(lambda * (h / 1000))
 * ln(P_climb) = ln(P_0) + lambda * (h / 1000)
 */
export function deriveFatigueDecayLambda(fatigueSamples) {
  if (!fatigueSamples || fatigueSamples.length < 20) return 0.08;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  const n = fatigueSamples.length;

  fatigueSamples.forEach(sample => {
    const x = sample.cumVertGainM / 1000; // Vert gain in km
    const y = Math.log(sample.basePaceMinMi);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });

  const denom = (n * sumXX) - (sumX * sumX);
  if (Math.abs(denom) < 1e-9) return 0.08;

  const lambda = ((n * sumXY) - (sumX * sumY)) / denom;
  return parseFloat(Math.max(0.01, Math.min(0.25, lambda)).toFixed(3));
}

/**
 * Combines parsed telemetry across multiple uploaded tracks into an Empirical Runner Profile.
 * @param {Array<object>} tracksTelemetry Array of stats returned by parseCalibrationTrack
 * @param {string} profileName Name of the generated athlete profile
 * @returns {object} Empirical RunnerProfile matching standard localStorage schema
 */
export function buildEmpiricalProfile(tracksTelemetry, profileName = "Empirical Calibrated Profile") {
  if (!tracksTelemetry || tracksTelemetry.length === 0) {
    throw new Error("No telemetry data provided for profile generation.");
  }

  const mergedBins = {
    descent: [],
    flat: [],
    moderate: [],
    steep: [],
    verysteep: [],
    extreme: []
  };

  const allFatigueSamples = [];
  const allPausesSec = [];

  tracksTelemetry.forEach(t => {
    Object.keys(mergedBins).forEach(k => {
      if (t.slopeBins[k]) mergedBins[k].push(...t.slopeBins[k]);
    });
    if (t.fatigueSamples) allFatigueSamples.push(...t.fatigueSamples);
    if (t.stationaryPausesSec) allPausesSec.push(...t.stationaryPausesSec);
  });

  const basePaces = {
    descent: computeMedian(mergedBins.descent, 9.0),
    flat: computeMedian(mergedBins.flat, 10.0),
    moderate: computeMedian(mergedBins.moderate, 13.5),
    steep: computeMedian(mergedBins.steep, 17.0),
    verysteep: computeMedian(mergedBins.verysteep, 21.0),
    extreme: computeMedian(mergedBins.extreme, 28.0)
  };

  const fatigueLambda = deriveFatigueDecayLambda(allFatigueSamples);

  // Compute Downhill Brake Factor (beta = speed_desc / speed_flat = pace_flat / pace_desc)
  const downhillBrakeBeta = parseFloat((basePaces.flat / basePaces.descent).toFixed(2));

  // Compute median aid station rest break duration in minutes
  const restDurationMin = allPausesSec.length > 0
    ? Math.round(computeMedian(allPausesSec, 900) / 60)
    : 15;

  return {
    id: `profile_empirical_${Date.now()}`,
    name: profileName,
    basePaces,
    restDurationMin,
    enduranceMetrics: {
      fatigueDecayLambda: fatigueLambda,
      downhillBrakeBeta,
      sourceTracksCount: tracksTelemetry.length,
      calibrationDate: new Date().toISOString().split("T")[0]
    }
  };
}
