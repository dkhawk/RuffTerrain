package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import java.util.Locale

@Composable
fun DashboardScreen(
    course: CourseData?,
    progress: RunnerProgress?,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize().padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        if (course == null) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = "No Course Loaded",
                    style = MaterialTheme.typography.body1,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Please open RuffTerrain on your phone and select a route.",
                    style = MaterialTheme.typography.caption2,
                    color = Color.LightGray,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
            return@Box
        }

        // Circular course progress
        val totalDist = course.totalDistance
        val distanceRun = progress?.distanceRunMeters ?: 0.0
        val progressFraction = if (totalDist > 0) (distanceRun / totalDist).toFloat().coerceIn(0f..1f) else 0f

        CircularProgressIndicator(
            progress = progressFraction,
            modifier = Modifier.fillMaxSize(),
            startAngle = 270f,
            indicatorColor = Color(0xFF10B981), // Green-500
            trackColor = Color.Gray.copy(alpha = 0.2f),
            strokeWidth = 4.dp
        )

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxHeight().padding(vertical = 8.dp)
        ) {
            // Course Name (Top)
            Text(
                text = course.name.uppercase(Locale.US),
                style = MaterialTheme.typography.caption2,
                color = Color(0xFFFBBF24), // Amber
                maxLines = 1
            )

            // Primary Stat: Elapsed Time (Center-Top)
            val elapsedMs = progress?.elapsedTimeMs ?: 0L
            val elapsedSec = elapsedMs / 1000
            val hours = elapsedSec / 3600
            val minutes = (elapsedSec % 3600) / 60
            val seconds = elapsedSec % 60
            val timeStr = String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds)

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = timeStr,
                    style = MaterialTheme.typography.title1.copy(fontSize = 24.sp),
                    fontWeight = FontWeight.Black,
                    color = Color.White
                )
                Text(
                    text = "ELAPSED TIME",
                    style = MaterialTheme.typography.caption3,
                    color = Color.LightGray
                )
            }

            // Secondary Stats: Distance & Pace (Center-Bottom)
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    val distKm = distanceRun / 1000.0
                    Text(
                        text = String.format(Locale.US, "%.2f", distKm),
                        style = MaterialTheme.typography.body1.copy(fontSize = 16.sp),
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF60A5FA) // Blue-400
                    )
                    Text(
                        text = "KM RUN",
                        style = MaterialTheme.typography.caption3,
                        color = Color.LightGray
                    )
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // Calculate current pace (min/km)
                    val paceMinKm = if (distanceRun > 50.0 && elapsedSec > 5) {
                        val km = distanceRun / 1000.0
                        (elapsedSec / 60.0) / km
                    } else {
                        0.0
                    }
                    val paceMin = paceMinKm.toInt()
                    val paceSec = ((paceMinKm - paceMin) * 60).toInt()
                    val paceStr = if (paceMinKm > 0) String.format(Locale.US, "%d:%02d", paceMin, paceSec) else "--:--"

                    Text(
                        text = paceStr,
                        style = MaterialTheme.typography.body1.copy(fontSize = 16.sp),
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF34D399) // Emerald-400
                    )
                    Text(
                        text = "/KM PACE",
                        style = MaterialTheme.typography.caption3,
                        color = Color.LightGray
                    )
                }
            }

            // Next Waypoint Info (Bottom)
            val nextWpt = progress?.nextStationName ?: "Finish"
            val nextWptDistKm = (progress?.nextStationDistanceRemainingM ?: 0.0) / 1000.0
            
            Text(
                text = if (nextWptDistKm > 0.0) {
                    "➡️ $nextWpt: ${String.format(Locale.US, "%.1f", nextWptDistKm)}k"
                } else {
                    "🏁 Finished!"
                },
                style = MaterialTheme.typography.caption1,
                color = Color.White,
                fontWeight = FontWeight.Medium,
                maxLines = 1
            )
        }
    }
}
