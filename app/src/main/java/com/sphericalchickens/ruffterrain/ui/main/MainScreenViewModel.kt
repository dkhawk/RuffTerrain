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

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sphericalchickens.ruffterrain.data.DataRepository
import com.sphericalchickens.ruffterrain.data.model.AppMode
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.MapMode
import com.sphericalchickens.ruffterrain.data.model.ClimbInfo
import com.sphericalchickens.ruffterrain.util.Haversine
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.cos

/**
 * Screen state representation for the course analyzer dashboard.
 */
data class MainScreenUiState(
    val courseData: CourseData? = null,
    val isProgressing: Boolean = false,
    val scrubberProgress: Double = 0.0, // 0.0..1.0 representing percentage along route
    val playbackSpeed: Float = 1.0f,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val mapMode: MapMode = MapMode.MAP_2D,
    val appMode: AppMode = AppMode.IMPORT_EDIT,

    // Tactical Running Dashboard additions
    val isGpsEnabled: Boolean = false,
    val userLatitude: Double? = null,
    val userLongitude: Double? = null,
    val deviationMeters: Double = 0.0,
    val bearingToTrail: Double = 0.0,
    val showRunningMap: Boolean = false, // Toggle map on/off in RUNNING mode
    val mockDeviation: Double = 0.0, // Mock deviation slider value
    val activeClimbInfo: ClimbInfo? = null
)

/**
 * ViewModel responsible for orchestrating course state, scrubber operations, and data loading.
 */
class MainScreenViewModel(private val dataRepository: DataRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(MainScreenUiState())
    val uiState: StateFlow<MainScreenUiState> = _uiState.asStateFlow()

    private var playbackJob: Job? = null

    /**
     * Loads a course from an input stream. Reads the bytes synchronously to prevent closure issues.
     */
    fun loadCourse(inputStream: java.io.InputStream) {
        try {
            val bytes = inputStream.use { it.readBytes() }
            loadCourseBytes(bytes)
        } catch (e: Exception) {
            _uiState.update { it.copy(errorMessage = e.localizedMessage ?: "Failed to read course stream") }
        }
    }

    /**
     * Loads a course from an in-memory byte array asynchronously.
     */
    fun loadCourseBytes(bytes: ByteArray) {
        pausePlayback()
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            val result = dataRepository.loadCourse(bytes.inputStream())
            result.fold(
                onSuccess = { course ->
                    _uiState.update {
                        val updatedState = it.copy(
                            courseData = course,
                            isLoading = false,
                            scrubberProgress = 0.0,
                            appMode = AppMode.SIMULATION,
                            isGpsEnabled = false,
                            deviationMeters = 0.0,
                            mockDeviation = 0.0
                        )
                        updatedState.copy(activeClimbInfo = detectClimb(0.0, course))
                    }
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = error.localizedMessage ?: "Failed to parse GPX course file"
                        )
                    }
                }
            )
        }
    }

    /**
     * Toggles playback between active running and paused states.
     */
    fun togglePlayback() {
        val hasCourse = _uiState.value.courseData != null
        if (!hasCourse) return

        _uiState.update { it.copy(isProgressing = !it.isProgressing) }
        if (_uiState.value.isProgressing) {
            startPlaybackLoop()
        } else {
            playbackJob?.cancel()
        }
    }

    /**
     * Pauses simulation playback.
     */
    fun pausePlayback() {
        _uiState.update { it.copy(isProgressing = false) }
        playbackJob?.cancel()
    }

    /**
     * Resets playback scrubber progress back to 0.0 (and stops playback).
     */
    fun rewind() {
        pausePlayback()
        _uiState.update {
            val course = it.courseData
            val climb = course?.let { c -> detectClimb(0.0, c) }
            it.copy(
                scrubberProgress = 0.0,
                deviationMeters = if (it.isGpsEnabled) it.deviationMeters else it.mockDeviation,
                activeClimbInfo = climb
            )
        }
    }

    /**
     * Adjusts simulation playback speed multiplier (e.g. 1.0f, 2.0f, 5.0f, 10.0f).
     */
    fun updatePlaybackSpeed(speed: Float) {
        _uiState.update { it.copy(playbackSpeed = speed) }
    }

    /**
     * Updates the active scrubber tracking position (coerced within 0.0 to 1.0).
     */
    fun updateScrubberProgress(progress: Double) {
        val cleanProgress = progress.coerceIn(0.0..1.0)
        _uiState.update {
            val course = it.courseData
            val totalDist = course?.totalDistance ?: 0.0
            val currentDist = cleanProgress * totalDist
            val climb = course?.let { c -> detectClimb(currentDist, c) }
            it.copy(
                scrubberProgress = cleanProgress,
                activeClimbInfo = climb
            )
        }
    }

    /**
     * Toggles between 2D and 3D map views.
     */
    fun toggleMapMode() {
        _uiState.update {
            val nextMode = if (it.mapMode == MapMode.MAP_3D) MapMode.MAP_2D else MapMode.MAP_3D
            it.copy(mapMode = nextMode)
        }
    }

    /**
     * Updates the active operational mode (e.g. IMPORT_EDIT, SIMULATION, RUNNING).
     */
    fun updateAppMode(mode: AppMode) {
        pausePlayback()
        _uiState.update {
            val course = it.courseData
            val totalDist = course?.totalDistance ?: 0.0
            val currentDist = it.scrubberProgress * totalDist
            val climb = course?.let { c -> detectClimb(currentDist, c) }
            it.copy(
                appMode = mode,
                activeClimbInfo = climb
            )
        }
    }

    // --- TACTICAL RUN DASHBOARD ACTIONS ---

    /**
     * Toggles GPS tracking mode in running screen.
     */
    fun toggleGpsEnabled(enabled: Boolean) {
        pausePlayback()
        _uiState.update {
            it.copy(
                isGpsEnabled = enabled,
                deviationMeters = if (enabled) 0.0 else it.mockDeviation
            )
        }
    }

    /**
     * Toggles map view vs tactical dashboard inside Running mode.
     */
    fun toggleRunningMap() {
        _uiState.update { it.copy(showRunningMap = !it.showRunningMap) }
    }

    /**
     * Updates simulated mock deviation in meters.
     */
    fun updateMockDeviation(deviation: Double) {
        _uiState.update {
            if (!it.isGpsEnabled) {
                it.copy(
                    mockDeviation = deviation,
                    deviationMeters = deviation
                )
            } else {
                it.copy(mockDeviation = deviation)
            }
        }
    }

    /**
     * Updates coordinates and snaps progress + deviation from GPS.
     */
    fun updateUserLocation(lat: Double, lon: Double) {
        val course = _uiState.value.courseData ?: return
        if (course.points.isEmpty()) return

        val proj = projectUserToTrail(lat, lon, course)

        _uiState.update {
            val totalDist = course.totalDistance
            val nextProgress = if (totalDist > 0.0) (proj.progressDistance / totalDist).coerceIn(0.0..1.0) else 0.0
            val climb = detectClimb(proj.progressDistance, course)

            it.copy(
                userLatitude = lat,
                userLongitude = lon,
                scrubberProgress = nextProgress,
                deviationMeters = proj.deviation,
                bearingToTrail = proj.bearing,
                activeClimbInfo = climb
            )
        }
    }

    // --- MATH & ALIGNMENT ENGINES ---

    data class ProjectionResult(val progressDistance: Double, val deviation: Double, val bearing: Double)

    /**
     * Projects GPS coordinates to the closest trail segment.
     */
    fun projectUserToTrail(userLat: Double, userLon: Double, course: CourseData): ProjectionResult {
        if (course.points.isEmpty()) return ProjectionResult(0.0, 0.0, 0.0)

        // 1. Find closest trackpoint index
        var closestIdx = 0
        var minDist = Double.MAX_VALUE
        for (i in course.points.indices) {
            val pt = course.points[i]
            val d = Haversine.distance(userLat, userLon, pt.latitude, pt.longitude)
            if (d < minDist) {
                minDist = d
                closestIdx = i
            }
        }

        // 2. Project onto adjacent segments to find cross-track error
        var bestDist = minDist
        var bestProgressDist = course.points[closestIdx].distance

        // Check segment before (closestIdx - 1 -> closestIdx)
        if (closestIdx > 0) {
            val ptA = course.points[closestIdx - 1]
            val ptB = course.points[closestIdx]
            val dSeg = Haversine.distanceToSegment(userLat, userLon, ptA.latitude, ptA.longitude, ptB.latitude, ptB.longitude)
            if (dSeg < bestDist) {
                bestDist = dSeg
                val r = calculateSegmentFactor(userLat, userLon, ptA.latitude, ptA.longitude, ptB.latitude, ptB.longitude)
                bestProgressDist = ptA.distance + r * (ptB.distance - ptA.distance)
            }
        }

        // Check segment after (closestIdx -> closestIdx + 1)
        if (closestIdx < course.points.size - 1) {
            val ptA = course.points[closestIdx]
            val ptB = course.points[closestIdx + 1]
            val dSeg = Haversine.distanceToSegment(userLat, userLon, ptA.latitude, ptA.longitude, ptB.latitude, ptB.longitude)
            if (dSeg < bestDist) {
                bestDist = dSeg
                val r = calculateSegmentFactor(userLat, userLon, ptA.latitude, ptA.longitude, ptB.latitude, ptB.longitude)
                bestProgressDist = ptA.distance + r * (ptB.distance - ptA.distance)
            }
        }

        val targetPtIdx = (closestIdx + 1).coerceAtMost(course.points.size - 1)
        val targetPt = course.points[targetPtIdx]
        val brg = Haversine.bearing(userLat, userLon, targetPt.latitude, targetPt.longitude)

        return ProjectionResult(bestProgressDist, bestDist, brg)
    }

    private fun calculateSegmentFactor(lat: Double, lon: Double, latA: Double, lonA: Double, latB: Double, lonB: Double): Double {
        val latAvg = Math.toRadians((latA + latB + lat) / 3.0)
        val cosLat = cos(latAvg)
        val metersPerDegree = 111132.95

        val xB = (lonB - lonA) * metersPerDegree * cosLat
        val yB = (latB - latA) * metersPerDegree

        val xP = (lon - lonA) * metersPerDegree * cosLat
        val yP = (lat - latA) * metersPerDegree

        val lenSq = xB * xB + yB * yB
        if (lenSq < 1e-4) return 0.0

        val r = (xP * xB + yP * yB) / lenSq
        return r.coerceIn(0.0..1.0)
    }

    /**
     * Scans forward from current distance to identify active or upcoming climbs.
     */
    fun detectClimb(currentDist: Double, course: CourseData): ClimbInfo? {
        if (course.points.isEmpty()) return null
        
        var currIdx = course.points.indexOfFirst { it.distance >= currentDist }
        if (currIdx == -1) currIdx = course.points.size - 1

        var peakIdx = currIdx
        var maxEle = course.points[currIdx].elevation

        for (i in currIdx + 1 until course.points.size) {
            val pt = course.points[i]
            if (pt.elevation > maxEle) {
                maxEle = pt.elevation
                peakIdx = i
            }
            if (maxEle - pt.elevation > 25.0) {
                break
            }
        }

        val currentPt = course.points[currIdx]
        val peakPt = course.points[peakIdx]
        val climbGain = peakPt.elevation - currentPt.elevation
        val climbDist = peakPt.distance - currentPt.distance

        return if (climbGain >= 20.0 && climbDist >= 150.0) {
            val nearestWpt = course.waypoints.find {
                it.distanceMeters >= currentPt.distance && it.distanceMeters <= peakPt.distance && 
                (it.name.lowercase().contains("pass") || it.name.lowercase().contains("summit") || it.name.lowercase().contains("top"))
            } ?: course.waypoints.minByOrNull { Math.abs(it.distanceMeters - peakPt.distance) }

            val name = nearestWpt?.name?.let { "Climb to $it" } ?: "Active Climb"
            ClimbInfo(
                name = name,
                distanceRemainingM = climbDist,
                elevationGainRemainingM = climbGain,
                averageGrade = (climbGain / climbDist) * 100.0
            )
        } else {
            null
        }
    }

    private fun startPlaybackLoop() {
        playbackJob?.cancel()
        val course = _uiState.value.courseData ?: return
        if (course.totalDistance <= 0.0) return

        playbackJob = viewModelScope.launch {
            var lastTime = System.currentTimeMillis()
            while (isActive) {
                delay(32) // Tick every ~32ms (~30 FPS)
                val now = System.currentTimeMillis()
                val dt = (now - lastTime) / 1000.0
                lastTime = now

                val state = _uiState.value
                if (!state.isProgressing) break

                val totalDist = course.totalDistance
                var currentDist = state.scrubberProgress * totalDist

                val speedVal = state.playbackSpeed
                val simSpeed = 20.0 * speedVal * speedVal
                currentDist += simSpeed * dt

                if (currentDist >= totalDist) {
                    _uiState.update {
                        val climb = detectClimb(totalDist, course)
                        it.copy(
                            scrubberProgress = 1.0,
                            isProgressing = false,
                            activeClimbInfo = climb
                        )
                    }
                    break
                } else {
                    _uiState.update {
                        val climb = detectClimb(currentDist, course)
                        it.copy(
                            scrubberProgress = currentDist / totalDist,
                            activeClimbInfo = climb
                        )
                    }
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        playbackJob?.cancel()
    }
}
