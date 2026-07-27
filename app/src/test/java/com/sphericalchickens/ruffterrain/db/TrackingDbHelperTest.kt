package com.sphericalchickens.ruffterrain.db

import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TrackingDbHelperTest {

    private lateinit var dbHelper: TrackingDbHelper

    @Before
    fun setUp() {
        dbHelper = TrackingDbHelper(ApplicationProvider.getApplicationContext())
    }

    @After
    fun tearDown() {
        dbHelper.close()
    }

    @Test
    fun testInsertAndGetPointsForSession() {
        val sessionId = "Session-1"
        val pt1 = TrackingPoint(sessionId = sessionId, latitude = 40.0, longitude = -105.0, elevation = 1600.0, timestampMs = 1000L)
        val pt2 = TrackingPoint(sessionId = sessionId, latitude = 40.1, longitude = -105.1, elevation = 1650.0, timestampMs = 2000L)

        dbHelper.insertPoint(pt1)
        dbHelper.insertPoint(pt2)

        val retrieved = dbHelper.getPointsForSession(sessionId)
        assertEquals(2, retrieved.size)
        
        assertEquals(40.0, retrieved[0].latitude, 0.0001)
        assertEquals(-105.0, retrieved[0].longitude, 0.0001)
        assertEquals(1600.0, retrieved[0].elevation, 0.1)
        assertEquals(1000L, retrieved[0].timestampMs)

        assertEquals(40.1, retrieved[1].latitude, 0.0001)
        assertEquals(-105.1, retrieved[1].longitude, 0.0001)
        assertEquals(1650.0, retrieved[1].elevation, 0.1)
        assertEquals(2000L, retrieved[1].timestampMs)
    }

    @Test
    fun testGetAllSessions() {
        val session1 = "Session-A"
        val session2 = "Session-B"

        dbHelper.insertPoint(TrackingPoint(sessionId = session1, latitude = 40.0, longitude = -105.0, elevation = 1600.0, timestampMs = 1000L))
        dbHelper.insertPoint(TrackingPoint(sessionId = session2, latitude = 40.1, longitude = -105.1, elevation = 1650.0, timestampMs = 2000L))

        val sessions = dbHelper.getAllSessions()
        assertEquals(2, sessions.size)
        assertTrue(sessions.contains(session1))
        assertTrue(sessions.contains(session2))
    }

    @Test
    fun testDeleteSession() {
        val sessionToDelete = "Session-To-Delete"
        val sessionToKeep = "Session-To-Keep"

        dbHelper.insertPoint(TrackingPoint(sessionId = sessionToDelete, latitude = 40.0, longitude = -105.0, elevation = 1600.0, timestampMs = 1000L))
        dbHelper.insertPoint(TrackingPoint(sessionId = sessionToKeep, latitude = 40.1, longitude = -105.1, elevation = 1650.0, timestampMs = 2000L))

        dbHelper.deleteSession(sessionToDelete)

        val pointsLeft = dbHelper.getPointsForSession(sessionToDelete)
        assertTrue(pointsLeft.isEmpty())

        val pointsKept = dbHelper.getPointsForSession(sessionToKeep)
        assertEquals(1, pointsKept.size)
    }
}
