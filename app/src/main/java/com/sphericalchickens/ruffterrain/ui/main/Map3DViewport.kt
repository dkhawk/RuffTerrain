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

import android.graphics.Color
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.google.android.gms.maps3d.GoogleMap3D
import com.google.android.gms.maps3d.Map3DOptions
import com.google.android.gms.maps3d.Map3DView
import com.google.android.gms.maps3d.OnMap3DViewReadyCallback
import com.google.android.gms.maps3d.model.LatLngAltitude
import com.google.android.gms.maps3d.model.Marker
import com.google.android.gms.maps3d.model.MarkerOptions
import com.google.android.gms.maps3d.model.Polyline
import com.google.android.gms.maps3d.model.PolylineOptions
import com.google.android.gms.maps3d.model.camera
import com.google.android.gms.maps3d.model.latLngAltitude


@Composable
fun Map3DViewport(
    courseData: CourseData,
    scrubberProgress: Double,
    modifier: Modifier = Modifier
) {
    val points = courseData.points
    if (points.isEmpty()) return

    var googleMap by remember { mutableStateOf<GoogleMap3D?>(null) }
    var activePolyline by remember { mutableStateOf<Polyline?>(null) }
    val activeMarkers = remember { mutableListOf<Marker>() }
    var runnerMarker by remember { mutableStateOf<Marker?>(null) }

    // Locate center coordinates to focus camera
    val centerPt = remember(points) {
        points.getOrNull(points.size / 2)
    }

    val map3DOptions = remember(centerPt) {
        val lat = centerPt?.latitude ?: 0.0
        val lng = centerPt?.longitude ?: 0.0
        val alt = (centerPt?.elevation ?: 0.0) + 3000.0 // Look from 3km altitude

        // Call positional constructor matching (defaultUiDisabled, centerLat, centerLng, centerAlt, heading, tilt, roll, range)
        Map3DOptions(
            false, // defaultUiDisabled
            lat,   // centerLat
            lng,   // centerLng
            alt,   // centerAlt
            0.0,   // heading
            45.0,  // tilt angle (45 degrees)
            0.0,   // roll
            8000.0 // range distance zoom
        )
    }

    // Draw static path polyline and waypoint markers once map becomes ready
    androidx.compose.runtime.LaunchedEffect(googleMap, points, courseData.waypoints) {
        val map = googleMap ?: return@LaunchedEffect
        
        // Reset drawn map components
        activePolyline?.remove()
        activePolyline = null
        activeMarkers.forEach { it.remove() }
        activeMarkers.clear()

        // Configure and add Polyline course path
        val polyOpts = PolylineOptions().apply {
            path = points.map { pt ->
                LatLngAltitude(pt.latitude, pt.longitude, pt.elevation)
            }
            strokeColor = Color.RED
            strokeWidth = 10.0
        }
        activePolyline = map.addPolyline(polyOpts)

        // Configure and place waypoints
        courseData.waypoints.forEach { wpt ->
            val mOpts = MarkerOptions().apply {
                position = LatLngAltitude(wpt.latitude, wpt.longitude, wpt.elevation)
                label = wpt.name
            }
            val marker = map.addMarker(mOpts)
            if (marker != null) {
                activeMarkers.add(marker)
            }
        }
    }

    // Update runner marker and camera position sequentially when progress ticks
    androidx.compose.runtime.LaunchedEffect(googleMap, scrubberProgress, points) {
        val map = googleMap ?: return@LaunchedEffect
        val scrubberIndex = (scrubberProgress * (points.size - 1)).toInt().coerceIn(0, points.size - 1)
        val scrubberPoint = points.getOrNull(scrubberIndex) ?: return@LaunchedEffect

        // Refresh runner position marker
        runnerMarker?.remove()
        val rOpts = MarkerOptions().apply {
            position = LatLngAltitude(scrubberPoint.latitude, scrubberPoint.longitude, scrubberPoint.elevation + 8.0)
            label = "Runner Position"
        }
        runnerMarker = map.addMarker(rOpts)

        // Center the 3D map camera on the runner position
        val currentCam = map.getCamera()
        if (currentCam != null) {
            val headingVal = currentCam.heading
            val tiltVal = currentCam.tilt
            val rangeVal = currentCam.range

            map.setCamera(
                camera {
                    center = latLngAltitude {
                        latitude = scrubberPoint.latitude
                        longitude = scrubberPoint.longitude
                        altitude = scrubberPoint.elevation
                    }
                    heading = headingVal
                    tilt = tiltVal
                    range = rangeVal
                    roll = 0.0
                }
            )
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                Map3DView(ctx, map3DOptions).apply {
                    onCreate(null)
                    onResume()
                    getMap3DViewAsync(object : OnMap3DViewReadyCallback {
                        override fun onMap3DViewReady(map3D: GoogleMap3D) {
                            googleMap = map3D
                        }

                        override fun onError(e: Exception) {
                            googleMap = null
                        }
                    })
                }
            },
            update = {
                // Telemetry updates are handled reactively in LaunchedEffects above
            },
            onRelease = { view ->
                googleMap = null
                activePolyline?.remove()
                activePolyline = null
                activeMarkers.forEach { it.remove() }
                activeMarkers.clear()
                runnerMarker?.remove()
                runnerMarker = null
                view.onPause()
                view.onDestroy()
            }
        )
    }
}
