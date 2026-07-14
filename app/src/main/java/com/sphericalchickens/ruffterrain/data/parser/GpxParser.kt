/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.sphericalchickens.ruffterrain.data.parser

import com.sphericalchickens.ruffterrain.data.model.*
import com.sphericalchickens.ruffterrain.util.Haversine
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.InputStream
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Utility class to parse GPX course data files using standard JDK DOM parser.
 * This implementation runs both on Android and standard JVM unit tests.
 */
object GpxParser {

    private fun Element.getChildElement(localName: String): Element? {
        val children = this.childNodes
        for (i in 0 until children.length) {
            val child = children.item(i)
            if (child.nodeType == Node.ELEMENT_NODE) {
                val childEl = child as Element
                val name = childEl.nodeName
                val actualLocalName = name.substringAfter(':')
                if (actualLocalName.equals(localName, ignoreCase = true)) {
                    return childEl
                }
            }
        }
        return null
    }

    private fun Element.getChildElements(localName: String): List<Element> {
        val result = mutableListOf<Element>()
        val children = this.childNodes
        for (i in 0 until children.length) {
            val child = children.item(i)
            if (child.nodeType == Node.ELEMENT_NODE) {
                val childEl = child as Element
                val name = childEl.nodeName
                val actualLocalName = name.substringAfter(':')
                if (actualLocalName.equals(localName, ignoreCase = true)) {
                    result.add(childEl)
                }
            }
        }
        return result
    }

    private fun Element.getChildText(localName: String): String? {
        return getChildElement(localName)?.textContent
    }

    /**
     * Parses a GPX InputStream and returns a fully calculated CourseData object.
     */
    fun parse(inputStream: InputStream): CourseData {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = true
        val builder = factory.newDocumentBuilder()
        val doc = builder.parse(inputStream)
        doc.documentElement.normalize()

        // Extract track/course name
        var currentTrackName = "Imported Course"
        val metadataNodes = doc.getElementsByTagName("metadata")
        var nameFound = false
        if (metadataNodes.length > 0) {
            val metadataEl = metadataNodes.item(0) as Element
            val nameEl = metadataEl.getChildElement("name")
            if (nameEl != null) {
                currentTrackName = nameEl.textContent
                nameFound = true
            }
        }
        if (!nameFound) {
            val trkNodes = doc.getElementsByTagName("trk")
            if (trkNodes.length > 0) {
                val trkEl = trkNodes.item(0) as Element
                val trkNameEl = trkEl.getChildElement("name")
                if (trkNameEl != null) {
                    currentTrackName = trkNameEl.textContent
                    nameFound = true
                }
            }
        }
        if (!nameFound) {
            val nameNodes = doc.getElementsByTagName("name")
            if (nameNodes.length > 0) {
                currentTrackName = nameNodes.item(0).textContent
            }
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

                val ele = element.getChildText("ele")?.toDoubleOrNull() ?: 0.0
                val time = element.getChildText("time")

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
                        grade = 0.0,
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

                // Calculate gradient percentage (%) over ~30-meter horizontal baseline lookback window.
                // Why ~30 meters? Because raw GPS trackpoint-to-trackpoint elevation changes over 1-2 meters
                // suffer from high vertical GPS noise and quantization error. A 30-meter baseline smooths out
                // false spikes while accurately capturing true physical terrain steepness.
                var grade = 0.0
                var j = finalPoints.size - 1
                while (j > 0 && cumulativeDistance - finalPoints[j].distance < 30.0) {
                    j--
                }
                val basePt = finalPoints.getOrNull(j)
                if (basePt != null) {
                    val runDist = cumulativeDistance - basePt.distance
                    val riseEle = curr.ele - basePt.elevation
                    if (runDist > 5.0) {
                        grade = (riseEle / runDist) * 100.0
                    }
                }

                finalPoints.add(
                    RoutePoint(
                        latitude = curr.lat,
                        longitude = curr.lon,
                        elevation = curr.ele,
                        distance = cumulativeDistance,
                        climb = totalClimb,
                        descent = totalDescent,
                        grade = grade,
                        time = curr.time
                    )
                )
            }
        }

        // Extract metadata extensions (ca:race_plan, ca:execution_plan)
        var executionPlan: ExecutionPlan? = null
        if (metadataNodes.length > 0) {
            val metadataEl = metadataNodes.item(0) as Element
            val extEl = metadataEl.getChildElement("extensions")
            if (extEl != null) {
                // Race Plan
                val racePlanEl = extEl.getChildElement("race_plan")
                var startTime: String? = null
                var targetDurationHrs: Double? = null
                if (racePlanEl != null) {
                    startTime = racePlanEl.getAttribute("start_time").takeIf { it.isNotEmpty() }
                    targetDurationHrs = racePlanEl.getAttribute("target_duration_hrs").toDoubleOrNull()
                }

                // Execution Plan Sectors
                val execPlanEl = extEl.getChildElement("execution_plan")
                val sectors = mutableListOf<Sector>()
                if (execPlanEl != null) {
                    val sectorElements = execPlanEl.getChildElements("sector")
                    for (secEl in sectorElements) {
                        val startDistM = secEl.getAttribute("start_dist_m").toDoubleOrNull() ?: 0.0
                        val endDistM = secEl.getAttribute("end_dist_m").toDoubleOrNull() ?: 0.0
                        val secName = secEl.getAttribute("name")
                        val targetPaceMin = secEl.getAttribute("target_pace_min").toDoubleOrNull() ?: 10.0

                        val strategy = secEl.getChildText("strategy")?.trim() ?: ""
                        val nutrition = secEl.getChildText("nutrition")?.trim() ?: ""

                        sectors.add(Sector(startDistM, endDistM, secName, targetPaceMin, strategy, nutrition))
                    }
                }

                if (startTime != null || targetDurationHrs != null || sectors.isNotEmpty()) {
                    executionPlan = ExecutionPlan(startTime, targetDurationHrs, sectors)
                }
            }
        }

        // Extract Waypoints (wpt)
        val wptNodes = doc.getElementsByTagName("wpt")
        val finalWaypoints = mutableListOf<Waypoint>()

        for (i in 0 until wptNodes.length) {
            val node = wptNodes.item(i)
            if (node.nodeType == Node.ELEMENT_NODE) {
                val element = node as Element
                val lat = element.getAttribute("lat").toDouble()
                val lon = element.getAttribute("lon").toDouble()

                val ele = element.getChildText("ele")?.toDoubleOrNull() ?: 0.0
                val name = element.getChildText("name")?.trim() ?: "Waypoint ${i + 1}"
                val sym = element.getChildText("sym")?.trim() ?: ""
                val desc = element.getChildText("desc")?.trim() ?: ""

                // Parse station extensions
                var id = "wpt-$i"
                var stationExtensions: StationExtensions? = null
                val extEl = element.getChildElement("extensions")
                if (extEl != null) {
                    val stationEl = extEl.getChildElement("station")

                    if (stationEl != null) {
                        id = stationEl.getAttribute("id").ifEmpty { "station-$i" }
                        val type = stationEl.getAttribute("type").ifEmpty { "informational" }
                        val subtype = stationEl.getAttribute("subtype").takeIf { it.isNotEmpty() }

                        // Parse passes
                        val passes = mutableListOf<Pass>()
                        val passesEl = stationEl.getChildElement("passes")
                        val passElements = passesEl?.getChildElements("pass") ?: stationEl.getChildElements("pass")
                        for (p in passElements) {
                            val num = p.getAttribute("num").toIntOrNull() ?: 1
                            val distM = p.getAttribute("dist_m").toDoubleOrNull() ?: 0.0
                            val label = p.getAttribute("label").takeIf { it.isNotEmpty() }
                            val cutoffClock = p.getAttribute("cutoff_clock").takeIf { it.isNotEmpty() }
                            val cutoffElapsed = p.getAttribute("cutoff_elapsed").takeIf { it.isNotEmpty() }
                            val targetArrival = p.getAttribute("target_arrival").takeIf { it.isNotEmpty() }
                            val stretchStrategy = p.getAttribute("stretch_strategy").takeIf { it.isNotEmpty() }
                            passes.add(Pass(num, distM, label, cutoffClock, cutoffElapsed, targetArrival, stretchStrategy))
                        }

                        // Parse accessibility
                        var accessibility = Accessibility()
                        val accessEl = stationEl.getChildElement("accessibility")
                        if (accessEl != null) {
                            accessibility = Accessibility(
                                crewAllowed = accessEl.getAttribute("crew_allowed").toBoolean(),
                                pacerAllowed = accessEl.getAttribute("pacer_allowed").toBoolean(),
                                vehicleTier = accessEl.getAttribute("vehicle_tier").ifEmpty { "none" },
                                dropBagAllowed = accessEl.getAttribute("drop_bag_allowed").toBoolean()
                            )
                        }

                        // Parse services
                        var services = Services()
                        val servEl = stationEl.getChildElement("services")
                        if (servEl != null) {
                            services = Services(
                                water = servEl.getAttribute("water").toBoolean(),
                                unmanagedWater = servEl.getAttribute("unmanaged_water").toBoolean(),
                                food = servEl.getAttribute("food").toBoolean(),
                                hotFood = servEl.getAttribute("hot_food").toBoolean(),
                                toilets = servEl.getAttribute("toilets").toBoolean(),
                                medical = servEl.getAttribute("medical").toBoolean(),
                                sleepArea = servEl.getAttribute("sleep_area").toBoolean()
                            )
                        }

                        // Parse navigation_alert
                        var navigationAlert: NavigationAlert? = null
                        val navEl = stationEl.getChildElement("navigation_alert")
                        if (navEl != null) {
                            navigationAlert = NavigationAlert(
                                severity = navEl.getAttribute("severity").ifEmpty { "info" },
                                turnType = navEl.getAttribute("turn_type").ifEmpty { "straight" },
                                prompt = navEl.getAttribute("prompt")
                            )
                        }

                        stationExtensions = StationExtensions(
                            station = Station(id, type, subtype, passes, accessibility, services, navigationAlert)
                        )
                    }
                }

                // Snap waypoint distance to routepoints
                var closestIdx = 0
                var minSpatialDist = Double.MAX_VALUE
                val nameLower = name.lowercase()
                val isFinish = nameLower.contains("finish") || nameLower.contains("end") || sym.lowercase().contains("finish")
                val searchStartIndex = if (isFinish && finalPoints.isNotEmpty()) finalPoints.size / 2 else 0

                for (idx in searchStartIndex until finalPoints.size) {
                    val trk = finalPoints[idx]
                    val d = Haversine.distance(lat, lon, trk.latitude, trk.longitude)
                    if (d < minSpatialDist) {
                        minSpatialDist = d
                        closestIdx = idx
                    }
                }

                val finalDist = finalPoints.getOrNull(closestIdx)?.distance ?: 0.0

                finalWaypoints.add(
                    Waypoint(
                        id = id,
                        name = name,
                        latitude = lat,
                        longitude = lon,
                        elevation = ele,
                        symbol = sym,
                        description = desc,
                        closestTrackpointIndex = closestIdx,
                        distanceMeters = finalDist,
                        extensions = stationExtensions
                    )
                )
            }
        }

        // Sort waypoints chronologically by distance along course
        finalWaypoints.sortBy { it.distanceMeters }

        // Inject Course Start & Finish if missing
        if (finalPoints.isNotEmpty()) {
            val hasStart = finalWaypoints.any { it.closestTrackpointIndex == 0 || it.distanceMeters < 100 }
            if (!hasStart) {
                val startPt = finalPoints[0]
                finalWaypoints.add(
                    0,
                    Waypoint(
                        id = "wpt-start",
                        name = "Course Start",
                        latitude = startPt.latitude,
                        longitude = startPt.longitude,
                        elevation = startPt.elevation,
                        symbol = "icons/start.svg",
                        description = "Starting Line",
                        closestTrackpointIndex = 0,
                        distanceMeters = 0.0,
                        extensions = StationExtensions(
                            station = Station(
                                id = "station-start",
                                type = "start",
                                subtype = "start",
                                passes = listOf(Pass(1, 0.0, label = "Start", targetArrival = "00:00"))
                            )
                        )
                    )
                )
            }

            val lastIdx = finalPoints.size - 1
            val lastPt = finalPoints[lastIdx]
            val hasFinish = finalWaypoints.any { it.closestTrackpointIndex == lastIdx || (lastPt.distance - it.distanceMeters) < 100 }
            if (!hasFinish) {
                finalWaypoints.add(
                    Waypoint(
                        id = "wpt-finish",
                        name = "Course Finish",
                        latitude = lastPt.latitude,
                        longitude = lastPt.longitude,
                        elevation = lastPt.elevation,
                        symbol = "icons/finish.svg",
                        description = "Finish Line",
                        closestTrackpointIndex = lastIdx,
                        distanceMeters = lastPt.distance,
                        extensions = StationExtensions(
                            station = Station(
                                id = "station-finish",
                                type = "finish",
                                subtype = "finish",
                                passes = listOf(Pass(1, lastPt.distance, label = "Finish"))
                            )
                        )
                    )
                )
            }
        }

        val forecastList = mutableListOf<WeatherCondition>()
        val weatherTypes = listOf(
            Pair("☀️", "Clear/Sunny"),
            Pair("⛅", "Partly Cloudy"),
            Pair("☁️", "Mostly Cloudy"),
            Pair("🌦️", "Light Rain Showers"),
            Pair("🌧️", "Rain")
        )
        for (h in 0..24) {
            val hourStr = String.format(java.util.Locale.US, "%02d:00", (8 + h) % 24)
            val angle = Math.toRadians((h - 6) * 15.0)
            val temp = 12.0 + 6.0 * Math.sin(angle)
            val conditionIdx = (h / 5).coerceIn(0, weatherTypes.size - 1)
            val (emoji, text) = weatherTypes[conditionIdx]
            
            forecastList.add(
                WeatherCondition(
                    timestamp = hourStr,
                    temperature = temp,
                    windSpeed = 10.0 + 5.0 * Math.sin(Math.toRadians(h * 30.0)),
                    windDirection = 180.0,
                    humidity = 50.0 - 20.0 * Math.sin(angle),
                    rainProbability = if (emoji == "🌧️" || emoji == "🌦️") 60.0 else 10.0,
                    conditionEmoji = emoji,
                    conditionText = text
                )
            )
        }

        return CourseData(
            name = currentTrackName,
            points = finalPoints,
            waypoints = finalWaypoints,
            weatherForecast = forecastList,
            totalDistance = cumulativeDistance,
            elevationGain = totalClimb,
            elevationLoss = totalDescent,
            executionPlan = executionPlan
        )
    }

    private data class RoutePointTemp(
        val lat: Double,
        val lon: Double,
        val ele: Double,
        val time: String?
    )
}
