package com.sphericalchickens.ruffterrain.wear

import android.util.Log
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import com.sphericalchickens.ruffterrain.wear.data.WearAppStateStore
import kotlinx.serialization.json.Json

class WearDataListenerService : WearableListenerService() {

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type == DataEvent.TYPE_CHANGED) {
                val path = event.dataItem.uri.path ?: continue
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap

                when (path) {
                    "/course_data" -> {
                        val json = dataMap.getString("course_json")
                        if (json != null) {
                            try {
                                val course = Json.decodeFromString<CourseData>(json)
                                WearAppStateStore.updateCourse(course)
                                Log.d("WearListener", "Successfully parsed and updated course: ${course.name}")
                            } catch (e: Exception) {
                                Log.e("WearListener", "Failed to deserialize course: ${e.message}")
                            }
                        }
                    }
                    "/runner_progress" -> {
                        val json = dataMap.getString("progress_json")
                        if (json != null) {
                            try {
                                val progress = Json.decodeFromString<RunnerProgress>(json)
                                WearAppStateStore.updateProgress(progress)
                                Log.d("WearListener", "Successfully parsed and updated progress")
                            } catch (e: Exception) {
                                Log.e("WearListener", "Failed to deserialize progress: ${e.message}")
                            }
                        }
                    }
                }
            }
        }
    }
}
