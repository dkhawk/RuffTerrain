package com.sphericalchickens.ruffterrain.ui.main

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sphericalchickens.ruffterrain.data.DefaultDataRepository
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainScreenUiTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun testBearCanyonCriticalUserJourney() {
        val repository = DefaultDataRepository()
        val viewModel = MainScreenViewModel(repository)

        composeTestRule.setContent {
            MainScreen(
                onItemClick = {},
                viewModel = viewModel
            )
        }

        // 1. Initial State: verify that the empty state is displayed
        composeTestRule.onNodeWithText("IMPORT GPX").assertIsDisplayed()

        // 2. Open Settings Dropdown Menu
        composeTestRule.onNodeWithText("⚙️").performClick()

        // 3. Load the planned Bear Canyon Sample
        composeTestRule.onNodeWithText("Load Bear Canyon Sample").performClick()

        // 4. Assert that the course title "Bear Canyon" is now shown
        composeTestRule.onNodeWithText("Bear Canyon").assertIsDisplayed()

        // 5. Open Settings Dropdown Menu again to launch simulator
        composeTestRule.onNodeWithText("⚙️").performClick()

        // 6. Launch the GPS Simulation Harness dialog
        composeTestRule.onNodeWithText("📍 Launch GPS Simulator").performClick()

        // 7. Assert that the simulator harness dialog is displayed
        composeTestRule.onNodeWithText("📍 GPS SIMULATOR HARNESS").assertIsDisplayed()

        // 8. Start "Normal" on-course steady-pace simulation
        composeTestRule.onNodeWithText("Normal").performClick()

        // 9. Close the simulation dialog
        composeTestRule.onNodeWithText("Close").performClick()

        // 10. Assert that tracking has successfully updated the next waypoint HUD objective
        composeTestRule.onNodeWithText("Next: Bear Canyon Junction", substring = true).assertIsDisplayed()
    }
}
