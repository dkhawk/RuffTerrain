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
  if (route.executionPlan) {
    xml += '    <extensions>\n';
    if (route.executionPlan.startTime || route.executionPlan.targetDurationHrs) {
      let rpTag = '      <ca:race_plan';
      if (route.executionPlan.startTime) rpTag += ` start_time="${escapeXml(route.executionPlan.startTime)}"`;
      if (route.executionPlan.targetDurationHrs !== undefined && route.executionPlan.targetDurationHrs !== null) {
        rpTag += ` target_duration_hrs="${route.executionPlan.targetDurationHrs}"`;
      }
      rpTag += ' />\n';
      xml += rpTag;
    }
    if (route.executionPlan.sectors && route.executionPlan.sectors.length > 0) {
      xml += '      <ca:execution_plan>\n';
      route.executionPlan.sectors.forEach(sec => {
        let sTag = `        <ca:sector start_dist_m="${sec.start_dist_m}" end_dist_m="${sec.end_dist_m}" name="${escapeXml(sec.name)}" target_pace_min="${sec.target_pace_min}"`;
        if (sec.terrain) sTag += ` terrain="${escapeXml(sec.terrain)}"`;
        sTag += '>\n';
        xml += sTag;
        if (sec.strategy) xml += `          <ca:strategy>${escapeXml(sec.strategy)}</ca:strategy>\n`;
        if (sec.nutrition) xml += `          <ca:nutrition>${escapeXml(sec.nutrition)}</ca:nutrition>\n`;
        xml += '        </ca:sector>\n';
      });
      xml += '      </ca:execution_plan>\n';
    }
    xml += '    </extensions>\n';
  }
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
          if (pass.target_arrival) {
            passTag += ` target_arrival="${escapeXml(pass.target_arrival)}"`;
          }
          if (pass.stretch_strategy) {
            passTag += ` stretch_strategy="${escapeXml(pass.stretch_strategy)}"`;
          }
          if (pass.eta_earliest) {
            passTag += ` eta_earliest="${escapeXml(pass.eta_earliest)}"`;
          }
          if (pass.eta_latest) {
            passTag += ` eta_latest="${escapeXml(pass.eta_latest)}"`;
          }
          if (pass.weather_cond) {
            passTag += ` weather_cond="${escapeXml(pass.weather_cond)}"`;
          }
          if (pass.weather_temp_c !== undefined && pass.weather_temp_c !== null) {
            passTag += ` weather_temp_c="${pass.weather_temp_c}"`;
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

      if (station.photo_url) {
        xml += `        <ca:photo_url>${escapeXml(station.photo_url)}</ca:photo_url>\n`;
      }

      xml += '      </ca:station>\n';
      xml += '    </extensions>\n';
    }

    xml += '  </wpt>\n';
  });

  // Trackpoints
  if (route.segments && route.segments.length > 1) {
    route.segments.forEach((seg) => {
      xml += '  <trk>\n';
      xml += `    <name>${escapeXml(seg.name)}</name>\n`;
      if (seg.desc) {
        xml += `    <desc>${escapeXml(seg.desc)}</desc>\n`;
      }
      xml += '    <trkseg>\n';
      for (let i = seg.startIndex; i <= seg.endIndex; i++) {
        const pt = route.trackpoints[i];
        if (pt) {
          xml += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
          xml += `        <ele>${pt.ele.toFixed(2)}</ele>\n`;
          xml += '      </trkpt>\n';
        }
      }
      xml += '    </trkseg>\n';
      xml += '  </trk>\n';
    });
  } else {
    xml += '  <trk>\n';
    const trkName = (route.segments && route.segments[0]?.name) || route.name;
    xml += `    <name>${escapeXml(trkName)}</name>\n`;
    if (route.segments && route.segments[0]?.desc) {
      xml += `    <desc>${escapeXml(route.segments[0].desc)}</desc>\n`;
    }
    xml += '    <trkseg>\n';
    route.trackpoints.forEach((pt) => {
      if (pt) {
        xml += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
        xml += `        <ele>${pt.ele.toFixed(2)}</ele>\n`;
        xml += '      </trkpt>\n';
      }
    });
    xml += '    </trkseg>\n';
    xml += '  </trk>\n';
  }
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
