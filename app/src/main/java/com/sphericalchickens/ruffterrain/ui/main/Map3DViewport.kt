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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay


@Composable
fun Map3DViewport(
    courseData: CourseData,
    scrubberProgress: Double,
    modifier: Modifier = Modifier
) {
    val points = courseData.points
    if (points.isEmpty()) return

    var googleMap by remember { mutableStateOf<GoogleMap3D?>(null) }

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

    // Unified lifecycle flow matching the native maps runtime
    androidx.compose.runtime.LaunchedEffect(googleMap, points, courseData.waypoints) {
        val map = googleMap ?: return@LaunchedEffect
        
        // Wait a short duration for the native 3D renderer context to fully initialize
        delay(300)
        if (!isActive) return@LaunchedEffect

        // Configure and add Polyline course path
        val polyOpts = PolylineOptions().apply {
            path = points.map { pt ->
                LatLngAltitude(pt.latitude, pt.longitude, pt.elevation)
            }
            strokeColor = Color.RED
            strokeWidth = 10.0
        }
        val polyline = map.addPolyline(polyOpts)

        // Configure and place waypoints
        val markers = courseData.waypoints.mapNotNull { wpt ->
            val mOpts = MarkerOptions().apply {
                position = LatLngAltitude(wpt.latitude, wpt.longitude, wpt.elevation)
                label = wpt.name
            }
            map.addMarker(mOpts)
        }

        // Initialize runner position marker
        var runnerMarker: Marker? = null

        try {
            // Wait slightly longer to let the camera subsystem stabilize before querying/centering
            delay(500)

            // Collect progress updates reactively while coroutine context is active
            val coroutineScope = this
            androidx.compose.runtime.snapshotFlow { scrubberProgress }
                .collect { progress ->
                    val scrubberIndex = (progress * (points.size - 1)).toInt().coerceIn(0, points.size - 1)
                    val scrubberPoint = points.getOrNull(scrubberIndex)
                    if (scrubberPoint != null && coroutineScope.isActive) {
                        // Refresh runner position marker safely on Main thread dispatcher
                        runnerMarker?.remove()
                        val rOpts = MarkerOptions().apply {
                            position = LatLngAltitude(scrubberPoint.latitude, scrubberPoint.longitude, scrubberPoint.elevation + 8.0)
                            label = "Runner Position"
                        }
                        runnerMarker = map.addMarker(rOpts)

                        // Center the 3D map camera on the runner position
                        val currentCam = map.getCamera()
                        if (currentCam != null && coroutineScope.isActive) {
                            map.setCamera(
                                camera {
                                    center = latLngAltitude {
                                        latitude = scrubberPoint.latitude
                                        longitude = scrubberPoint.longitude
                                        altitude = scrubberPoint.elevation
                                    }
                                    heading = currentCam.heading
                                    tilt = currentCam.tilt
                                    range = currentCam.range
                                    roll = 0.0
                                }
                            )
                        }
                    }
                }
        } catch (e: Exception) {
            // Context cancelled or disposed
        } finally {
            // DO NOT call remove() on native components here because the map is being destroyed,
            // and the native Map3DView.onDestroy() handles all marker and polyline cleanups.
            // Calling JNI remove() during teardown causes dual-free crashes.
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val map3DView = Map3DView(ctx, map3DOptions)
                map3DView.tag = java.lang.Boolean.FALSE // Mark as active
                map3DView.onCreate(null)
                map3DView.onResume()
                map3DView.getMap3DViewAsync(object : OnMap3DViewReadyCallback {
                    override fun onMap3DViewReady(map3D: GoogleMap3D) {
                        // Only set the map reference if the view hasn't been released
                        if (map3DView.tag == java.lang.Boolean.FALSE) {
                            googleMap = map3D
                        }
                    }

                    override fun onError(e: Exception) {
                        googleMap = null
                    }
                })
                map3DView
            },
            update = {
                // Reactive updates are handled in LaunchedEffect flow
            },
            onRelease = { view ->
                // Flag the view as disposed immediately so any in-flight async callbacks are ignored
                view.tag = java.lang.Boolean.TRUE
                googleMap = null
                view.onPause()
                view.onDestroy()
            }
        )
    }
}
