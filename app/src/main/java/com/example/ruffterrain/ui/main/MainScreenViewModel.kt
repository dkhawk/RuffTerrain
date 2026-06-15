package com.example.ruffterrain.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ruffterrain.data.DataRepository
import com.example.ruffterrain.data.model.AppMode
import com.example.ruffterrain.data.model.CourseData
import com.example.ruffterrain.data.model.MapMode
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.InputStream

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
    val mapMode: MapMode = MapMode.MAP_3D,
    val appMode: AppMode = AppMode.IMPORT_EDIT
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
                        it.copy(
                            courseData = course,
                            isLoading = false,
                            scrubberProgress = 0.0,
                            // Set to Simulation Map Mode on new file load
                            appMode = AppMode.SIMULATION
                        )
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
        _uiState.update { it.copy(scrubberProgress = 0.0) }
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
        _uiState.update { it.copy(scrubberProgress = progress.coerceIn(0.0..1.0)) }
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
        _uiState.update { it.copy(appMode = mode) }
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

                // Sim speed: base speed 20m/s * speedMultiplier^2 matching Web client physics
                val speedVal = state.playbackSpeed
                val simSpeed = 20.0 * speedVal * speedVal
                currentDist += simSpeed * dt

                if (currentDist >= totalDist) {
                    _uiState.update {
                        it.copy(
                            scrubberProgress = 1.0,
                            isProgressing = false
                        )
                    }
                    break
                } else {
                    _uiState.update {
                        it.copy(scrubberProgress = currentDist / totalDist)
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
