package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.ExecutionPlan
import com.sphericalchickens.ruffterrain.data.model.RoutePoint
import com.sphericalchickens.ruffterrain.data.model.Sector
import com.sphericalchickens.ruffterrain.data.model.Waypoint
import com.sphericalchickens.ruffterrain.wear.engine.WearLocationEngine
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ObstacleHudScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun testObstacleHudRendersCorrectly() {
        val context = RuntimeEnvironment.getApplication()
        val locationEngine = WearLocationEngine(context)

        // Setup a mock course with a climb and waypoints
        val course = CourseData(
            name = "Imogene Pass",
            points = listOf(
                RoutePoint(37.9, -107.7, 2800.0, 0.0),
                // Climb: 500m distance, 100m elevation gain
                RoutePoint(37.901, -107.7, 2850.0, 250.0),
                RoutePoint(37.902, -107.7, 2900.0, 500.0),
                RoutePoint(37.903, -107.7, 2900.0, 1000.0)
            ),
            waypoints = listOf(
                Waypoint(
                    id = "aid1",
                    name = "Upper Camp Aid Station",
                    latitude = 37.902,
                    longitude = -107.7,
                    elevation = 2900.0,
                    symbol = "aid-station",
                    distanceMeters = 500.0
                )
            ),
            totalDistance = 1000.0,
            executionPlan = ExecutionPlan(
                sectors = listOf(
                    Sector(
                        startDistM = 0.0,
                        endDistM = 1000.0,
                        name = "S1",
                        targetPaceMin = 10.0,
                        bestPaceMin = 8.0,
                        worstPaceMin = 12.0
                    )
                )
            )
        )

        composeTestRule.setContent {
            ObstacleHudScreen(
                course = course,
                progress = null,
                locationEngine = locationEngine
            )
        }

        // Verify Title is displayed
        composeTestRule.onNodeWithText("OBSTACLE HUD").assertIsDisplayed()

        // Verify Scenario buttons exist
        composeTestRule.onNodeWithText("BEST").assertIsDisplayed()
        composeTestRule.onNodeWithText("TARGET").assertIsDisplayed()
        composeTestRule.onNodeWithText("WORST").assertIsDisplayed()

                // Verify Active Climb Card is displayed (0m start has climb ahead)
        composeTestRule.onNodeWithText("🧗 ACTIVE CLIMB").assertIsDisplayed()
        composeTestRule.onNodeWithText("Climb to Upper Camp Aid Station").assertIsDisplayed()

        // Verify Next Aid Station card is displayed
        composeTestRule.onNodeWithText("🏥 NEXT AID STATION").assertIsDisplayed()
        composeTestRule.onNodeWithText("Upper Camp Aid Station").assertIsDisplayed()
    }
}
