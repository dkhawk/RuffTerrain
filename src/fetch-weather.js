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

// Simple in-memory cache for weather forecasts to avoid hitting API rate limits during scrubbing
const weatherCache = new Map();

/**
 * Fetches hourly weather forecast from Google Weather API.
 * Uses local caching based on rounded lat/lon coordinates and the current hour.
 * @param {number} lat Latitude
 * @param {number} lon Longitude
 * @param {number} hours Number of hours to forecast (default 3)
 * @param {string} apiKey Google Maps API Key
 * @returns {Promise<Object>} The forecast response object
 */
export async function fetchWeatherForecast(lat, lon, hours = 3, apiKey) {
  if (!apiKey) {
    throw new Error("Google Maps API key is missing. Set it in Config Settings.");
  }

  // Round coordinates to 3 decimal places (~110m precision) to leverage caching during scrubbing
  const latRounded = Number(lat).toFixed(3);
  const lonRounded = Number(lon).toFixed(3);
  
  // Cache key expires hourly
  const currentHour = new Date().toISOString().substring(0, 13); // "YYYY-MM-DDTHH"
  const cacheKey = `${latRounded},${lonRounded},${hours},${currentHour}`;

  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey);
  }

  const baseUrl = `https://weather.googleapis.com/v1/forecast/hours:lookup?key=${apiKey}&location.latitude=${latRounded}&location.longitude=${lonRounded}&hours=${hours}`;

  try {
    let forecastHours = [];
    let nextPageToken = null;
    let pagesFetched = 0;

    do {
      let url = baseUrl;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Weather API Error (${response.status}): ${errorText || response.statusText}`);
      }

      const data = await response.json();
      if (data.forecastHours && data.forecastHours.length > 0) {
        forecastHours = forecastHours.concat(data.forecastHours);
      }

      nextPageToken = data.nextPageToken;
      pagesFetched++;
    } while (nextPageToken && forecastHours.length < hours && pagesFetched < 10);

    const mergedData = { forecastHours };
    weatherCache.set(cacheKey, mergedData);
    return mergedData;
  } catch (error) {
    console.error("Failed to fetch weather forecast:", error);
    throw error;
  }
}

/**
 * Map API weather conditions to user-friendly emojis and visual styles.
 * @param {string} type The condition type returned by the API (e.g. "CLOUDY", "CLEAR")
 * @returns {Object} Emoji symbol and display name
 */
export function getWeatherConditionStyle(type) {
  const normalizedType = (type || "").toUpperCase();

  const mappings = {
    "CLEAR": { emoji: "☀️", label: "Clear" },
    "SUNNY": { emoji: "☀️", label: "Sunny" },
    "MOSTLY_CLEAR": { emoji: "🌤️", label: "Mostly Clear" },
    "PARTLY_CLOUDY": { emoji: "⛅", label: "Partly Cloudy" },
    "MOSTLY_CLOUDY": { emoji: "🌥️", label: "Mostly Cloudy" },
    "CLOUDY": { emoji: "☁️", label: "Cloudy" },
    "FOG": { emoji: "🌫️", label: "Foggy" },
    "FOGGY": { emoji: "🌫️", label: "Foggy" },
    "HAZE": { emoji: "🌫️", label: "Haze" },
    "MIST": { emoji: "🌫️", label: "Mist" },
    "DRIZZLE": { emoji: "🌧️", label: "Drizzle" },
    "RAIN": { emoji: "🌧️", label: "Rain" },
    "HEAVY_RAIN": { emoji: "⛈️", label: "Heavy Rain" },
    "SHOWERS": { emoji: "🌧️", label: "Showers" },
    "THUNDERSTORM": { emoji: "⛈️", label: "Thunderstorm" },
    "SNOW": { emoji: "❄️", label: "Snow" },
    "HEAVY_SNOW": { emoji: "❄️", label: "Heavy Snow" },
    "SLEET": { emoji: "🌧️", label: "Sleet" },
    "WINDY": { emoji: "💨", label: "Windy" }
  };

  return mappings[normalizedType] || { emoji: "🌡️", label: normalizedType.replace(/_/g, " ") };
}

/**
 * Calculates the elapsed hours up to a given cumulative distance.
 * Leverages the execution plan if generated, otherwise falls back to a linear duration estimate.
 * @param {Object} route Active route details
 * @param {number} dist_m Cumulative distance in meters
 * @param {number} durationHrs Fallback duration in hours
 * @returns {number} Expected elapsed hours
 */
export function getElapsedHoursAtDistance(route, dist_m, durationHrs = 4.0) {
  if (!route) return 0;
  if (route.executionPlan && route.executionPlan.sectors && route.executionPlan.sectors.length > 0) {
    let elapsedHrs = 0;
    const sectors = route.executionPlan.sectors.slice().sort((a, b) => a.start_dist_m - b.start_dist_m);
    for (const sec of sectors) {
      if (dist_m > sec.end_dist_m) {
        const secDistMi = (sec.end_dist_m - sec.start_dist_m) / 1609.344;
        const secHrs = secDistMi * (sec.target_pace_min / 60);
        elapsedHrs += secHrs;
      } else if (dist_m >= sec.start_dist_m) {
        const partialDistMi = (dist_m - sec.start_dist_m) / 1609.344;
        const partialHrs = partialDistMi * (sec.target_pace_min / 60);
        elapsedHrs += partialHrs;
        return elapsedHrs;
      }
    }
    // If the distance exceeds the final sector's end distance, project the remaining distance using the final sector's pace
    const lastSec = sectors[sectors.length - 1];
    if (dist_m > lastSec.end_dist_m) {
      const extraDistMi = (dist_m - lastSec.end_dist_m) / 1609.344;
      const extraHrs = extraDistMi * (lastSec.target_pace_min / 60);
      elapsedHrs += extraHrs;
    }
    return elapsedHrs;
  } else {
    const progressFraction = route.totalDistance > 0 ? Math.min(1, Math.max(0, dist_m / route.totalDistance)) : 0;
    return progressFraction * durationHrs;
  }
}

/**
 * Calculates the weather display data including expected condition and temperature range for a window.
 * @param {Object} activeRoute Active route
 * @param {number} dist_m Distance of the waypoint/pass
 * @param {Object} forecastData Forecast hours list from API
 * @param {number} arrivalMs Expected arrival time in ms
 * @returns {Object} Selected hour, display hours subset, and temperature range
 */
export function getWeatherWindowDetails(activeRoute, dist_m, forecastData, arrivalMs) {
  if (!forecastData || !forecastData.forecastHours || forecastData.forecastHours.length === 0) {
    return null;
  }
  
  const totalDist = activeRoute && activeRoute.totalDistance > 0 ? activeRoute.totalDistance : 1;
  const progress = Math.min(1, Math.max(0, dist_m / totalDist));
  
  // Window size W scales linearly from 2 hours at start to 5 hours at end of the course
  const W = Math.round(2 + progress * 3); // 2 to 5 hours
  
  // Find selected hour closest to arrivalMs
  let selectedHour = forecastData.forecastHours[0];
  let minDiff = Infinity;
  let selectedIdx = 0;
  
  forecastData.forecastHours.forEach((hr, idx) => {
    let hrMs = Date.now();
    if (hr.time) {
      hrMs = new Date(hr.time).getTime();
    } else if (hr.interval && hr.interval.startTime) {
      hrMs = new Date(hr.interval.startTime).getTime();
    } else if (hr.displayDateTime) {
      const dt = hr.displayDateTime;
      const arrivalDate = new Date(arrivalMs);
      hrMs = new Date(dt.year || arrivalDate.getFullYear(), (dt.month || arrivalDate.getMonth() + 1) - 1, dt.day || arrivalDate.getDate(), dt.hours || 0).getTime();
    }
    const diff = Math.abs(hrMs - arrivalMs);
    if (diff < minDiff) {
      minDiff = diff;
      selectedHour = hr;
      selectedIdx = idx;
    }
  });
  
  // Slice W hours centered on selectedIdx
  const halfBefore = Math.floor((W - 1) / 2);
  const startIdx = Math.max(0, selectedIdx - halfBefore);
  const displayHours = forecastData.forecastHours.slice(startIdx, Math.min(forecastData.forecastHours.length, startIdx + W));
  
  let minTemp = Infinity;
  let maxTemp = -Infinity;
  displayHours.forEach(hr => {
    const t = hr.temperature?.degrees ?? 0;
    if (t < minTemp) minTemp = t;
    if (t > maxTemp) maxTemp = t;
  });
  
  return {
    selectedHour,
    minTemp,
    maxTemp,
    displayHours,
    windowSize: W
  };
}
