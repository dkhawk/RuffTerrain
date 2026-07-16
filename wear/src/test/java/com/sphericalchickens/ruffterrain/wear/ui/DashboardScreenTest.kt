package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DashboardScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun testNoCourseLoadedMessage() {
        composeTestRule.setContent {
            DashboardScreen(course = null, progress = null)
        }

        composeTestRule.onNodeWithText("No Course Loaded").assertIsDisplayed()
        composeTestRule.onNodeWithText("Please open RuffTerrain on your phone and select a route.").assertIsDisplayed()
    }

    @Test
    fun testDashboardMetricsDisplay() {
        val course = CourseData(
            name = "Canyon Route",
            points = emptyList(),
            totalDistance = 10000.0,
            elevationGain = 500.0
        )

        // Elapsed time: 1 hr 15 mins (4500 seconds)
        // Distance: 5000 meters (5 km)
        // Next station: "Halfway Station" at 7.5km (2500m remaining)
        val progress = RunnerProgress(
            elapsedTimeMs = 4500 * 1000L,
            distanceRunMeters = 5000.0,
            nextStationName = "Halfway Station",
            nextStationDistanceRemainingM = 2500.0
        )

        composeTestRule.setContent {
            DashboardScreen(course = course, progress = progress)
        }

        // Check Course Name
        composeTestRule.onNodeWithText("CANYON ROUTE").assertIsDisplayed()

        // Check Elapsed Time (1:15:00)
        composeTestRule.onNodeWithText("01:15:00").assertIsDisplayed()

        // Check KM Run
        composeTestRule.onNodeWithText("5.00").assertIsDisplayed()

        // Check Pace (/KM PACE)
        // 4500 seconds / 5 km = 900 seconds per km = 15:00 min/km
        composeTestRule.onNodeWithText("15:00").assertIsDisplayed()

        // Check Next Waypoint
        composeTestRule.onNodeWithText("➡️ Halfway Station: 2.5k").assertIsDisplayed()
    }
}
