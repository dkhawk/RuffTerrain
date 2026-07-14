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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
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
import com.sphericalchickens.ruffterrain.data.model.Waypoint
import com.sphericalchickens.ruffterrain.data.model.WeatherCondition
import com.google.android.gms.maps.model.LatLng
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
  var selectedDetailWaypoint by remember { mutableStateOf<Waypoint?>(null) }
  var pendingWaypointLatLng by remember { mutableStateOf<LatLng?>(null) }
  var editingWaypoint by remember { mutableStateOf<Waypoint?>(null) }
  val sharedPrefs = remember { context.getSharedPreferences("ruff_terrain_prefs", android.content.Context.MODE_PRIVATE) }
  var unitsPref by remember { mutableStateOf(sharedPrefs.getString("units_preference", "default") ?: "default") }
  var accuracyPref by remember { mutableStateOf(sharedPrefs.getString("accuracy_preference", "AUTO") ?: "AUTO") }
  var pauseTimePref by remember { mutableStateOf(sharedPrefs.getInt("pause_time_preference", 2)) }
  var mapTypePref by remember { mutableStateOf(sharedPrefs.getString("map_type_preference", "NORMAL") ?: "NORMAL") }
  var showMapTypeDialog by remember { mutableStateOf(false) }

  // Sync settings with VM on startup/change
  LaunchedEffect(accuracyPref, pauseTimePref) {
      val mode = try { LocationAccuracyMode.valueOf(accuracyPref) } catch(e: Exception) { LocationAccuracyMode.AUTO }
      viewModel.updateLocationAccuracyMode(mode)
      viewModel.updateExpectedPauseTimeMinutes(pauseTimePref)
  }

  // Auto-hide controls after a timeout (3 seconds) of no interaction
  LaunchedEffect(isControlsVisible, lastInteractionTime) {
      if (isControlsVisible) {
          kotlinx.coroutines.delay(3000)
          isControlsVisible = false
      }
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

  val resolvedAccuracyMode = if (state.locationAccuracyMode == LocationAccuracyMode.AUTO) {
      val course = state.courseData
      val targetHours = course?.executionPlan?.targetDurationHrs
          ?: course?.let { (it.totalDistance / 1.38) / 3600.0 }
          ?: 0.0
      when {
          targetHours < 3.0 -> LocationAccuracyMode.HIGH_PERFORMANCE
          targetHours < 8.0 -> LocationAccuracyMode.BALANCED
          else -> LocationAccuracyMode.ULTRA_SAVER
      }
  } else {
      state.locationAccuracyMode
  }

  val (minTimeMs, minDistanceM) = when (resolvedAccuracyMode) {
      LocationAccuracyMode.HIGH_PERFORMANCE -> Pair(2000L, 2f)
      LocationAccuracyMode.BALANCED -> Pair(15000L, 15f)
      LocationAccuracyMode.ULTRA_SAVER -> Pair(60000L, 50f)
      else -> Pair(15000L, 15f)
  }

  // Register location updates when GPS is enabled
  LaunchedEffect(state.isGpsEnabled, minTimeMs, minDistanceM) {
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
                      minTimeMs,
                      minDistanceM,
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
            modifier = Modifier.fillMaxSize(),
            unitsPref = unitsPref,
            mapTypePref = mapTypePref,
            onWaypointClick = { selectedDetailWaypoint = it },
            onMapLongClick = {
                if (state.appMode == AppMode.IMPORT_EDIT) {
                    pendingWaypointLatLng = it
                }
            }
        )
      }

      // Overlay UI layer
      Box(modifier = Modifier.fillMaxSize()) {
        if (state.appMode == AppMode.IMPORT_EDIT && course != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A).copy(alpha = 0.85f)),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF3B82F6).copy(alpha = 0.5f)),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 16.dp)
                    .padding(horizontal = 24.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "💡 Planning Mode: Long-press on the map to add custom waypoints.",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
        
        if (state.appMode == AppMode.RUNNING && !state.showRunningMap && course != null) {
            // RENDER MAPLESS TACTICAL RUN DASHBOARD
            RunningTacticalDashboard(
                state = state,
                viewModel = viewModel,
                permissionLauncher = permissionLauncher,
                isScreenLocked = isScreenLocked,
                onLockToggle = { isScreenLocked = it },
                unitsPref = unitsPref
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
                        val system = getActiveUnitSystem(unitsPref)
                        Text(
                            text = "Distance: ${formatDistance(course.totalDistance, system)}  |  " +
                                   "Ascent: ${formatElevation(course.elevationGain, system)}  |  " +
                                   "Descent: ${formatElevation(course.elevationLoss, system)}",
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
                            val isFinish = wpt.name.contains("Finish", ignoreCase = true) ||
                                    wpt.symbol.contains("finish", ignoreCase = true) ||
                                    station?.subtype == "finish" ||
                                    station?.type == "finish"
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
                            }.joinToString("")
                            val suffix = if (amenities.isNotEmpty()) " $amenities" else ""
                            
                            val system = getActiveUnitSystem(unitsPref)
                            Text(
                                text = "• ${wpt.name}$suffix (${formatDistanceShort(wpt.distanceMeters, system)})",
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
    
                        val system = getActiveUnitSystem(unitsPref)
                        Row(modifier = Modifier.fillMaxWidth()) {
                          Column(modifier = Modifier.weight(1f)) {
                            Text("DISTANCE", fontSize = 11.sp, color = Color.Gray)
                            Text(
                                text = formatDistance(activePt?.distance ?: 0.0, system),
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontFamily = FontFamily.Monospace
                            )
                          }
                          Column(modifier = Modifier.weight(1f)) {
                            Text("TOTAL ASCENT", fontSize = 11.sp, color = Color.Gray)
                            Text(
                                text = formatElevation(course.elevationGain, system),
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
                        text = {
                            val label = when (mapTypePref) {
                                "SATELLITE" -> "Map Type: Satellite"
                                "HYBRID" -> "Map Type: Hybrid"
                                else -> "Map Type: Regular Map"
                            }
                            Text("🗺️ $label")
                        },
                        onClick = {
                            showSettingsMenu = false
                            showMapTypeDialog = true
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(if (state.mapMode == MapMode.MAP_3D) "Switch to 2D Map" else "Switch to 3D Map") },
                        onClick = {
                          showSettingsMenu = false
                          viewModel.toggleMapMode()
                        }
                    )
                  }
                   DropdownMenuItem(
                       text = {
                           val label = when (unitsPref) {
                               "metric" -> "Units: Metric (km/m)"
                               "imperial" -> "Units: Imperial (mi/ft)"
                               else -> "Units: Locale Default"
                           }
                           Text(label)
                       },
                       onClick = {
                           showSettingsMenu = false
                           val nextPref = when (unitsPref) {
                               "default" -> "metric"
                               "metric" -> "imperial"
                               else -> "default"
                           }
                           unitsPref = nextPref
                           sharedPrefs.edit().putString("units_preference", nextPref).apply()
                       }
                   )
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
                   DropdownMenuItem(
                        text = { Text("Load Bear Canyon Sample") },
                        onClick = {
                         showSettingsMenu = false
                         try {
                           val sharedPrefs = context.getSharedPreferences("ruff_terrain_prefs", android.content.Context.MODE_PRIVATE)
                           sharedPrefs.edit().remove("last_opened_course").apply()
                           
                           context.assets.open("bear_canyon_sample.gpx").use { assetStream ->
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

   pendingWaypointLatLng?.let { latLng ->
       AddWaypointDialog(
           latLng = latLng,
           onDismiss = { pendingWaypointLatLng = null },
           onSave = { name, symbol, water, food, toilets, medical, crew, dropBag ->
               viewModel.addCustomWaypoint(
                   name = name,
                   latitude = latLng.latitude,
                   longitude = latLng.longitude,
                   symbol = symbol,
                   water = water,
                   food = food,
                   toilets = toilets,
                   medical = medical,
                   crewAllowed = crew,
                   dropBagAllowed = dropBag
               )
               pendingWaypointLatLng = null
           }
       )
    }

    if (showMapTypeDialog) {
        MapTypeDialog(
            currentType = mapTypePref,
            onDismiss = { showMapTypeDialog = false },
            onSelect = { type ->
                mapTypePref = type
                sharedPrefs.edit().putString("map_type_preference", type).apply()
                showMapTypeDialog = false
            }
        )
    }

  selectedDetailWaypoint?.let { wpt ->
      WaypointDetailDialog(
          waypoint = wpt,
          weatherForecast = state.courseData?.weatherForecast ?: emptyList(),
          unitsPref = unitsPref,
          appMode = state.appMode,
          onDismiss = { selectedDetailWaypoint = null },
          onEditClick = {
              editingWaypoint = wpt
              selectedDetailWaypoint = null
          },
          onRemoveClick = {
              viewModel.removeWaypoint(wpt.id)
              selectedDetailWaypoint = null
          }
      )
  }

  editingWaypoint?.let { wpt ->
      EditWaypointDialog(
          waypoint = wpt,
          onDismiss = { editingWaypoint = null },
          onSave = { name, symbol, water, food, toilets, medical, crew, dropBag ->
              viewModel.editWaypoint(
                  waypointId = wpt.id,
                  name = name,
                  symbol = symbol,
                  water = water,
                  food = food,
                  toilets = toilets,
                  medical = medical,
                  crew = crew,
                  dropBag = dropBag
              )
              editingWaypoint = null
          }
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
    unitsPref: String = "default",
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
                                    val system = getActiveUnitSystem(unitsPref)
                                    Text("DISTANCE TO", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = formatDistance(distLeft, system),
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Column {
                                    val system = getActiveUnitSystem(unitsPref)
                                    Text("GAIN TO", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = "+${formatElevation(gainToNext, system)}",
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
                                    val system = getActiveUnitSystem(unitsPref)
                                    Text("CLIMB REMAINING", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = formatDistance(climb.distanceRemainingM, system),
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Column {
                                    val system = getActiveUnitSystem(unitsPref)
                                    Text("GAIN REMAINING", color = Color.Gray, fontSize = 10.sp)
                                    Text(
                                        text = "+${formatElevation(climb.elevationGainRemainingM, system)}",
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFFB923C),
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
                            val system = getActiveUnitSystem(unitsPref)
                            Text("TOTAL COURSE DISTANCE", color = Color.Gray, fontSize = 9.sp)
                            Text(
                                text = "${formatDistance(currentDist, system, false)} / ${formatDistance(course.totalDistance, system)}",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            val system = getActiveUnitSystem(unitsPref)
                            Text("ELEVATION GAIN DONE", color = Color.Gray, fontSize = 9.sp)
                            val donePtIdx = (state.scrubberProgress * (course.points.size - 1)).toInt().coerceIn(0, course.points.size - 1)
                            val donePt = course.points.getOrNull(donePtIdx)
                            val gainDone = donePt?.climb ?: 0.0
                            Text(
                                text = "+${formatElevation(gainDone, system)} / +${formatElevation(course.elevationGain, system)}",
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
    modifier: Modifier = Modifier,
    unitsPref: String = "default",
    mapTypePref: String = "NORMAL",
    onWaypointClick: (Waypoint) -> Unit = {},
    onMapLongClick: (LatLng) -> Unit = {}
) {
    if (mapMode == MapMode.MAP_3D) {
        Map3DViewport(courseData = courseData, scrubberProgress = scrubberProgress, modifier = modifier)
    } else {
        Map2DViewport(
            courseData = courseData,
            scrubberProgress = scrubberProgress,
            modifier = modifier,
            unitsPref = unitsPref,
            mapTypePref = mapTypePref,
            onWaypointClick = onWaypointClick,
            onMapLongClick = onMapLongClick
        )
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

@Composable
fun WaypointDetailDialog(
    waypoint: Waypoint,
    weatherForecast: List<WeatherCondition>,
    unitsPref: String = "default",
    appMode: AppMode = AppMode.IMPORT_EDIT,
    onDismiss: () -> Unit,
    onEditClick: () -> Unit = {},
    onRemoveClick: () -> Unit = {}
) {
    val context = LocalContext.current
    val system = getActiveUnitSystem(unitsPref)
    val station = waypoint.extensions?.station
    val isFinish = waypoint.name.contains("Finish", ignoreCase = true) ||
            waypoint.symbol.contains("finish", ignoreCase = true) ||
            station?.subtype == "finish" ||
            station?.type == "finish"

    Dialog(onDismissRequest = onDismiss) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .padding(24.dp)
                    .fillMaxWidth()
            ) {
                // Header
                Text(
                    text = if (isFinish) "${waypoint.name} 🏁" else waypoint.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                
                Spacer(modifier = Modifier.height(4.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Distance: ${formatDistance(waypoint.distanceMeters, system)} | Elevation: ${formatElevation(waypoint.elevation, system)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.LightGray
                    )
                    
                    Button(
                        onClick = {
                            val gmmIntentUri = android.net.Uri.parse("google.streetview:cbll=${waypoint.latitude},${waypoint.longitude}")
                            val mapIntent = android.content.Intent(android.content.Intent.ACTION_VIEW, gmmIntentUri)
                            mapIntent.setPackage("com.google.android.apps.maps")
                            try {
                                context.startActivity(mapIntent)
                            } catch (e: Exception) {
                                val webIntent = android.content.Intent(
                                    android.content.Intent.ACTION_VIEW,
                                    android.net.Uri.parse("https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${waypoint.latitude},${waypoint.longitude}")
                                )
                                context.startActivity(webIntent)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text("🧭 Street View", fontSize = 11.sp, color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
                
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp)
                        .height(1.dp)
                        .background(Color.Gray.copy(alpha = 0.3f))
                )
                
                // 1. Expected Arrival / Cutoff
                val station = waypoint.extensions?.station
                val passesList = station?.passes ?: emptyList()
                val pass = passesList.firstOrNull()
                
                Text(
                    text = "⏰ EXPECTED ARRIVAL & TIME LIMITS",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF38BDF8) // Light blue
                )
                Spacer(modifier = Modifier.height(4.dp))
                
                if (passesList.isNotEmpty()) {
                    val isSinglePass = passesList.size <= 1
                    passesList.forEach { p ->
                        val target = p.targetArrival ?: "Not set"
                        val cutoff = p.cutoffElapsed ?: p.cutoffClock ?: "No cutoff"
                        val prefix = if (isSinglePass) "• " else "• Pass ${p.num}: "
                        Text(
                            text = "${prefix}Target Arrival: $target (elapsed) | Cutoff: $cutoff",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.LightGray,
                            lineHeight = 20.sp
                        )
                    }
                } else {
                    Text(
                        text = "No expected arrival or cutoff data available.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.LightGray
                    )
                }
                
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp)
                        .height(1.dp)
                        .background(Color.Gray.copy(alpha = 0.3f))
                )
                
                // 2. Expected Weather
                Text(
                    text = "🌤️ EXPECTED WEATHER",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFFBBF24) // Yellow/Amber
                )
                Spacer(modifier = Modifier.height(4.dp))
                
                // Estimate arrival time in hours (using normal 2.78 m/s speed if targetArrival is empty)
                val arrivalHour = if (pass != null && !pass.targetArrival.isNullOrEmpty()) {
                    val parts = pass.targetArrival.split(":")
                    val hrs = parts.getOrNull(0)?.toIntOrNull() ?: 0
                    hrs.coerceIn(0, 24)
                } else {
                    (waypoint.distanceMeters / (2.78 * 3600.0)).toInt().coerceIn(0, 24)
                }
                
                val weather = weatherForecast.getOrNull(arrivalHour)
                if (weather != null) {
                    val tempF = (weather.temperature * 9.0 / 5.0) + 32.0
                    Text(
                        text = "• Condition: ${weather.conditionEmoji} ${weather.conditionText}\n" +
                               String.format(Locale.US, "• Temperature: %.1f°C / %.1f°F\n", weather.temperature, tempF) +
                               "• Wind: ${formatWindSpeed(weather.windSpeed, system)} | Humidity: ${String.format(Locale.US, "%.1f%%", weather.humidity)}\n" +
                               String.format(Locale.US, "• Rain Probability: %.0f%%", weather.rainProbability),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.LightGray,
                        lineHeight = 20.sp
                    )
                } else {
                    Text(
                        text = "Weather forecast unavailable.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.LightGray
                    )
                }
                
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp)
                        .height(1.dp)
                        .background(Color.Gray.copy(alpha = 0.3f))
                )
                
                // 3. Amenities Breakdown
                Text(
                    text = "🎒 AMENITIES & ACCESS BREAKDOWN",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF34D399) // Emerald/Green
                )
                Spacer(modifier = Modifier.height(6.dp))
                
                val services = station?.services
                val access = station?.accessibility
                
                Column(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    val items = buildList {
                        if (isFinish) add("🏁 Course Finish Line")
                        services?.let { svc ->
                            if (svc.water) add("💧 Water Available")
                            if (svc.unmanagedWater) add("🚰 Unmanaged Water Source")
                            if (svc.food) add("🍞 Food/Snacks Available")
                            if (svc.hotFood) add("🍲 Hot Meals Served")
                            if (svc.toilets) add("🚽 Public Restrooms")
                            if (svc.medical) add("🏥 Medical Station")
                            if (svc.sleepArea) add("🛏️ Sleeping Area")
                        }
                        access?.let { acc ->
                            if (acc.dropBagAllowed) add("💼 Drop Bags Allowed")
                            if (acc.crewAllowed) add("👥 Crew Support Access")
                            if (acc.pacerAllowed) add("👟 Pacer Exchange Station")
                            if (acc.vehicleTier != "none") add("🚗 Transportation/Vehicle Support")
                        }
                    }
                    
                    if (items.isNotEmpty()) {
                        items.forEach { label ->
                            Text(
                                text = "✅  $label",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.White,
                                modifier = Modifier.padding(vertical = 2.dp)
                            )
                        }
                    } else {
                        Text(
                            text = "No recorded amenities or access rules at this checkpoint.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.LightGray
                        )
                    }
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (appMode == AppMode.IMPORT_EDIT) {
                        val isStartOrFinish = waypoint.id.contains("start", ignoreCase = true) || 
                                waypoint.id.contains("finish", ignoreCase = true) ||
                                waypoint.name.contains("Start", ignoreCase = true) ||
                                waypoint.name.contains("Finish", ignoreCase = true)
                        
                        Row {
                            Button(
                                onClick = onEditClick,
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3B82F6)),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text("Edit", color = Color.White)
                            }
                            if (!isStartOrFinish) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Button(
                                    onClick = onRemoveClick,
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                                    shape = RoundedCornerShape(8.dp)
                                ) {
                                    Text("Remove", color = Color.White)
                                }
                            }
                        }
                    } else {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                    
                    Button(
                        onClick = onDismiss,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF334155)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Dismiss", color = Color.White)
                    }
                }
            }
        }
    }
}

fun getActiveUnitSystem(pref: String): String {
    if (pref == "metric") return "metric"
    if (pref == "imperial") return "imperial"
    
    val locale = java.util.Locale.getDefault()
    val country = locale.country.uppercase()
    return if (country == "US" || country == "LR" || country == "MM") {
        "imperial"
    } else {
        "metric"
    }
}

fun formatDistance(meters: Double, system: String, includeUnit: Boolean = true): String {
    return if (system == "imperial") {
        val miles = meters / 1609.344
        if (includeUnit) String.format(java.util.Locale.US, "%.2f mi", miles) else String.format(java.util.Locale.US, "%.2f", miles)
    } else {
        val km = meters / 1000.0
        if (includeUnit) String.format(java.util.Locale.US, "%.2f km", km) else String.format(java.util.Locale.US, "%.2f", km)
    }
}

fun formatDistanceShort(meters: Double, system: String): String {
    return if (system == "imperial") {
        val miles = meters / 1609.344
        String.format(java.util.Locale.US, "%.1f mi", miles)
    } else {
        val km = meters / 1000.0
        String.format(java.util.Locale.US, "%.1f km", km)
    }
}

fun formatElevation(meters: Double, system: String): String {
    return if (system == "imperial") {
        val feet = meters * 3.28084
        String.format(java.util.Locale.US, "%d ft", feet.toInt())
    } else {
        String.format(java.util.Locale.US, "%d m", meters.toInt())
    }
}

fun formatPace(minPerKm: Double, system: String): String {
    return if (system == "imperial") {
        val minPerMile = minPerKm * 1.609344
        String.format(java.util.Locale.US, "%.1f min/mi", minPerMile)
    } else {
        String.format(java.util.Locale.US, "%.1f min/km", minPerKm)
    }
}

fun formatWindSpeed(kmh: Double, system: String): String {
    return if (system == "imperial") {
        val mph = kmh * 0.621371
        String.format(java.util.Locale.US, "%.1f mph", mph)
    } else {
        String.format(java.util.Locale.US, "%.1f km/h", kmh)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddWaypointDialog(
    latLng: LatLng,
    onDismiss: () -> Unit,
    onSave: (
        name: String,
        symbol: String,
        water: Boolean,
        food: Boolean,
        toilets: Boolean,
        medical: Boolean,
        crew: Boolean,
        dropBag: Boolean
    ) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var symbol by remember { mutableStateOf("icons/aid_station.svg") }
    
    var water by remember { mutableStateOf(false) }
    var food by remember { mutableStateOf(false) }
    var toilets by remember { mutableStateOf(false) }
    var medical by remember { mutableStateOf(false) }
    
    var crew by remember { mutableStateOf(false) }
    var dropBag by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.Start
            ) {
                Text(
                    text = "➕ Add Custom Waypoint",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Waypoint Name", color = Color.LightGray) },
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color(0xFF3B82F6),
                        unfocusedIndicatorColor = Color.Gray
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text("Select Marker Icon:", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(modifier = Modifier.height(8.dp))
                
                val presetIcons = listOf(
                    "↩️" to "Turn",
                    "⛰️" to "Summit",
                    "👁️" to "View",
                    "🌉" to "Bridge",
                    "⛺" to "Camp",
                    "⚠️" to "Hazard",
                    "💧" to "Water",
                    "🍞" to "Food",
                    "🚽" to "Restroom",
                    "🏥" to "Medical",
                    "🧭" to "Junction",
                    "🏁" to "Finish",
                    "icons/aid_station.svg" to "Aid AS",
                    "icons/waypoint.svg" to "POI"
                )
                
                presetIcons.chunked(4).forEach { rowItems ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        rowItems.forEach { (symPath, label) ->
                            val isSelected = symbol == symPath
                            Button(
                                onClick = { symbol = symPath },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (isSelected) Color(0xFF3B82F6) else Color(0xFF1E293B)
                                ),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp, vertical = 6.dp),
                                modifier = Modifier.weight(1f).height(36.dp)
                            ) {
                                val textLabel = if (symPath.startsWith("icons/")) label else "$symPath $label"
                                Text(textLabel, color = Color.White, fontSize = 10.sp, maxLines = 1)
                            }
                        }
                        if (rowItems.size < 4) {
                            repeat(4 - rowItems.size) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
                
                Spacer(modifier = Modifier.height(12.dp))
                
                var customSymbolInput by remember { mutableStateOf("") }
                OutlinedTextField(
                    value = customSymbolInput,
                    onValueChange = {
                        customSymbolInput = it
                        if (it.isNotEmpty()) {
                            symbol = it
                        }
                    },
                    label = { Text("Or Type Custom Symbol (Emoji / Text)", color = Color.LightGray) },
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color(0xFF3B82F6),
                        unfocusedIndicatorColor = Color.Gray
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                if (symbol == "icons/aid_station.svg") {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Amenities / Services:", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Water (💧)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = water, onCheckedChange = { water = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Food (🍞)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = food, onCheckedChange = { food = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Toilets (🚽)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = toilets, onCheckedChange = { toilets = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Medical (🏥)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = medical, onCheckedChange = { medical = it })
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Access rules:", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Crew Allowed (👥)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = crew, onCheckedChange = { crew = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Drop Bag Allowed (💼)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = dropBag, onCheckedChange = { dropBag = it })
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = Color.LightGray)
                    }
                    Spacer(modifier = Modifier.width(16.dp))
                    Button(
                        onClick = {
                            val finalName = name.ifEmpty { 
                                if (symbol == "icons/aid_station.svg") "Aid Station" else "Waypoint"
                            }
                            onSave(finalName, symbol, water, food, toilets, medical, crew, dropBag)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Save", color = Color.White)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditWaypointDialog(
    waypoint: Waypoint,
    onDismiss: () -> Unit,
    onSave: (
        name: String,
        symbol: String,
        water: Boolean,
        food: Boolean,
        toilets: Boolean,
        medical: Boolean,
        crew: Boolean,
        dropBag: Boolean
    ) -> Unit
) {
    val station = waypoint.extensions?.station
    val services = station?.services
    val access = station?.accessibility
    
    var name by remember { mutableStateOf(waypoint.name) }
    var symbol by remember { mutableStateOf(waypoint.symbol) }
    
    var water by remember { mutableStateOf(services?.water ?: false) }
    var food by remember { mutableStateOf(services?.food ?: false) }
    var toilets by remember { mutableStateOf(services?.toilets ?: false) }
    var medical by remember { mutableStateOf(services?.medical ?: false) }
    
    var crew by remember { mutableStateOf(access?.crewAllowed ?: false) }
    var dropBag by remember { mutableStateOf(access?.dropBagAllowed ?: false) }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.Start
            ) {
                Text(
                    text = "✏️ Edit Waypoint",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Waypoint Name", color = Color.LightGray) },
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color(0xFF3B82F6),
                        unfocusedIndicatorColor = Color.Gray
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text("Select Marker Icon:", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(modifier = Modifier.height(8.dp))
                
                val presetIcons = listOf(
                    "↩️" to "Turn",
                    "⛰️" to "Summit",
                    "👁️" to "View",
                    "🌉" to "Bridge",
                    "⛺" to "Camp",
                    "⚠️" to "Hazard",
                    "💧" to "Water",
                    "🍞" to "Food",
                    "🚽" to "Restroom",
                    "🏥" to "Medical",
                    "🧭" to "Junction",
                    "🏁" to "Finish",
                    "icons/aid_station.svg" to "Aid AS",
                    "icons/waypoint.svg" to "POI"
                )
                
                presetIcons.chunked(4).forEach { rowItems ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        rowItems.forEach { (symPath, label) ->
                            val isSelected = symbol == symPath
                            Button(
                                onClick = { symbol = symPath },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (isSelected) Color(0xFF3B82F6) else Color(0xFF1E293B)
                                ),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp, vertical = 6.dp),
                                modifier = Modifier.weight(1f).height(36.dp)
                            ) {
                                val textLabel = if (symPath.startsWith("icons/")) label else "$symPath $label"
                                Text(textLabel, color = Color.White, fontSize = 10.sp, maxLines = 1)
                            }
                        }
                        if (rowItems.size < 4) {
                            repeat(4 - rowItems.size) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
                
                Spacer(modifier = Modifier.height(12.dp))
                
                var customSymbolInput by remember { mutableStateOf("") }
                OutlinedTextField(
                    value = customSymbolInput,
                    onValueChange = {
                        customSymbolInput = it
                        if (it.isNotEmpty()) {
                            symbol = it
                        }
                    },
                    label = { Text("Or Type Custom Symbol (Emoji / Text)", color = Color.LightGray) },
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color(0xFF3B82F6),
                        unfocusedIndicatorColor = Color.Gray
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                if (symbol == "icons/aid_station.svg") {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Amenities / Services:", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Water (💧)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = water, onCheckedChange = { water = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Food (🍞)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = food, onCheckedChange = { food = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Toilets (🚽)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = toilets, onCheckedChange = { toilets = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Medical (🏥)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = medical, onCheckedChange = { medical = it })
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Access rules:", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Crew Allowed (👥)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = crew, onCheckedChange = { crew = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Drop Bag Allowed (💼)", color = Color.LightGray, fontSize = 13.sp)
                        Switch(checked = dropBag, onCheckedChange = { dropBag = it })
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = Color.LightGray)
                    }
                    Spacer(modifier = Modifier.width(16.dp))
                    Button(
                        onClick = {
                            val finalName = name.ifEmpty { 
                                if (symbol == "icons/aid_station.svg") "Aid Station" else "Waypoint"
                            }
                            onSave(finalName, symbol, water, food, toilets, medical, crew, dropBag)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Save", color = Color.White)
                    }
                }
            }
        }
    }
}

@Composable
fun MapTypeDialog(
    currentType: String,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit
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
                horizontalAlignment = Alignment.Start
            ) {
                Text(
                    text = "🗺️ Select Map Type",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                val options = listOf(
                    "NORMAL" to "Regular Map",
                    "SATELLITE" to "Satellite View",
                    "HYBRID" to "Hybrid View"
                )

                options.forEach { (key, label) ->
                    val isSelected = currentType == key
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(key) }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        androidx.compose.material3.RadioButton(
                            selected = isSelected,
                            onClick = { onSelect(key) },
                            colors = androidx.compose.material3.RadioButtonDefaults.colors(
                                selectedColor = Color(0xFF3B82F6),
                                unselectedColor = Color.Gray
                            )
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(text = label, color = Color.White, fontSize = 14.sp)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF334155)),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text("Cancel", color = Color.White)
                }
            }
        }
    }
}
