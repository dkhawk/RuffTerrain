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

package com.sphericalchickens.ruffterrain.ui.main

import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RoutePoint
import com.sphericalchickens.ruffterrain.data.model.Waypoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import com.sphericalchickens.ruffterrain.data.DataRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

/**
 * Unit tests validating GPS tracking, trail projection, active climbs detection,
 * and off-trail deviation calculations inside MainScreenViewModel.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MainScreenViewModelLocationTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // Simple mock repository for testing
    private val mockRepository = object : DataRepository {
        private val _courseData = MutableStateFlow<CourseData?>(null)
        override val courseData: StateFlow<CourseData?> = _courseData.asStateFlow()

        override fun loadCourse(inputStream: java.io.InputStream): Result<CourseData> {
            val course = createMockCourse()
            _courseData.value = course
            return Result.success(course)
        }
    }

    private fun createMockCourse(): CourseData {
        // Linear path North along longitude -105.0
        // Point 1: 40.0, -105.0 (dist = 0m, ele = 100m)
        // Point 2: 40.01, -105.0 (dist = ~1111.3m, ele = 110m)
        // Point 3: 40.02, -105.0 (dist = ~2222.6m, ele = 160m) - A total rise of 60m over 2.2km
        val p1 = RoutePoint(40.0, -105.0, 100.0, 0.0, climb = 0.0, grade = 0.0)
        val p2 = RoutePoint(40.01, -105.0, 110.0, 1111.3, climb = 10.0, grade = 0.9)
        val p3 = RoutePoint(40.02, -105.0, 160.0, 2222.6, climb = 60.0, grade = 4.5)

        val waypoints = listOf(
            Waypoint("wpt-start", "Start Line", 40.0, -105.0, 100.0, "start", distanceMeters = 0.0),
            Waypoint("wpt-summit", "Pass Summit", 40.02, -105.0, 160.0, "pass", distanceMeters = 2222.6)
        )

        return CourseData(
            name = "Mock Climb Course",
            points = listOf(p1, p2, p3),
            waypoints = waypoints,
            totalDistance = 2222.6,
            elevationGain = 60.0,
            elevationLoss = 0.0
        )
    }

    @Test
    fun testUpdateUserLocation_snapsToTrailAndComputesDeviation() = runTest {
        val viewModel = MainScreenViewModel(mockRepository)
        
        // Load the mock course
        viewModel.loadCourseBytes(ByteArray(0))
        val stateAfterLoad = viewModel.uiState.value
        assertNotNull(stateAfterLoad.courseData)
        assertEquals("Mock Climb Course", stateAfterLoad.courseData?.name)

        // 1. Simulate user directly on the path at Point 2
        viewModel.updateUserLocation(40.01, -105.0)
        val stateOnPath = viewModel.uiState.value
        assertEquals(0.5, stateOnPath.scrubberProgress, 0.05) // Should be halfway (around 0.5)
        assertEquals(0.0, stateOnPath.deviationMeters, 5.0) // Deviation should be near 0

        // 2. Simulate user 100 meters east of Point 2 (off-trail)
        // 0.001 degrees longitude at 40° latitude is roughly 85 meters
        viewModel.updateUserLocation(40.01, -105.00117)
        val stateOffPath = viewModel.uiState.value
        assertEquals(0.5, stateOffPath.scrubberProgress, 0.05) // Still halfway along course
        assertEquals(100.0, stateOffPath.deviationMeters, 10.0) // Deviation ~100m
        assertTrue(stateOffPath.deviationMeters > 20.0) // Triggers deviation warnings
    }

    @Test
    fun testDetectClimb_returnsCorrectClimbDetails() = runTest {
        val viewModel = MainScreenViewModel(mockRepository)
        viewModel.loadCourseBytes(ByteArray(0))

        // Trigger user position at start
        viewModel.updateUserLocation(40.0, -105.0)
        val state = viewModel.uiState.value
        
        // Verify climb details
        val climb = state.activeClimbInfo
        assertNotNull(climb)
        assertEquals("Climb to Pass Summit", climb!!.name)
        assertEquals(2222.6, climb.distanceRemainingM, 50.0)
        assertEquals(60.0, climb.elevationGainRemainingM, 5.0)
        assertEquals(2.7, climb.averageGrade, 0.5) // ~60m gain over 2222m is 2.7%
    }
}
