package com.sphericalchickens.ruffterrain.util

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RunnerProgress
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class WearDataSyncHelper(private val context: Context) {
    private val dataClient = Wearable.getDataClient(context)

    fun syncCourse(course: CourseData) {
        try {
            val json = Json.encodeToString(course)
            val putDataMapReq = PutDataMapRequest.create("/course_data").apply {
                dataMap.putString("course_json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }
            val putDataReq = putDataMapReq.asPutDataRequest().setUrgent()
            dataClient.putDataItem(putDataReq)
                .addOnSuccessListener { Log.d("WearSync", "Successfully synced course data to Wear OS") }
                .addOnFailureListener { Log.e("WearSync", "Failed to sync course data: ${it.message}") }
        } catch (e: Exception) {
            Log.e("WearSync", "Error encoding course data for sync: ${e.message}")
        }
    }

    fun syncProgress(progress: RunnerProgress) {
        try {
            val json = Json.encodeToString(progress)
            val putDataMapReq = PutDataMapRequest.create("/runner_progress").apply {
                dataMap.putString("progress_json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }
            val putDataReq = putDataMapReq.asPutDataRequest().setUrgent()
            dataClient.putDataItem(putDataReq)
                .addOnSuccessListener { Log.d("WearSync", "Successfully synced runner progress to Wear OS") }
                .addOnFailureListener { Log.e("WearSync", "Failed to sync runner progress: ${it.message}") }
        } catch (e: Exception) {
            Log.e("WearSync", "Error encoding runner progress: ${e.message}")
        }
    }
}
