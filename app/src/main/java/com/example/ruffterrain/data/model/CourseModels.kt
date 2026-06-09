package com.example.ruffterrain.data.model

import kotlinx.serialization.Serializable

/**
 * Represents a single coordinates coordinate point along the trail.
 */
@Serializable
data class RoutePoint(
    val latitude: Double,
    val longitude: Double,
    val elevation: Double, // In meters
    val distance: Double,  // Cumulative distance from start in meters
    val climb: Double = 0.0,
    val descent: Double = 0.0,
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

/**
 * Unified course data wrapper holding parsed track metrics, computed alerts, and forecasts.
 */
@Serializable
data class CourseData(
    val name: String,
    val points: List<RoutePoint>,
    val alerts: List<CourseAlert> = emptyList(),
    val weatherForecast: List<WeatherCondition> = emptyList(),
    val totalDistance: Double = 0.0,
    val elevationGain: Double = 0.0,
    val elevationLoss: Double = 0.0
)
