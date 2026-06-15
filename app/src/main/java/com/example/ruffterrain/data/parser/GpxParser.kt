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

package com.example.ruffterrain.data.parser

import com.example.ruffterrain.data.model.*
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
        factory.isNamespaceAware = true
        val builder = factory.newDocumentBuilder()
        val doc = builder.parse(inputStream)
        doc.documentElement.normalize()

        // Extract track/course name
        val nameNodes = doc.getElementsByTagNameNS("*", "name")
        var currentTrackName = "Imported Course"
        if (nameNodes.length > 0) {
            currentTrackName = nameNodes.item(0).textContent
        }

        // Extract track points
        val trkptNodes = doc.getElementsByTagNameNS("*", "trkpt")
        val rawPoints = mutableListOf<RoutePointTemp>()

        for (i in 0 until trkptNodes.length) {
            val node = trkptNodes.item(i)
            if (node.nodeType == Node.ELEMENT_NODE) {
                val element = node as Element
                val lat = element.getAttribute("lat").toDouble()
                val lon = element.getAttribute("lon").toDouble()

                var ele = 0.0
                val eleNodes = element.getElementsByTagNameNS("*", "ele")
                if (eleNodes.length > 0) {
                    ele = eleNodes.item(0).textContent.toDoubleOrNull() ?: 0.0
                }

                var time: String? = null
                val timeNodes = element.getElementsByTagNameNS("*", "time")
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

        // Extract metadata extensions (ca:race_plan, ca:execution_plan)
        var executionPlan: ExecutionPlan? = null
        val metadataNodes = doc.getElementsByTagNameNS("*", "metadata")
        if (metadataNodes.length > 0) {
            val metadataEl = metadataNodes.item(0) as Element
            val extensionsNodes = metadataEl.getElementsByTagNameNS("*", "extensions")
            if (extensionsNodes.length > 0) {
                val extEl = extensionsNodes.item(0) as Element

                // Race Plan
                val racePlanNodes = extEl.getElementsByTagNameNS("*", "race_plan")
                val racePlanEl = if (racePlanNodes.length > 0) {
                    racePlanNodes.item(0) as Element
                } else {
                    val rp = extEl.getElementsByTagName("ca:race_plan")
                    if (rp.length > 0) rp.item(0) as Element else {
                        val rp2 = extEl.getElementsByTagName("race_plan")
                        if (rp2.length > 0) rp2.item(0) as Element else null
                    }
                }

                var startTime: String? = null
                var targetDurationHrs: Double? = null
                if (racePlanEl != null) {
                    startTime = racePlanEl.getAttribute("start_time").takeIf { it.isNotEmpty() }
                    targetDurationHrs = racePlanEl.getAttribute("target_duration_hrs").toDoubleOrNull()
                }

                // Execution Plan Sectors
                val execPlanNodes = extEl.getElementsByTagNameNS("*", "execution_plan")
                val execPlanEl = if (execPlanNodes.length > 0) {
                    execPlanNodes.item(0) as Element
                } else {
                    val ep = extEl.getElementsByTagName("ca:execution_plan")
                    if (ep.length > 0) ep.item(0) as Element else {
                        val ep2 = extEl.getElementsByTagName("execution_plan")
                        if (ep2.length > 0) ep2.item(0) as Element else null
                    }
                }

                val sectors = mutableListOf<Sector>()
                if (execPlanEl != null) {
                    val sectorNodes = execPlanEl.getElementsByTagNameNS("*", "sector")
                    val finalSecNodes = if (sectorNodes.length > 0) sectorNodes else {
                        val sn = execPlanEl.getElementsByTagName("ca:sector")
                        if (sn.length > 0) sn else execPlanEl.getElementsByTagName("sector")
                    }

                    for (j in 0 until finalSecNodes.length) {
                        val secNode = finalSecNodes.item(j)
                        if (secNode.nodeType == Node.ELEMENT_NODE) {
                            val secEl = secNode as Element
                            val startDistM = secEl.getAttribute("start_dist_m").toDoubleOrNull() ?: 0.0
                            val endDistM = secEl.getAttribute("end_dist_m").toDoubleOrNull() ?: 0.0
                            val secName = secEl.getAttribute("name")
                            val targetPaceMin = secEl.getAttribute("target_pace_min").toDoubleOrNull() ?: 10.0

                            var strategy = ""
                            val stratNodes = secEl.getElementsByTagNameNS("*", "strategy")
                            val finalStratNodes = if (stratNodes.length > 0) stratNodes else {
                                val st = secEl.getElementsByTagName("ca:strategy")
                                if (st.length > 0) st else secEl.getElementsByTagName("strategy")
                            }
                            if (finalStratNodes.length > 0) {
                                strategy = finalStratNodes.item(0).textContent.trim()
                            }

                            var nutrition = ""
                            val nutNodes = secEl.getElementsByTagNameNS("*", "nutrition")
                            val finalNutNodes = if (nutNodes.length > 0) nutNodes else {
                                val nu = secEl.getElementsByTagName("ca:nutrition")
                                if (nu.length > 0) nu else secEl.getElementsByTagName("nutrition")
                            }
                            if (finalNutNodes.length > 0) {
                                nutrition = finalNutNodes.item(0).textContent.trim()
                            }

                            sectors.add(Sector(startDistM, endDistM, secName, targetPaceMin, strategy, nutrition))
                        }
                    }
                }

                if (startTime != null || targetDurationHrs != null || sectors.isNotEmpty()) {
                    executionPlan = ExecutionPlan(startTime, targetDurationHrs, sectors)
                }
            }
        }

        // Extract Waypoints (wpt)
        val wptNodes = doc.getElementsByTagNameNS("*", "wpt")
        val finalWaypoints = mutableListOf<Waypoint>()

        for (i in 0 until wptNodes.length) {
            val node = wptNodes.item(i)
            if (node.nodeType == Node.ELEMENT_NODE) {
                val element = node as Element
                val lat = element.getAttribute("lat").toDouble()
                val lon = element.getAttribute("lon").toDouble()

                var ele = 0.0
                val eleNodes = element.getElementsByTagNameNS("*", "ele")
                if (eleNodes.length > 0) {
                    ele = eleNodes.item(0).textContent.toDoubleOrNull() ?: 0.0
                }

                var name = "Waypoint ${i + 1}"
                val nameNodes = element.getElementsByTagNameNS("*", "name")
                if (nameNodes.length > 0) {
                    name = nameNodes.item(0).textContent.trim()
                }

                var sym = ""
                val symNodes = element.getElementsByTagNameNS("*", "sym")
                if (symNodes.length > 0) {
                    sym = symNodes.item(0).textContent.trim()
                }

                var desc = ""
                val descNodes = element.getElementsByTagNameNS("*", "desc")
                if (descNodes.length > 0) {
                    desc = descNodes.item(0).textContent.trim()
                }

                // Parse station extensions
                var id = "wpt-$i"
                var stationExtensions: StationExtensions? = null
                val extNodes = element.getElementsByTagNameNS("*", "extensions")
                if (extNodes.length > 0) {
                    val extEl = extNodes.item(0) as Element

                    val stationNodes = extEl.getElementsByTagNameNS("*", "station")
                    val stationEl = if (stationNodes.length > 0) {
                        stationNodes.item(0) as Element
                    } else {
                        val st = extEl.getElementsByTagName("ca:station")
                        if (st.length > 0) st.item(0) as Element else {
                            val st2 = extEl.getElementsByTagName("station")
                            if (st2.length > 0) st2.item(0) as Element else null
                        }
                    }

                    if (stationEl != null) {
                        id = stationEl.getAttribute("id").ifEmpty { "station-$i" }
                        val type = stationEl.getAttribute("type").ifEmpty { "informational" }
                        val subtype = stationEl.getAttribute("subtype").takeIf { it.isNotEmpty() }

                        // Parse passes
                        val passes = mutableListOf<Pass>()
                        val passNodes = stationEl.getElementsByTagNameNS("*", "pass")
                        val finalPassNodes = if (passNodes.length > 0) passNodes else {
                            val pn = stationEl.getElementsByTagName("ca:pass")
                            if (pn.length > 0) pn else stationEl.getElementsByTagName("pass")
                        }
                        for (p in 0 until finalPassNodes.length) {
                            val pEl = finalPassNodes.item(p) as Element
                            val num = pEl.getAttribute("num").toIntOrNull() ?: 1
                            val distM = pEl.getAttribute("dist_m").toDoubleOrNull() ?: 0.0
                            val label = pEl.getAttribute("label").takeIf { it.isNotEmpty() }
                            val cutoffClock = pEl.getAttribute("cutoff_clock").takeIf { it.isNotEmpty() }
                            val cutoffElapsed = pEl.getAttribute("cutoff_elapsed").takeIf { it.isNotEmpty() }
                            val targetArrival = pEl.getAttribute("target_arrival").takeIf { it.isNotEmpty() }
                            val stretchStrategy = pEl.getAttribute("stretch_strategy").takeIf { it.isNotEmpty() }
                            passes.add(Pass(num, distM, label, cutoffClock, cutoffElapsed, targetArrival, stretchStrategy))
                        }

                        // Parse accessibility
                        var accessibility = Accessibility()
                        val accessNodes = stationEl.getElementsByTagNameNS("*", "accessibility")
                        val accessEl = if (accessNodes.length > 0) {
                            accessNodes.item(0) as Element
                        } else {
                            val ac = stationEl.getElementsByTagName("ca:accessibility")
                            if (ac.length > 0) ac.item(0) as Element else {
                                val ac2 = stationEl.getElementsByTagName("accessibility")
                                if (ac2.length > 0) ac2.item(0) as Element else null
                            }
                        }
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
                        val servNodes = stationEl.getElementsByTagNameNS("*", "services")
                        val servEl = if (servNodes.length > 0) {
                            servNodes.item(0) as Element
                        } else {
                            val se = stationEl.getElementsByTagName("ca:services")
                            if (se.length > 0) se.item(0) as Element else {
                                val se2 = stationEl.getElementsByTagName("services")
                                if (se2.length > 0) se2.item(0) as Element else null
                            }
                        }
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
                        val navNodes = stationEl.getElementsByTagNameNS("*", "navigation_alert")
                        val navEl = if (navNodes.length > 0) {
                            navNodes.item(0) as Element
                        } else {
                            val na = stationEl.getElementsByTagName("ca:navigation_alert")
                            if (na.length > 0) na.item(0) as Element else {
                                val na2 = stationEl.getElementsByTagName("navigation_alert")
                                if (na2.length > 0) na2.item(0) as Element else null
                            }
                        }
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

        return CourseData(
            name = currentTrackName,
            points = finalPoints,
            waypoints = finalWaypoints,
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
