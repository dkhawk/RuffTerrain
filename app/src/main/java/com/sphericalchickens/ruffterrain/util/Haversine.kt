package com.sphericalchickens.ruffterrain.util

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

    /**
     * Calculates the initial bearing from (lat1, lon1) to (lat2, lon2) in degrees (0..359).
     */
    fun bearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val deltaLambda = Math.toRadians(lon2 - lon1)

        val y = sin(deltaLambda) * cos(phi2)
        val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(deltaLambda)
        val theta = atan2(y, x)
        return (Math.toDegrees(theta) + 360.0) % 360.0
    }

    /**
     * Calculates the shortest distance in meters from a point P (lat, lon) to a line segment AB.
     */
    fun distanceToSegment(lat: Double, lon: Double, latA: Double, lonA: Double, latB: Double, lonB: Double): Double {
        val latAvg = Math.toRadians((latA + latB + lat) / 3.0)
        val cosLat = cos(latAvg)
        val metersPerDegree = 111132.95

        val xA = 0.0
        val yA = 0.0

        val xB = (lonB - lonA) * metersPerDegree * cosLat
        val yB = (latB - latA) * metersPerDegree

        val xP = (lon - lonA) * metersPerDegree * cosLat
        val yP = (lat - latA) * metersPerDegree

        val dx = xB - xA
        val dy = yB - yA
        val lenSq = dx * dx + dy * dy

        if (lenSq < 1e-4) {
            return distance(lat, lon, latA, lonA)
        }

        val r = ((xP - xA) * dx + (yP - yA) * dy) / lenSq

        return when {
            r <= 0.0 -> distance(lat, lon, latA, lonA)
            r >= 1.0 -> distance(lat, lon, latB, lonB)
            else -> {
                val projX = xA + r * dx
                val projY = yA + r * dy
                val distSq = (xP - projX) * (xP - projX) + (yP - projY) * (yP - projY)
                sqrt(distSq)
            }
        }
    }
}

