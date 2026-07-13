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

package com.example.ruffterrain.ui.main

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests validating terrain gradient classification, zero and negative gradient detection,
 * and alignment with route alert and segment color schemes.
 */
class GradientVisualizerTest {

    @Test
    fun classifyGradient_handlesZeroAndNegativeGradients() {
        // Negative gradients (Descent)
        assertEquals(GradientTier.DESCENT, classifyGradient(-6.5))
        assertEquals(GradientTier.DESCENT, classifyGradient(-2.1))

        // Zero and flat gradients
        assertEquals(GradientTier.FLAT, classifyGradient(0.0))
        assertEquals(GradientTier.FLAT, classifyGradient(-1.5))
        assertEquals(GradientTier.FLAT, classifyGradient(1.5))
        assertEquals(GradientTier.FLAT, classifyGradient(null))
        assertEquals(GradientTier.FLAT, classifyGradient(Double.NaN))
    }

    @Test
    fun classifyGradient_handlesPositiveClimbTiers() {
        assertEquals(GradientTier.MODERATE_CLIMB, classifyGradient(3.2))
        assertEquals(GradientTier.MODERATE_CLIMB, classifyGradient(5.0))

        assertEquals(GradientTier.STEEP_CLIMB, classifyGradient(6.8))
        assertEquals(GradientTier.STEEP_CLIMB, classifyGradient(8.0))

        assertEquals(GradientTier.VERY_STEEP, classifyGradient(9.1))
        assertEquals(GradientTier.VERY_STEEP, classifyGradient(10.0))

        assertEquals(GradientTier.EXTREME_CLIMB, classifyGradient(12.5))
    }

    @Test
    fun gradientTiers_alignWithAlertAndSegmentColorScheme() {
        // Verify color alignment with standard UI alert and 3D segment color scheme
        assertEquals(Color(0xFF10B981), GradientTier.DESCENT.color)
        assertEquals(Color(0xFF3B82F6), GradientTier.FLAT.color)
        assertEquals(Color(0xFFF59E0B), GradientTier.MODERATE_CLIMB.color)
        assertEquals(Color(0xFFF97316), GradientTier.STEEP_CLIMB.color)
        assertEquals(Color(0xFFEF4444), GradientTier.VERY_STEEP.color)
        assertEquals(Color(0xFFB91C1C), GradientTier.EXTREME_CLIMB.color)
    }

    @Test
    fun gradientTiers_haveConsistentLabels() {
        assertNotNull(GradientTier.DESCENT.label)
        assertTrue(GradientTier.DESCENT.label.contains("DESCENT"))
        assertTrue(GradientTier.MODERATE_CLIMB.label.contains("MODERATE"))
    }
}
