package com.sphericalchickens.ruffterrain.ui.main

import com.sphericalchickens.ruffterrain.data.DataRepository
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RoutePoint
import com.sphericalchickens.ruffterrain.data.model.Waypoint
import com.sphericalchickens.ruffterrain.data.model.StationExtensions
import com.sphericalchickens.ruffterrain.data.model.Station
import com.sphericalchickens.ruffterrain.data.model.Pass
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.InputStream

@OptIn(ExperimentalCoroutinesApi::class)
class RunningAlertsTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createMockCourse(): CourseData {
        // Linear path along 0 longitude from latitude 0.0 to 0.03
        val points = listOf(
            RoutePoint(0.0, 0.0, 0.0, 0.0),
            RoutePoint(0.01, 0.0, 10.0, 1111.0),
            RoutePoint(0.02, 0.0, 20.0, 2222.0),
            RoutePoint(0.03, 0.0, 30.0, 3333.0)
        )
        val pass = Pass(num = 1, distM = 2222.0, cutoffElapsed = "00:15") // 15 mins (900s) cutoff
        val station = Station(id = "AS1", type = "aid_station", passes = listOf(pass))
        val waypoints = listOf(
            Waypoint(
                id = "AS1",
                name = "Les Houches Mock",
                latitude = 0.02,
                longitude = 0.0,
                elevation = 20.0,
                symbol = "aid",
                distanceMeters = 2222.0,
                extensions = StationExtensions(station = station)
            )
        )
        return CourseData(name = "Alert test course", points = points, waypoints = waypoints)
    }

    @Test
    fun testOffCourseAlertThresholdsAndMuting() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)
        repository.setMockResult(Result.success(createMockCourse()))
        viewModel.loadCourse("".byteInputStream())

        // 1. Initial State: On-trail
        viewModel.updateUserLocation(0.0, 0.0, 1000L)
        var state = viewModel.uiState.value
        assertEquals(0.0, state.deviationMeters, 0.1)
        assertFalse(state.showCriticalOffCourseDialog)
        assertFalse(state.isOffCourseWarningMuted)

        // 2. Veer slightly (30m off course)
        // 0.00027 degrees longitude is approx 30 meters perpendicular to trail
        viewModel.updateUserLocation(0.01, 0.00027, 2000L)
        state = viewModel.uiState.value
        assertTrue(state.deviationMeters in 25.0..35.0)
        assertFalse(state.showCriticalOffCourseDialog) // only triggers > 50m

        // 3. Veer critically (80m off course)
        // 0.00072 degrees longitude is approx 80 meters perpendicular to trail
        viewModel.updateUserLocation(0.01, 0.00072, 3000L)
        state = viewModel.uiState.value
        assertTrue(state.deviationMeters in 75.0..85.0)
        assertTrue(state.showCriticalOffCourseDialog)

        // 4. Acknowledge and Mute
        viewModel.acknowledgeOffCourse()
        state = viewModel.uiState.value
        assertFalse(state.showCriticalOffCourseDialog)
        assertTrue(state.isOffCourseWarningMuted)

        // 5. Still off course, but muted (should not show dialog)
        viewModel.updateUserLocation(0.01, 0.00075, 4000L)
        state = viewModel.uiState.value
        assertFalse(state.showCriticalOffCourseDialog)
        assertTrue(state.isOffCourseWarningMuted)

        // 6. Return to trail (deviation < 20m)
        viewModel.updateUserLocation(0.01, 0.0, 5000L)
        state = viewModel.uiState.value
        assertFalse(state.showCriticalOffCourseDialog)
        assertFalse(state.isOffCourseWarningMuted) // Muting resets on returning to trail
    }

    @Test
    fun testCutoffWarningTooSlow() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)
        repository.setMockResult(Result.success(createMockCourse()))
        viewModel.loadCourse("".byteInputStream())

        // Start at 0m, timestamp 0s
        viewModel.updateUserLocation(0.0, 0.0, 1000L)
        
        // Runner moves very slowly to 1111m, taking 1000 seconds (speed = 1.11 m/s)
        viewModel.updateUserLocation(0.01, 0.0, 1001000L)
        
        val state = viewModel.uiState.value
        assertNotNull(state.cutoffAlertMessage)
        assertTrue(state.cutoffAlertMessage!!.contains("CUTOFF WARNING"))
    }

    private class FakeDataRepository : DataRepository {
        private val _courseData = MutableStateFlow<CourseData?>(null)
        override val courseData: StateFlow<CourseData?> = _courseData.asStateFlow()

        private var mockResult: Result<CourseData> = Result.failure(IllegalStateException("No mock set"))

        fun setMockResult(result: Result<CourseData>) {
            this.mockResult = result
        }

        override fun loadCourse(inputStream: InputStream): Result<CourseData> {
            return mockResult.onSuccess {
                _courseData.value = it
            }
        }
    }
}
