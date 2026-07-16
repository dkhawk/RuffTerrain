package com.sphericalchickens.ruffterrain.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.sphericalchickens.ruffterrain.wear.data.WearAppStateStore
import com.sphericalchickens.ruffterrain.wear.ui.CheckpointsScreen
import com.sphericalchickens.ruffterrain.wear.ui.DashboardScreen
import com.sphericalchickens.ruffterrain.wear.ui.ElevationProfileScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState);
        setContent {
            WearAppTheme {
                MainPagerScreen()
            }
        }
    }
}

@Composable
fun WearAppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = Color(0xFF10B981), // Green
            secondary = Color(0xFF3B82F6), // Blue
            background = Color.Black,
            onBackground = Color.White
        ),
        content = content
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MainPagerScreen() {
    val course by WearAppStateStore.courseData.collectAsState()
    val progress by WearAppStateStore.runnerProgress.collectAsState()

    val pagerState = rememberPagerState(pageCount = { 3 })

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize()
        ) { page ->
            when (page) {
                0 -> DashboardScreen(course = course, progress = progress)
                1 -> ElevationProfileScreen(course = course, progress = progress)
                2 -> CheckpointsScreen(course = course, progress = progress)
            }
        }

        // Horizontal Page Indicators (accent dots at the bottom)
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            repeat(3) { index ->
                val active = pagerState.currentPage == index
                val color = if (active) Color(0xFF10B981) else Color.Gray.copy(alpha = 0.5f)
                Box(
                    modifier = Modifier
                        .size(4.dp)
                        .background(color = color, shape = MaterialTheme.shapes.small)
                )
            }
        }
    }
}
