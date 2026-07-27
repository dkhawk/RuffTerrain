package com.sphericalchickens.ruffterrain.util

import com.sphericalchickens.ruffterrain.db.TrackingPoint
import org.junit.Assert.assertTrue
import org.junit.Test

class GpxExporterTest {

    @Test
    fun testExportSessionToGpxString_createsValidGpxStructure() {
        val sessionName = "Test Run Session <3>"
        val points = listOf(
            TrackingPoint(id = 1, sessionId = sessionName, latitude = 45.0, longitude = 7.0, elevation = 1200.0, timestampMs = 1783960000000L),
            TrackingPoint(id = 2, sessionId = sessionName, latitude = 45.001, longitude = 7.002, elevation = 1210.5, timestampMs = 1783960010000L)
        )

        val gpxString = GpxExporter.exportSessionToGpxString(sessionName, points)

        // Verify XML header and tags
        assertTrue(gpxString.startsWith("<?xml"))
        assertTrue(gpxString.contains("<gpx version=\"1.1\""))
        assertTrue(gpxString.contains("<metadata>"))
        assertTrue(gpxString.contains("<trk>"))
        assertTrue(gpxString.contains("<trkseg>"))

        // Verify escaped characters in session name
        assertTrue(gpxString.contains("Test Run Session &lt;3&gt;"))

        // Verify track points
        assertTrue(gpxString.contains("lat=\"45.000000\" lon=\"7.000000\""))
        assertTrue(gpxString.contains("lat=\"45.001000\" lon=\"7.002000\""))
        assertTrue(gpxString.contains("<ele>1200.00</ele>"))
        assertTrue(gpxString.contains("<ele>1210.50</ele>"))

        // Verify closing tags
        assertTrue(gpxString.contains("</trkseg>"))
        assertTrue(gpxString.contains("</trk>"))
        assertTrue(gpxString.contains("</gpx>"))
    }
}
