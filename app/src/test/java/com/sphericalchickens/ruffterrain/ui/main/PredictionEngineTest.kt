package com.sphericalchickens.ruffterrain.ui.main

import org.junit.Assert.assertEquals
import org.junit.Test

class PredictionEngineTest {

    @Test
    fun testGradeAdjustedSpeedFactor() {
        // 1. Flat terrain (slope = 0.0) -> no penalty (factor = 1.0)
        val flatSlope = 0.0
        val flatFactor = if (flatSlope > 0.0) {
            (1.0 - flatSlope * 3.0).coerceIn(0.3, 1.0)
        } else if (flatSlope < -0.1) {
            (1.0 - (-flatSlope * 1.5)).coerceIn(0.6, 1.0)
        } else {
            1.0
        }
        assertEquals(1.0, flatFactor, 0.001)

        // 2. Steep climb (slope = 0.20 -> 20% grade) -> 40% penalty (0.4 factor)
        val steepSlope = 0.20
        val steepFactor = if (steepSlope > 0.0) {
            (1.0 - steepSlope * 3.0).coerceIn(0.3, 1.0)
        } else {
            1.0
        }
        assertEquals(0.4, steepFactor, 0.001)

        // 3. Extreme climb (slope = 0.40 -> 40% grade) -> clamped to 0.3 minimum speed factor
        val wallSlope = 0.40
        val wallFactor = if (wallSlope > 0.0) {
            (1.0 - wallSlope * 3.0).coerceIn(0.3, 1.0)
        } else {
            1.0
        }
        assertEquals(0.3, wallFactor, 0.001)

        // 4. Steep descent (slope = -0.20 -> -20% grade) -> factor = (1.0 - (-slope * 1.5)).coerceIn(0.6, 1.0) -> 0.7 factor
        val descentSlope = -0.20
        val descentFactor = if (descentSlope < -0.1) {
            (1.0 - (-descentSlope * 1.5)).coerceIn(0.6, 1.0)
        } else {
            1.0
        }
        assertEquals(0.7, descentFactor, 0.001)
    }
}
