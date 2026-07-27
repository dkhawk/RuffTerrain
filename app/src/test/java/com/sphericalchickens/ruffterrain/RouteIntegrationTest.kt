package com.sphericalchickens.ruffterrain

import androidx.test.core.app.ApplicationProvider
import com.sphericalchickens.ruffterrain.data.parser.GpxParser
import com.sphericalchickens.ruffterrain.db.TrackingDbHelper
import com.sphericalchickens.ruffterrain.db.TrackingPoint
import com.sphericalchickens.ruffterrain.util.GpxExporter
import com.sphericalchickens.ruffterrain.util.Haversine
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RouteIntegrationTest {

    private lateinit var dbHelper: TrackingDbHelper

    @Before
    fun setUp() {
        dbHelper = TrackingDbHelper(ApplicationProvider.getApplicationContext())
    }

    @After
    fun tearDown() {
        dbHelper.close()
    }

    @Test
    fun testRealOrMockGpxRouteIntegration() {
        // Attempt to find user's real GPX route first, fall back to mock data
        val realFile = File("/Users/dkhawk/Downloads/TMB/GPX/TMB-Day-4-Courmayeur-to-Arnuva.gpx")
        val stream: InputStream? = if (realFile.exists()) {
            println("=== Using Real Route File for Integration Test ===")
            FileInputStream(realFile)
        } else {
            println("=== Using Mock Resource File for Integration Test ===")
            javaClass.classLoader?.getResourceAsStream("leadville_sample.gpx")
        }

        assertNotNull("No GPX stream found (real or mock)", stream)

        stream!!.use { s ->
            // 1. Parse route
            val course = GpxParser.parse(s)
            assertNotNull(course)
            assertTrue("Expected parsed points to be non-empty", course.points.isNotEmpty())
            println("Course Parsed: ${course.name} with ${course.points.size} points.")

            // 2. Perform segment snapping verification on the route points
            val firstPt = course.points.first()
            val secondPt = course.points[1]

            // Calculate distance between segment A and B
            val distanceToSelf = Haversine.distanceToSegment(
                firstPt.latitude, firstPt.longitude,
                firstPt.latitude, firstPt.longitude,
                secondPt.latitude, secondPt.longitude
            )
            assertEquals(0.0, distanceToSelf, 0.1)

            // 3. Persist route coordinates into local database tracking
            val sessionId = "Integration-Test-Run-${course.name.replace(" ", "-")}"
            course.points.take(50).forEachIndexed { index, pt ->
                dbHelper.insertPoint(
                    TrackingPoint(
                        sessionId = sessionId,
                        latitude = pt.latitude,
                        longitude = pt.longitude,
                        elevation = pt.elevation,
                        timestampMs = 1783960000000L + (index * 1000)
                    )
                )
            }

            // 4. Retrieve and verify points from persistent store
            val dbPoints = dbHelper.getPointsForSession(sessionId)
            assertEquals(50.coerceAtMost(course.points.size), dbPoints.size)

            // 5. Verify GPX document export matches standard output
            val exportedGpx = GpxExporter.exportSessionToGpxString(sessionId, dbPoints)
            assertTrue(exportedGpx.contains("<gpx version=\"1.1\""))
            assertTrue(exportedGpx.contains("<trkpt"))
            assertTrue(exportedGpx.contains("</gpx>"))
            println("Successfully exported ${dbPoints.size} database points to standard GPX format.")
        }
    }
}
