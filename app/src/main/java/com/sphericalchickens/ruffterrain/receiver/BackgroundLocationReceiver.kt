package com.sphericalchickens.ruffterrain.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import com.sphericalchickens.ruffterrain.db.TrackingDbHelper
import com.sphericalchickens.ruffterrain.db.TrackingPoint

class BackgroundLocationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val location = @Suppress("DEPRECATION") (intent.getParcelableExtra<Location>(LocationManager.KEY_LOCATION_CHANGED)
            ?: intent.extras?.get(LocationManager.KEY_LOCATION_CHANGED) as? Location)
            ?: return

        val sharedPrefs = context.getSharedPreferences("ruff_terrain_prefs", Context.MODE_PRIVATE)
        val isTracking = sharedPrefs.getBoolean("is_tracking", false)
        val sessionId = sharedPrefs.getString("active_session_id", null)

        if (isTracking && sessionId != null) {
            val dbHelper = TrackingDbHelper(context)
            try {
                dbHelper.insertPoint(
                    TrackingPoint(
                        sessionId = sessionId,
                        latitude = location.latitude,
                        longitude = location.longitude,
                        elevation = location.altitude,
                        timestampMs = location.time
                    )
                )
            } finally {
                dbHelper.close()
            }
        }

        // Cache the latest received background location in SharedPreferences for instantaneous UI load
        sharedPrefs.edit()
            .putFloat("last_bg_lat", location.latitude.toFloat())
            .putFloat("last_bg_lon", location.longitude.toFloat())
            .putFloat("last_bg_elev", location.altitude.toFloat())
            .putLong("last_bg_time", location.time)
            .apply()
    }
}
