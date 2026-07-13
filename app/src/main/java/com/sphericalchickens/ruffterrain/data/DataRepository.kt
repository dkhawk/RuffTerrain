package com.sphericalchickens.ruffterrain.data

import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.parser.GpxParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.InputStream

/**
 * Interface defining the course data access layer.
 */
interface DataRepository {
    /**
     * Observable stream of the currently loaded course.
     */
    val courseData: StateFlow<CourseData?>

    /**
     * Parses and loads a course GPX document.
     */
    fun loadCourse(inputStream: InputStream): Result<CourseData>
}

/**
 * Default implementation of the DataRepository interface.
 */
class DefaultDataRepository : DataRepository {
    private val _courseData = MutableStateFlow<CourseData?>(null)
    override val courseData: StateFlow<CourseData?> = _courseData.asStateFlow()

    override fun loadCourse(inputStream: InputStream): Result<CourseData> {
        return runCatching {
            val parsed = GpxParser.parse(inputStream)
            _courseData.value = parsed
            parsed
        }
    }
}
