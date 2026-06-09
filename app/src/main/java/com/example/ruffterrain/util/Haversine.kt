package com.example.ruffterrain.util

import kotlin.math.*

/**
 * Utility to calculate spatial distances using the Haversine formula.
 */
object Haversine {
    private const val EARTH_RADIUS_METERS = 6371000.0

    /**
     * Calculates the distance between two lat/lng pairs in meters.
     */
    fun distance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val deltaPhi = Math.toRadians(lat2 - lat1)
        val deltaLambda = Math.toRadians(lon2 - lon1)

        val a = sin(deltaPhi / 2.0).pow(2) +
                cos(phi1) * cos(phi2) * sin(deltaLambda / 2.0).pow(2)
        val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
        return EARTH_RADIUS_METERS * c
    }
}
