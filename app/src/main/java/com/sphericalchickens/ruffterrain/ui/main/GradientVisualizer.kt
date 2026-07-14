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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sphericalchickens.ruffterrain.data.model.CourseData
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil

/**
 * Represents the distinct classification tiers of terrain gradient steepness.
 * We align these colors directly with the scheme used for route alerts and 3D map segments
 * to maintain consistent visual language across all analytical views.
 */
enum class GradientTier(val label: String, val color: Color, val backgroundColor: Color) {
    DESCENT("DESCENT", Color(0xFF10B981), Color(0xFF10B981).copy(alpha = 0.15f)),
    FLAT("FLAT", Color(0xFF3B82F6), Color(0xFF3B82F6).copy(alpha = 0.15f)),
    MODERATE_CLIMB("MODERATE CLIMB", Color(0xFFF59E0B), Color(0xFFF59E0B).copy(alpha = 0.15f)),
    STEEP_CLIMB("STEEP CLIMB", Color(0xFFF97316), Color(0xFFF97316).copy(alpha = 0.15f)),
    VERY_STEEP("VERY STEEP", Color(0xFFEF4444), Color(0xFFEF4444).copy(alpha = 0.15f)),
    EXTREME_CLIMB("EXTREME CLIMB", Color(0xFFB91C1C), Color(0xFFB91C1C).copy(alpha = 0.25f))
}

/**
 * Classifies a gradient percentage (e.g. -4.5%, 7.2%) into its corresponding [GradientTier].
 * Why these exact thresholds?
 * - Descents (< -2.0%): Downhill sections where runners recover or experience quad impact.
 * - Flat (-2.0%..+2.0%): Level terrain suitable for sustained target pace.
 * - Moderate (2.0%..5.0%): Noticeable inclines requiring slight pacing adjustment.
 * - Steep (5.0%..8.0%): Challenging climbs triggering safety caution markers.
 * - Very Steep (8.0%..10.0%): Heavy power-hiking territory.
 * - Extreme (> 10.0%): Severe ascents with high exertion demands.
 */
fun classifyGradient(grade: Double?): GradientTier {
    if (grade == null || grade.isNaN()) return GradientTier.FLAT
    return when {
        grade < -2.0 -> GradientTier.DESCENT
        grade <= 2.0 -> GradientTier.FLAT
        grade <= 5.0 -> GradientTier.MODERATE_CLIMB
        grade <= 8.0 -> GradientTier.STEEP_CLIMB
        grade <= 10.0 -> GradientTier.VERY_STEEP
        else -> GradientTier.EXTREME_CLIMB
    }
}

/**
 * A retro color-coded bar graph representing the terrain gradient, designed to evoke the classic
 * segmented LED volume bars / VU meters found on stereo graphic equalizers from the 80s and 90s.
 *
 * Why a segmented bar graph?
 * Classic 80s/90s stereo equalizers used discrete illuminated LED blocks stacked horizontally or
 * vertically. By mapping gradient percentages to illuminated LED blocks with a clear Zero (0%)
 * center indicator, runners get intuitive, instant visual feedback on incline and downhill severity.
 *
 * @param currentGrade The instantaneous gradient percentage (e.g. -6.5, 8.2).
 * @param modifier Optional Compose styling modifier.
 */
@Composable
fun RetroGradientBarGraph(
    currentGrade: Double,
    modifier: Modifier = Modifier
) {
    // 1. Dampen the reading using Compose's Animatable to prevent visual bounce
    val animatedGrade = remember { androidx.compose.animation.core.Animatable(currentGrade.toFloat()) }
    
    androidx.compose.runtime.LaunchedEffect(currentGrade) {
        animatedGrade.animateTo(
            targetValue = currentGrade.toFloat(),
            animationSpec = androidx.compose.animation.core.spring(
                dampingRatio = androidx.compose.animation.core.Spring.DampingRatioNoBouncy,
                stiffness = androidx.compose.animation.core.Spring.StiffnessLow
            )
        )
    }

    val smoothedGrade = animatedGrade.value.toDouble()
    val tier = classifyGradient(smoothedGrade)

    // Formatted percentage string shown in a fixed-width container on the left
    val formattedPercentage = remember(smoothedGrade) {
        String.format(Locale.US, "%+.1f%%", smoothedGrade)
    }

    // Text Measurer for scale labels embedded inside the bar
    val textMeasurer = rememberTextMeasurer()

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Color(0xFF0B1120), RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Percentage Value at a fixed space on the left
        Text(
            text = formattedPercentage,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = tier.color,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.width(52.dp)
        )

        Spacer(modifier = Modifier.width(6.dp))

        // Single Line LED Visualizer + Embedded Scales
        Canvas(
            modifier = Modifier
                .weight(1f)
                .height(14.dp)
        ) {
            val canvasWidth = size.width
            val canvasHeight = size.height

            // We design a center-zero segmented bar graph spanning from -16% (left) to +24% (right).
            val minGradeSpan = -16.0
            val maxGradeSpan = 24.0
            val totalBlocks = 40
            val gapPx = 1.5f.dp.toPx()

            // Calculate exact width of each discrete LED block
            val availableWidth = canvasWidth - (gapPx * (totalBlocks - 1))
            val blockWidthPx = availableWidth / totalBlocks

            // Identify the exact index corresponding to Zero (0%) gradient
            val zeroBlockIndex = abs(minGradeSpan).toInt()

            for (i in 0 until totalBlocks) {
                val blockGrade = minGradeSpan + i
                val x = i * (blockWidthPx + gapPx)

                // Determine the classification color of this specific block
                val blockColor = classifyGradient(blockGrade).color

                // Determine if this LED block is currently active (illuminated) based on smoothedGrade.
                val isIlluminated = when {
                    smoothedGrade > 0.5 -> i in zeroBlockIndex..ceil(smoothedGrade - minGradeSpan).toInt().coerceAtMost(totalBlocks - 1)
                    smoothedGrade < -0.5 -> i in ceil(smoothedGrade - minGradeSpan).toInt().coerceAtLeast(0)..zeroBlockIndex
                    else -> i == zeroBlockIndex
                }

                // Draw the discrete LED block
                drawRect(
                    color = if (isIlluminated) blockColor else blockColor.copy(alpha = 0.15f),
                    topLeft = Offset(x, 0f),
                    size = Size(blockWidthPx, canvasHeight)
                )
            }

            // Draw crisp Zero (0%) indicator mark over the zero block
            val zeroX = zeroBlockIndex * (blockWidthPx + gapPx) + (blockWidthPx / 2f)
            drawLine(
                color = Color.White.copy(alpha = 0.6f),
                start = Offset(zeroX, 0f),
                end = Offset(zeroX, canvasHeight),
                strokeWidth = 1.5.dp.toPx()
            )

            // Measure and draw scale labels directly on top of the visualizer bar
            val labelStyle = TextStyle(
                color = Color.White,
                fontSize = 8.5.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )

            // 1. Draw "-16%" label (Left-aligned, inset slightly)
            val leftLabelResult = textMeasurer.measure("-16%", style = labelStyle)
            drawText(
                textLayoutResult = leftLabelResult,
                topLeft = Offset(
                    x = 4.dp.toPx(),
                    y = (canvasHeight - leftLabelResult.size.height) / 2f
                ),
                blendMode = BlendMode.Difference
            )

            // 2. Draw "0%" label (Centered on the zero baseline)
            val centerLabelResult = textMeasurer.measure("0%", style = labelStyle)
            drawText(
                textLayoutResult = centerLabelResult,
                topLeft = Offset(
                    x = zeroX - (centerLabelResult.size.width / 2f),
                    y = (canvasHeight - centerLabelResult.size.height) / 2f
                ),
                blendMode = BlendMode.Difference
            )

            // 3. Draw "+24%" label (Right-aligned, inset slightly)
            val rightLabelResult = textMeasurer.measure("+24%", style = labelStyle)
            drawText(
                textLayoutResult = rightLabelResult,
                topLeft = Offset(
                    x = canvasWidth - rightLabelResult.size.width - 4.dp.toPx(),
                    y = (canvasHeight - rightLabelResult.size.height) / 2f
                ),
                blendMode = BlendMode.Difference
            )
        }
    }
}

/**
 * A color-coded bar graph representing the gradient across the entire course.
 *
 * Why a route-wide gradient bar graph?
 * While [RetroGradientBarGraph] shows instantaneous steepness at the runner's location,
 * displaying the entire course as a sequence of vertical segment bars along the distance timeline
 * gives runners an immediate overview of upcoming climbs and descents. The zero baseline clearly
 * separates negative downhill slopes from positive mountain ascents.
 *
 * @param courseData The active course containing elevation and distance points.
 * @param scrubberProgress The current simulation progress (0.0 to 1.0).
 * @param modifier Optional Compose styling modifier.
 */
@Composable
fun CourseGradientBarChart(
    courseData: CourseData,
    scrubberProgress: Double,
    modifier: Modifier = Modifier
) {
    val points = courseData.points
    if (points.isEmpty() || courseData.totalDistance <= 0.0) return

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color(0xFF0B1120), RoundedCornerShape(12.dp))
            .padding(12.dp)
    ) {
        Text(
            text = "COURSE GRADIENT PROFILE (BAR GRAPH)",
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF94A3B8),
            fontFamily = FontFamily.Monospace
        )

        Spacer(modifier = Modifier.height(8.dp))

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
        ) {
            val canvasWidth = size.width
            val canvasHeight = size.height

            // We establish a Zero baseline in the center of the canvas height.
            // Positive gradient bars extend upward from zero; negative gradient bars extend downward.
            val zeroBaselineY = canvasHeight * 0.5f

            // Maximum absolute gradient displayed for vertical canvas scaling (e.g. 20%)
            val maxGradeScale = 20.0f
            val halfHeight = canvasHeight * 0.5f

            // We divide the canvas into 80 discrete vertical bars (like retro stereo equalizer bands across the course)
            val numBars = 80
            val gapPx = 1.dp.toPx()
            val barWidthPx = (canvasWidth - (gapPx * (numBars - 1))) / numBars

            for (i in 0 until numBars) {
                // Determine the distance slice along the course represented by this vertical bar
                val barStartProgress = i.toDouble() / numBars
                val targetDistance = barStartProgress * courseData.totalDistance

                // Locate closest trackpoint
                val pt = points.minByOrNull { abs(it.distance - targetDistance) }
                val grade = pt?.grade ?: 0.0
                val tier = classifyGradient(grade)

                val x = i * (barWidthPx + gapPx)

                // Normalize gradient height relative to half canvas height
                val normGrade = (abs(grade).toFloat() / maxGradeScale).coerceIn(0.05f, 1.0f)
                val barHeightPx = normGrade * halfHeight

                val (topLeftY, drawHeight) = if (grade >= 0) {
                    // Positive climb: draw upward from baseline
                    Pair(zeroBaselineY - barHeightPx, barHeightPx)
                } else {
                    // Negative descent: draw downward from baseline
                    Pair(zeroBaselineY, barHeightPx)
                }

                // Draw the vertical gradient bar
                drawRect(
                    color = tier.color,
                    topLeft = Offset(x, topLeftY),
                    size = Size(barWidthPx, drawHeight)
                )
            }

            // Draw crisp horizontal Zero (0%) baseline across all bars
            drawLine(
                color = Color.White.copy(alpha = 0.5f),
                start = Offset(0f, zeroBaselineY),
                end = Offset(canvasWidth, zeroBaselineY),
                strokeWidth = 1.dp.toPx()
            )

            // Draw glowing vertical line indicating current Scrubber / Runner position
            val scrubberX = (scrubberProgress * canvasWidth).toFloat().coerceIn(0f, canvasWidth)
            drawLine(
                color = Color.White,
                start = Offset(scrubberX, 0f),
                end = Offset(scrubberX, canvasHeight),
                strokeWidth = 2.dp.toPx()
            )
            drawCircle(
                color = Color.Red,
                radius = 4.dp.toPx(),
                center = Offset(scrubberX, zeroBaselineY),
                style = Stroke(width = 1.5.dp.toPx())
            )
        }
    }
}
