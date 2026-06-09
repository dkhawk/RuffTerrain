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

  const url = `https://weather.googleapis.com/v1/forecast/hours:lookup?key=${apiKey}&location.latitude=${latRounded}&location.longitude=${lonRounded}&hours=${hours}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Weather API Error (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    weatherCache.set(cacheKey, data);
    return data;
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
