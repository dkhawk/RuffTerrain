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
import kotlinx.coroutines.launch
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
        return CourseData(
            name = "Alert test course",
            points = points,
            waypoints = waypoints,
            totalDistance = 3333.0,
            elevationGain = 30.0
        )
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

    @Test
    fun testAddCustomWaypointMultiPassAndAnnouncements() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)
        
        // Setup loop course data
        val points = listOf(
            RoutePoint(0.0, 0.0, 0.0, 0.0),             // 0m
            RoutePoint(0.01, 0.0, 10.0, 1000.0),        // 1000m (Outbound pass)
            RoutePoint(0.02, 0.0, 20.0, 2000.0),        // 2000m (Turnaround point)
            RoutePoint(0.01, 0.0001, 10.0, 3000.0),     // 3000m (Inbound pass, ~11m apart)
            RoutePoint(0.0, 0.0, 0.0, 4000.0)           // 4000m (Finish)
        )
        val course = CourseData(
            name = "Loop Course",
            points = points,
            waypoints = emptyList(),
            totalDistance = 4000.0,
            elevationGain = 20.0
        )
        repository.setMockResult(Result.success(course))
        viewModel.loadCourse("".byteInputStream())

        // Add custom waypoint near 0.01, 0.0
        viewModel.addCustomWaypoint(
            name = "Critical Turn",
            latitude = 0.01,
            longitude = 0.0,
            symbol = "turn_left"
        )

        // Verify that two waypoints were added (one for outbound, one for inbound)
        val updatedCourse = viewModel.uiState.value.courseData
        assertNotNull(updatedCourse)
        val customWaypoints = updatedCourse!!.waypoints.filter { it.id.startsWith("wpt-custom-") }
        assertEquals(2, customWaypoints.size)
        
        val firstPass = customWaypoints[0]
        val secondPass = customWaypoints[1]
        
        assertEquals("Critical Turn (Pass 1)", firstPass.name)
        assertEquals(1000.0, firstPass.distanceMeters, 50.0)
        
        assertEquals("Critical Turn (Pass 2)", secondPass.name)
        assertEquals(3000.0, secondPass.distanceMeters, 50.0)

        // Test Proximity Announcements
        val announcements = mutableListOf<String>()
        val collectJob = launch(UnconfinedTestDispatcher()) {
            viewModel.announcementEvents.collect {
                announcements.add(it)
            }
        }

        // Runner is far away: no announcements
        viewModel.updateUserLocation(0.0, 0.0, 1000L) // at 0m
        assertTrue(announcements.isEmpty())

        // Runner approaches first pass (within 100m, e.g. at 920m)
        // Point index 1 is at 1000m, index 0 is at 0m. User location at 0.0092 lat, 0.0 lon matches distance ~920m
        viewModel.updateUserLocation(0.0092, 0.0, 2000L)
        assertEquals(1, announcements.size)
        assertEquals("Approaching Critical Turn (Pass 1)", announcements.last())

        // Move past it to turnaround point (2000m)
        viewModel.updateUserLocation(0.02, 0.0, 3000L)
        
        // Approach second pass (e.g. at 2920m)
        // Index 3 is at 3000m. User location at 0.0108 lat, 0.0001 lon matches distance ~2920m
        viewModel.updateUserLocation(0.0108, 0.0001, 4000L)
        assertEquals(2, announcements.size)
        assertEquals("Approaching Critical Turn (Pass 2)", announcements.last())

        // Test Muting: disable TTS, move away, and approach again
        viewModel.updateTtsEnabled(false)
        viewModel.updateUserLocation(0.02, 0.0, 5000L) // reset location far away
        viewModel.updateUserLocation(0.0108, 0.0001, 6000L) // approach again
        // Announcement list size should still be 2
        assertEquals(2, announcements.size)

        collectJob.cancel()
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
