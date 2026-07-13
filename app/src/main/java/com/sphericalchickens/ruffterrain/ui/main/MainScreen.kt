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
import android.net.Uri
import java.util.Locale
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
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
import com.sphericalchickens.ruffterrain.data.DefaultDataRepository
import com.sphericalchickens.ruffterrain.data.model.AppMode
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.MapMode
import androidx.activity.compose.ManagedActivityResultLauncher
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.window.Dialog

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.core.content.ContextCompat

@Composable
fun MainScreen(
  onItemClick: (NavKey) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: MainScreenViewModel = viewModel { MainScreenViewModel(DefaultDataRepository()) },
) {
  val state by viewModel.uiState.collectAsStateWithLifecycle()
  val context = LocalContext.current
  var showSettingsMenu by remember { mutableStateOf(false) }
  var showSimulationHarness by remember { mutableStateOf(false) }
  var isScreenLocked by remember { mutableStateOf(false) }
  var isControlsVisible by remember { mutableStateOf(true) }
  var lastInteractionTime by remember { mutableStateOf(System.currentTimeMillis()) }

  // Auto-hide controls after a timeout (3 seconds) of no interaction - disabled for test harness legibility
  LaunchedEffect(isControlsVisible, lastInteractionTime) {
      // Keep controls visible
  }

  // System picker result launcher (reads bytes synchronously in callback)
  val filePickerLauncher = rememberLauncherForActivityResult(
      contract = ActivityResultContracts.GetContent()
  ) { uri ->
      uri?.let {
          try {
              context.contentResolver.openInputStream(uri)?.use { stream ->
                  val bytes = stream.readBytes()
                  
                  // Save file to app directory
                  val filename = getFileName(context, uri) ?: "imported_course_${System.currentTimeMillis()}.gpx"
                  val destFile = java.io.File(context.filesDir, filename)
                  destFile.writeBytes(bytes)
                  
                  // Save filename to SharedPreferences
                  val sharedPrefs = context.getSharedPreferences("ruff_terrain_prefs", Context.MODE_PRIVATE)
                  sharedPrefs.edit().putString("last_opened_course", filename).apply()
                  
                  viewModel.loadCourseBytes(bytes)
              }
          } catch (e: Exception) {
              // Ignore or handle stream read exceptions
          }
      }
  }

  // Location permissions launcher
  val permissionLauncher = rememberLauncherForActivityResult(
      contract = ActivityResultContracts.RequestMultiplePermissions()
  ) { permissions ->
      val fineGranted = permissions[android.Manifest.permission.ACCESS_FINE_LOCATION] ?: false
      val coarseGranted = permissions[android.Manifest.permission.ACCESS_COARSE_LOCATION] ?: false
      if (fineGranted || coarseGranted) {
          viewModel.toggleGpsEnabled(true)
      } else {
          viewModel.toggleGpsEnabled(false)
      }
  }

  // Location Manager setup
  val locationManager = remember { context.getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager }
  val locationListener = remember {
      object : android.location.LocationListener {
          override fun onLocationChanged(location: android.location.Location) {
              viewModel.updateUserLocation(location.latitude, location.longitude)
          }
          override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
          override fun onProviderEnabled(provider: String) {}
          override fun onProviderDisabled(provider: String) {}
      }
  }

  // Register location updates when GPS is enabled
  LaunchedEffect(state.isGpsEnabled) {
      if (state.isGpsEnabled) {
          try {
              val hasFine = ContextCompat.checkSelfPermission(
                  context, android.Manifest.permission.ACCESS_FINE_LOCATION
              ) == android.content.pm.PackageManager.PERMISSION_GRANTED
              val hasCoarse = ContextCompat.checkSelfPermission(
                  context, android.Manifest.permission.ACCESS_COARSE_LOCATION
              ) == android.content.pm.PackageManager.PERMISSION_GRANTED
              
              if (hasFine || hasCoarse) {
                  val provider = if (locationManager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
                      android.location.LocationManager.GPS_PROVIDER
                  } else {
                      android.location.LocationManager.NETWORK_PROVIDER
                  }
                  locationManager.requestLocationUpdates(
                      provider,
                      1000L, // 1 sec
                      1f,    // 1 meter
                      locationListener
                  )
                  val lastKnown = locationManager.getLastKnownLocation(provider)
                  if (lastKnown != null) {
                      viewModel.updateUserLocation(lastKnown.latitude, lastKnown.longitude)
                  }
              } else {
                  viewModel.toggleGpsEnabled(false)
              }
          } catch (e: SecurityException) {
              viewModel.toggleGpsEnabled(false)
          }
      } else {
          locationManager.removeUpdates(locationListener)
      }
  }

  // Auto-reset screen lock on appMode changes
  LaunchedEffect(state.appMode) {
      if (state.appMode != AppMode.RUNNING) {
          isScreenLocked = false
      }
  }

  DisposableEffect(Unit) {
      onDispose {
          locationManager.removeUpdates(locationListener)
      }
  }

  // Auto-load standard Leadville asset course or last opened course on startup
  LaunchedEffect(state.courseData, state.isLoading, state.errorMessage) {
    if (state.courseData == null && !state.isLoading && state.errorMessage == null) {
      try {
        val sharedPrefs = context.getSharedPreferences("ruff_terrain_prefs", Context.MODE_PRIVATE)
        val lastOpened = sharedPrefs.getString("last_opened_course", null)
        var loaded = false
        if (lastOpened != null) {
          val file = java.io.File(context.filesDir, lastOpened)
          if (file.exists()) {
            try {
              val bytes = file.readBytes()
              viewModel.loadCourseBytes(bytes)
              loaded = true
            } catch (e: Exception) {
              // ignore
            }
          }
        }
        if (!loaded) {
          context.assets.open("leadville_sample.gpx").use { assetStream ->
            val bytes = assetStream.readBytes()
            viewModel.loadCourseBytes(bytes)
          }
        }
      } catch (e: Exception) {
        // Fallback for missing assets
      }
    }
  }

  Box(
      modifier = modifier
          .fillMaxSize()
          .background(Color(0xFF0B0F19))
          .pointerInput(Unit) {
              awaitPointerEventScope {
                  while (true) {
                      awaitPointerEvent(PointerEventPass.Initial)
                      isControlsVisible = true
                      lastInteractionTime = System.currentTimeMillis()
                  }
              }
          }
  ) {
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
      val showMap = state.appMode != AppMode.RUNNING || state.showRunningMap

      if (course != null && showMap) {
        // Map viewport container
        MapViewport(
            courseData = course,
            mapMode = activeMapMode,
            scrubberProgress = state.scrubberProgress,
            modifier = Modifier.fillMaxSize()
        )
      }

      // Overlay UI layer
      Box(modifier = Modifier.fillMaxSize()) {
        
        if (state.appMode == AppMode.RUNNING && !state.showRunningMap && course != null) {
            // RENDER MAPLESS TACTICAL RUN DASHBOARD
            RunningTacticalDashboard(
                state = state,
                viewModel = viewModel,
                permissionLauncher = permissionLauncher,
                isScreenLocked = isScreenLocked,
                onLockToggle = { isScreenLocked = it }
            )
        } else {
            // RENDER STANDARD BOTTOM OVERLAYS (Import, Simulation, or Run-with-map)
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
                        
                        Column(
                            modifier = Modifier
                                .height(100.dp)
                                .verticalScroll(rememberScrollState())
                        ) {
                           course.waypoints.forEach { wpt ->
                            val station = wpt.extensions?.station
                            val services = station?.services
                            val access = station?.accessibility
                            val amenities = buildList {
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
                            }.joinToString("")
                            val suffix = if (amenities.isNotEmpty()) " $amenities" else ""
                            
                            Text(
                                text = "• ${wpt.name}$suffix (km ${(wpt.distanceMeters/1000.0).format(1)})",
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
                      Column(modifier = Modifier.padding(12.dp)) {
                        
                        ElevationProfileChart(
                            courseData = course,
                            scrubberProgress = state.scrubberProgress,
                            onScrub = { progress -> viewModel.updateScrubberProgress(progress) },
                            modifier = Modifier.height(55.dp)
                        )
    
                        Spacer(modifier = Modifier.height(4.dp))
    
                        val scrubberIndex = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                        val scrubberPoint = course.points.getOrNull(scrubberIndex)
                        val currentGrade = scrubberPoint?.grade ?: 0.0
    
                        RetroGradientBarGraph(currentGrade = currentGrade)
    
                        AnimatedVisibility(
                            visible = isControlsVisible,
                            enter = fadeIn(animationSpec = tween(300)) + expandVertically(),
                            exit = fadeOut(animationSpec = tween(300)) + shrinkVertically()
                        ) {
                          Column {
                            Spacer(modifier = Modifier.height(2.dp))
        
                            Slider(
                                value = state.scrubberProgress.toFloat(),
                                onValueChange = { viewModel.updateScrubberProgress(it.toDouble()) },
                                valueRange = 0f..1f,
                                modifier = Modifier.fillMaxWidth()
                            )
        
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                              Row(
                                  verticalAlignment = Alignment.CenterVertically,
                                  horizontalArrangement = Arrangement.spacedBy(8.dp)
                              ) {
                                Button(
                                    onClick = { viewModel.rewind() },
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                  Text("⏮", fontSize = 14.sp)
                                }
                                Button(
                                    onClick = { viewModel.togglePlayback() },
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                  Text(if (state.isProgressing) "⏸" else "▶", fontSize = 14.sp)
                                }
                              }
        
                              Text(
                                  text = String.format(java.util.Locale.US, "Progress: %.1f%%", state.scrubberProgress * 100.0),
                                  style = MaterialTheme.typography.bodyMedium,
                                  fontWeight = FontWeight.Bold,
                                  color = Color.White,
                                  fontFamily = FontFamily.Monospace
                              )
        
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
                                  shape = RoundedCornerShape(8.dp),
                                  contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                              ) {
                                Text("${state.playbackSpeed.toInt()}x", fontSize = 12.sp)
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
    
                AppMode.RUNNING -> {
                  if (course != null) {
                    Card(
                        shape = RoundedCornerShape(24.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                      Column(modifier = Modifier.padding(20.dp)) {
                        
                        val activeIndex = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                        val activePt = course.points.getOrNull(activeIndex)
                        val nextWpt = course.waypoints.find { it.distanceMeters > (activePt?.distance ?: 0.0) }
    
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                          Text(
                              text = "🏃 ON MAP VIEW",
                              color = Color(0xFF38BDF8),
                              fontWeight = FontWeight.Bold,
                              fontSize = 14.sp
                          )
                          Text(
                              text = nextWpt?.let { "Next: ${it.name} | Dev: ${state.deviationMeters.toInt()}m" } ?: "🏁 FINISH",
                              color = Color.LightGray,
                              fontSize = 12.sp
                          )
                        }
    
                        Spacer(modifier = Modifier.height(12.dp))
    
                        RetroGradientBarGraph(currentGrade = activePt?.grade ?: 0.0)
    
                        Spacer(modifier = Modifier.height(12.dp))
    
                        Row(modifier = Modifier.fillMaxWidth()) {
                          Column(modifier = Modifier.weight(1f)) {
                            Text("DISTANCE", fontSize = 11.sp, color = Color.Gray)
                            Text(
                                text = String.format("%.2f km", (activePt?.distance ?: 0.0) / 1000.0),
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontFamily = FontFamily.Monospace
                            )
                          }
                          Column(modifier = Modifier.weight(1f)) {
                            Text("TOTAL ASCENT", fontSize = 11.sp, color = Color.Gray)
                            Text(
                                text = String.format("%d m", course.elevationGain.toInt()),
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontFamily = FontFamily.Monospace
                            )
                          }
                        }
    
                        Spacer(modifier = Modifier.height(16.dp))
    
                        Button(
                            onClick = { viewModel.toggleRunningMap() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF374151)),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                          Text("🎛️ Switch to Tactical Dashboard", color = Color.White)
                        }
                      }
                    }
                  }
                }
              }
            }
        }

        // 1. FLOATING MODE SELECTION BAR (Top Pill Bar) - Always on top
        AnimatedVisibility(
            visible = isControlsVisible || state.appMode == AppMode.IMPORT_EDIT,
            enter = fadeIn(animationSpec = tween(300)),
            exit = fadeOut(animationSpec = tween(300)),
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(16.dp)
                .fillMaxWidth()
        ) {
          Card(
              shape = RoundedCornerShape(24.dp),
              colors = CardDefaults.cardColors(containerColor = Color(0xDD0F172A))
          ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
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
                   DropdownMenuItem(
                       text = { Text("📍 Launch GPS Simulator") },
                       onClick = {
                         showSettingsMenu = false
                         showSimulationHarness = true
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
                          val sharedPrefs = context.getSharedPreferences("ruff_terrain_prefs", android.content.Context.MODE_PRIVATE)
                          sharedPrefs.edit().remove("last_opened_course").apply()
                          
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
        }
      }
    }
  }

  if (showSimulationHarness) {
      GpsSimulationHarnessDialog(
          state = state,
          viewModel = viewModel,
          onDismiss = { showSimulationHarness = false }
      )
  }

  if (state.showCriticalOffCourseDialog) {
      CriticalOffCourseDialog(
          deviation = state.deviationMeters,
          onAcknowledge = { viewModel.acknowledgeOffCourse() }
      )
  }
}

@Composable
fun GpsSimulationHarnessDialog(
    state: MainScreenUiState,
    viewModel: MainScreenViewModel,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "📍 GPS SIMULATOR HARNESS",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))
                
                Text(
                    text = "Select a scenario to inject mock coordinates:",
                    color = Color.LightGray,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))

                val scenarios = listOf(
                    "Normal" to "On Course, Steady Pace (No alerts)",
                    "Off-Course" to "Off-Course Veering (Triggers dialog + muting)",
                    "Cutoff" to "Too Slow Pace (Triggers cutoff warning)"
                )

                scenarios.forEach { (name, desc) ->
                    val isActive = state.activeSimulationScenario == name
                    Button(
                        onClick = {
                            viewModel.startSimulation(name)
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isActive) Color(0xFF10B981) else Color(0xFF1E293B)
                        ),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = if (isActive) "★ $name Running" else name,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Text(text = desc, fontSize = 11.sp, color = Color.Gray)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    if (state.activeSimulationScenario != null) {
                        Button(
                            onClick = { viewModel.stopSimulation() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text("Stop Sim")
                        }
                    }
                    Button(
                        onClick = onDismiss,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Close")
                    }
                }
            }
        }
    }
}

@Composable
fun CriticalOffCourseDialog(
    deviation: Double,
    onAcknowledge: () -> Unit
) {
    Dialog(onDismissRequest = {}) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF7F1D1D)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "🚨 CRITICAL WARNING",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(12.dp))
                
                Text(
                    text = String.format(Locale.US, "You are %.0f meters off course!", deviation),
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 18.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(
                    text = "Verify route map and return to trail immediately.",
                    color = Color(0xFFFCA5A5),
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(24.dp))

                Button(
                    onClick = onAcknowledge,
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF7F1D1D)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Acknowledge & Mute Alert", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RunningTacticalDashboard(
    state: MainScreenUiState,
    viewModel: MainScreenViewModel,
    permissionLauncher: ManagedActivityResultLauncher<Array<String>, Map<String, Boolean>>,
    isScreenLocked: Boolean,
    onLockToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    val course = state.courseData ?: return
    val context = LocalContext.current

    Box(modifier = modifier.fillMaxSize()) {
        if (isScreenLocked) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xFA090D16))
                    .statusBarsPadding()
                    .navigationBarsPadding(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "🔒 SCREEN LOCKED",
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Touch and hold below to unlock",
                        color = Color.Gray,
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.height(48.dp))
                    Box(
                        modifier = Modifier
                            .background(Color(0xFFE91E63), shape = RoundedCornerShape(24.dp))
                            .combinedClickable(
                                onLongClick = { onLockToggle(false) },
                                onClick = {
                                    android.widget.Toast.makeText(context, "Hold to unlock", android.widget.Toast.LENGTH_SHORT).show()
                                }
                            )
                            .padding(horizontal = 32.dp, vertical = 16.dp)
                    ) {
                        Text(
                            text = "HOLD TO UNLOCK",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        )
                    }
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .statusBarsPadding()
                    .navigationBarsPadding()
            ) {
                Spacer(modifier = Modifier.height(88.dp))

                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = {
                            if (!state.isGpsEnabled) {
                                permissionLauncher.launch(
                                    arrayOf(
                                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                                        android.Manifest.permission.ACCESS_COARSE_LOCATION
                                    )
                                )
                            } else {
                                viewModel.toggleGpsEnabled(false)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (state.isGpsEnabled) Color(0xFF10B981) else Color(0xFF475569)
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(if (state.isGpsEnabled) "🛰️ GPS: LIVE" else "🎮 GPS: MOCK")
                    }

                    Button(
                        onClick = { viewModel.toggleRunningMap() },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("🗺️ Map View")
                    }

                    Button(
                        onClick = { onLockToggle(true) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE2E8F0), contentColor = Color.Black),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("🔒 Lock")
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                if (state.activeSimulationScenario != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "📍 Simulating: ${state.activeSimulationScenario} (${state.elapsedSimulationTimeSeconds}s)",
                                color = Color(0xFF38BDF8),
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            Button(
                                onClick = { viewModel.stopSimulation() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)
                            ) {
                                Text("Stop", fontSize = 11.sp, color = Color.White)
                            }
                        }
                    }
                }

                if (state.cutoffAlertMessage != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF854D0E)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                    ) {
                        Text(
                            text = state.cutoffAlertMessage,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(16.dp),
                            textAlign = TextAlign.Center
                        )
                    }
                }

                if (state.paceAlertMessage != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                    ) {
                        Text(
                            text = state.paceAlertMessage,
                            color = Color(0xFFFBBF24),
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(16.dp),
                            textAlign = TextAlign.Center
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                val isOffTrail = state.deviationMeters > 20.0
                val (arrow, cardinalDir) = getDirectionArrowAndText(state.bearingToTrail)

                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isOffTrail) Color(0xFF7F1D1D) else Color(0xFF064E3B)
                    ),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = if (isOffTrail) "🚨 OFF COURSE" else "✓ ON COURSE",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = String.format("Deviation: %.0f meters (Limit: 20m)", state.deviationMeters),
                            fontSize = 24.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Color.White,
                            fontFamily = FontFamily.Monospace
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Text(
                                text = arrow,
                                fontSize = 36.sp,
                                color = if (isOffTrail) Color(0xFFFCA5A5) else Color(0xFF6EE7B7)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (isOffTrail) "Steer $cardinalDir to return" else "Path goes $cardinalDir",
                                fontSize = 14.sp,
                                color = Color.White,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        val activeIndex = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                        val activePt = course.points.getOrNull(activeIndex)
                        val nearestWpt = course.waypoints.minByOrNull { Math.abs(it.distanceMeters - (activePt?.distance ?: 0.0)) }
                        val nav = nearestWpt?.extensions?.station?.navigationAlert
                        if (nav != null && nav.prompt.isNotEmpty() && Math.abs(nearestWpt.distanceMeters - (activePt?.distance ?: 0.0)) < 150.0) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0x33000000), shape = RoundedCornerShape(8.dp))
                                    .padding(8.dp)
                            ) {
                                Text(
                                    text = "📣 Turn Alert: ${nav.prompt} (${nav.turnType})",
                                    color = Color(0xFFFDE047),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                val currentDist = state.scrubberProgress * course.totalDistance
                val activeSector = course.executionPlan?.sectors?.find { currentDist >= it.startDistM && currentDist <= it.endDistM }

                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "🎯 SECTOR STRATEGY GOALS",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF60A5FA)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        if (activeSector != null) {
                            Text(
                                text = activeSector.name,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Target Pace: ", color = Color.Gray, fontSize = 13.sp)
                                Text(
                                    text = String.format("%.1f min/km", activeSector.targetPaceMin),
                                    color = Color(0xFF34D399),
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 15.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                            if (activeSector.strategy.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "🏃 Strategy: ${activeSector.strategy}",
                                    fontSize = 13.sp,
                                    color = Color.LightGray
                                )
                            }
                            if (activeSector.nutrition.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "🍎 Nutrition: ${activeSector.nutrition}",
                                    fontSize = 13.sp,
                                    color = Color(0xFFFDBA74)
                                )
                            }
                        } else {
                            Text(
                                text = "Free running - No active execution plan sector loaded.",
                                color = Color.Gray,
                                fontSize = 13.sp
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                val nextAs = course.waypoints.find { it.distanceMeters > currentDist && it.extensions?.station != null }
                if (nextAs != null) {
                    val distLeft = nextAs.distanceMeters - currentDist
                    
                    var gainToNext = 0.0
                    val startPtIdx = (state.scrubberProgress * (course.points.size - 1)).toInt()
                    val endPtIdx = nextAs.closestTrackpointIndex.coerceIn(0, course.points.size - 1)
                    if (endPtIdx > startPtIdx) {
                        for (idx in startPtIdx until endPtIdx) {
                            val diff = course.points[idx + 1].elevation - course.points[idx].elevation
                            if (diff > 0.0) gainToNext += diff
                        }
                    }

                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "🏁 NEXT OBJECTIVE",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFF472B6)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = nextAs.name,
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column {
                                    Text("DISTANCE TO", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = String.format("%.2f km", distLeft / 1000.0),
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Column {
                                    Text("GAIN TO", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = String.format("+%.0f m", gainToNext),
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFF59E0B),
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            }
                            
                            val passObj = nextAs.extensions?.station?.passes?.firstOrNull()
                            if (passObj != null) {
                                if (passObj.targetArrival != null || passObj.cutoffClock != null || passObj.cutoffElapsed != null) {
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .background(Color(0xFF334155), shape = RoundedCornerShape(8.dp))
                                            .padding(8.dp)
                                    ) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            if (passObj.targetArrival != null) {
                                                Column {
                                                    Text("PLAN ETA", color = Color.LightGray, fontSize = 9.sp)
                                                    Text(passObj.targetArrival, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                                }
                                            }
                                            val cutoffText = passObj.cutoffClock ?: passObj.cutoffElapsed
                                            if (cutoffText != null) {
                                                Column(horizontalAlignment = Alignment.End) {
                                                    Text("CUTOFF", color = Color(0xFFFCA5A5), fontSize = 9.sp)
                                                    Text(cutoffText, color = Color(0xFFEF4444), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                val climb = state.activeClimbInfo
                if (climb != null) {
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "⛰️ ACTIVE CLIMB PROFILE",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFFB923C)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = climb.name,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column {
                                    Text("CLIMB REMAINING", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = String.format("%.2f km", climb.distanceRemainingM / 1000.0),
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Column {
                                    Text("GAIN REMAINING", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = String.format("+%.0f m", climb.elevationGainRemainingM),
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFF97316),
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text("AVG GRADE", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = String.format("%.1f %%", climb.averageGrade),
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFEF4444),
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text("TOTAL COURSE DISTANCE", color = Color.Gray, fontSize = 9.sp)
                            Text(
                                text = String.format("%.2f / %.2f km", currentDist / 1000.0, course.totalDistance / 1000.0),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("ELEVATION GAIN DONE", color = Color.Gray, fontSize = 9.sp)
                            val donePtIdx = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                            val donePt = course.points.getOrNull(donePtIdx)
                            val gainDone = donePt?.climb ?: 0.0
                            Text(
                                text = String.format("+%.0f / +%.0f m", gainDone, course.elevationGain),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF10B981),
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "📈 ELEVATION PROFILE PROGRESS",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.LightGray,
                            modifier = Modifier.padding(bottom = 6.dp)
                        )
                        ElevationProfileChart(
                            courseData = course,
                            scrubberProgress = state.scrubberProgress,
                            onScrub = { progress -> viewModel.updateScrubberProgress(progress) },
                            modifier = Modifier.height(100.dp).fillMaxWidth()
                        )
                    }
                }

                if (!state.isGpsEnabled) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF334155)),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "🛠️ SIMULATION DEV CONTROLS",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF93C5FD)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Mock Deviation:", color = Color.White, fontSize = 12.sp)
                                Text(
                                    text = String.format("%.0f meters", state.mockDeviation),
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Slider(
                                value = state.mockDeviation.toFloat(),
                                onValueChange = { viewModel.updateMockDeviation(it.toDouble()) },
                                valueRange = 0f..100f,
                                modifier = Modifier.fillMaxWidth()
                            )

                            Spacer(modifier = Modifier.height(4.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Button(
                                    onClick = { viewModel.rewind() },
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                                    modifier = Modifier.padding(horizontal = 4.dp)
                                ) {
                                    Text("⏮")
                                }
                                Button(
                                    onClick = { viewModel.togglePlayback() },
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                                    modifier = Modifier.padding(horizontal = 4.dp)
                                ) {
                                    Text(if (state.isProgressing) "⏸" else "▶")
                                }
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
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                                    modifier = Modifier.padding(horizontal = 4.dp)
                                ) {
                                    Text("${state.playbackSpeed.toInt()}x")
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}

private fun getDirectionArrowAndText(bearing: Double): Pair<String, String> {
    val index = (((bearing + 22.5) % 360) / 45.0).toInt()
    val arrow = when (index) {
        0 -> "⬆"
        1 -> "↗"
        2 -> "➡"
        3 -> "↘"
        4 -> "⬇"
        5 -> "↙"
        6 -> "⬅"
        7 -> "↖"
        else -> "⬆"
    }
    val text = when (index) {
        0 -> "North"
        1 -> "North-East"
        2 -> "East"
        3 -> "South-East"
        4 -> "South"
        5 -> "South-West"
        6 -> "West"
        7 -> "North-West"
        else -> "North"
    }
    return Pair(arrow, text)
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

private fun getFileName(context: Context, uri: Uri): String? {
    var result: String? = null
    if (uri.scheme == "content") {
        val cursor = context.contentResolver.query(uri, null, null, null, null)
        try {
            if (cursor != null && cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    result = cursor.getString(index)
                }
            }
        } finally {
            cursor?.close()
        }
    }
    if (result == null) {
        result = uri.path
        val cut = result?.lastIndexOf('/') ?: -1
        if (cut != -1) {
            result = result?.substring(cut + 1)
        }
    }
    return result
}
