package com.example.ruffterrain.ui.main

import com.example.ruffterrain.data.DataRepository
import com.example.ruffterrain.data.model.CourseData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.InputStream

@OptIn(ExperimentalCoroutinesApi::class)
class MainScreenViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun testInitialUiState() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)
        val state = viewModel.uiState.value

        assertNull(state.courseData)
        assertFalse(state.isLoading)
        assertNull(state.errorMessage)
        assertEquals(0.0, state.scrubberProgress, 0.001)
    }

    @Test
    fun testLoadCourseSuccess() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        // Setup mock course response
        val mockCourse = CourseData(name = "Test Trail", points = emptyList())
        repository.setMockResult(Result.success(mockCourse))

        val dummyInputStream = "".byteInputStream()
        viewModel.loadCourse(dummyInputStream)

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertNotNull(state.courseData)
        assertEquals("Test Trail", state.courseData?.name)
        assertNull(state.errorMessage)
    }

    @Test
    fun testLoadCourseFailure() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        repository.setMockResult(Result.failure(RuntimeException("Parsing error")))

        val dummyInputStream = "".byteInputStream()
        viewModel.loadCourse(dummyInputStream)

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertNull(state.courseData)
        assertEquals("Parsing error", state.errorMessage)
    }

    @Test
    fun testUpdateScrubberProgress() = runTest {
        val repository = FakeDataRepository()
        val viewModel = MainScreenViewModel(repository)

        viewModel.updateScrubberProgress(0.55)
        assertEquals(0.55, viewModel.uiState.value.scrubberProgress, 0.001)

        // Coercion check
        viewModel.updateScrubberProgress(1.2)
        assertEquals(1.0, viewModel.uiState.value.scrubberProgress, 0.001)

        viewModel.updateScrubberProgress(-0.1)
        assertEquals(0.0, viewModel.uiState.value.scrubberProgress, 0.001)
    }
}

private class FakeDataRepository : DataRepository {
    private val _courseData = MutableStateFlow<CourseData?>(null)
    override val courseData: StateFlow<CourseData?> = _courseData.asStateFlow()

    private var mockResult: Result<CourseData> = Result.failure(IllegalStateException("No mock set"))

    fun setMockResult(result: Result<CourseData>) {
        this.mockResult = result
    }

    override fun loadCourse(inputStream: InputStream): Result<CourseData> {
        return mockResult.onSuccess {
            _courseData.value = it
        }
    }
}
