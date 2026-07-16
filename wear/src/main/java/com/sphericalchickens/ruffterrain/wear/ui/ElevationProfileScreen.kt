package com.sphericalchickens.ruffterrain.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import java.util.Locale

@Composable
fun ElevationProfileScreen(
    course: CourseData?,
    progress: RunnerProgress?,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize().padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        if (course == null || course.points.isEmpty()) {
            Text(
                text = "Load GPX to view elevation",
                style = MaterialTheme.typography.caption2,
                color = Color.LightGray,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            return@Box
        }

        val totalDistance = course.totalDistance
        val distanceRun = progress?.distanceRunMeters ?: 0.0

        // Downsample elevation profile points to around 100 points for efficient watch rendering
        val rawPoints = course.points
        val numSamplePoints = 100
        val samplePoints = if (rawPoints.size <= numSamplePoints) {
            rawPoints
        } else {
            val step = rawPoints.size.toDouble() / numSamplePoints
            List(numSamplePoints) { idx -> rawPoints[(idx * step).toInt().coerceIn(rawPoints.indices)] }
        }

        val minElevation = samplePoints.minOfOrNull { it.elevation } ?: 0.0
        val maxElevation = samplePoints.maxOfOrNull { it.elevation } ?: 1.0
        val elevationDelta = (maxElevation - minElevation).coerceAtLeast(1.0)

        // Find current elevation of runner
        val currentPtIdx = if (totalDistance > 0.0) {
            val fraction = (distanceRun / totalDistance).coerceIn(0.0..1.0)
            (fraction * (rawPoints.size - 1)).toInt().coerceIn(rawPoints.indices)
        } else 0
        val currentElevation = rawPoints.getOrNull(currentPtIdx)?.elevation ?: 0.0

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxSize().padding(top = 4.dp)
        ) {
            // Title & Info
            Text(
                text = "ELEVATION PROFILE",
                style = MaterialTheme.typography.caption2,
                color = Color(0xFFFBBF24), // Amber
                fontWeight = FontWeight.Bold
            )

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${currentElevation.toInt()} m",
                    style = MaterialTheme.typography.caption1,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                
                val gainRemaining = (course.elevationGain - (rawPoints.getOrNull(currentPtIdx)?.climb ?: 0.0)).coerceAtLeast(0.0)
                Text(
                    text = "+${gainRemaining.toInt()} m left",
                    style = MaterialTheme.typography.caption2,
                    color = Color(0xFF34D399) // Emerald-400
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Canvas drawing
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(vertical = 4.dp)
            ) {
                val canvasWidth = size.width
                val canvasHeight = size.height

                val path = Path()
                var currentX = 0f
                var currentY = 0f

                // Formulate coordinate scaling helpers
                fun getX(dist: Double): Float = ((dist / totalDistance) * canvasWidth).toFloat()
                fun getY(elev: Double): Float {
                    val norm = (elev - minElevation) / elevationDelta
                    // Invert Y axis for Canvas coordinates
                    return (canvasHeight - (norm * canvasHeight)).toFloat()
                }

                samplePoints.forEachIndexed { index, routePoint ->
                    val x = getX(routePoint.distance)
                    val y = getY(routePoint.elevation)
                    if (index == 0) {
                        path.moveTo(x, y)
                    } else {
                        path.lineTo(x, y)
                    }
                }

                // Draw filled path below the profile
                val fillPath = Path().apply {
                    addPath(path)
                    lineTo(canvasWidth, canvasHeight)
                    lineTo(0f, canvasHeight)
                    close()
                }

                drawPath(
                    path = fillPath,
                    color = Color(0xFF60A5FA).copy(alpha = 0.15f) // Subtle blue fill
                )

                drawPath(
                    path = path,
                    color = Color(0xFF3B82F6), // Blue stroke
                    style = Stroke(width = 2.dp.toPx())
                )

                // Draw runner's current position dot
                val runnerX = getX(distanceRun)
                val runnerY = getY(currentElevation)

                // White outer focal ring
                drawCircle(
                    color = Color.White,
                    radius = 5.dp.toPx(),
                    center = Offset(runnerX, runnerY)
                )

                // Blue inner dot
                drawCircle(
                    color = Color(0xFF1D4ED8),
                    radius = 3.dp.toPx(),
                    center = Offset(runnerX, runnerY)
                )
            }

            // Distances
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "0.0k",
                    style = MaterialTheme.typography.caption3,
                    color = Color.LightGray
                )
                Text(
                    text = "${String.format(Locale.US, "%.1f", distanceRun / 1000.0)}k done",
                    style = MaterialTheme.typography.caption3,
                    color = Color.LightGray
                )
                Text(
                    text = "${String.format(Locale.US, "%.1f", totalDistance / 1000.0)}k",
                    style = MaterialTheme.typography.caption3,
                    color = Color.LightGray
                )
            }
        }
    }
}
