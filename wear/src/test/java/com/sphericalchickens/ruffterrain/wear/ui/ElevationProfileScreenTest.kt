package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RoutePoint
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ElevationProfileScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun testElevationProfileRendersSuccessfully() {
        val points = listOf(
            RoutePoint(latitude = 0.0, longitude = 0.0, elevation = 100.0, distance = 0.0),
            RoutePoint(latitude = 0.01, longitude = 0.01, elevation = 200.0, distance = 1000.0),
            RoutePoint(latitude = 0.02, longitude = 0.02, elevation = 300.0, distance = 2000.0),
            RoutePoint(latitude = 0.03, longitude = 0.03, elevation = 150.0, distance = 3000.0)
        )

        val course = CourseData(
            name = "Peak Trail",
            points = points,
            totalDistance = 3000.0,
            elevationGain = 200.0,
            elevationLoss = 150.0
        )

        val progress = RunnerProgress(
            elapsedTimeMs = 1200 * 1000L,
            distanceRunMeters = 1500.0 // Runner is halfway through
        )

        composeTestRule.setContent {
            ElevationProfileScreen(course = course, progress = progress)
        }

        // Header check
        composeTestRule.onNodeWithText("ELEVATION PROFILE").assertIsDisplayed()

        // Displays current elevation (around 200m when snapped/fractioned)
        // Point index for 1500m (halfway between 1000m and 2000m) is checked:
        // Current implementation resolves index by 1500/3000 = 0.5 fraction -> index 1 (elevation 200m)
        composeTestRule.onNodeWithText("200 m").assertIsDisplayed()

        // Verify start and end distance labels
        composeTestRule.onNodeWithText("0.0k").assertIsDisplayed()
        composeTestRule.onNodeWithText("1.5k done").assertIsDisplayed()
        composeTestRule.onNodeWithText("3.0k").assertIsDisplayed()
    }
}
