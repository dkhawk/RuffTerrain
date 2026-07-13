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

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import com.example.ruffterrain.data.DefaultDataRepository
import com.example.ruffterrain.data.model.AppMode
import com.example.ruffterrain.data.model.CourseData
import com.example.ruffterrain.data.model.MapMode

@Composable
fun MainScreen(
  onItemClick: (NavKey) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: MainScreenViewModel = viewModel { MainScreenViewModel(DefaultDataRepository()) },
) {
  val state by viewModel.uiState.collectAsStateWithLifecycle()
  val context = LocalContext.current
  var showSettingsMenu by remember { mutableStateOf(false) }

  // System picker result launcher (reads bytes synchronously in callback)
  val filePickerLauncher = rememberLauncherForActivityResult(
      contract = ActivityResultContracts.GetContent()
  ) { uri ->
      uri?.let {
          try {
              context.contentResolver.openInputStream(uri)?.use { stream ->
                  val bytes = stream.readBytes()
                  viewModel.loadCourseBytes(bytes)
              }
          } catch (e: Exception) {
              // Ignore or handle stream read exceptions
          }
      }
  }

  // Auto-load standard Leadville asset course on startup
  LaunchedEffect(state.courseData, state.isLoading, state.errorMessage) {
    if (state.courseData == null && !state.isLoading && state.errorMessage == null) {
      try {
        context.assets.open("leadville_sample.gpx").use { assetStream ->
          val bytes = assetStream.readBytes()
          viewModel.loadCourseBytes(bytes)
        }
      } catch (e: Exception) {
        // Fallback for missing assets
      }
    }
  }

  Box(modifier = modifier.fillMaxSize()) {
    if (state.isLoading) {
      Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
      }
    } else if (state.errorMessage != null) {
      Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text("Error loading data: ${state.errorMessage}", color = MaterialTheme.colorScheme.error)
          Spacer(modifier = Modifier.height(16.dp))
          Button(onClick = { filePickerLauncher.launch("*/*") }) {
            Text("Try Importing Again")
          }
        }
      }
    } else {
      val course = state.courseData

      // Force 2D map in RUNNING mode to conserve battery and support offline
      val activeMapMode = if (state.appMode == AppMode.RUNNING) MapMode.MAP_2D else state.mapMode

      if (course != null) {
        // Map viewport container
        MapViewport(
            courseData = course,
            mapMode = activeMapMode,
            scrubberProgress = state.scrubberProgress,
            modifier = Modifier.fillMaxSize()
        )
      } else {
        // Empty state placeholder map view
        Box(
            modifier = Modifier.fillMaxSize().background(Color(0xFF1E293B)),
            contentAlignment = Alignment.Center
        ) {
          Text("No course loaded. Import a file to get started.", color = Color.White)
        }
      }

      // Overlay UI layer
      Box(modifier = Modifier.fillMaxSize()) {
        
        // 1. FLOATING MODE SELECTION BAR (Top Pill Bar)
        Card(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(16.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xDD0F172A)) // Sleek dark slate glass
        ) {
          Row(
              modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.SpaceBetween
          ) {
            // Mode Select buttons
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
              ModeTabButton(
                  title = "📂 Plan",
                  isSelected = state.appMode == AppMode.IMPORT_EDIT,
                  onClick = { viewModel.updateAppMode(AppMode.IMPORT_EDIT) }
              )
              ModeTabButton(
                  title = "🎮 Preview",
                  isSelected = state.appMode == AppMode.SIMULATION,
                  onClick = { viewModel.updateAppMode(AppMode.SIMULATION) }
              )
              ModeTabButton(
                  title = "🏃 Run",
                  isSelected = state.appMode == AppMode.RUNNING,
                  onClick = { viewModel.updateAppMode(AppMode.RUNNING) }
              )
            }

            // Options drop-down trigger button
            Box {
              Box(
                  modifier = Modifier
                      .clickable { showSettingsMenu = true }
                      .padding(8.dp)
              ) {
                Text("⚙️", fontSize = 18.sp)
              }

              DropdownMenu(
                  expanded = showSettingsMenu,
                  onDismissRequest = { showSettingsMenu = false }
              ) {
                DropdownMenuItem(
                    text = { Text("Import GPX Course") },
                    onClick = {
                      showSettingsMenu = false
                      filePickerLauncher.launch("*/*")
                    }
                )
                if (state.appMode != AppMode.RUNNING) {
                  DropdownMenuItem(
                      text = { Text(if (state.mapMode == MapMode.MAP_3D) "Switch to 2D Map" else "Switch to 3D Map") },
                      onClick = {
                        showSettingsMenu = false
                        viewModel.toggleMapMode()
                      }
                  )
                }
                DropdownMenuItem(
                    text = { Text("Reload Leadville Sample") },
                    onClick = {
                      showSettingsMenu = false
                      try {
                        context.assets.open("leadville_sample.gpx").use { assetStream ->
                          viewModel.loadCourseBytes(assetStream.readBytes())
                        }
                      } catch (e: Exception) {
                        // ignore
                      }
                    }
                )
              }
            }
          }
        }

        // 2. CONTEXTUAL PANEL (Bottom Overlays)
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 24.dp)
                .fillMaxWidth()
        ) {
          when (state.appMode) {
            AppMode.IMPORT_EDIT -> {
              Card(
                  shape = RoundedCornerShape(16.dp),
                  colors = CardDefaults.cardColors(containerColor = Color(0xEE1E293B)),
                  modifier = Modifier.fillMaxWidth()
              ) {
                Column(modifier = Modifier.padding(16.dp)) {
                  if (course != null) {
                    Text(text = course.name, style = MaterialTheme.typography.titleLarge, color = Color.White)
                    Text(
                        text = String.format("Distance: %.1f km  |  Ascent: %d m  |  Descent: %d m", 
                            course.totalDistance / 1000.0, 
                            course.elevationGain.toInt(),
                            course.elevationLoss.toInt()
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.LightGray
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(text = "Waypoints & Landmarks:", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(modifier = Modifier.height(6.dp))
                    
                    // Simple vertical scroll list of aid stations/landmarks
                    Column(
                        modifier = Modifier
                            .height(100.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                      course.waypoints.forEach { wpt ->
                        Text(
                            text = "• ${wpt.name} (km ${(wpt.distanceMeters/1000.0).format(1)})",
                            color = Color.LightGray,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(vertical = 2.dp)
                        )
                      }
                    }
                  } else {
                    Text(
                        text = "Plan & Import Mode",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Import a GPX file containing route paths, elevation profiles, and checkpoint markers to begin.",
                        color = Color.LightGray,
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = { filePickerLauncher.launch("*/*") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                      Text("📂 Choose GPX File")
                    }
                  }
                }
              }
            }

            AppMode.SIMULATION -> {
              if (course != null) {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xEE1E293B)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                  Column(modifier = Modifier.padding(16.dp)) {
                    
                    // Elevation Profile chart drawn in-place
                    ElevationProfileChart(
                        courseData = course,
                        scrubberProgress = state.scrubberProgress,
                        onScrub = { progress -> viewModel.updateScrubberProgress(progress) },
                        modifier = Modifier.height(80.dp)
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    val scrubberIndex = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                    val scrubberPoint = course.points.getOrNull(scrubberIndex)
                    val currentGrade = scrubberPoint?.grade ?: 0.0

                    // 1. Retro Stereo Equalizer / Volume-style Gradient Bar Graph VU Meter
                    RetroGradientBarGraph(currentGrade = currentGrade)

                    Spacer(modifier = Modifier.height(8.dp))

                    // 2. Course-wide Color-Coded Gradient Profile Bar Graph
                    CourseGradientBarChart(courseData = course, scrubberProgress = state.scrubberProgress)

                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                      Text(
                          text = String.format("Simulation Progress: %.1f%%", state.scrubberProgress * 100.0),
                          style = MaterialTheme.typography.bodyMedium,
                          color = Color.White
                      )
                      // Speed multiplier cycler
                      Button(
                          onClick = {
                            val nextSpeed = when (state.playbackSpeed) {
                              1.0f -> 2.0f
                              2.0f -> 5.0f
                              5.0f -> 10.0f
                              else -> 1.0f
                            }
                            viewModel.updatePlaybackSpeed(nextSpeed)
                          },
                          shape = RoundedCornerShape(8.dp)
                      ) {
                        Text("${state.playbackSpeed.toInt()}x")
                      }
                    }

                    Slider(
                        value = state.scrubberProgress.toFloat(),
                        onValueChange = { viewModel.updateScrubberProgress(it.toDouble()) },
                        valueRange = 0f..1f,
                        modifier = Modifier.fillMaxWidth()
                    )

                    // Playback Buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                      Button(
                          onClick = { viewModel.rewind() },
                          shape = RoundedCornerShape(8.dp),
                          modifier = Modifier.padding(horizontal = 8.dp)
                      ) {
                        Text("⏮")
                      }
                      Button(
                          onClick = { viewModel.togglePlayback() },
                          shape = RoundedCornerShape(8.dp),
                          modifier = Modifier.padding(horizontal = 8.dp)
                      ) {
                        Text(if (state.isProgressing) "⏸" else "▶")
                      }
                    }
                  }
                }
              }
            }

            AppMode.RUNNING -> {
              if (course != null) {
                // High contrast, highly legible dashboard for active runners
                Card(
                    shape = RoundedCornerShape(24.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)), // Fully dark
                    modifier = Modifier.fillMaxWidth()
                ) {
                  Column(modifier = Modifier.padding(20.dp)) {
                    
                    // Large active checkpoint telemetry
                    val activeIndex = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                    val activePt = course.points.getOrNull(activeIndex)
                    val nextWpt = course.waypoints.find { it.distanceMeters > (activePt?.distance ?: 0.0) }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                      Text(
                          text = "🏃 ON COURSE",
                          color = Color(0xFF10B981),
                          fontWeight = FontWeight.Bold,
                          fontSize = 14.sp
                      )
                      Text(
                          text = nextWpt?.let { "Next: ${it.name} at ${(it.distanceMeters/1000.0).format(1)} km" } ?: "🏁 FINISH",
                          color = Color.LightGray,
                          fontSize = 12.sp
                      )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Instantaneous Gradient Retro Equalizer VU Meter
                    RetroGradientBarGraph(currentGrade = activePt?.grade ?: 0.0)

                    Spacer(modifier = Modifier.height(16.dp))

                    // Giant telemetry stats grid
                    Row(modifier = Modifier.fillMaxWidth()) {
                      Column(modifier = Modifier.weight(1f)) {
                        Text("DISTANCE", fontSize = 11.sp, color = Color.Gray)
                        Text(
                            text = String.format("%.2f km", (activePt?.distance ?: 0.0) / 1000.0),
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            fontFamily = FontFamily.Monospace
                        )
                      }
                      Column(modifier = Modifier.weight(1f)) {
                        Text("TOTAL ASCENT", fontSize = 11.sp, color = Color.Gray)
                        Text(
                            text = String.format("%d m", course.elevationGain.toInt()),
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            fontFamily = FontFamily.Monospace
                        )
                      }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Row(modifier = Modifier.fillMaxWidth()) {
                      Column(modifier = Modifier.weight(1f)) {
                        Text("PACE", fontSize = 11.sp, color = Color.Gray)
                        Text(
                            text = "5:12 /km",
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            fontFamily = FontFamily.Monospace
                        )
                      }
                      Column(modifier = Modifier.weight(1f)) {
                        Text("DURATION", fontSize = 11.sp, color = Color.Gray)
                        Text(
                            text = "02:44:12",
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            fontFamily = FontFamily.Monospace
                        )
                      }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Lock Screen button to prevent false trigger taps
                    Button(
                        onClick = { /* Unlock pattern */ },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF374151)),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                      Text("🔒 Screen Locked (Hold to Unlock)", color = Color.White)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

@Composable
fun ModeTabButton(
    title: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
  Button(
      onClick = onClick,
      colors = ButtonDefaults.buttonColors(
          containerColor = if (isSelected) Color(0xFFE91E63) else Color.Transparent,
          contentColor = if (isSelected) Color.White else Color.LightGray
      ),
      shape = RoundedCornerShape(16.dp),
      contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
      modifier = Modifier.padding(horizontal = 2.dp)
  ) {
    Text(text = title, fontSize = 13.sp, fontWeight = FontWeight.Bold)
  }
}

private fun Double.format(digits: Int): String {
    return String.format("%.${digits}f", this)
}

@Composable
fun MapViewport(
    courseData: CourseData,
    mapMode: MapMode,
    scrubberProgress: Double,
    modifier: Modifier = Modifier
) {
    if (mapMode == MapMode.MAP_3D) {
        Map3DViewport(courseData = courseData, scrubberProgress = scrubberProgress, modifier = modifier)
    } else {
        Map2DViewport(courseData = courseData, scrubberProgress = scrubberProgress, modifier = modifier)
    }
}
