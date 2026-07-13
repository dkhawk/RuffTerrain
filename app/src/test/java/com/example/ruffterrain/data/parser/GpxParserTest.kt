package com.example.ruffterrain.data.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.InputStream

class GpxParserTest {

    @Test
    fun testParseLeadvilleSample() {
        // Load the sample GPX file from test resources
        val resourceStream = GpxParserTest::class.java.classLoader?.getResourceAsStream("leadville_sample.gpx")
        
        assertNotNull("Could not find test asset leadville_sample.gpx", resourceStream)
        
        resourceStream!!.use { stream ->
            val courseData = GpxParser.parse(stream)
            
            assertTrue(courseData.name.contains("Leadville"))
            
            val points = courseData.points
            assertTrue("Expected parsed points to be non-empty", points.isNotEmpty())
            
            // Validate first point state
            val firstPt = points.first()
            assertEquals(0.0, firstPt.distance, 0.001)
            assertEquals(0.0, firstPt.climb, 0.001)
            assertEquals(0.0, firstPt.descent, 0.001)
            
            // Validate total metrics calculation
            assertTrue("Expected positive total distance", courseData.totalDistance > 0.0)
            assertTrue("Expected positive elevation gain", courseData.elevationGain > 0.0)
            assertTrue("Expected positive elevation loss", courseData.elevationLoss > 0.0)
            
            // Verify final points have accumulated positive distance and climb
            val lastPt = points.last()
            assertEquals(courseData.totalDistance, lastPt.distance, 0.001)
            assertEquals(courseData.elevationGain, lastPt.climb, 0.001)
            assertEquals(courseData.elevationLoss, lastPt.descent, 0.001)
            
            println("Parsed Course Name: ${courseData.name}")
            println("Total Points: ${points.size}")
            println("Total Distance: ${courseData.totalDistance} m")
            println("Elevation Gain: ${courseData.elevationGain} m")
            println("Elevation Loss: ${courseData.elevationLoss} m")
        }
    }

    @Test
    fun testParseGPXWithRuffTerrainExtensions() {
        val gpxData = """
            <?xml version="1.0" encoding="UTF-8"?>
            <gpx version="1.1" creator="RuffTerrain"
                 xmlns="http://www.topografix.com/GPX/1/1"
                 xmlns:ca="http://coursearchitect.com/schema/v1">
              <metadata>
                <name>Test Route with Extensions</name>
                <extensions>
                  <ca:race_plan start_time="06:00" target_duration_hrs="12.5" />
                  <ca:execution_plan>
                    <ca:sector start_dist_m="0" end_dist_m="5000" name="Sector 1" target_pace_min="10.5">
                      <ca:strategy>Steady effort</ca:strategy>
                      <ca:nutrition>Eat every 45m</ca:nutrition>
                    </ca:sector>
                  </ca:execution_plan>
                </extensions>
              </metadata>
              <wpt lat="40.01" lon="-105.0">
                <ele>1500.0</ele>
                <name>Aid Station A</name>
                <sym>icons/aid_station.svg</sym>
                <desc>Water source</desc>
                <extensions>
                  <ca:station type="aid_station" id="station-1" subtype="major">
                    <ca:passes>
                      <ca:pass num="1" dist_m="2500" label="Pass A" cutoff_clock="08:00" target_arrival="06:45" />
                    </ca:passes>
                    <ca:accessibility crew_allowed="true" pacer_allowed="false" vehicle_tier="4wd" drop_bag_allowed="true" />
                    <ca:services water="true" food="true" toilets="true" medical="true" sleep_area="false" />
                    <ca:navigation_alert severity="warning" turn_type="right" prompt="Turn right" />
                  </ca:station>
                </extensions>
              </wpt>
              <trk>
                <name>Track</name>
                <trkseg>
                  <trkpt lat="40.0" lon="-105.0"><ele>1500.0</ele></trkpt>
                  <trkpt lat="40.01" lon="-105.0"><ele>1520.0</ele></trkpt>
                  <trkpt lat="40.02" lon="-105.0"><ele>1510.0</ele></trkpt>
                </trkseg>
              </trk>
            </gpx>
        """.trimIndent()

        val stream = gpxData.byteInputStream()
        val courseData = GpxParser.parse(stream)

        assertEquals("Test Route with Extensions", courseData.name)
        assertNotNull(courseData.executionPlan)
        assertEquals("06:00", courseData.executionPlan?.startTime)
        assertEquals(12.5, courseData.executionPlan?.targetDurationHrs ?: 0.0, 0.001)
        assertEquals(1, courseData.executionPlan?.sectors?.size)
        
        val sector = courseData.executionPlan!!.sectors[0]
        assertEquals("Sector 1", sector.name)
        assertEquals(10.5, sector.targetPaceMin, 0.001)
        assertEquals("Steady effort", sector.strategy)
        assertEquals("Eat every 45m", sector.nutrition)

        // Verify Waypoints (Start, Aid Station A, Finish should all be present and sorted)
        val wpts = courseData.waypoints
        assertEquals(3, wpts.size)

        val startWpt = wpts[0]
        assertEquals("Course Start", startWpt.name)
        assertEquals(0.0, startWpt.distanceMeters, 0.001)

        val aidWpt = wpts[1]
        assertEquals("Aid Station A", aidWpt.name)
        assertEquals(1500.0, aidWpt.elevation, 0.001)
        
        val station = aidWpt.extensions?.station
        assertNotNull(station)
        assertEquals("station-1", station?.id)
        assertEquals("aid_station", station?.type)
        assertEquals("major", station?.subtype)

        assertEquals(1, station?.passes?.size)
        val pass = station!!.passes[0]
        assertEquals(1, pass.num)
        assertEquals(2500.0, pass.distM, 0.001)
        assertEquals("Pass A", pass.label)
        assertEquals("08:00", pass.cutoffClock)

        assertTrue(station.accessibility.crewAllowed)
        assertTrue(station.accessibility.dropBagAllowed)
        assertEquals("4wd", station.accessibility.vehicleTier)

        assertTrue(station.services.water)
        assertTrue(station.services.food)
        assertTrue(station.services.medical)

        assertEquals("warning", station.navigationAlert?.severity)
        assertEquals("Turn right", station.navigationAlert?.prompt)

        val finishWpt = wpts[2]
        assertEquals("Course Finish", finishWpt.name)
        assertTrue(finishWpt.distanceMeters > 0.0)
    }
}
