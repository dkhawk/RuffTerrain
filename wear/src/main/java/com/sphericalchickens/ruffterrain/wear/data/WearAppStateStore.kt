package com.sphericalchickens.ruffterrain.wear.data

import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object WearAppStateStore {
    private val _courseData = MutableStateFlow<CourseData?>(null)
    val courseData: StateFlow<CourseData?> = _courseData.asStateFlow()

    private val _runnerProgress = MutableStateFlow<RunnerProgress?>(null)
    val runnerProgress: StateFlow<RunnerProgress?> = _runnerProgress.asStateFlow()

    fun updateCourse(course: CourseData) {
        _courseData.value = course
    }

    fun updateProgress(progress: RunnerProgress) {
        _runnerProgress.value = progress
    }

    fun reset() {
        _courseData.value = null
        _runnerProgress.value = null
    }
}
