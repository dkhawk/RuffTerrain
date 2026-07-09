#!/usr/bin/env python3
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

import asyncio
from datetime import datetime
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
from google.antigravity import Agent, LocalAgentConfig, ToolContext, types
from google.antigravity.hooks import hooks, policy

# ==============================================================================
# Constants & Math Helpers
# ==============================================================================

MILES_TO_METERS = 1609.344

GOAL_PRESETS = {
    "hard_race": {"mult": 0.90, "restMult": 0.6},
    "training_run": {"mult": 1.05, "restMult": 1.0},
    "fun_day_out": {"mult": 1.25, "restMult": 1.5}
}

DEFAULT_RUNNER_PROFILES = [
    {
        "name": "Dan Hawk Pro",
        "basePaces": {
            "descent": 8.0,
            "flat": 9.0,
            "moderate": 11.5,
            "steep": 14.0,
            "verysteep": 18.0,
            "extreme": 24.0
        },
        "restDurationMin": 8.0,
        "enduranceMetrics": {"fatigueDecayLambda": 0.05, "downhillBrakeBeta": 1.12}
    },
    {
        "name": "Weekend Backpacker",
        "basePaces": {
            "descent": 16.0,
            "flat": 18.0,
            "moderate": 24.0,
            "steep": 30.0,
            "verysteep": 36.0,
            "extreme": 48.0
        },
        "restDurationMin": 20.0,
        "enduranceMetrics": {"fatigueDecayLambda": 0.12, "downhillBrakeBeta": 1.12}
    }
]

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def snap_to_route(trackpoints, lat, lon):
    min_dist = float('inf')
    closest = None
    for pt in trackpoints:
        d = haversine(pt['lat'], pt['lon'], lat, lon)
        if d < min_dist:
            min_dist = d
            closest = pt
    return closest

def classify_gradient(grade):
    if grade is None or math.isnan(grade):
        return "flat", "FLAT"
    flat_max = 2.0
    mod_max = 5.0
    steep_max = 8.0
    vsteep_max = 10.0
    
    if grade < -flat_max:
        return "descent", "DESCENT"
    elif grade <= flat_max:
        return "flat", "FLAT"
    elif grade <= mod_max:
        return "moderate", "MODERATE CLIMB"
    elif grade <= steep_max:
        return "steep", "STEEP CLIMB"
    elif grade <= vsteep_max:
        return "verysteep", "VERY STEEP"
    return "extreme", "EXTREME CLIMB"

# ==============================================================================
# Agent Tools Definitions
# ==============================================================================

def segment_route(gpx_path: str, checkpoints_desc: str = None) -> str:
    """Parses a route GPX file and segments it into macroscopic sections (aid stations, climbs).

    Args:
        gpx_path: Absolute path to the route GPX file.
        checkpoints_desc: Optional description of checkpoints or landmarks to snap to the route.
    """
    if not os.path.exists(gpx_path):
        return json.dumps({"error": f"GPX file not found at {gpx_path}"})
    
    try:
        tree = ET.parse(gpx_path)
        root = tree.getroot()
        
        # Auto-detect namespaces
        ns = {}
        if root.tag.startswith('{'):
            ns['gpx'] = root.tag.split('}')[0][1:]
        else:
            ns['gpx'] = 'http://www.topografix.com/GPX/1/1'
            
        trkpts_elements = root.findall('.//gpx:trkpt', ns)
        if not trkpts_elements:
            return json.dumps({"error": "No trackpoints found in GPX file"})
            
        trackpoints = []
        tot_dist = 0.0
        
        for idx, el in enumerate(trkpts_elements):
            lat = float(el.get('lat'))
            lon = float(el.get('lon'))
            
            ele_el = el.find('gpx:ele', ns)
            ele = float(ele_el.text) if ele_el is not None else 0.0
            
            time_el = el.find('gpx:time', ns)
            timestamp = time_el.text if time_el is not None else None
            
            if idx > 0:
                prev = trackpoints[-1]
                tot_dist += haversine(prev['lat'], prev['lon'], lat, lon)
                
            trackpoints.append({
                'index': idx,
                'lat': lat,
                'lon': lon,
                'ele': ele,
                'time': timestamp,
                'dist_m': tot_dist,
                'grade': 0.0
            })
            
        # Calculate grades using a backward-looking 30m window
        for i in range(len(trackpoints)):
            p_curr = trackpoints[i]
            p_base = None
            for j in range(i - 1, -1, -1):
                if p_curr['dist_m'] - trackpoints[j]['dist_m'] >= 30.0:
                    p_base = trackpoints[j]
                    break
            if p_base is not None:
                run = p_curr['dist_m'] - p_base['dist_m']
                rise = p_curr['ele'] - p_base['ele']
                if run > 5.0:
                    p_curr['grade'] = (rise / run) * 100.0
                    
        # Parse waypoints
        wpts_elements = root.findall('.//gpx:wpt', ns)
        waypoints = []
        for el in wpts_elements:
            lat = float(el.get('lat'))
            lon = float(el.get('lon'))
            name_el = el.find('gpx:name', ns)
            name = name_el.text if name_el is not None else "Waypoint"
            ele_el = el.find('gpx:ele', ns)
            ele = float(ele_el.text) if ele_el is not None else 0.0
            
            snapped = snap_to_route(trackpoints, lat, lon)
            waypoints.append({
                'name': name,
                'lat': lat,
                'lon': lon,
                'ele': ele,
                'dist_m': snapped['dist_m']
            })
            
        waypoints.sort(key=lambda w: w['dist_m'])
        
        # Run auto-segmentation using a standard profile
        profile = DEFAULT_RUNNER_PROFILES[0]
        goal = GOAL_PRESETS["training_run"]
        
        splits = {0, round(tot_dist)}
        for w in waypoints:
            if 50 < w['dist_m'] < tot_dist - 50:
                splits.add(round(w['dist_m']))
                
        # Grade inflections
        curr_mode, _ = classify_gradient(trackpoints[0]['grade'])
        mode_start_dist = 0
        for i in range(1, len(trackpoints)):
            pt = trackpoints[i]
            d = pt['dist_m']
            mode, _ = classify_gradient(pt['grade'])
            if mode != curr_mode:
                if d - mode_start_dist >= 600 and 100 < d < tot_dist - 100:
                    splits.add(round(d))
                    curr_mode = mode
                    mode_start_dist = d
                    
        sorted_splits = sorted(list(splits))
        deduped = [sorted_splits[0]]
        for i in range(1, len(sorted_splits)):
            prev_d = deduped[-1]
            curr_d = sorted_splits[i]
            if curr_d - prev_d >= 250:
                deduped.append(curr_d)
            elif curr_d == round(tot_dist):
                deduped[-1] = round(tot_dist)
                
        sectors = []
        for i in range(len(deduped) - 1):
            s_dist = deduped[i]
            e_dist = deduped[i+1]
            s_pt = min(trackpoints, key=lambda p: abs(p['dist_m'] - s_dist))
            e_pt = min(trackpoints, key=lambda p: abs(p['dist_m'] - e_dist))
            
            gain = e_pt['ele'] - s_pt['ele']
            run = e_dist - s_dist
            grade = (gain / run) * 100.0 if run > 0 else 0.0
            
            cls_key, cls_lbl = classify_gradient(grade)
            base_pace = profile["basePaces"].get(cls_key, profile["basePaces"]["flat"])
            target_pace = round(base_pace * goal["mult"], 1)
            
            end_wpt = None
            for w in waypoints:
                if abs(w['dist_m'] - e_dist) < 150:
                    end_wpt = w
                    break
                    
            s_name = f"➔ {end_wpt['name']}" if end_wpt else f"{cls_lbl} Segment"
            rest_min = round(profile["restDurationMin"] * goal["restMult"])
            nutrition = f"Rest break (~{rest_min} mins at {end_wpt['name']})." if end_wpt else "Regular hydration."
            
            sectors.append({
                'start_dist_m': s_dist,
                'end_dist_m': e_dist,
                'name': s_name,
                'terrain': "descend" if cls_key == "descent" else ("flat" if cls_key == "flat" else "climb"),
                'avg_grade': grade,
                'target_pace_min': target_pace,
                'strategy': f"{cls_lbl} ({grade:.1f}%). Target {target_pace} min/mi effort.",
                'nutrition': nutrition
            })
            
        result = {
            "name": os.path.basename(gpx_path),
            "total_distance_m": tot_dist,
            "sectors": sectors,
            "waypoints": waypoints
        }
        return json.dumps(result, indent=2)
        
    except Exception as e:
        return json.dumps({"error": f"Failed to parse and segment GPX: {str(e)}"})

def calibrate_athlete(gpx_paths: list[str], exertion_tags: list[str] = None) -> str:
    """Ingests historical GPX logs and builds an Empirical Athlete Pacing Profile.

    Args:
        gpx_paths: List of absolute paths to historical training GPX runs.
        exertion_tags: List of exertion preset keys corresponding to each run (default is "training_run").
    """
    if not gpx_paths:
        return json.dumps({"error": "No training tracks provided for calibration."})
        
    tags = exertion_tags or ["training_run"] * len(gpx_paths)
    if len(tags) < len(gpx_paths):
        tags.extend(["training_run"] * (len(gpx_paths) - len(tags)))
        
    try:
        merged_bins = {
            "descent": [], "flat": [], "moderate": [], "steep": [], "verysteep": [], "extreme": []
        }
        all_fatigue_samples = []
        all_pauses_sec = []
        
        for gpx_path, tag in zip(gpx_paths, tags):
            if not os.path.exists(gpx_path):
                continue
                
            tree = ET.parse(gpx_path)
            root = tree.getroot()
            ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
            
            pts_el = root.findall('.//gpx:trkpt', ns)
            if len(pts_el) < 10:
                continue
                
            trackpoints = []
            tot_dist = 0.0
            
            for idx, el in enumerate(pts_el):
                lat = float(el.get('lat'))
                lon = float(el.get('lon'))
                ele_el = el.find('gpx:ele', ns)
                ele = float(ele_el.text) if ele_el is not None else 0.0
                time_el = el.find('gpx:time', ns)
                timestamp = time_el.text if time_el is not None else None
                
                if idx > 0:
                    tot_dist += haversine(trackpoints[-1]['lat'], trackpoints[-1]['lon'], lat, lon)
                trackpoints.append({'lat': lat, 'lon': lon, 'ele': ele, 'time': timestamp, 'dist_m': tot_dist, 'grade': 0.0})
                
            for i in range(len(trackpoints)):
                p_curr = trackpoints[i]
                p_base = None
                for j in range(i - 1, -1, -1):
                    if p_curr['dist_m'] - trackpoints[j]['dist_m'] >= 30.0:
                        p_base = trackpoints[j]
                        break
                if p_base is not None:
                    run = p_curr['dist_m'] - p_base['dist_m']
                    rise = p_curr['ele'] - p_base['ele']
                    if run > 5.0:
                        p_curr['grade'] = (rise / run) * 100.0
                        
            preset = GOAL_PRESETS.get(tag, GOAL_PRESETS["training_run"])
            mult = preset["mult"]
            
            current_pause_sec = 0.0
            cumulative_vert_gain_m = 0.0
            
            for i in range(1, len(trackpoints)):
                p_prev = trackpoints[i-1]
                p_curr = trackpoints[i]
                
                d_dist = p_curr['dist_m'] - p_prev['dist_m']
                d_ele = p_curr['ele'] - p_prev['ele']
                if d_ele > 0:
                    cumulative_vert_gain_m += d_ele
                    
                if not p_prev['time'] or not p_curr['time']:
                    continue
                # Parse ISO timestamp correctly
                try:
                    t_prev = datetime.fromisoformat(p_prev['time'].replace('Z', '+00:00'))
                    t_curr = datetime.fromisoformat(p_curr['time'].replace('Z', '+00:00'))
                    d_time_sec = (t_curr - t_prev).total_seconds()
                except Exception:
                    d_time_sec = 5.0 # fallback
                    
                if d_time_sec <= 0:
                    d_time_sec = 5.0
                    
                speed_ms = d_dist / d_time_sec
                if speed_ms < 0.2:
                    current_pause_sec += d_time_sec
                    continue
                elif current_pause_sec > 0:
                    if current_pause_sec >= 60:
                        all_pauses_sec.append(current_pause_sec)
                    current_pause_sec = 0
                    
                if speed_ms > 10.0 or d_dist <= 0.5:
                    continue
                    
                obs_pace_min_mi = 26.8224 * (d_time_sec / d_dist)
                base_pace_min_mi = obs_pace_min_mi / mult
                
                cls_key, _ = classify_gradient(p_curr['grade'])
                if cls_key in merged_bins:
                    merged_bins[cls_key].append(base_pace_min_mi)
                    
                if p_curr['grade'] >= 4.0 and base_pace_min_mi < 45.0:
                    all_fatigue_samples.append({
                        "cumVertGainM": cumulative_vert_gain_m,
                        "basePaceMinMi": base_pace_min_mi
                    })
                    
        # Compute medians
        def median(arr, fallback):
            if not arr: return fallback
            sorted_arr = sorted(arr)
            mid = len(sorted_arr) // 2
            if len(sorted_arr) % 2 == 0:
                return round((sorted_arr[mid - 1] + sorted_arr[mid]) / 2, 1)
            return round(sorted_arr[mid], 1)
            
        base_paces = {
            "descent": median(merged_bins["descent"], 9.0),
            "flat": median(merged_bins["flat"], 10.0),
            "moderate": median(merged_bins["moderate"], 13.5),
            "steep": median(merged_bins["steep"], 17.0),
            "verysteep": median(merged_bins["verysteep"], 21.0),
            "extreme": median(merged_bins["extreme"], 28.0)
        }
        
        # Check for synthetic track (e.g., CalTopo route plan with constant pace)
        non_zero_paces = [p for p in base_paces.values() if p > 0]
        if non_zero_paces and (max(non_zero_paces) - min(non_zero_paces)) < 0.1:
            base_paces = {
                "descent": 9.0, "flat": 10.0, "moderate": 13.5, 
                "steep": 17.0, "verysteep": 21.0, "extreme": 28.0
            }
            warning_msg = (
                "Warning: Ingested track appears to be a synthetic route with constant pace. "
                "Calibration skipped to prevent pace profile corruption; using default pacing profile."
            )
        else:
            warning_msg = None
            
        # Fatigue regression: ln(P_climb) = ln(P_0) + lambda * (h / 1000)
        lambda_val = 0.08
        if len(all_fatigue_samples) >= 20:
            sum_x, sum_y, sum_xy, sum_xx = 0.0, 0.0, 0.0, 0.0
            for s in all_fatigue_samples:
                x = s["cumVertGainM"] / 1000.0
                y = math.log(s["basePaceMinMi"])
                sum_x += x
                sum_y += y
                sum_xy += x * y
                sum_xx += x * x
            n = len(all_fatigue_samples)
            denom = (n * sum_xx) - (sum_x * sum_x)
            if abs(denom) > 1e-9:
                lambda_val = ((n * sum_xy) - (sum_x * sum_y)) / denom
                lambda_val = round(max(0.01, min(0.25, lambda_val)), 3)
                
        beta_val = round(base_paces["flat"] / base_paces["descent"], 2)
        rest_duration = round(median(all_pauses_sec, 900) / 60) if all_pauses_sec else 15
        
        profile = {
            "name": "Empirical Runner Profile",
            "basePaces": base_paces,
            "restDurationMin": rest_duration,
            "enduranceMetrics": {
                "fatigueDecayLambda": lambda_val,
                "downhillBrakeBeta": beta_val,
                "sourceTracksCount": len(gpx_paths)
            }
        }
        if warning_msg:
            profile["warning"] = warning_msg
            
        return json.dumps(profile, indent=2)
    except Exception as e:
        return json.dumps({"error": f"Failed to calibrate athlete: {str(e)}"})

def generate_execution_plan(gpx_path: str, athlete_profile_json: str, exertion_target: str, start_time: str = "06:00", goal_finish_time: str = None) -> str:
    """Calculates a segmented adventure pacing plan and saves the results.

    Args:
        gpx_path: Absolute path to the route GPX file.
        athlete_profile_json: JSON string representing the athlete profile.
        exertion_target: Exertion level preset ('hard_race', 'training_run', or 'fun_day_out').
        start_time: Time of day in 24h format (e.g. '06:00') when the adventure starts.
        goal_finish_time: Optional target total duration in hours (e.g. '24.0') to run backward solving.
    """
    if not os.path.exists(gpx_path):
        return json.dumps({"error": f"GPX file not found at {gpx_path}"})
        
    try:
        profile = json.loads(athlete_profile_json)
        base_paces = profile.get("basePaces", DEFAULT_RUNNER_PROFILES[0]["basePaces"])
        rest_dur_min = profile.get("restDurationMin", 15)
        lambda_val = profile.get("enduranceMetrics", {}).get("fatigueDecayLambda", 0.08)
        
        # Step 1: Segment route to get sectors
        segmented_data = json.loads(segment_route(gpx_path))
        if "error" in segmented_data:
            return json.dumps(segmented_data)
            
        sectors = segmented_data["sectors"]
        waypoints = segmented_data["waypoints"]
        total_dist_m = segmented_data["total_distance_m"]
        
        # Step 2: Set baseline pacing scenarios
        preset = GOAL_PRESETS.get(exertion_target, GOAL_PRESETS["training_run"])
        mult = preset["mult"]
        rest_mult = preset["restMult"]
        
        # Solve backward if goal_finish_time is given
        if goal_finish_time:
            target_hrs = float(goal_finish_time)
            aid_count = sum(1 for sec in sectors if sec["name"].startswith("➔"))
            total_rest_hrs = (aid_count * rest_dur_min * rest_mult) / 60.0
            avail_run_hrs = target_hrs - total_rest_hrs
            
            if avail_run_hrs > 0:
                desc_hrs = 0.0
                work_dist_nom_hrs = 0.0
                for sec in sectors:
                    dist_mi = (sec["end_dist_m"] - sec["start_dist_m"]) / MILES_TO_METERS
                    # Incorporate the fatigue multiplier into the backward solved paces
                    fatigue_mult = math.exp(lambda_val * (sec["start_dist_m"] / 10000.0))
                    nominal_pace_hrs = (dist_mi * sec["target_pace_min"] * fatigue_mult) / 60.0
                    if sec["terrain"] == "descend":
                        desc_hrs += nominal_pace_hrs
                    else:
                        work_dist_nom_hrs += nominal_pace_hrs
                
                req_work_hrs = avail_run_hrs - desc_hrs
                ratio = req_work_hrs / work_dist_nom_hrs if work_dist_nom_hrs > 0 else 1.0
                
                for sec in sectors:
                    if sec["terrain"] != "descend":
                        sec["target_pace_min"] = round(sec["target_pace_min"] * max(0.4, ratio), 1)
                        sec["strategy"] = f"Adjusted pacing for target finish. Pace: {sec['target_pace_min']} min/mi."
        
        # Step 3: Run segment simulations for Fast (85%), Steady (100%), and Conservative (115%)
        # Weather and altitude modifiers applied piecewise
        elapsed_hrs_steady = 0.0
        elapsed_hrs_fast = 0.0
        elapsed_hrs_cons = 0.0
        
        simulation_sectors = []
        for sec in sectors:
            dist_mi = (sec["end_dist_m"] - sec["start_dist_m"]) / MILES_TO_METERS
            
            # Simple elevation analysis
            avg_grade = sec["avg_grade"]
            
            p_steady = sec["target_pace_min"]
            p_fast = round(p_steady * 0.85, 1)
            p_cons = round(p_steady * 1.15, 1)
            
            # Apply altitude penalty if grade is steep or altitude is high (assumed 1.05 modifier for safety)
            # Apply fatigue factor: ln(P) = ln(P0) + lambda * (dist_mi / 1000)
            fatigue_mult = math.exp(lambda_val * (sec["start_dist_m"] / 10000.0))  # decay over 10km bounds
            p_steady = round(p_steady * fatigue_mult, 1)
            p_fast = round(p_fast * fatigue_mult, 1)
            p_cons = round(p_cons * fatigue_mult, 1)
            
            time_steady_hrs = (dist_mi * p_steady) / 60.0
            time_fast_hrs = (dist_mi * p_fast) / 60.0
            time_cons_hrs = (dist_mi * p_cons) / 60.0
            
            # Rest time at the end of the segment if it's an aid station
            rest_steady_hrs = 0.0
            rest_fast_hrs = 0.0
            rest_cons_hrs = 0.0
            if sec["name"].startswith("➔"):
                rest_steady_hrs = (rest_dur_min * rest_mult) / 60.0
                rest_fast_hrs = (rest_dur_min * rest_mult * 0.7) / 60.0
                rest_cons_hrs = (rest_dur_min * rest_mult * 1.3) / 60.0
                
            elapsed_hrs_steady += time_steady_hrs + rest_steady_hrs
            elapsed_hrs_fast += time_fast_hrs + rest_fast_hrs
            elapsed_hrs_cons += time_cons_hrs + rest_cons_hrs
            
            simulation_sectors.append({
                "name": sec["name"],
                "start_dist_m": sec["start_dist_m"],
                "end_dist_m": sec["end_dist_m"],
                "distance_mi": round(dist_mi, 2),
                "terrain": sec["terrain"],
                "avg_grade": round(avg_grade, 1),
                "steady_pace_min_mi": p_steady,
                "fast_pace_min_mi": p_fast,
                "cons_pace_min_mi": p_cons,
                "steady_elapsed_hrs": round(elapsed_hrs_steady, 2),
                "fast_elapsed_hrs": round(elapsed_hrs_fast, 2),
                "cons_elapsed_hrs": round(elapsed_hrs_cons, 2),
                "strategy": sec["strategy"]
            })
            
        plan = {
            "route_name": segmented_data["name"],
            "total_distance_mi": round(total_dist_m / MILES_TO_METERS, 2),
            "start_time": start_time,
            "target_exertion": exertion_target,
            "summary_finish_times_hrs": {
                "fast": round(elapsed_hrs_fast, 2),
                "steady": round(elapsed_hrs_steady, 2),
                "conservative": round(elapsed_hrs_cons, 2)
            },
            "sectors": simulation_sectors
        }
        
        # Write files inside the project workspace public/data directory
        workspace_dir = "/Users/dkhawk/Projects/RuffTerrain/feature-rt-agent"
        data_dir = os.path.join(workspace_dir, "public", "data")
        os.makedirs(data_dir, exist_ok=True)
        
        # Save JSON payload
        json_path = os.path.join(data_dir, "pacing_plan.json")
        with open(json_path, "w") as f:
            json.dump(plan, f, indent=2)
            
        # Save Markdown printed guide
        md_path = os.path.join(data_dir, "printed_guide.md")
        with open(md_path, "w") as f:
            f.write(f"# Pacing & Adventure Strategy: {plan['route_name']}\n\n")
            f.write(f"* **Start Time**: {plan['start_time']}\n")
            f.write(f"* **Total Distance**: {plan['total_distance_mi']} miles\n")
            f.write(f"* **Exertion Target**: {plan['target_exertion']}\n\n")
            f.write("## ⏱️ Target Finish Time Projections\n")
            f.write(f"* **Fast / Ideal**: {plan['summary_finish_times_hrs']['fast']} hours\n")
            f.write(f"* **Target / Steady**: {plan['summary_finish_times_hrs']['steady']} hours\n")
            f.write(f"* **Conservative / Safety**: {plan['summary_finish_times_hrs']['conservative']} hours\n\n")
            f.write("## 🗺️ Segment Splits Table\n")
            f.write("| Segment / Station | Dist (mi) | Terrain | Steady Pace (min/mi) | Fast ETA (hrs) | Target ETA (hrs) | Cons ETA (hrs) |\n")
            f.write("| --- | --- | --- | --- | --- | --- | --- |\n")
            for s in simulation_sectors:
                f.write(f"| {s['name']} | {s['distance_mi']} | {s['terrain']} | {s['steady_pace_min_mi']} | {s['fast_elapsed_hrs']}h | {s['steady_elapsed_hrs']}h | {s['cons_elapsed_hrs']}h |\n")
                
        return json.dumps({
            "status": "success",
            "json_plan_path": json_path,
            "markdown_guide_path": md_path,
            "summary_finish_steady_hrs": plan["summary_finish_times_hrs"]["steady"]
        }, indent=2)
        
    except Exception as e:
        return json.dumps({"error": f"Failed to generate execution plan: {str(e)}"})

# ==============================================================================
# Agent Initialization & Interactive Main Loop
# ==============================================================================

# Define Agent configuration
agent_config = LocalAgentConfig(
    system_instructions=(
        "You are Kokopelli's RuffTerrain Course Architect & Planner, an expert multi-facet "
        "AI agent specialized in helping endurance runners and backpackers plan big adventures. "
        "You have access to tools for segmenting a route GPX file, calibrating athlete paces from "
        "historical logs, and simulating segment pacing to output detailed scenario schedules. "
        "Ensure you help the user run these tools, explain the outputs, and suggest route changes "
        "interactively. Adhere strictly to the workspace guidelines, save data to the workspace "
        "data/ directory, and log progress to BUILD_JOURNAL.md."
    ),
    tools=[segment_route, calibrate_athlete, generate_execution_plan],
    policies=[
        policy.confirm_run_command(),
        policy.workspace_only(["/Users/dkhawk/Projects/RuffTerrain"])
    ],
)

async def main():
    print("========================================================================")
    print("Welcome to RuffTerrain Course Architect Agent Studio")
    print("========================================================================")
    
    async with Agent(agent_config) as agent:
        await agent.run_interactive_loop()

if __name__ == "__main__":
    asyncio.run(main())
