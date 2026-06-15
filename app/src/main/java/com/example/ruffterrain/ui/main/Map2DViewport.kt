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

package com.example.ruffterrain.ui.main

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.example.ruffterrain.data.model.CourseData
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
            Marker(
                state = rememberMarkerState(position = LatLng(wpt.latitude, wpt.longitude)),
                title = wpt.name,
                snippet = wpt.description.ifEmpty { "Elevation: ${wpt.elevation.toInt()}m" }
            )
        }

        // Draw runner progress marker dot
        if (scrubberLatLng != null && scrubberPoint != null) {
            val distMiles = scrubberPoint.distance / 1609.34
            Marker(
                state = rememberMarkerState(position = scrubberLatLng),
                title = "Runner Position",
                snippet = String.format(Locale.US, "Distance: %.2f mi | Elevation: %d m", distMiles, scrubberPoint.elevation.toInt())
            )
        }
    }
}
