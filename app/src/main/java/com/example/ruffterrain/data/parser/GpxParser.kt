package com.example.ruffterrain.data.parser

import com.example.ruffterrain.data.model.CourseData
import com.example.ruffterrain.data.model.RoutePoint
import com.example.ruffterrain.util.Haversine
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.InputStream
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Utility class to parse GPX course data files using standard JDK DOM parser.
 * This implementation runs both on Android and standard JVM unit tests.
 */
object GpxParser {

    /**
     * Parses a GPX InputStream and returns a fully calculated CourseData object.
     */
    fun parse(inputStream: InputStream): CourseData {
        val factory = DocumentBuilderFactory.newInstance()
        val builder = factory.newDocumentBuilder()
        val doc = builder.parse(inputStream)
        doc.documentElement.normalize()

        // Extract track/course name
        val nameNodes = doc.getElementsByTagName("name")
        var currentTrackName = "Imported Course"
        if (nameNodes.length > 0) {
            currentTrackName = nameNodes.item(0).textContent
        }

        // Extract track points
        val trkptNodes = doc.getElementsByTagName("trkpt")
        val rawPoints = mutableListOf<RoutePointTemp>()

        for (i in 0 until trkptNodes.length) {
            val node = trkptNodes.item(i)
            if (node.nodeType == Node.ELEMENT_NODE) {
                val element = node as Element
                val lat = element.getAttribute("lat").toDouble()
                val lon = element.getAttribute("lon").toDouble()

                var ele = 0.0
                val eleNodes = element.getElementsByTagName("ele")
                if (eleNodes.length > 0) {
                    ele = eleNodes.item(0).textContent.toDoubleOrNull() ?: 0.0
                }

                var time: String? = null
                val timeNodes = element.getElementsByTagName("time")
                if (timeNodes.length > 0) {
                    time = timeNodes.item(0).textContent
                }

                rawPoints.add(RoutePointTemp(lat, lon, ele, time))
            }
        }

        // Convert raw points to RoutePoints with cumulative metrics
        val finalPoints = mutableListOf<RoutePoint>()
        var cumulativeDistance = 0.0
        var totalClimb = 0.0
        var totalDescent = 0.0

        for (i in rawPoints.indices) {
            val curr = rawPoints[i]
            if (i == 0) {
                finalPoints.add(
                    RoutePoint(
                        latitude = curr.lat,
                        longitude = curr.lon,
                        elevation = curr.ele,
                        distance = 0.0,
                        climb = 0.0,
                        descent = 0.0,
                        time = curr.time
                    )
                )
            } else {
                val prev = rawPoints[i - 1]
                val dist = Haversine.distance(prev.lat, prev.lon, curr.lat, curr.lon)
                cumulativeDistance += dist

                val eleDiff = curr.ele - prev.ele
                val climb = if (eleDiff > 0) eleDiff else 0.0
                val descent = if (eleDiff < 0) -eleDiff else 0.0
                totalClimb += climb
                totalDescent += descent

                finalPoints.add(
                    RoutePoint(
                        latitude = curr.lat,
                        longitude = curr.lon,
                        elevation = curr.ele,
                        distance = cumulativeDistance,
                        climb = totalClimb,
                        descent = totalDescent,
                        time = curr.time
                    )
                )
            }
        }

        return CourseData(
            name = currentTrackName,
            points = finalPoints,
            totalDistance = cumulativeDistance,
            elevationGain = totalClimb,
            elevationLoss = totalDescent
        )
    }

    private data class RoutePointTemp(
        val lat: Double,
        val lon: Double,
        val ele: Double,
        val time: String?
    )
}
