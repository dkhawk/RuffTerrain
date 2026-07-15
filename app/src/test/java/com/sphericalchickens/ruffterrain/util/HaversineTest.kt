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

package com.sphericalchickens.ruffterrain.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for Haversine calculations including distance, bearing, and distance to segment.
 */
class HaversineTest {

    @Test
    fun testDistance_calculatesCorrectly() {
        // Boulder to Denver: roughly 38-40 km
        val distance = Haversine.distance(40.0150, -105.2705, 39.7392, -104.9903)
        assertEquals(38900.0, distance, 500.0) // 38.9 km with 500m tolerance
    }

    @Test
    fun testBearing_calculatesCorrectly() {
        // Due North
        val bNorth = Haversine.bearing(40.0, -105.0, 41.0, -105.0)
        assertEquals(0.0, bNorth, 1.0)

        // Due East
        val bEast = Haversine.bearing(40.0, -105.0, 40.0, -104.0)
        assertEquals(90.0, bEast, 1.0)

        // Due South
        val bSouth = Haversine.bearing(40.0, -105.0, 39.0, -105.0)
        assertEquals(180.0, bSouth, 1.0)

        // Due West
        val bWest = Haversine.bearing(40.0, -105.0, 40.0, -106.0)
        assertEquals(270.0, bWest, 1.0)
    }

    @Test
    fun testDistanceToSegment_calculatesCorrectly() {
        // Line segment A to B: (40.0, -105.0) to (40.0, -104.0) (a horizontal line segment of ~85km)
        val latA = 40.0
        val lonA = -105.0
        val latB = 40.0
        val lonB = -104.0

        // Point P is directly on the segment (e.g., halfway)
        val dOn = Haversine.distanceToSegment(40.0, -104.5, latA, lonA, latB, lonB)
        assertEquals(0.0, dOn, 1.0) // On the line segment, deviation should be 0

        // Point P is off the segment but projects onto it (10km directly north of the midpoint)
        // 1 degree latitude ~ 111.12 km. So 0.09 degrees North is ~10km.
        val dOff = Haversine.distanceToSegment(40.09, -104.5, latA, lonA, latB, lonB)
        assertEquals(10000.0, dOff, 200.0) // ~10,000 meters

        // Point P is past point A (projects to A)
        val dPastA = Haversine.distanceToSegment(40.0, -105.1, latA, lonA, latB, lonB)
        // Distance to A should be ~11.1km
        val distToA = Haversine.distance(40.0, -105.1, latA, lonA)
        assertEquals(distToA, dPastA, 1.0)
    }
}
