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

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.content.ContextCompat
import android.util.Log
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import com.google.android.gms.maps.MapsInitializer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.sphericalchickens.ruffterrain.R
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.Waypoint
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapType
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerInfoWindowContent
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberMarkerState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

@Composable
fun Map2DViewport(
    courseData: CourseData,
    scrubberProgress: Double,
    modifier: Modifier = Modifier,
    unitsPref: String = "default",
    mapTypePref: String = "NORMAL",
    onWaypointClick: (Waypoint) -> Unit = {},
    onMapLongClick: (LatLng) -> Unit = {}
) {
    val points = courseData.points
    if (points.isEmpty()) return

    // Convert route points to LatLng
    val latLngList = remember(points) {
        points.map { LatLng(it.latitude, it.longitude) }
    }

    // Determine course boundaries
    val bounds = remember(latLngList) {
        val builder = LatLngBounds.Builder()
        latLngList.forEach { builder.include(it) }
        builder.build()
    }

    // Set up camera position state centered on course bounds
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(bounds.center, 12f)
    }

    // Auto-update camera when course bounds change
    LaunchedEffect(bounds) {
        cameraPositionState.position = CameraPosition.fromLatLngZoom(bounds.center, 12f)
    }

    // Calculate current runner progress location using linear interpolation (LERP) based on distance
    val scrubberPoint = remember(scrubberProgress, points) {
        if (points.isEmpty()) {
            null
        } else if (points.size == 1) {
            points[0]
        } else {
            val totalDistance = points.last().distance
            val targetDist = (scrubberProgress * totalDistance).coerceIn(0.0, totalDistance)
            
            var low = 0
            var high = points.size - 2
            var segmentIdx = 0
            while (low <= high) {
                val mid = (low + high) / 2
                val distMid = points[mid].distance
                val distNext = points[mid + 1].distance
                if (targetDist >= distMid && targetDist <= distNext) {
                    segmentIdx = mid
                    break
                } else if (targetDist < distMid) {
                    high = mid - 1
                } else {
                    low = mid + 1
                }
            }
            
            val pA = points[segmentIdx]
            val pB = points[segmentIdx + 1]
            val segDist = pB.distance - pA.distance
            if (segDist > 0.0) {
                val fraction = (targetDist - pA.distance) / segDist
                val lat = pA.latitude + fraction * (pB.latitude - pA.latitude)
                val lon = pA.longitude + fraction * (pB.longitude - pA.longitude)
                val elev = pA.elevation + fraction * (pB.elevation - pA.elevation)
                com.sphericalchickens.ruffterrain.data.model.RoutePoint(
                    latitude = lat,
                    longitude = lon,
                    elevation = elev,
                    distance = targetDist,
                    climb = pA.climb
                )
            } else {
                pA
            }
        }
    }
    val scrubberLatLng = scrubberPoint?.let { LatLng(it.latitude, it.longitude) }

    val context = LocalContext.current
    var runnerIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var aidStationIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var waypointIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var finishIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }

    LaunchedEffect(context) {
        MapsInitializer.initialize(context, MapsInitializer.Renderer.LATEST) {
            runnerIcon = bitmapDescriptorFromVector(context, R.drawable.ic_runner)
            aidStationIcon = bitmapDescriptorFromVector(context, R.drawable.ic_aid_station)
            waypointIcon = bitmapDescriptorFromVector(context, R.drawable.ic_waypoint)
            finishIcon = bitmapDescriptorFromVector(context, R.drawable.ic_finish)
        }
    }

    val runnerMarkerState = rememberMarkerState()

    // Auto-update camera to center on the runner's marker as progress updates
    LaunchedEffect(scrubberLatLng) {
        scrubberLatLng?.let { latLng ->
            runnerMarkerState.position = latLng
            cameraPositionState.move(
                com.google.android.gms.maps.CameraUpdateFactory.newLatLng(latLng)
            )
        }
    }

    val mapType = remember(mapTypePref) {
        when (mapTypePref) {
            "SATELLITE" -> MapType.SATELLITE
            "HYBRID" -> MapType.HYBRID
            else -> MapType.NORMAL
        }
    }
    val mapProperties = remember(mapType) {
        MapProperties(mapType = mapType)
    }

    Box(modifier = modifier.fillMaxSize()) {
        key(courseData.waypoints) {
            GoogleMap(
                modifier = Modifier.fillMaxSize(),
                cameraPositionState = cameraPositionState,
                uiSettings = MapUiSettings(zoomControlsEnabled = false),
                properties = mapProperties,
                onMapLongClick = onMapLongClick
            ) {
            // Draw course route line
            Polyline(
                points = latLngList,
                color = Color.Red,
                width = 8f
            )

            // Draw course waypoints / aid stations
            courseData.waypoints.forEach { wpt ->
                val station = wpt.extensions?.station
                val services = station?.services
                val access = station?.accessibility
                val isFinish = wpt.name.contains("Finish", ignoreCase = true) ||
                        wpt.symbol.contains("finish", ignoreCase = true) ||
                        station?.subtype == "finish" ||
                        station?.type == "finish"
                val isAidStation = wpt.name.contains("Aid", ignoreCase = true) ||
                        wpt.name.contains("Water", ignoreCase = true) ||
                        wpt.name.contains("Medical", ignoreCase = true) ||
                        wpt.name.contains(Regex("(?i)\\bAS\\d*\\b")) ||
                        wpt.symbol.contains("aid", ignoreCase = true) ||
                        station?.subtype == "aid_station" ||
                        station?.subtype == "water_source" ||
                        services?.water == true ||
                        services?.unmanagedWater == true ||
                        services?.food == true ||
                        services?.hotFood == true ||
                        services?.medical == true
                
                val amenities = buildList {
                    if (isFinish) add("🏁")
                    services?.let { svc ->
                        if (svc.water) add("💧")
                        if (svc.unmanagedWater) add("🚰")
                        if (svc.food) add("🍞")
                        if (svc.hotFood) add("🍲")
                        if (svc.toilets) add("🚽")
                        if (svc.medical) add("🏥")
                        if (svc.sleepArea) add("🛏️")
                    }
                    access?.let { acc ->
                        if (acc.dropBagAllowed) add("💼")
                        if (acc.crewAllowed) add("👥")
                        if (acc.pacerAllowed) add("👟")
                        if (acc.vehicleTier != "none") add("🚗")
                    }
                }.joinToString(" ")

                val isStandardSymbol = wpt.symbol.lowercase(Locale.getDefault()) in listOf("aid", "waypoint", "start", "finish", "checkpoint", "flag")
                val customIcon = if (wpt.symbol.isNotEmpty() && !wpt.symbol.startsWith("icons/") && !isStandardSymbol) {
                    bitmapDescriptorFromEmoji(context, wpt.symbol)
                } else {
                    null
                }

                val markerIcon = when {
                    customIcon != null -> customIcon
                    isFinish && finishIcon != null -> finishIcon
                    isAidStation -> aidStationIcon
                    else -> waypointIcon
                }

                MarkerInfoWindowContent(
                    state = rememberMarkerState(position = LatLng(wpt.latitude, wpt.longitude)),
                    icon = markerIcon,
                    onInfoWindowClick = { onWaypointClick(wpt) }
                ) { marker ->
                    Box(
                        modifier = Modifier
                            .background(Color(0xFF0F172A), shape = RoundedCornerShape(8.dp))
                            .padding(12.dp)
                    ) {
                        Column {
                            Text(
                                text = wpt.name,
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            val system = getActiveUnitSystem(unitsPref)
                            Text(
                                text = if (wpt.description.isNotEmpty()) {
                                    wpt.description
                                } else {
                                    "Distance: ${formatDistance(wpt.distanceMeters, system)} | Elevation: ${formatElevation(wpt.elevation, system)}"
                                },
                                color = Color.LightGray,
                                fontSize = 11.sp
                            )
                            if (amenities.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = amenities,
                                    color = Color.White,
                                    fontSize = 16.sp
                                )
                            }
                        }
                    }
                }
            }

            // Draw runner progress marker dot
            if (scrubberLatLng != null && scrubberPoint != null) {
                val system = getActiveUnitSystem(unitsPref)
                val distStr = formatDistance(scrubberPoint.distance, system)
                val elevStr = formatElevation(scrubberPoint.elevation, system)
                Marker(
                    state = runnerMarkerState,
                    title = "Runner Position",
                    snippet = "Distance: $distStr | Elevation: $elevStr",
                    icon = runnerIcon
                )
            }
        }
        }
    }
}

private fun bitmapDescriptorFromVector(context: Context, vectorResId: Int): BitmapDescriptor? {
    try {
        val drawable = ContextCompat.getDrawable(context, vectorResId)
        if (drawable == null) {
            Log.e("Map2DViewport", "Drawable for resId $vectorResId is null")
            return null
        }
        val width = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else 48
        val height = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else 48
        drawable.setBounds(0, 0, width, height)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.draw(canvas)
        val descriptor = BitmapDescriptorFactory.fromBitmap(bitmap)
        if (descriptor == null) {
            Log.e("Map2DViewport", "BitmapDescriptorFactory returned null for resId $vectorResId")
        } else {
            Log.i("Map2DViewport", "Successfully created BitmapDescriptor for resId $vectorResId ($width x $height)")
        }
        return descriptor
    } catch (e: Exception) {
        Log.e("Map2DViewport", "Error converting vector resId $vectorResId to BitmapDescriptor", e)
        return null
    }
}

private fun bitmapDescriptorFromEmoji(context: Context, emoji: String): BitmapDescriptor? {
    try {
        val size = 128
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        
        // Define drop pin vector path pointing down to (64, 120)
        val path = android.graphics.Path().apply {
            moveTo(64f, 120f)
            // Left curve
            cubicTo(24f, 85f, 16f, 55f, 24f, 36f)
            // Top circular curve
            cubicTo(32f, 10f, 96f, 10f, 104f, 36f)
            // Right curve
            cubicTo(112f, 55f, 104f, 85f, 64f, 120f)
            close()
        }

        // Draw pin background shadow and slate fill
        val paintBg = android.graphics.Paint().apply {
            color = android.graphics.Color.parseColor("#0F172A") // Slate 900
            style = android.graphics.Paint.Style.FILL
            isAntiAlias = true
            // Shadow layer to make the pin float above map layers
            setShadowLayer(6f, 0f, 4f, android.graphics.Color.parseColor("#60000000"))
        }
        val paintBorder = android.graphics.Paint().apply {
            color = android.graphics.Color.parseColor("#3B82F6") // Blue 500
            style = android.graphics.Paint.Style.STROKE
            strokeWidth = 4f
            isAntiAlias = true
        }
        
        canvas.drawPath(path, paintBg)
        canvas.drawPath(path, paintBorder)
        
        // Draw centered emoji inside the upper circular bounds (centered at (64, 48))
        val paintText = android.graphics.Paint().apply {
            textSize = 48f
            textAlign = android.graphics.Paint.Align.CENTER
            isAntiAlias = true
        }
        
        val yPos = 48f - ((paintText.descent() + paintText.ascent()) / 2f)
        canvas.drawText(emoji, 64f, yPos, paintText)
        
        return BitmapDescriptorFactory.fromBitmap(bitmap)
    } catch (e: Exception) {
        Log.e("Map2DViewport", "Error converting emoji to BitmapDescriptor", e)
        return null
    }
}
