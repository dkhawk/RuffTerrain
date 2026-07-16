package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import java.util.Locale

@Composable
fun CheckpointsScreen(
    course: CourseData?,
    progress: RunnerProgress?,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize().padding(12.dp),
        contentAlignment = Alignment.Center
    ) {
        if (course == null || course.waypoints.isEmpty()) {
            Text(
                text = "Load GPX to view checkpoints",
                style = MaterialTheme.typography.caption2,
                color = Color.LightGray,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            return@Box
        }

        val distanceRun = progress?.distanceRunMeters ?: 0.0
        val waypoints = course.waypoints
        val listState = rememberScalingLazyListState()

        Scaffold(
            positionIndicator = {
                PositionIndicator(scalingLazyListState = listState)
            }
        ) {
            ScalingLazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // Header item
                item {
                    Text(
                        text = "AID STATIONS",
                        style = MaterialTheme.typography.caption2,
                        color = Color(0xFFFBBF24), // Amber
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }

                // Filter stations and checkpoints
                val stations = waypoints.filter { it.extensions?.station != null }
                if (stations.isEmpty()) {
                    // Fallback to general waypoints if no specific station extensions exist
                    items(waypoints) { waypoint ->
                        val isPassed = distanceRun > waypoint.distanceMeters
                        val distKm = (waypoint.distanceMeters - distanceRun) / 1000.0

                        Card(
                            onClick = {},
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                            backgroundPainter = CardDefaults.cardBackgroundPainter(
                                startBackgroundColor = if (isPassed) Color.Gray.copy(alpha = 0.2f) else Color(0xFF1E293B)
                            )
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = waypoint.name,
                                        style = MaterialTheme.typography.body2,
                                        fontWeight = FontWeight.Bold,
                                        color = if (isPassed) Color.Gray else Color.White
                                    )
                                    Text(
                                        text = "${String.format(Locale.US, "%.1f", waypoint.distanceMeters / 1000.0)} km",
                                        style = MaterialTheme.typography.caption3,
                                        color = Color.LightGray
                                    )
                                }

                                if (isPassed) {
                                    Text(
                                        text = "PASSED",
                                        style = MaterialTheme.typography.caption3.copy(fontSize = 9.sp),
                                        color = Color(0xFF10B981),
                                        fontWeight = FontWeight.Bold
                                    )
                                } else {
                                    Text(
                                        text = "+${String.format(Locale.US, "%.1f", distKm)}k",
                                        style = MaterialTheme.typography.body2,
                                        color = Color(0xFF60A5FA),
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                } else {
                    items(stations) { waypoint ->
                        val isPassed = distanceRun > waypoint.distanceMeters
                        val distKm = (waypoint.distanceMeters - distanceRun) / 1000.0
                        val station = waypoint.extensions?.station
                        
                        // Grab cutoff clock or cutoff elapsed if present
                        val passObj = station?.passes?.firstOrNull()
                        val cutoffText = passObj?.cutoffClock ?: passObj?.cutoffElapsed

                        Card(
                            onClick = {},
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                            backgroundPainter = CardDefaults.cardBackgroundPainter(
                                startBackgroundColor = if (isPassed) Color.Gray.copy(alpha = 0.2f) else Color(0xFF1E293B)
                            )
                        ) {
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = waypoint.name,
                                            style = MaterialTheme.typography.body2,
                                            fontWeight = FontWeight.Bold,
                                            color = if (isPassed) Color.Gray else Color.White
                                        )
                                        Text(
                                            text = "${String.format(Locale.US, "%.1f", waypoint.distanceMeters / 1000.0)} km",
                                            style = MaterialTheme.typography.caption3,
                                            color = Color.LightGray
                                        )
                                    }

                                    if (isPassed) {
                                        Text(
                                            text = "PASSED",
                                            style = MaterialTheme.typography.caption3.copy(fontSize = 9.sp),
                                            color = Color(0xFF10B981),
                                            fontWeight = FontWeight.Bold
                                        )
                                    } else {
                                        Text(
                                            text = "+${String.format(Locale.US, "%.1f", distKm)}k",
                                            style = MaterialTheme.typography.body2,
                                            color = Color(0xFF60A5FA),
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }

                                if (cutoffText != null && !isPassed) {
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "Cutoff: $cutoffText",
                                        style = MaterialTheme.typography.caption3,
                                        color = Color(0xFFFCA5A5),
                                        fontWeight = FontWeight.Medium
                                    )
                                }
                            }
                        }
                    }
                }

                // Spacing item at the bottom to ensure comfortable scrolling
                item {
                    Spacer(modifier = Modifier.height(20.dp))
                }
            }
        }
    }
}
