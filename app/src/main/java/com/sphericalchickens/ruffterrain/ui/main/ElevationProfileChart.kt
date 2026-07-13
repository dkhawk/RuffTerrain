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

package com.sphericalchickens.ruffterrain.ui.main

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.sphericalchickens.ruffterrain.data.model.CourseData

@Composable
fun ElevationProfileChart(
    courseData: CourseData,
    scrubberProgress: Double,
    modifier: Modifier = Modifier,
    onScrub: ((Double) -> Unit)? = null
) {
    val points = courseData.points
    if (points.isEmpty()) return

    val totalDist = courseData.totalDistance
    if (totalDist <= 0.0) return

    val minElev = remember(points) { points.minOf { it.elevation } }
    val maxElev = remember(points) { points.maxOf { it.elevation } }
    val elevRange = (maxElev - minElev).coerceAtLeast(1.0)

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(100.dp)
            .pointerInput(points, onScrub) {
                detectTapGestures { offset ->
                    onScrub?.invoke((offset.x / size.width).toDouble().coerceIn(0.0..1.0))
                }
            }
    ) {
        val width = size.width
        val height = size.height

        // Padding factors so line doesn't hit bottom/top bounds
        val verticalPadding = height * 0.15f
        val chartHeight = height - (verticalPadding * 2f)

        // Helper to convert data point to canvas pixel coordinates
        fun getCanvasCoordinates(distance: Double, elevation: Double): Offset {
            val x = (distance / totalDist).toFloat() * width
            val normElev = ((elevation - minElev) / elevRange).toFloat()
            val y = height - verticalPadding - (normElev * chartHeight)
            return Offset(x, y)
        }

        // Build the elevation path
        val fillPath = Path()

        val firstPt = points.first()
        val startOffset = getCanvasCoordinates(firstPt.distance, firstPt.elevation)

        fillPath.moveTo(0f, height)
        fillPath.lineTo(startOffset.x, startOffset.y)

        // Plot trail trackpoints on the chart
        for (i in 1 until points.size) {
            val pt = points[i]
            val offset = getCanvasCoordinates(pt.distance, pt.elevation)
            fillPath.lineTo(offset.x, offset.y)
        }

        fillPath.lineTo(width, height)
        fillPath.close()

        // 1. Draw beautiful translucent color gradient fill under elevation line
        drawPath(
            path = fillPath,
            brush = Brush.verticalGradient(
                colors = listOf(
                    Color(0xFF38BDF8).copy(alpha = 0.15f),
                    Color(0xFF38BDF8).copy(alpha = 0.0f)
                ),
                startY = verticalPadding,
                endY = height
            )
        )

        // 2. Draw solid course elevation profile stroke color-coded by grade
        var prevOffset = startOffset
        for (i in 1 until points.size) {
            val pt = points[i]
            val offset = getCanvasCoordinates(pt.distance, pt.elevation)
            val tier = classifyGradient(pt.grade)
            drawLine(
                color = tier.color,
                start = prevOffset,
                end = offset,
                strokeWidth = 3.dp.toPx()
            )
            prevOffset = offset
        }


        // 3. Draw vertical dotted lines for Waypoints (Aid Stations / Water points)
        courseData.waypoints.forEach { wpt ->
            val offset = getCanvasCoordinates(wpt.distanceMeters, wpt.elevation)
            // Draw a tiny waypoint marker pin indicator dot
            drawCircle(
                color = Color.White,
                radius = 4.dp.toPx(),
                center = offset
            )
            drawCircle(
                color = Color.DarkGray,
                radius = 4.dp.toPx(),
                center = offset,
                style = Stroke(width = 1.dp.toPx())
            )
        }

        // 4. Draw vertical line for Scrubber Position
        val scrubberIndex = (scrubberProgress * (points.size - 1)).toInt().coerceIn(0, points.size - 1)
        val scrubberPoint = points.getOrNull(scrubberIndex)
        if (scrubberPoint != null) {
            val scrubberOffset = getCanvasCoordinates(scrubberPoint.distance, scrubberPoint.elevation)

            // Draw vertical indicator line
            drawLine(
                color = Color.Red,
                start = Offset(scrubberOffset.x, 0f),
                end = Offset(scrubberOffset.x, height),
                strokeWidth = 1.5.dp.toPx()
            )

            // Draw glowing core runner dot
            drawCircle(
                color = Color.Red,
                radius = 6.dp.toPx(),
                center = scrubberOffset
            )
            drawCircle(
                color = Color.White,
                radius = 2.dp.toPx(),
                center = scrubberOffset
            )
        }
    }
}
