# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import xml.etree.ElementTree as ET
import json
import math
import argparse
import os

# Constant to convert meters to miles (only used if we need to convert input miles to meters)
MILES_TO_METERS = 1609.344

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2) * math.sin(delta_phi/2) + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda/2) * math.sin(delta_lambda/2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c  # in meters

def calculate_cumulative_distances(trkpts, ns):
    distances = [0.0]
    total_dist = 0.0
    for i in range(1, len(trkpts)):
        lat1 = float(trkpts[i-1].get('lat'))
        lon1 = float(trkpts[i-1].get('lon'))
        lat2 = float(trkpts[i].get('lat'))
        lon2 = float(trkpts[i].get('lon'))
        
        dist = haversine(lat1, lon1, lat2, lon2)
        total_dist += dist
        distances.append(total_dist)
    return distances, total_dist

def find_closest_index(target_dist, cumulative_distances):
    min_diff = float('inf')
    closest_idx = 0
    for idx, dist in enumerate(cumulative_distances):
        diff = abs(dist - target_dist)
        if diff < min_diff:
            min_diff = diff
            closest_idx = idx
    return closest_idx

def find_turnaround_point(trkpts, cumulative_distances):
    """Finds the trackpoint where cumulative distance is closest to half of the total distance."""
    total_dist = cumulative_distances[-1]
    target_dist = total_dist / 2.0
    return find_closest_index(target_dist, cumulative_distances)


def find_multi_pass_intersection(trkpts, cumulative_distances, pass_nominal_distances_m, scale_factor, max_deviation_m=1000):
    """
    Finds a trackpoint near the first pass that minimizes the spatial distance
    to the trackpoints in the neighborhoods of the other passes.
    Uses spatial distance windows instead of index windows to prevent false matches.
    """
    if not pass_nominal_distances_m or len(pass_nominal_distances_m) < 2:
        return 0
        
    N = len(trkpts)
    scaled_distances = [d * scale_factor for d in pass_nominal_distances_m]
    
    # Find estimated index for first pass
    I1 = find_closest_index(scaled_distances[0], cumulative_distances)
    
    # Get search range for first pass (spatially)
    start_search = 0
    end_search = N - 1
    for i, dist in enumerate(cumulative_distances):
        if dist >= scaled_distances[0] - max_deviation_m:
            start_search = i
            break
    for i in range(N - 1, -1, -1):
        if cumulative_distances[i] <= scaled_distances[0] + max_deviation_m:
            end_search = i
            break
            
    best_idx = I1
    min_total_score = float('inf')
    
    # Prepare search ranges for other passes (spatially)
    other_ranges = []
    for d in scaled_distances[1:]:
        o_start = 0
        o_end = N - 1
        for i, dist in enumerate(cumulative_distances):
            if dist >= d - max_deviation_m:
                o_start = i
                break
        for i in range(N - 1, -1, -1):
            if cumulative_distances[i] <= d + max_deviation_m:
                o_end = i
                break
        other_ranges.append((o_start, o_end))
        
    print(f"Optimizing multi-pass intersection near first pass (search range: {cumulative_distances[start_search]/1000:.2f}km to {cumulative_distances[end_search]/1000:.2f}km)...")
    
    for c_idx in range(start_search, end_search + 1):
        c_pt = trkpts[c_idx]
        c_lat = float(c_pt.get('lat'))
        c_lon = float(c_pt.get('lon'))
        
        total_score = 0.0
        
        # For each other pass, find the minimum distance to the candidate within its spatial range
        for o_start, o_end in other_ranges:
            min_o_dist = float('inf')
            for j in range(o_start, o_end + 1):
                o_pt = trkpts[j]
                o_lat = float(o_pt.get('lat'))
                o_lon = float(o_pt.get('lon'))
                
                dist = haversine(c_lat, c_lon, o_lat, o_lon)
                if dist < min_o_dist:
                    min_o_dist = dist
                    
            total_score += min_o_dist
            
        if total_score < min_total_score:
            min_total_score = total_score
            best_idx = c_idx
            
    print(f"Multi-pass intersection snapping optimized: average divergence is {min_total_score / len(other_ranges):.2f} meters.")
    return best_idx

def reconcile(gpx_path, json_path, output_path, nominal_distance_m=None):
    print(f"Loading GPX from {gpx_path}...")
    ET.register_namespace('', 'http://www.topografix.com/GPX/1/1')
    ET.register_namespace('ca', 'http://coursearchitect.com/schema/v1')
    
    tree = ET.parse(gpx_path)
    root = tree.getroot()
    ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
    
    trkpts = root.findall('.//gpx:trkpt', ns)
    if not trkpts:
        print("Error: No trackpoints found in GPX.")
        return
        
    print(f"Found {len(trkpts)} trackpoints.")
    cumulative_distances, actual_distance_m = calculate_cumulative_distances(trkpts, ns)
    print(f"Actual GPX track distance: {actual_distance_m:.2f} meters ({actual_distance_m / 1000:.2f} km)")
    
    # Calculate scale factor for distance stretching
    scale_factor = 1.0
    if nominal_distance_m:
        scale_factor = actual_distance_m / nominal_distance_m
        print(f"Applying linear stretch factor: {scale_factor:.4f} (Nominal: {nominal_distance_m:.2f} meters)")
        
    print(f"Loading JSON from {json_path}...")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    stations = data.get('stations', [])
    print(f"Found {len(stations)} stations in JSON.")
    
    waypoints_to_add = []
    
    for station in stations:
        station_id = station.get('id')
        name = station.get('name')
        station_type = station.get('type')
        subtype = station.get('subtype')
        
        passes = station.get('passes', [])
        if not passes:
            continue
            
        # Determine the best trackpoint index for this station
        closest_idx = 0
        heuristic_applied = "None"
        
        override = station.get('coordinate_override')
        use_exact_override = False
        
        if override:
            override_lat = float(override.get('lat'))
            override_lon = float(override.get('lon'))
            # Find closest trackpoint to lock elevation
            min_spatial_dist = float('inf')
            for idx, pt in enumerate(trkpts):
                pt_lat = float(pt.get('lat'))
                pt_lon = float(pt.get('lon'))
                dist = haversine(override_lat, override_lon, pt_lat, pt_lon)
                if dist < min_spatial_dist:
                    min_spatial_dist = dist
                    closest_idx = idx
            
            lat = str(override_lat)
            lon = str(override_lon)
            use_exact_override = True
            heuristic_applied = f"Manual Coordinate Override (Elevation from Trackpoint {closest_idx}, spatial error: {min_spatial_dist:.1f}m)"
        else:
            # Check if any pass is a turnaround
            is_turnaround = False
            for p in passes:
                label = p.get('label', '').lower()
                if 'turnaround' in label or 'turn-around' in label:
                    is_turnaround = True
                    break
                    
            if is_turnaround:
                # Heuristic 3: Turnaround Snapping
                closest_idx = find_turnaround_point(trkpts, cumulative_distances)
                heuristic_applied = "Turnaround (Sequential Midpoint)"

            elif len(passes) > 1:
                # Heuristic 2: Multi-Pass Intersection Snapping (with spatial windows)
                pass_nominal_distances_m = [p.get('dist_m') for p in passes]
                # Using 1500 meters deviation for search window to be safe but restrictive
                closest_idx = find_multi_pass_intersection(trkpts, cumulative_distances, pass_nominal_distances_m, scale_factor, max_deviation_m=1500)
                heuristic_applied = "Multi-Pass Intersection Optimization (Spatial)"
            else:
                # Standard Snapping (Single Pass)
                first_pass = passes[0]
                nominal_pass_dist_m = first_pass.get('dist_m')
                snapped_pass_dist_m = nominal_pass_dist_m * scale_factor
                closest_idx = find_closest_index(snapped_pass_dist_m, cumulative_distances)
                heuristic_applied = "Standard Linear Snapping"
                
        target_pt = trkpts[closest_idx]
        if not use_exact_override:
            lat = target_pt.get('lat')
            lon = target_pt.get('lon')

        
        # Get elevation from GPX if available
        ele_elem = target_pt.find('gpx:ele', ns)
        ele = ele_elem.text if ele_elem is not None else "0.0"
        
        first_pass = passes[0]
        nominal_first_dist_m = first_pass.get('dist_m')
        print(f"Snapping {name} (nominal {nominal_first_dist_m:.1f}m -> scaled {nominal_first_dist_m * scale_factor:.1f}m) to trackpoint {closest_idx} (dist: {cumulative_distances[closest_idx]:.1f}m) using heuristic: {heuristic_applied}")
        
        # Create Waypoint Element
        wpt = ET.Element('{http://www.topografix.com/GPX/1/1}wpt', lat=lat, lon=lon)
        
        ele_sub = ET.SubElement(wpt, '{http://www.topografix.com/GPX/1/1}ele')
        ele_sub.text = ele
        
        name_sub = ET.SubElement(wpt, '{http://www.topografix.com/GPX/1/1}name')
        name_sub.text = name
        
        # Symbol injection based on POI category heuristics
        sym_name = "icons/services.svg"
        name_l = name.lower()
        if 'start' in name_l:
            sym_name = "icons/start.svg"
        elif 'finish' in name_l or '(end)' in name_l:
            sym_name = "icons/finish.svg"
        elif subtype == 'aid_station' or 'aid' in name_l or 'station' in name_l or 'checkpoint' in name_l:
            sym_name = "icons/aid_station.svg"
        elif subtype == 'water_source' or 'creek' in name_l or 'spring' in name_l or 'water' in name_l or 'well' in name_l or 'stream' in name_l:
            sym_name = "icons/water.svg"
        elif subtype == 'scenic' or 'viewpoint' in name_l or 'vista' in name_l or 'lookout' in name_l:
            sym_name = "icons/scenic.svg"
        elif subtype == 'campground' or 'camp' in name_l or 'campsite' in name_l:
            sym_name = "icons/campground.svg"
        elif subtype == 'refuge' or any(k in name_l for k in ['refuge', 'rifugio', 'shelter']):
            sym_name = "icons/refuge.svg"
        elif subtype == 'summit' or any(k in name_l for k in ['pass', 'col', 'summit', 'peak', 'saddle', 'tête', 'posettes']):
            sym_name = "icons/summit.svg"
            
        sym_sub = ET.SubElement(wpt, '{http://www.topografix.com/GPX/1/1}sym')
        sym_sub.text = sym_name
        
        # Description
        desc_parts = []
        for p in passes:
            p_num = p.get('num')
            p_dist_m = p.get('dist_m')
            p_label = p.get('label', '')
            desc_parts.append(f"Pass {p_num} at {p_dist_m/1000:.2f}km ({p_label})")
        desc_sub = ET.SubElement(wpt, '{http://www.topografix.com/GPX/1/1}desc')
        desc_sub.text = " | ".join(desc_parts)
        
        # Extensions
        extensions = ET.SubElement(wpt, '{http://www.topografix.com/GPX/1/1}extensions')
        
        ca_station = ET.SubElement(extensions, '{http://coursearchitect.com/schema/v1}station', 
                                   type=station_type, id=station_id)
        if subtype:
            ca_station.set('subtype', subtype)
            
        ca_passes = ET.SubElement(ca_station, '{http://coursearchitect.com/schema/v1}passes')
        for p in passes:
            ca_pass = ET.SubElement(ca_passes, '{http://coursearchitect.com/schema/v1}pass',
                                     num=str(p.get('num')),
                                     dist_m=str(p.get('dist_m')))
            if p.get('label'):
                ca_pass.set('label', p.get('label'))
            if p.get('cutoff_clock'):
                ca_pass.set('cutoff_clock', p.get('cutoff_clock'))
            if p.get('cutoff_elapsed'):
                ca_pass.set('cutoff_elapsed', p.get('cutoff_elapsed'))
                
        # Accessibility
        access = station.get('accessibility', {})
        if access:
            ca_access = ET.SubElement(ca_station, '{http://coursearchitect.com/schema/v1}accessibility')
            for k, v in access.items():
                ca_access.set(k, str(v).lower())
                
        # Services
        services = station.get('services', {})
        if services:
            ca_services = ET.SubElement(ca_station, '{http://coursearchitect.com/schema/v1}services')
            for k, v in services.items():
                ca_services.set(k, str(v).lower())
                
        # Navigation Alert
        nav_alert = station.get('navigation_alert')
        if nav_alert:
            ca_nav = ET.SubElement(ca_station, '{http://coursearchitect.com/schema/v1}navigation_alert')
            for k, v in nav_alert.items():
                ca_nav.set(k, str(v))
                
        waypoints_to_add.append(wpt)
        
    # Insert waypoints before the first <trk> element
    first_trk_idx = -1
    for idx, child in enumerate(root):
        if child.tag.endswith('trk'):
            first_trk_idx = idx
            break
            
    if first_trk_idx != -1:
        for wpt in reversed(waypoints_to_add):
            root.insert(first_trk_idx, wpt)
    else:
        for wpt in waypoints_to_add:
            root.append(wpt)
            
    print(f"Writing reconciled GPX to {output_path}...")
    tree.write(output_path, xml_declaration=True, encoding='utf-8')
    print("Done!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reconcile LLM Course JSON with GPX track (Metric version with spatial optimization).")
    parser.add_argument("--gpx", required=True, help="Path to input GPX file")
    parser.add_argument("--json", required=True, help="Path to input JSON file")
    parser.add_argument("--output", required=True, help="Path to output GPX file")
    parser.add_argument("--nominal_dist_m", type=float, help="Nominal distance of the course in meters (for stretching)")
    
    args = parser.parse_args()
    reconcile(args.gpx, args.json, args.output, args.nominal_dist_m)
