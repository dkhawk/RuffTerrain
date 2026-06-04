/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Converts a structured route object back into a standard, enhanced GPX XML string.
 * @param {Object} route Route data to serialize
 * @returns {string} XML string
 */
export function writeGPX(route) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gpx version="1.1" creator="RuffTerrain Web Visualizer"\n';
  xml += '     xmlns="http://www.topografix.com/GPX/1/1"\n';
  xml += '     xmlns:ca="http://coursearchitect.com/schema/v1"\n';
  xml += '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  xml += '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n';

  // Metadata
  xml += '  <metadata>\n';
  xml += `    <name>${escapeXml(route.name)}</name>\n`;
  xml += `    <desc>${escapeXml(route.description)}</desc>\n`;
  xml += '  </metadata>\n';

  // Waypoints
  route.waypoints.forEach((wpt) => {
    xml += `  <wpt lat="${wpt.lat}" lon="${wpt.lon}">\n`;
    xml += `    <ele>${wpt.ele.toFixed(2)}</ele>\n`;
    xml += `    <name>${escapeXml(wpt.name)}</name>\n`;
    xml += `    <sym>${escapeXml(wpt.sym)}</sym>\n`;
    xml += `    <desc>${escapeXml(wpt.desc)}</desc>\n`;

    // Render extensions if available
    const station = wpt.extensions?.station;
    if (station) {
      xml += '    <extensions>\n';
      
      let stationTag = `      <ca:station type="${escapeXml(station.type)}" id="${escapeXml(station.id)}"`;
      if (station.subtype) {
        stationTag += ` subtype="${escapeXml(station.subtype)}"`;
      }
      stationTag += '>\n';
      xml += stationTag;

      // Passes
      if (station.passes && station.passes.length > 0) {
        xml += '        <ca:passes>\n';
        station.passes.forEach((pass) => {
          let passTag = `          <ca:pass num="${pass.num}" dist_m="${pass.dist_m}"`;
          if (pass.label) {
            passTag += ` label="${escapeXml(pass.label)}"`;
          }
          if (pass.cutoff_clock) {
            passTag += ` cutoff_clock="${escapeXml(pass.cutoff_clock)}"`;
          }
          if (pass.cutoff_elapsed) {
            passTag += ` cutoff_elapsed="${escapeXml(pass.cutoff_elapsed)}"`;
          }
          passTag += ' />\n';
          xml += passTag;
        });
        xml += '        </ca:passes>\n';
      }

      // Accessibility
      const access = station.accessibility;
      if (access && Object.keys(access).length > 0) {
        let accessTag = '        <ca:accessibility';
        if (access.crew_allowed !== undefined) accessTag += ` crew_allowed="${access.crew_allowed}"`;
        if (access.pacer_allowed !== undefined) accessTag += ` pacer_allowed="${access.pacer_allowed}"`;
        if (access.vehicle_tier !== undefined) accessTag += ` vehicle_tier="${escapeXml(access.vehicle_tier)}"`;
        if (access.drop_bag_allowed !== undefined) accessTag += ` drop_bag_allowed="${access.drop_bag_allowed}"`;
        accessTag += ' />\n';
        xml += accessTag;
      }

      // Services
      const services = station.services;
      if (services && Object.keys(services).length > 0) {
        let servicesTag = '        <ca:services';
        if (services.water !== undefined) servicesTag += ` water="${services.water}"`;
        if (services.unmanaged_water !== undefined) servicesTag += ` unmanaged_water="${services.unmanaged_water}"`;
        if (services.food !== undefined) servicesTag += ` food="${services.food}"`;
        if (services.hot_food !== undefined) servicesTag += ` hot_food="${services.hot_food}"`;
        if (services.toilets !== undefined) servicesTag += ` toilets="${services.toilets}"`;
        if (services.medical !== undefined) servicesTag += ` medical="${services.medical}"`;
        if (services.sleep_area !== undefined) servicesTag += ` sleep_area="${services.sleep_area}"`;
        servicesTag += ' />\n';
        xml += servicesTag;
      }

      // Navigation alert
      const nav = station.navigation_alert;
      if (nav) {
        let navTag = '        <ca:navigation_alert';
        if (nav.severity) navTag += ` severity="${escapeXml(nav.severity)}"`;
        if (nav.turn_type) navTag += ` turn_type="${escapeXml(nav.turn_type)}"`;
        if (nav.prompt) navTag += ` prompt="${escapeXml(nav.prompt)}"`;
        navTag += ' />\n';
        xml += navTag;
      }

      xml += '      </ca:station>\n';
      xml += '    </extensions>\n';
    }

    xml += '  </wpt>\n';
  });

  // Trackpoints
  xml += '  <trk>\n';
  xml += `    <name>${escapeXml(route.name)}</name>\n`;
  xml += '    <trkseg>\n';
  route.trackpoints.forEach((pt) => {
    xml += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
    xml += `        <ele>${pt.ele.toFixed(2)}</ele>\n`;
    xml += '      </trkpt>\n';
  });
  xml += '    </trkseg>\n';
  xml += '  </trk>\n';
  xml += '</gpx>\n';

  return xml;
}

/**
 * Escapes special XML characters.
 * @param {string} str String to escape
 * @returns {string} Escaped string
 */
function escapeXml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
