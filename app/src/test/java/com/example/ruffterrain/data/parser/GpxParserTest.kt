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
}
