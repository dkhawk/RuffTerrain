package com.sphericalchickens.ruffterrain.db

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class TrackingPoint(
    val id: Long = 0,
    val sessionId: String,
    val latitude: Double,
    val longitude: Double,
    val elevation: Double,
    val timestampMs: Long
)

class TrackingDbHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    companion object {
        private const val DATABASE_NAME = "ruff_terrain_tracking.db"
        private const val DATABASE_VERSION = 1

        private const val TABLE_POINTS = "tracking_points"
        private const val COLUMN_ID = "id"
        private const val COLUMN_SESSION_ID = "session_id"
        private const val COLUMN_LATITUDE = "latitude"
        private const val COLUMN_LONGITUDE = "longitude"
        private const val COLUMN_ELEVATION = "elevation"
        private const val COLUMN_TIMESTAMP = "timestamp_ms"
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTable = """
            CREATE TABLE $TABLE_POINTS (
                $COLUMN_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                $COLUMN_SESSION_ID TEXT NOT NULL,
                $COLUMN_LATITUDE REAL NOT NULL,
                $COLUMN_LONGITUDE REAL NOT NULL,
                $COLUMN_ELEVATION REAL NOT NULL,
                $COLUMN_TIMESTAMP INTEGER NOT NULL
            )
        """.trimIndent()
        db.execSQL(createTable)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_POINTS")
        onCreate(db)
    }

    fun insertPoint(point: TrackingPoint): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put(COLUMN_SESSION_ID, point.sessionId)
            put(COLUMN_LATITUDE, point.latitude)
            put(COLUMN_LONGITUDE, point.longitude)
            put(COLUMN_ELEVATION, point.elevation)
            put(COLUMN_TIMESTAMP, point.timestampMs)
        }
        return db.insert(TABLE_POINTS, null, values)
    }

    fun getPointsForSession(sessionId: String): List<TrackingPoint> {
        val points = mutableListOf<TrackingPoint>()
        val db = readableDatabase
        val cursor = db.query(
            TABLE_POINTS,
            null,
            "$COLUMN_SESSION_ID = ?",
            arrayOf(sessionId),
            null,
            null,
            "$COLUMN_TIMESTAMP ASC"
        )
        cursor.use {
            val idIndex = cursor.getColumnIndexOrThrow(COLUMN_ID)
            val sessionIndex = cursor.getColumnIndexOrThrow(COLUMN_SESSION_ID)
            val latIndex = cursor.getColumnIndexOrThrow(COLUMN_LATITUDE)
            val lonIndex = cursor.getColumnIndexOrThrow(COLUMN_LONGITUDE)
            val eleIndex = cursor.getColumnIndexOrThrow(COLUMN_ELEVATION)
            val timeIndex = cursor.getColumnIndexOrThrow(COLUMN_TIMESTAMP)

            while (cursor.moveToNext()) {
                points.add(
                    TrackingPoint(
                        id = cursor.getLong(idIndex),
                        sessionId = cursor.getString(sessionIndex),
                        latitude = cursor.getDouble(latIndex),
                        longitude = cursor.getDouble(lonIndex),
                        elevation = cursor.getDouble(eleIndex),
                        timestampMs = cursor.getLong(timeIndex)
                    )
                )
            }
        }
        return points
    }

    fun getAllSessions(): List<String> {
        val sessions = mutableListOf<String>()
        val db = readableDatabase
        val cursor = db.query(
            TABLE_POINTS,
            arrayOf(COLUMN_SESSION_ID),
            null,
            null,
            COLUMN_SESSION_ID, // GROUP BY
            null,
            "$COLUMN_TIMESTAMP DESC"
        )
        cursor.use {
            val index = cursor.getColumnIndexOrThrow(COLUMN_SESSION_ID)
            while (cursor.moveToNext()) {
                sessions.add(cursor.getString(index))
            }
        }
        return sessions
    }

    fun deleteSession(sessionId: String) {
        val db = writableDatabase
        db.delete(TABLE_POINTS, "$COLUMN_SESSION_ID = ?", arrayOf(sessionId))
    }
}
