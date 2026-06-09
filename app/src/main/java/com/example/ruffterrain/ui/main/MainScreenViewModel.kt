package com.example.ruffterrain.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ruffterrain.data.DataRepository
import com.example.ruffterrain.data.model.CourseData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
    val errorMessage: String? = null
)

/**
 * ViewModel responsible for orchestrating course state, scrubber operations, and data loading.
 */
class MainScreenViewModel(private val dataRepository: DataRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(MainScreenUiState())
    val uiState: StateFlow<MainScreenUiState> = _uiState.asStateFlow()

    /**
     * Loads a course from an input stream using the repository.
     */
    fun loadCourse(inputStream: InputStream) {
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            val result = dataRepository.loadCourse(inputStream)
            result.fold(
                onSuccess = { course ->
                    _uiState.update {
                        it.copy(
                            courseData = course,
                            isLoading = false,
                            scrubberProgress = 0.0
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
     * Updates the active scrubber tracking position (coerced within 0.0 to 1.0).
     */
    fun updateScrubberProgress(progress: Double) {
        _uiState.update { it.copy(scrubberProgress = progress.coerceIn(0.0..1.0)) }
    }
}
