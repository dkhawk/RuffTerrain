package com.sphericalchickens.ruffterrain.ui.main

import com.sphericalchickens.ruffterrain.data.DataRepository
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.MapMode
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
class MainScreenViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun testInitialUiState() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)
        val state = viewModel.uiState.value

        assertNull(state.courseData)
        assertFalse(state.isLoading)
        assertNull(state.errorMessage)
        assertEquals(0.0, state.scrubberProgress, 0.001)
        assertEquals(MapMode.MAP_2D, state.mapMode)
    }

    @Test
    fun testLoadCourseSuccess() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        // Setup mock course response
        val mockCourse = CourseData(name = "Test Trail", points = emptyList())
        repository.setMockResult(Result.success(mockCourse))

        val dummyInputStream = "".byteInputStream()
        viewModel.loadCourse(dummyInputStream)

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertNotNull(state.courseData)
        assertEquals("Test Trail", state.courseData?.name)
        assertNull(state.errorMessage)
    }

    @Test
    fun testLoadCourseFailure() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        repository.setMockResult(Result.failure(RuntimeException("Parsing error")))

        val dummyInputStream = "".byteInputStream()
        viewModel.loadCourse(dummyInputStream)

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertNull(state.courseData)
        assertEquals("Parsing error", state.errorMessage)
    }

    @Test
    fun testUpdateScrubberProgress() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        viewModel.updateScrubberProgress(0.55)
        assertEquals(0.55, viewModel.uiState.value.scrubberProgress, 0.001)

        // Coercion check
        viewModel.updateScrubberProgress(1.2)
        assertEquals(1.0, viewModel.uiState.value.scrubberProgress, 0.001)

        viewModel.updateScrubberProgress(-0.1)
        assertEquals(0.0, viewModel.uiState.value.scrubberProgress, 0.001)
    }

    @Test
    fun testToggleMapMode() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        // Initial mode should be MAP_2D
        assertEquals(MapMode.MAP_2D, viewModel.uiState.value.mapMode)

        // Toggle once -> MAP_3D
        viewModel.toggleMapMode()
        assertEquals(MapMode.MAP_3D, viewModel.uiState.value.mapMode)

        viewModel.toggleMapMode()
        assertEquals(MapMode.MAP_2D, viewModel.uiState.value.mapMode)
    }

    @Test
    fun testUpdatePlaybackSpeed() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        // Initial speed should be 1.0f
        assertEquals(1.0f, viewModel.uiState.value.playbackSpeed)

        // Set to 5.0f
        viewModel.updatePlaybackSpeed(5.0f)
        assertEquals(5.0f, viewModel.uiState.value.playbackSpeed)
    }

    @Test
    fun testRewind() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        viewModel.updateScrubberProgress(0.8)
        assertEquals(0.8, viewModel.uiState.value.scrubberProgress, 0.001)

        viewModel.rewind()
        assertEquals(0.0, viewModel.uiState.value.scrubberProgress, 0.001)
        assertFalse(viewModel.uiState.value.isProgressing)
    }

    @Test
    fun testTogglePlaybackWithoutCourseDoesNothing() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        assertFalse(viewModel.uiState.value.isProgressing)
        viewModel.togglePlayback()
        assertFalse(viewModel.uiState.value.isProgressing) // Should still be false
    }

    @Test
    fun testUpdateLocationAccuracyAndPauseTime() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        assertEquals(LocationAccuracyMode.AUTO, viewModel.uiState.value.locationAccuracyMode)
        assertEquals(2, viewModel.uiState.value.expectedPauseTimeMinutes)

        viewModel.updateLocationAccuracyMode(LocationAccuracyMode.HIGH_PERFORMANCE)
        assertEquals(LocationAccuracyMode.HIGH_PERFORMANCE, viewModel.uiState.value.locationAccuracyMode)

        viewModel.updateExpectedPauseTimeMinutes(5)
        assertEquals(5, viewModel.uiState.value.expectedPauseTimeMinutes)
    }

    @Test
    fun testArrivalProjections() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        val point1 = com.sphericalchickens.ruffterrain.data.model.RoutePoint(
            latitude = 40.0,
            longitude = -105.0,
            elevation = 1000.0,
            distance = 0.0,
            climb = 0.0
        )
        val point2 = com.sphericalchickens.ruffterrain.data.model.RoutePoint(
            latitude = 40.01,
            longitude = -105.01,
            elevation = 1100.0,
            distance = 1000.0,
            climb = 100.0
        )
        val waypoint = com.sphericalchickens.ruffterrain.data.model.Waypoint(
            id = "wp1",
            name = "Aid Station 1",
            latitude = 40.005,
            longitude = -105.005,
            elevation = 1050.0,
            symbol = "aid",
            closestTrackpointIndex = 1,
            distanceMeters = 500.0
        )

        val mockCourse = CourseData(
            name = "Trail Test",
            points = listOf(point1, point2),
            waypoints = listOf(waypoint),
            totalDistance = 1000.0,
            elevationGain = 100.0
        )

        repository.setMockResult(Result.success(mockCourse))
        viewModel.loadCourse("".byteInputStream())

        viewModel.toggleGpsEnabled(true)
        val startMs = 10000000L
        viewModel.updateUserLocation(40.0, -105.0, timestampMs = startMs)
        viewModel.updateUserLocation(40.0009, -105.0009, timestampMs = startMs + 10000)

        val state = viewModel.uiState.value
        assertNotNull(state.nextWaypointDurationMin)
        assertNotNull(state.nextWaypointDurationMax)
        assertNotNull(state.finishDurationMin)
        assertNotNull(state.finishDurationMax)
    }

    @Test
    fun testAddCustomWaypoint() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        val point1 = com.sphericalchickens.ruffterrain.data.model.RoutePoint(
            latitude = 40.0,
            longitude = -105.0,
            elevation = 1000.0,
            distance = 0.0,
            climb = 0.0
        )
        val pointMid = com.sphericalchickens.ruffterrain.data.model.RoutePoint(
            latitude = 40.005,
            longitude = -105.005,
            elevation = 1050.0,
            distance = 750.0,
            climb = 50.0
        )
        val point2 = com.sphericalchickens.ruffterrain.data.model.RoutePoint(
            latitude = 40.01,
            longitude = -105.01,
            elevation = 1100.0,
            distance = 1500.0,
            climb = 100.0
        )
        val mockCourse = CourseData(
            name = "Trail Test",
            points = listOf(point1, pointMid, point2),
            waypoints = emptyList(),
            totalDistance = 1500.0,
            elevationGain = 100.0
        )
        repository.setMockResult(Result.success(mockCourse))
        viewModel.loadCourse("".byteInputStream())

        // Add custom waypoint at coordinate 40.005, -105.005 (which is approximately halfway)
        viewModel.addCustomWaypoint(
            name = "Halfway Oasis",
            latitude = 40.005,
            longitude = -105.005,
            symbol = "icons/aid_station.svg",
            water = true,
            food = true
        )

        val updatedCourse = viewModel.uiState.value.courseData
        assertNotNull(updatedCourse)
        assertEquals(1, updatedCourse!!.waypoints.size)
        val addedWpt = updatedCourse.waypoints[0]
        assertEquals("Halfway Oasis", addedWpt.name)
        assertEquals("icons/aid_station.svg", addedWpt.symbol)
        assertTrue(addedWpt.distanceMeters > 0.0 && addedWpt.distanceMeters < 1500.0)
        
        val station = addedWpt.extensions?.station
        assertNotNull(station)
        assertEquals("aid_station", station!!.type)
        assertTrue(station.services?.water == true)
        assertTrue(station.services?.food == true)
    }

    @Test
    fun testEditAndRemoveWaypoint() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        val point1 = com.sphericalchickens.ruffterrain.data.model.RoutePoint(
            latitude = 40.0,
            longitude = -105.0,
            elevation = 1000.0,
            distance = 0.0,
            climb = 0.0
        )
        val waypoint = com.sphericalchickens.ruffterrain.data.model.Waypoint(
            id = "wpt-original",
            name = "Old Name",
            latitude = 40.0,
            longitude = -105.0,
            elevation = 1000.0,
            symbol = "icons/waypoint.svg",
            description = "",
            closestTrackpointIndex = 0,
            distanceMeters = 0.0,
            extensions = null
        )
        val mockCourse = CourseData(
            name = "Trail Test",
            points = listOf(point1),
            waypoints = listOf(waypoint),
            totalDistance = 0.0,
            elevationGain = 0.0
        )
        repository.setMockResult(Result.success(mockCourse))
        viewModel.loadCourse("".byteInputStream())

        // Edit the waypoint
        viewModel.editWaypoint(
            waypointId = "wpt-original",
            name = "New Name",
            symbol = "icons/aid_station.svg",
            water = true,
            food = false,
            toilets = true,
            medical = false,
            crew = true,
            dropBag = false
        )

        var updatedCourse = viewModel.uiState.value.courseData
        assertNotNull(updatedCourse)
        assertEquals(1, updatedCourse!!.waypoints.size)
        val editedWpt = updatedCourse.waypoints[0]
        assertEquals("New Name", editedWpt.name)
        assertEquals("icons/aid_station.svg", editedWpt.symbol)
        
        val station = editedWpt.extensions?.station
        assertNotNull(station)
        assertTrue(station?.services?.water == true)
        assertTrue(station?.services?.toilets == true)
        assertTrue(station?.services?.food == false)
        assertTrue(station?.accessibility?.crewAllowed == true)

        // Now remove the waypoint
        viewModel.removeWaypoint("wpt-original")
        updatedCourse = viewModel.uiState.value.courseData
        assertNotNull(updatedCourse)
        assertTrue(updatedCourse!!.waypoints.isEmpty())
    }

    @Test
    fun testOutAndBackSnappingWindow() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        // Create an out-and-back course with 100 points
        val points = (0 until 100).map { i ->
            // Outbound goes from 40.0 -> 40.01. Inbound goes from 40.01 -> 40.0.
            val lat = if (i < 50) 40.0 + (i * 0.0002) else 40.0 + ((100 - i) * 0.0002)
            com.sphericalchickens.ruffterrain.data.model.RoutePoint(
                latitude = lat,
                longitude = -105.0,
                elevation = 1000.0,
                distance = i * 10.0,
                climb = 0.0
            )
        }

        val mockCourse = CourseData(
            name = "Out-and-Back Test",
            points = points,
            waypoints = emptyList(),
            totalDistance = 1000.0,
            elevationGain = 0.0
        )
        repository.setMockResult(Result.success(mockCourse))
        viewModel.loadCourse("".byteInputStream())

        // Initial position updates: start on the outbound leg (around index 5)
        viewModel.updateUserLocation(40.001, -105.0)
        
        // Simulating GPS noise putting coordinate physically close to index 95 (inbound leg)
        // Leg index 5 is Lat=40.001. Leg index 95 is Lat=40.001.
        // If we update location to 40.0012, -105.0 (outbound index 6):
        // Without windowing, it could resolve to index 94.
        // With windowing, it must snap to index 6 since index 94 is outside the sliding window of last index 5!
        viewModel.updateUserLocation(40.0012, -105.0)

        // Verify that progress distance is close to 60.0 (index 6 * 10m), not 940.0 (index 94 * 10m)
        val progress = viewModel.uiState.value.scrubberProgress * 1000.0
        assertTrue("Expected progress to snap to outbound leg (< 500m), but was $progress", progress < 200.0)
    }
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
