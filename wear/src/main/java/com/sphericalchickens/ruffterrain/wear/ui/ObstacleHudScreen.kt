package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import com.sphericalchickens.ruffterrain.data.model.ClimbInfo
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import com.sphericalchickens.ruffterrain.wear.engine.ScenarioType
import com.sphericalchickens.ruffterrain.wear.engine.WearLocationEngine
import java.util.Locale

@Composable
fun ObstacleHudScreen(
    course: CourseData?,
    progress: RunnerProgress?,
    locationEngine: WearLocationEngine,
    modifier: Modifier = Modifier
) {
    val estimatedDistance by locationEngine.estimatedDistanceMeters.collectAsState()
    val scenario by locationEngine.scenarioType.collectAsState()
    val isGpsSearching by locationEngine.isGpsSearching.collectAsState()
    val listState = rememberScalingLazyListState()

    Box(
        modifier = modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        if (course == null) {
            Text(
                text = "No active course",
                style = MaterialTheme.typography.body1,
                color = Color.LightGray
            )
            return@Box
        }

        val elapsedSec = progress?.elapsedTimeMs?.div(1000.0) ?: 0.0

        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = listState,
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Header / GPS Info
            item {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "OBSTACLE HUD",
                        style = MaterialTheme.typography.caption1.copy(fontSize = 11.sp),
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFFBBF24) // Amber
                    )
                    if (isGpsSearching) {
                        Text(
                            text = "📡 Calibrating GPS...",
                            style = MaterialTheme.typography.caption2,
                            color = Color(0xFF60A5FA) // Blue-400
                        )
                    }
                }
            }

            // Scenario Selector
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    ScenarioButton("BEST", scenario == ScenarioType.BEST) {
                        locationEngine.setScenario(ScenarioType.BEST)
                    }
                    ScenarioButton("TARGET", scenario == ScenarioType.TARGET) {
                        locationEngine.setScenario(ScenarioType.TARGET)
                    }
                    ScenarioButton("WORST", scenario == ScenarioType.WORST) {
                        locationEngine.setScenario(ScenarioType.WORST)
                    }
                }
            }

            // Obstacle 1: Active Climb Card
            val activeClimb = detectClimb(estimatedDistance, course)
            if (activeClimb != null) {
                item {
                    Card(
                        onClick = {},
                        modifier = Modifier.fillMaxWidth(),
                        backgroundPainter = CardDefaults.cardBackgroundPainter(
                            startBackgroundColor = Color(0xFF450A0A), // Very dark red
                            endBackgroundColor = Color(0xFF180808)
                        )
                    ) {
                        Column {
                            Text(
                                text = "🧗 ACTIVE CLIMB",
                                style = MaterialTheme.typography.caption2,
                                color = Color(0xFFEF4444), // Red
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = activeClimb.name,
                                style = MaterialTheme.typography.body2,
                                maxLines = 1,
                                fontWeight = FontWeight.Medium
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = String.format(Locale.US, "Gain: +%.0fm", activeClimb.elevationGainRemainingM),
                                    style = MaterialTheme.typography.caption2,
                                    color = Color.LightGray
                                )
                                Text(
                                    text = String.format(Locale.US, "Grade: %.1f%%", activeClimb.averageGrade),
                                    style = MaterialTheme.typography.caption2,
                                    color = Color.LightGray
                                )
                            }
                            Text(
                                text = String.format(Locale.US, "Dist Remaining: %.2f km", activeClimb.distanceRemainingM / 1000.0),
                                style = MaterialTheme.typography.caption1,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                        }
                    }
                }
            }

            // Obstacle 2: Next Checkpoint/Aid Station
            val nextCheckpoint = course.waypoints
                .filter { it.distanceMeters > estimatedDistance }
                .minByOrNull { it.distanceMeters }
            
            if (nextCheckpoint != null) {
                item {
                    val distToStation = nextCheckpoint.distanceMeters - estimatedDistance
                    val projectBestSec = calculateProjectedTime(estimatedDistance, elapsedSec, nextCheckpoint.distanceMeters, course, ScenarioType.BEST)
                    val projectWorstSec = calculateProjectedTime(estimatedDistance, elapsedSec, nextCheckpoint.distanceMeters, course, ScenarioType.WORST)
                    val projectTargetSec = calculateProjectedTime(estimatedDistance, elapsedSec, nextCheckpoint.distanceMeters, course, ScenarioType.TARGET)

                    Card(
                        onClick = {},
                        modifier = Modifier.fillMaxWidth(),
                        backgroundPainter = CardDefaults.cardBackgroundPainter(
                            startBackgroundColor = Color(0xFF065F46), // Dark emerald green
                            endBackgroundColor = Color(0xFF064E3B)
                        )
                    ) {
                        Column {
                            Text(
                                text = "🏥 NEXT AID STATION",
                                style = MaterialTheme.typography.caption2,
                                color = Color(0xFF34D399), // Emerald
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = nextCheckpoint.name,
                                style = MaterialTheme.typography.body2,
                                maxLines = 1,
                                fontWeight = FontWeight.Medium
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = String.format(Locale.US, "Dist: %.2f km", distToStation / 1000.0),
                                style = MaterialTheme.typography.caption1,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = String.format(
                                    Locale.US, 
                                    "Projected: %s\nRange: %s - %s",
                                    formatTime(projectTargetSec),
                                    formatTime(projectBestSec),
                                    formatTime(projectWorstSec)
                                ),
                                style = MaterialTheme.typography.caption2,
                                color = Color.LightGray
                            )
                        }
                    }
                }
            }

            // Obstacle 3: Finish Line Progress
            item {
                val remDistance = course.totalDistance - estimatedDistance
                val finishBest = calculateProjectedTime(estimatedDistance, elapsedSec, course.totalDistance, course, ScenarioType.BEST)
                val finishWorst = calculateProjectedTime(estimatedDistance, elapsedSec, course.totalDistance, course, ScenarioType.WORST)
                val finishTarget = calculateProjectedTime(estimatedDistance, elapsedSec, course.totalDistance, course, ScenarioType.TARGET)

                Card(
                    onClick = {},
                    modifier = Modifier.fillMaxWidth(),
                    backgroundPainter = CardDefaults.cardBackgroundPainter(
                        startBackgroundColor = Color(0xFF1E3A8A), // Dark blue
                        endBackgroundColor = Color(0xFF0F172A)
                    )
                ) {
                    Column {
                        Text(
                            text = "🏁 RACE FINISH",
                            style = MaterialTheme.typography.caption2,
                            color = Color(0xFF60A5FA), // Light blue
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = String.format(Locale.US, "Remaining: %.2f km", remDistance / 1000.0),
                            style = MaterialTheme.typography.body2,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = String.format(
                                Locale.US,
                                "ETA: %s\nRange: %s - %s",
                                formatTime(finishTarget),
                                formatTime(finishBest),
                                formatTime(finishWorst)
                            ),
                            style = MaterialTheme.typography.caption2,
                            color = Color.LightGray
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ScenarioButton(text: String, isSelected: Boolean, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        colors = ChipDefaults.chipColors(
            backgroundColor = if (isSelected) Color(0xFFFBBF24) else Color.DarkGray,
            contentColor = if (isSelected) Color.Black else Color.White
        ),
        modifier = Modifier.width(52.dp).height(24.dp),
        label = {
            Text(
                text = text,
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    )
}

private fun formatTime(seconds: Double): String {
    val h = (seconds / 3600).toInt()
    val m = ((seconds % 3600) / 60).toInt()
    val s = (seconds % 60).toInt()
    return String.format(Locale.US, "%02d:%02d:%02d", h, m, s)
}

private fun detectClimb(currentDist: Double, course: CourseData): ClimbInfo? {
    if (course.points.isEmpty()) return null
    
    var currIdx = course.points.indexOfFirst { it.distance >= currentDist }
    if (currIdx == -1) currIdx = course.points.size - 1

    var peakIdx = currIdx
    var maxEle = course.points[currIdx].elevation

    for (i in currIdx + 1 until course.points.size) {
        val pt = course.points[i]
        if (pt.elevation > maxEle) {
            maxEle = pt.elevation
            peakIdx = i
        }
        if (maxEle - pt.elevation > 25.0) {
            break
        }
    }

    val currentPt = course.points[currIdx]
    val peakPt = course.points[peakIdx]
    val climbGain = peakPt.elevation - currentPt.elevation
    val climbDist = peakPt.distance - currentPt.distance

    return if (climbGain >= 20.0 && climbDist >= 150.0) {
        val nearestWpt = course.waypoints.find {
            it.distanceMeters >= currentPt.distance && it.distanceMeters <= peakPt.distance && 
            (it.name.lowercase().contains("pass") || it.name.lowercase().contains("summit") || it.name.lowercase().contains("top"))
        } ?: course.waypoints.minByOrNull { Math.abs(it.distanceMeters - peakPt.distance) }

        val name = nearestWpt?.name?.let { "Climb to $it" } ?: "Active Climb"
        ClimbInfo(
            name = name,
            distanceRemainingM = climbDist,
            elevationGainRemainingM = climbGain,
            averageGrade = (climbGain / climbDist) * 100.0
        )
    } else {
        null
    }
}

private fun calculateProjectedTime(
    currentDist: Double,
    currentElapsedSec: Double,
    targetDist: Double,
    course: CourseData,
    scenario: ScenarioType
): Double {
    if (targetDist <= currentDist) return currentElapsedSec
    val plan = course.executionPlan ?: return currentElapsedSec + (targetDist - currentDist) * (10.0 * 60.0 / 1000.0) // fallback 10:00/km
    
    var remainingTimeSec = 0.0
    var tempDist = currentDist
    
    for (sector in plan.sectors) {
        if (targetDist <= sector.startDistM) continue
        if (tempDist >= sector.endDistM) continue
        
        val start = Math.max(tempDist, sector.startDistM)
        val end = Math.min(targetDist, sector.endDistM)
        if (end > start) {
            val length = end - start
            val paceMin = when (scenario) {
                ScenarioType.BEST -> sector.bestPaceMin
                ScenarioType.TARGET -> sector.targetPaceMin
                ScenarioType.WORST -> sector.worstPaceMin
            }
            val velocityMps = if (paceMin > 0.0) 1000.0 / (paceMin * 60.0) else 0.0
            if (velocityMps > 0.0) {
                remainingTimeSec += length / velocityMps
            }
        }
    }
    return currentElapsedSec + remainingTimeSec
}
