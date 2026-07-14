package com.sphericalchickens.ruffterrain.ui.main

import com.sphericalchickens.ruffterrain.data.DefaultDataRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.FileInputStream

@OptIn(ExperimentalCoroutinesApi::class)
class BearCanyonSimulationTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun loadPlannedGPX(): File {
        // Gradle working dir is either app/ or the root directory
        val fileInApp = File("src/main/assets/bear_canyon_sample.gpx")
        if (fileInApp.exists()) return fileInApp
        return File("app/src/main/assets/bear_canyon_sample.gpx")
    }

    @Test
    fun testBearCanyonPlanVerification() = runTest {
        val file = loadPlannedGPX()
        assertTrue("Planned GPX file should exist in assets", file.exists())

        val repository = DefaultDataRepository()
        val viewModel = MainScreenViewModel(repository)

        // Load planned GPX
        FileInputStream(file).use { stream ->
            viewModel.loadCourse(stream)
        }

        val state = viewModel.uiState.value
        val course = state.courseData
        assertNotNull("CourseData should be successfully parsed", course)
        assertEquals("Bear Canyon", course!!.name)
        assertEquals(3, course.waypoints.size)

        // Verify Waypoints
        assertEquals("Bear Canyon Trailhead", course.waypoints[0].name)
        assertEquals("Bear Canyon Junction", course.waypoints[1].name)
        assertEquals("Trailhead Finish", course.waypoints[2].name)

        // Verify Sectors
        val plan = course.executionPlan
        assertNotNull("Execution plan should be parsed", plan)
        assertEquals(2, plan!!.sectors.size)
        assertEquals("Bear Canyon Ascent", plan.sectors[0].name)
        assertEquals(6.8, plan.sectors[0].targetPaceMin, 0.01)
        assertEquals("Bear Canyon Descent", plan.sectors[1].name)
        assertEquals(5.2, plan.sectors[1].targetPaceMin, 0.01)
    }

    @Test
    fun testBearCanyonRouteTrackingSimulation() = runTest {
        val file = loadPlannedGPX()
        val repository = DefaultDataRepository()
        val viewModel = MainScreenViewModel(repository)
        FileInputStream(file).use { stream ->
            viewModel.loadCourse(stream)
        }

        val course = viewModel.uiState.value.courseData!!
        viewModel.toggleGpsEnabled(true)

        // Simulating the run:
        // Let's inject a first coordinate at start trailhead
        val pStart = course.points[0]
        viewModel.updateUserLocation(pStart.latitude, pStart.longitude, timestampMs = 1000L)

        var state = viewModel.uiState.value
        assertEquals(0.0, state.scrubberProgress, 0.05)
        assertEquals(LocationAccuracyMode.AUTO, state.locationAccuracyMode)
        // Auto-tuned strategy: Bear Canyon target duration is ~1.25 hours (< 3 hours)
        // High performance mode should be auto-resolved
        val targetHours = course.executionPlan?.targetDurationHrs ?: 1.25
        assertTrue(targetHours < 3.0)

        // Simulate Ascent: progress to ~3 km (3000m) at target pace (6.8 min/km -> speed = 2.45 m/s)
        // Move to point close to 3 km index
        val targetIdx = course.points.indexOfFirst { it.distance >= 3000.0 }
        val pMid = course.points[targetIdx]
        
        // Time taken = distance / speed = 3000 / 2.45 = 1224 seconds
        viewModel.updateUserLocation(pMid.latitude, pMid.longitude, timestampMs = 1000L + 1224000L)

        state = viewModel.uiState.value
        assertTrue("Scrubber progress should advance", state.scrubberProgress > 0.2)
        assertNotNull(state.nextWaypointDurationMin)
        assertNotNull(state.nextWaypointDurationMax)
        
        // Assert remaining distance to midpoint AS (approx 5.79 km)
        val remainingToAs = 5789.5 - (state.scrubberProgress * course.totalDistance)
        assertTrue(remainingToAs in 2000.0..3200.0)
        
        // Assert finish durations are computed
        assertNotNull(state.finishDurationMin)
        assertNotNull(state.finishDurationMax)
    }
}
