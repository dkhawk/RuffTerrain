package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.sphericalchickens.ruffterrain.data.model.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CheckpointsScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun testCheckpointsListingAndStatuses() {
        // Create stations
        val station1 = Waypoint(
            id = "station-1",
            name = "Aid Station 1",
            latitude = 0.0,
            longitude = 0.0,
            elevation = 100.0,
            symbol = "icons/aid.svg",
            distanceMeters = 3000.0, // 3 km
            extensions = StationExtensions(
                station = Station(
                    id = "station-1",
                    type = "aid",
                    passes = listOf(Pass(num = 1, distM = 3000.0, label = "AS1", cutoffClock = "12:00"))
                )
            )
        )

        val station2 = Waypoint(
            id = "station-2",
            name = "Aid Station 2",
            latitude = 0.0,
            longitude = 0.0,
            elevation = 150.0,
            symbol = "icons/aid.svg",
            distanceMeters = 8000.0, // 8 km
            extensions = StationExtensions(
                station = Station(
                    id = "station-2",
                    type = "aid",
                    passes = listOf(Pass(num = 1, distM = 8000.0, label = "AS2", cutoffClock = "15:30"))
                )
            )
        )

        val course = CourseData(
            name = "Test Route",
            points = emptyList(),
            waypoints = listOf(station1, station2),
            totalDistance = 10000.0
        )

        // Scenario A: Runner has run 5000m (5 km)
        // Station 1 (3 km) should be PASSED.
        // Station 2 (8 km) should be upcoming (3 km remaining) with Cutoff: 15:30.
        val progress = RunnerProgress(
            elapsedTimeMs = 3600 * 1000L,
            distanceRunMeters = 5000.0,
            nextStationName = "Aid Station 2",
            nextStationDistanceRemainingM = 3000.0
        )

        composeTestRule.setContent {
            CheckpointsScreen(course = course, progress = progress)
        }

        // Title header
        composeTestRule.onNodeWithText("AID STATIONS").assertIsDisplayed()

        // Station 1 checks
        composeTestRule.onNodeWithText("Aid Station 1").assertIsDisplayed()
        composeTestRule.onNodeWithText("3.0 km").assertIsDisplayed()
        composeTestRule.onNodeWithText("PASSED").assertIsDisplayed()

        // Station 2 checks
        composeTestRule.onNodeWithText("Aid Station 2").assertIsDisplayed()
        composeTestRule.onNodeWithText("8.0 km").assertIsDisplayed()
        composeTestRule.onNodeWithText("+3.0k").assertIsDisplayed()
        composeTestRule.onNodeWithText("Cutoff: 15:30").assertIsDisplayed()
    }
}
