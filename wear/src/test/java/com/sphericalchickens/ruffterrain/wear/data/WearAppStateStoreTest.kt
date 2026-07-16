package com.sphericalchickens.ruffterrain.wear.data

import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class WearAppStateStoreTest {

    @Before
    fun setup() {
        WearAppStateStore.reset()
    }

    @Test
    fun testInitialState() {
        assertNull(WearAppStateStore.courseData.value)
        assertNull(WearAppStateStore.runnerProgress.value)
    }

    @Test
    fun testUpdateCourse() {
        val course = CourseData(
            name = "Test Course",
            points = emptyList(),
            totalDistance = 1000.0,
            elevationGain = 100.0
        )
        WearAppStateStore.updateCourse(course)
        assertEquals(course, WearAppStateStore.courseData.value)
        assertEquals("Test Course", WearAppStateStore.courseData.value?.name)
    }

    @Test
    fun testUpdateProgress() {
        val progress = RunnerProgress(
            elapsedTimeMs = 5000L,
            distanceRunMeters = 250.0,
            nextStationName = "Aid Station 1",
            nextStationDistanceRemainingM = 750.0
        )
        WearAppStateStore.updateProgress(progress)
        assertEquals(progress, WearAppStateStore.runnerProgress.value)
        assertEquals(250.0, WearAppStateStore.runnerProgress.value?.distanceRunMeters)
    }
}
