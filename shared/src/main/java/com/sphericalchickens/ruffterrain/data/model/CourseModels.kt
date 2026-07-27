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

package com.sphericalchickens.ruffterrain.data.model

import kotlinx.serialization.Serializable

/**
 * Represents a single coordinate point along the trail.
 */
@Serializable
data class RoutePoint(
    val latitude: Double,
    val longitude: Double,
    val elevation: Double, // In meters
    val distance: Double,  // Cumulative distance from start in meters
    val climb: Double = 0.0,
    val descent: Double = 0.0,
    val grade: Double = 0.0, // Gradient percentage (%) calculated over ~30m baseline window
    val time: String? = null // Timestamp if available
)

/**
 * Categories of safety warnings or route caution markers.
 */
enum class AlertType {
    STEEP_CLIMB,
    DESERT_ZONE,
    ROUTE_DISCREPANCY
}

/**
 * Spatial warning trigger bounding box or range.
 */
@Serializable
data class CourseAlert(
    val type: AlertType,
    val description: String,
    val startDistance: Double,
    val endDistance: Double,
    val severity: String // "warning" | "caution"
)

/**
 * Localized hourly weather forecast metrics mapped to a timestamp.
 */
@Serializable
data class WeatherCondition(
    val timestamp: String,
    val temperature: Double,
    val windSpeed: Double,
    val windDirection: Double,
    val humidity: Double,
    val rainProbability: Double,
    val conditionEmoji: String,
    val conditionText: String
)

@Serializable
data class Pass(
    val num: Int,
    val distM: Double,
    val label: String? = null,
    val cutoffClock: String? = null,
    val cutoffElapsed: String? = null,
    val targetArrival: String? = null,
    val stretchStrategy: String? = null
)

@Serializable
data class Accessibility(
    val crewAllowed: Boolean = false,
    val pacerAllowed: Boolean = false,
    val vehicleTier: String = "none",
    val dropBagAllowed: Boolean = false
)

@Serializable
data class Services(
    val water: Boolean = false,
    val unmanagedWater: Boolean = false,
    val food: Boolean = false,
    val hotFood: Boolean = false,
    val toilets: Boolean = false,
    val medical: Boolean = false,
    val sleepArea: Boolean = false
)

@Serializable
data class NavigationAlert(
    val severity: String = "info",
    val turnType: String = "straight",
    val prompt: String = ""
)

@Serializable
data class Station(
    val id: String,
    val type: String,
    val subtype: String? = null,
    val passes: List<Pass> = emptyList(),
    val accessibility: Accessibility = Accessibility(),
    val services: Services = Services(),
    val navigationAlert: NavigationAlert? = null
)

@Serializable
data class StationExtensions(
    val station: Station? = null
)

@Serializable
data class Waypoint(
    val id: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val elevation: Double,
    val symbol: String,
    val description: String = "",
    val closestTrackpointIndex: Int = 0,
    val distanceMeters: Double = 0.0,
    val extensions: StationExtensions? = null
)

@Serializable
data class Sector(
    val startDistM: Double,
    val endDistM: Double,
    val name: String,
    val targetPaceMin: Double,
    val strategy: String = "",
    val nutrition: String = "",
    val bestPaceMin: Double = targetPaceMin,
    val worstPaceMin: Double = targetPaceMin
)

@Serializable
data class ExecutionPlan(
    val startTime: String? = null,
    val targetDurationHrs: Double? = null,
    val sectors: List<Sector> = emptyList()
)

/**
 * Unified course data wrapper holding parsed track metrics, computed alerts, and forecasts.
 */
@Serializable
data class CourseData(
    val name: String,
    val points: List<RoutePoint>,
    val waypoints: List<Waypoint> = emptyList(),
    val alerts: List<CourseAlert> = emptyList(),
    val weatherForecast: List<WeatherCondition> = emptyList(),
    val totalDistance: Double = 0.0,
    val elevationGain: Double = 0.0,
    val elevationLoss: Double = 0.0,
    val executionPlan: ExecutionPlan? = null
)

/**
 * Map rendering modes available in the application viewport.
 */
enum class MapMode {
    MAP_2D,
    MAP_3D
}

/**
 * Application operations modes.
 */
enum class AppMode {
    IMPORT_EDIT,
    SIMULATION,
    RUNNING
}

@Serializable
data class ClimbInfo(
    val name: String,
    val distanceRemainingM: Double,
    val elevationGainRemainingM: Double,
    val averageGrade: Double
)

@Serializable
data class RunnerProgress(
    val elapsedTimeMs: Long,
    val distanceRunMeters: Double,
    val heartRate: Int = 0,
    val currentPaceMinPerKm: Double = 0.0,
    val nextStationName: String = "",
    val nextStationDistanceRemainingM: Double = 0.0
)
