package com.sphericalchickens.ruffterrain.wear.engine

import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.ExecutionPlan
import com.sphericalchickens.ruffterrain.data.model.RoutePoint
import com.sphericalchickens.ruffterrain.data.model.Sector
import com.sphericalchickens.ruffterrain.wear.data.WearAppStateStore
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class WearLocationEngineTest {

    private lateinit var engine: WearLocationEngine

    @Before
    fun setUp() {
        WearAppStateStore.reset()
        val context = RuntimeEnvironment.getApplication()
        engine = WearLocationEngine(context)
    }

    @Test
    fun testExtrapolationAtTargetPace() {
        val course = CourseData(
            name = "Test Route",
            points = listOf(
                RoutePoint(40.0, -105.0, 1500.0, 0.0),
                RoutePoint(40.01, -105.0, 1510.0, 1000.0),
                RoutePoint(40.02, -105.0, 1520.0, 2000.0)
            ),
            totalDistance = 2000.0,
            executionPlan = ExecutionPlan(
                sectors = listOf(
                    Sector(
                        startDistM = 0.0,
                        endDistM = 2000.0,
                        name = "S1",
                        targetPaceMin = 10.0, // 10 min/km = 1.667 m/s
                        bestPaceMin = 8.0,   // 8 min/km = 2.083 m/s
                        worstPaceMin = 12.0  // 12 min/km = 1.389 m/s
                    )
                )
            )
        )
        WearAppStateStore.updateCourse(course)

        // Set baseline at 0m
        engine.calibrate(0.0)
        engine.setScenario(ScenarioType.TARGET)

        // Mock screen state change to trigger calculation loop updates
        engine.onScreenStateChanged(true)

        // Directly invoke internal extrapolation logic for deterministic testing
        val method = WearLocationEngine::class.java.getDeclaredMethod("extrapolateCurrentDistance")
        method.isAccessible = true

        // Simulate 60 seconds passing (expected distance at 10 min/km: 1.667 * 60 = 100m)
        val lastKnownTimeField = WearLocationEngine::class.java.getDeclaredField("lastKnownTimeMs")
        lastKnownTimeField.isAccessible = true
        lastKnownTimeField.set(engine, System.currentTimeMillis() - 60_000L)

        method.invoke(engine)

        val estimated = engine.estimatedDistanceMeters.value
        assertEquals(100.0, estimated, 1.0)
    }

    @Test
    fun testExtrapolationAtBestPace() {
        val course = CourseData(
            name = "Test Route",
            points = listOf(
                RoutePoint(40.0, -105.0, 1500.0, 0.0),
                RoutePoint(40.02, -105.0, 1520.0, 2000.0)
            ),
            totalDistance = 2000.0,
            executionPlan = ExecutionPlan(
                sectors = listOf(
                    Sector(
                        startDistM = 0.0,
                        endDistM = 2000.0,
                        name = "S1",
                        targetPaceMin = 10.0,
                        bestPaceMin = 8.0,   // 8 min/km = 2.083 m/s
                        worstPaceMin = 12.0
                    )
                )
            )
        )
        WearAppStateStore.updateCourse(course)

        engine.calibrate(0.0)
        engine.setScenario(ScenarioType.BEST)

        val method = WearLocationEngine::class.java.getDeclaredMethod("extrapolateCurrentDistance")
        method.isAccessible = true

        // Simulate 60 seconds passing (expected distance at 8 min/km: 2.083 * 60 = 125m)
        val lastKnownTimeField = WearLocationEngine::class.java.getDeclaredField("lastKnownTimeMs")
        lastKnownTimeField.isAccessible = true
        lastKnownTimeField.set(engine, System.currentTimeMillis() - 60_000L)

        method.invoke(engine)

        val estimated = engine.estimatedDistanceMeters.value
        assertEquals(125.0, estimated, 1.0)
    }

    @Test
    fun testGpsSnapsToNearestRoutePoint() {
        val course = CourseData(
            name = "Test Route",
            points = listOf(
                RoutePoint(40.0, -105.0, 1500.0, 0.0),
                RoutePoint(40.01, -105.0, 1510.0, 1000.0),
                RoutePoint(40.02, -105.0, 1520.0, 2000.0)
            ),
            totalDistance = 2000.0
        )
        WearAppStateStore.updateCourse(course)

        // Mock snapping a location very close to the second trackpoint (40.01, -105.0)
        val method = WearLocationEngine::class.java.getDeclaredMethod(
            "snapGpsToTrail",
            Double::class.java,
            Double::class.java,
            List::class.java
        )
        method.isAccessible = true

        // 40.0101, -105.0001 is within 200m of 40.01, -105.0
        method.invoke(engine, 40.0101, -105.0001, course.points)

        // Should snap to 1000.0 meters
        assertEquals(1000.0, engine.estimatedDistanceMeters.value, 0.1)
    }
}
