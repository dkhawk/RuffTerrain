package com.sphericalchickens.ruffterrain.wear.engine

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.util.Log
import com.sphericalchickens.ruffterrain.data.model.CourseData
import com.sphericalchickens.ruffterrain.data.model.RoutePoint
import com.sphericalchickens.ruffterrain.util.Haversine
import com.sphericalchickens.ruffterrain.wear.data.WearAppStateStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class ScenarioType {
    BEST,
    TARGET,
    WORST
}

class WearLocationEngine(private val context: Context) {

    private val coroutineScope = CoroutineScope(Dispatchers.Main + Job())
    private var extrapolationJob: Job? = null
    private var backgroundCalibrateJob: Job? = null

    private var lastKnownDistance = 0.0
    private var lastKnownTimeMs = System.currentTimeMillis()

    private val _estimatedDistanceMeters = MutableStateFlow(0.0)
    val estimatedDistanceMeters: StateFlow<Double> = _estimatedDistanceMeters.asStateFlow()

    private val _scenarioType = MutableStateFlow(ScenarioType.TARGET)
    val scenarioType: StateFlow<ScenarioType> = _scenarioType.asStateFlow()

    private val _isGpsSearching = MutableStateFlow(false)
    val isGpsSearching: StateFlow<Boolean> = _isGpsSearching.asStateFlow()

    init {
        // Collect synced progress from the phone to update our base state
        coroutineScope.launch {
            WearAppStateStore.runnerProgress.collect { progress ->
                if (progress != null) {
                    calibrate(progress.distanceRunMeters)
                    Log.d("WearLocationEngine", "Calibrated baseline from synced phone progress: ${progress.distanceRunMeters}m")
                }
            }
        }
    }

    fun setScenario(type: ScenarioType) {
        _scenarioType.value = type
        // Recalibrate current progress timing when pace scenario changes
        calibrate(_estimatedDistanceMeters.value)
    }

    fun calibrate(distance: Double) {
        lastKnownDistance = distance
        lastKnownTimeMs = System.currentTimeMillis()
        _estimatedDistanceMeters.value = distance
    }

    fun onScreenStateChanged(isActive: Boolean) {
        if (isActive) {
            startExtrapolationLoop()
            triggerSingleShotGpsCalibration()
            stopBackgroundCalibrationLoop()
        } else {
            stopExtrapolationLoop()
            startBackgroundCalibrationLoop()
        }
    }

    private fun startExtrapolationLoop() {
        extrapolationJob?.cancel()
        extrapolationJob = coroutineScope.launch {
            while (true) {
                extrapolateCurrentDistance()
                delay(500)
            }
        }
    }

    private fun stopExtrapolationLoop() {
        extrapolationJob?.cancel()
        extrapolationJob = null
    }

    private fun startBackgroundCalibrationLoop() {
        backgroundCalibrateJob?.cancel()
        backgroundCalibrateJob = coroutineScope.launch {
            while (true) {
                // Calibrate every 3 minutes when in background / screen off
                delay(3 * 60 * 1000L)
                triggerSingleShotGpsCalibration()
            }
        }
    }

    private fun stopBackgroundCalibrationLoop() {
        backgroundCalibrateJob?.cancel()
        backgroundCalibrateJob = null
    }

    private fun extrapolateCurrentDistance() {
        val course = WearAppStateStore.courseData.value ?: return
        if (course.totalDistance <= 0.0) return

        val elapsedSec = (System.currentTimeMillis() - lastKnownTimeMs) / 1000.0
        val paceMinPerKm = getPaceMinPerKmAtDistance(lastKnownDistance, course)
        
        // velocity (meters per second) = 1000.0 / (paceMinPerKm * 60.0)
        val velocityMps = if (paceMinPerKm > 0.0) 1000.0 / (paceMinPerKm * 60.0) else 0.0
        val extrapolated = lastKnownDistance + (elapsedSec * velocityMps)
        
        _estimatedDistanceMeters.value = extrapolated.coerceIn(0.0, course.totalDistance)
    }

    private fun getPaceMinPerKmAtDistance(distance: Double, course: CourseData): Double {
        val plan = course.executionPlan ?: return 10.0 // Default pace 10:00/km if no plan
        val sector = plan.sectors.firstOrNull { distance >= it.startDistM && distance <= it.endDistM }
            ?: plan.sectors.lastOrNull()
            ?: return 10.0

        return when (_scenarioType.value) {
            ScenarioType.BEST -> sector.bestPaceMin
            ScenarioType.TARGET -> sector.targetPaceMin
            ScenarioType.WORST -> sector.worstPaceMin
        }
    }

    fun triggerSingleShotGpsCalibration() {
        val course = WearAppStateStore.courseData.value ?: return
        if (course.points.isEmpty()) return

        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.ACCESS_FINE_LOCATION
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            Log.w("WearLocationEngine", "Fine location permission not granted")
            return
        }

        try {
            _isGpsSearching.value = true
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    0L,
                    0f,
                    object : LocationListener {
                        override fun onLocationChanged(location: Location) {
                            _isGpsSearching.value = false
                            snapGpsToTrail(location.latitude, location.longitude, course.points)
                            locationManager.removeUpdates(this)
                        }
                        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {}
                    },
                    context.mainLooper
                )
            } else {
                _isGpsSearching.value = false
                val lastKnown = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                if (lastKnown != null) {
                    snapGpsToTrail(lastKnown.latitude, lastKnown.longitude, course.points)
                }
            }
        } catch (e: SecurityException) {
            _isGpsSearching.value = false
            Log.e("WearLocationEngine", "Security exception requesting updates: ${e.message}")
        }
    }

    private fun snapGpsToTrail(latitude: Double, longitude: Double, points: List<RoutePoint>) {
        var minDistance = Double.MAX_VALUE
        var bestPoint: RoutePoint? = null
        
        for (pt in points) {
            val dist = Haversine.distance(latitude, longitude, pt.latitude, pt.longitude)
            if (dist < minDistance) {
                minDistance = dist
                bestPoint = pt
            }
        }

        // Snap to route if within 200m to ignore out-of-bounds GPS noise
        if (minDistance <= 200.0 && bestPoint != null) {
            calibrate(bestPoint.distance)
            Log.d("WearLocationEngine", "Snapped GPS to trail point: ${bestPoint.distance}m (Drift: ${minDistance}m)")
        } else {
            Log.w("WearLocationEngine", "GPS point too far from trail to snap: ${minDistance}m")
        }
    }
}
