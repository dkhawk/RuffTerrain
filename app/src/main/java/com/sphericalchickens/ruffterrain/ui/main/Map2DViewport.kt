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
import androidx.compose.ui.Modifier
import com.google.android.gms.maps.MapsInitializer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.sphericalchickens.ruffterrain.R
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberMarkerState
import java.util.Locale

@Composable
fun Map2DViewport(
    courseData: CourseData,
    scrubberProgress: Double,
    modifier: Modifier = Modifier
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

    // Calculate current runner progress location
    val scrubberIndex = (scrubberProgress * (points.size - 1)).toInt().coerceIn(0, points.size - 1)
    val scrubberPoint = points.getOrNull(scrubberIndex)
    val scrubberLatLng = scrubberPoint?.let { LatLng(it.latitude, it.longitude) }

    val context = LocalContext.current
    var runnerIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var aidStationIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var waypointIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }

    LaunchedEffect(context) {
        MapsInitializer.initialize(context, MapsInitializer.Renderer.LATEST) {
            runnerIcon = bitmapDescriptorFromVector(context, R.drawable.ic_runner)
            aidStationIcon = bitmapDescriptorFromVector(context, R.drawable.ic_aid_station)
            waypointIcon = bitmapDescriptorFromVector(context, R.drawable.ic_waypoint)
        }
    }

    val runnerMarkerState = rememberMarkerState()

    // Auto-update camera to center on the runner's marker as progress updates
    LaunchedEffect(scrubberLatLng) {
        scrubberLatLng?.let { latLng ->
            runnerMarkerState.position = latLng
            cameraPositionState.animate(
                com.google.android.gms.maps.CameraUpdateFactory.newLatLng(latLng)
            )
        }
    }

    GoogleMap(
        modifier = modifier.fillMaxSize(),
        cameraPositionState = cameraPositionState,
        uiSettings = MapUiSettings(zoomControlsEnabled = false)
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
            
            Marker(
                state = rememberMarkerState(position = LatLng(wpt.latitude, wpt.longitude)),
                title = wpt.name,
                snippet = wpt.description.ifEmpty { "Elevation: ${wpt.elevation.toInt()}m" },
                icon = if (isAidStation) aidStationIcon else waypointIcon
            )
        }

        // Draw runner progress marker dot
        if (scrubberLatLng != null && scrubberPoint != null) {
            val distMiles = scrubberPoint.distance / 1609.34
            Marker(
                state = runnerMarkerState,
                title = "Runner Position",
                snippet = String.format(Locale.US, "Distance: %.2f mi | Elevation: %d m", distMiles, scrubberPoint.elevation.toInt()),
                icon = runnerIcon
            )
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
