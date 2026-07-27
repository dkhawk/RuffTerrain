package com.sphericalchickens.ruffterrain

import com.sphericalchickens.ruffterrain.data.parser.GpxParser
import com.sphericalchickens.ruffterrain.util.Haversine
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.FileInputStream

class OffCourseDetectionTest {

    @Test
    fun testDetectOffCourseEpisode() {
        val plannedFile = File("/Users/dkhawk/Downloads/enhanced_cafe_floria_2.gpx")
        val executedFile = File("/Users/dkhawk/Downloads/Cafe_run_in_Chamonix.gpx")

        if (!plannedFile.exists() || !executedFile.exists()) {
            println("Real test GPX files not found in Downloads. Skipping off-course integration analysis.")
            return
        }

        val plannedCourse = GpxParser.parse(FileInputStream(plannedFile))
        val executedCourse = GpxParser.parse(FileInputStream(executedFile))

        assertNotNull(plannedCourse)
        assertNotNull(executedCourse)
        assertTrue(plannedCourse.points.isNotEmpty())
        assertTrue(executedCourse.points.isNotEmpty())

        println("Planned course points: ${plannedCourse.points.size}")
        println("Executed track points: ${executedCourse.points.size}")

        var isCurrentlyOffCourse = false
        var offCourseStartIndex = -1
        var maxDeviationInEpisode = 0.0
        val offCourseEpisodes = mutableListOf<String>()

        // Simulate execution along the track
        executedCourse.points.forEachIndexed { index, actualPt ->
            // Find closest perpendicular projection to the planned course
            var minDeviation = Double.MAX_VALUE
            for (i in 0 until plannedCourse.points.size - 1) {
                val ptA = plannedCourse.points[i]
                val ptB = plannedCourse.points[i + 1]
                val d = Haversine.distanceToSegment(
                    actualPt.latitude, actualPt.longitude,
                    ptA.latitude, ptA.longitude,
                    ptB.latitude, ptB.longitude
                )
                if (d < minDeviation) {
                    minDeviation = d
                }
            }

            if (!isCurrentlyOffCourse) {
                // Trigger warning at 50 meters
                if (minDeviation > 50.0) {
                    isCurrentlyOffCourse = true
                    offCourseStartIndex = index
                    maxDeviationInEpisode = minDeviation
                }
            } else {
                if (minDeviation > maxDeviationInEpisode) {
                    maxDeviationInEpisode = minDeviation
                }
                // Recover at 20 meters
                if (minDeviation < 20.0) {
                    val durationPts = index - offCourseStartIndex
                    offCourseEpisodes.add(
                        "Off-course episode detected: started at point index $offCourseStartIndex, " +
                        "recovered at point index $index (duration: $durationPts points). " +
                        "Peak deviation: ${String.format("%.1f", maxDeviationInEpisode)} meters."
                    )
                    isCurrentlyOffCourse = false
                    maxDeviationInEpisode = 0.0
                }
            }
        }

        // Handle trailing off-course at the end
        if (isCurrentlyOffCourse) {
            offCourseEpisodes.add(
                "Off-course episode detected: started at point index $offCourseStartIndex, " +
                "ended off-course at track end. Peak deviation: ${String.format("%.1f", maxDeviationInEpisode)} meters."
            )
        }

        println("=== Off-Course Episodes Detected ===")
        offCourseEpisodes.forEach { println(it) }
        println("====================================")

        // Verify that we detected at least one deviation episode
        assertTrue("Expected to detect at least one off-course episode where runner veered off-trail", offCourseEpisodes.isNotEmpty())
    }
}
