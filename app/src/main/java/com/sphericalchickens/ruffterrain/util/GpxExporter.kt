package com.sphericalchickens.ruffterrain.util

import com.sphericalchickens.ruffterrain.db.TrackingPoint
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

object GpxExporter {
    fun exportSessionToGpxString(sessionName: String, points: List<TrackingPoint>): String {
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<gpx version=\"1.1\" creator=\"RuffTerrain\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n")
        sb.append("  <metadata>\n")
        sb.append("    <name>").append(escapeXml(sessionName)).append("</name>\n")
        sb.append("    <time>").append(DateTimeFormatter.ISO_INSTANT.format(Instant.now())).append("</time>\n")
        sb.append("  </metadata>\n")
        sb.append("  <trk>\n")
        sb.append("    <name>").append(escapeXml(sessionName)).append("</name>\n")
        sb.append("    <trkseg>\n")
        
        for (pt in points) {
            sb.append(String.format(Locale.US, "      <trkpt lat=\"%.6f\" lon=\"%.6f\">\n", pt.latitude, pt.longitude))
            sb.append(String.format(Locale.US, "        <ele>%.2f</ele>\n", pt.elevation))
            val instant = Instant.ofEpochMilli(pt.timestampMs)
            sb.append("        <time>").append(DateTimeFormatter.ISO_INSTANT.format(instant)).append("</time>\n")
            sb.append("      </trkpt>\n")
        }
        
        sb.append("    </trkseg>\n")
        sb.append("  </trk>\n")
        sb.append("</gpx>\n")
        return sb.toString()
    }

    private fun escapeXml(str: String): String {
        return str.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;")
    }
}
