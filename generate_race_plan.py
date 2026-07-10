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

"""
generate_race_plan.py
=====================
Automated Multi-Loop & Multi-Scenario Race Execution Plan Generator for RuffTerrain.

Literate Programming Documentation
----------------------------------
This script transforms a base 1-loop GPX course (equipped with `<ca:sector>` pacing blocks)
into a production-ready, multi-loop, multi-scenario race execution package consisting of:
  1. A master multi-scenario CSV spreadsheet (`.csv`) for crew and Excel planning.
  2. A responsive, print-ready HTML race matrix (`.html`) styled in Landscape mode.
  3. An authoritative, high-resolution Landscape PDF (`.pdf`) rendered via headless Chrome.
  4. An enriched Course Architect GPX (`.gpx`) containing all trackpoints, sectors, and
     multi-pass waypoint schedules (`<ca:station>` and `<ca:passes>`).

Mathematical Principles of Pacing & Fatigue Distribution
--------------------------------------------------------
When generating across multiple finishing-time scenarios (`T_goal`), the engine preserves
the relative terrain profile of the base course while applying two distinct fatigue models:

1. **Loop Fatigue Penalty (`--loop-penalty-min`)**:
   For each main loop `k` after Loop 1, a constant time penalty `(k - 1) * delta_L` is added.
   To preserve exact target times without distortion across unequal sector lengths, this time
   penalty is distributed proportionally across all `N` sectors of Loop `k` based on their distance:
     `pace_sector(k, i) = base_pace(i) * scale_factor + (delta_L / total_loop_miles)`

2. **Late-Race Out-and-Back Fatigue Factor (`--ob-fatigue-factor`)**:
   When appending a flat out-and-back leg at the end of an ultra distance (e.g., miles 45 to 50),
   the runner's pace must be modeled slower than the average pace of the preceding loop (`Loop K`).
   The engine computes the remaining target duration (`T_remaining = T_goal - sum(Loop_Times)`)
   and verifies/enforces that `pace_OB > pace_Loop_K`.

Usage Example
-------------
```bash
python3 generate_race_plan.py \
  --base-gpx enhanced_leadiots_fitty_1_loop.gpx.bak \
  --loops 3 --direction alternating --loop-penalty-min 20.0 \
  --append-out-and-back-mi 5.0 --ob-fatigue-factor 1.15 \
  --scenarios "Optimistic:12.0,Sub-Goal:13.0,Goal:14.0,Max:15.0" \
  --start-time "2026-07-10T20:00:00" \
  --name "Ruff Terrain Ultra - 50-Mile Master Plan" \
  --out-prefix "ruff_terrain_50_miler_auto" \
  --landscape --no-cutoffs
```
"""

import argparse
import csv
from datetime import datetime, timedelta
import html
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

# Register namespaces so output GPX elements remain clean
NS_MAP = {
    "gpx": "http://www.topografix.com/GPX/1/1",
    "ca": "http://coursearchitect.com/schema/v1",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance"
}
for prefix, uri in NS_MAP.items():
    if prefix != "gpx":
        ET.register_namespace(prefix, uri)
    else:
        ET.register_namespace("", uri)


def format_pace(pace_min_per_mi: float) -> str:
    """Formats decimal minutes/mile into a standard MM:SS string."""
    m = int(pace_min_per_mi)
    s = int(round((pace_min_per_mi - m) * 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def format_elapsed(el_min: float) -> str:
    """Formats cumulative elapsed minutes into human-readable Xh Ym format."""
    h = int(el_min // 60)
    m = int(round(el_min % 60))
    if m == 60:
        h += 1
        m = 0
    return f"{h}h {m:02d}m" if h > 0 else f"{m}m"


class RacePlanBuilder:
    def __init__(self, args):
        self.args = args
        self.start_time = datetime.fromisoformat(args.start_time)
        self.scenarios = self._parse_scenarios(args.scenarios)
        self.base_tree = ET.parse(args.base_gpx)
        self.base_root = self.base_tree.getroot()
        self.base_sectors = self._extract_base_sectors()
        self.base_loop_dist_m = sum(s["dist_m"] for s in self.base_sectors)
        self.base_loop_dist_mi = self.base_loop_dist_m / 1609.344
        self.base_loop_time_min = sum((s["dist_m"] / 1609.344) * s["pace"] for s in self.base_sectors)
        
        # Calculate total spatial distance
        self.total_dist_mi = (self.base_loop_dist_mi * args.loops) + args.append_out_and_back_mi
        self.total_dist_m = self.total_dist_mi * 1609.344
        self.scenario_data = {}

    def _parse_scenarios(self, scenarios_str: str) -> dict:
        """Parses scenario string (e.g., 'Optimistic:12.0,Goal:14.0') into structured dictionary."""
        result = {}
        for item in scenarios_str.split(","):
            if ":" not in item:
                continue
            name, hrs = item.split(":")
            result[name.strip()] = float(hrs.strip()) * 60.0
        return result

    def _extract_base_sectors(self) -> list:
        """Extracts baseline sectors and strategies from the input GPX."""
        sectors = []
        for sec in self.base_root.findall(".//ca:sector", NS_MAP):
            start_m = float(sec.attrib["start_dist_m"])
            end_m = float(sec.attrib["end_dist_m"])
            pace = float(sec.attrib["target_pace_min"])
            strat = sec.find("ca:strategy", NS_MAP)
            strat_text = strat.text if strat is not None and strat.text else ""
            sectors.append({
                "name": sec.attrib["name"],
                "start_m": start_m,
                "end_m": end_m,
                "dist_m": end_m - start_m,
                "pace": pace,
                "strat": strat_text
            })
        if not sectors:
            raise ValueError("No <ca:sector> elements found in base GPX file.")
        return sectors

    def build_all(self):
        """Executes all four stages of the race plan automation engine."""
        print("⚡ Stage 1: Solving multi-scenario pacing and fatigue matrices...")
        self._solve_scenarios()
        
        print("⚡ Stage 2: Generating master CSV planning spreadsheet...")
        self._generate_csv()
        
        print("⚡ Stage 3: Generating responsive HTML matrix with Landscape CSS...")
        html_path = self._generate_html()
        
        print("⚡ Stage 4: Compiling print-ready Landscape PDF via Headless Chrome...")
        self._compile_pdf(html_path)
        
        print("⚡ Stage 5: Updating Course Architect GPX with multi-pass schedules...")
        self._generate_gpx()
        print("✅ Full automation pipeline completed successfully!")

    def _solve_scenarios(self):
        """Solves sector paces across all loops and out-and-back legs for each target scenario."""
        for sname, total_target_min in self.scenarios.items():
            # Calculate total loop penalties added across loops 2..K
            # Loop 1 gets 0 penalty, Loop 2 gets +delta_L, Loop 3 gets +2*delta_L...
            total_loop_penalties = sum((k - 1) * self.args.loop_penalty_min for k in range(1, self.args.loops + 1))
            
            # If out-and-back exists, estimate out-and-back duration
            # We want pace_OB > average pace of final loop
            ob_dist_mi = self.args.append_out_and_back_mi
            if ob_dist_mi > 0:
                # Solve for base scaling factor s_scale such that:
                # loops_time = sum(base_loop_time * s_scale + (k-1)*penalty)
                # ob_time = total_target_min - loops_time
                # where ob_time / ob_dist_mi = (base_loop_pace * s_scale + final_loop_penalty) * ob_fatigue_factor
                final_loop_penalty_pace = ((self.args.loops - 1) * self.args.loop_penalty_min) / self.base_loop_dist_mi
                base_avg_pace = self.base_loop_time_min / self.base_loop_dist_mi
                
                # We solve algebraically for s_scale
                # loops_time = (s_scale * self.base_loop_time_min * self.args.loops) + total_loop_penalties
                # ob_time = ob_dist_mi * (base_avg_pace * s_scale + final_loop_penalty_pace) * self.args.ob_fatigue_factor
                # loops_time + ob_time = total_target_min
                coeff = (self.base_loop_time_min * self.args.loops) + (ob_dist_mi * base_avg_pace * self.args.ob_fatigue_factor)
                const_term = total_loop_penalties + (ob_dist_mi * final_loop_penalty_pace * self.args.ob_fatigue_factor)
                s_scale = (total_target_min - const_term) / coeff
            else:
                s_scale = (total_target_min - total_loop_penalties) / (self.base_loop_time_min * self.args.loops)

            # Build exact sector list for this scenario
            sectors = []
            cur_m = 0.0

            for loop_idx in range(1, self.args.loops + 1):
                loop_penalty_min = (loop_idx - 1) * self.args.loop_penalty_min
                loop_pace_add = loop_penalty_min / self.base_loop_dist_mi
                is_reverse = (self.args.direction == "alternating" and loop_idx % 2 == 0)
                
                loop_sectors = list(reversed(self.base_sectors)) if is_reverse else self.base_sectors
                
                for sec in loop_sectors:
                    sec_dist_m = sec["dist_m"]
                    sec_pace = (sec["pace"] * s_scale) + loop_pace_add
                    
                    name = sec["name"]
                    if is_reverse:
                        parts = name.split(" to ")
                        name = f"{parts[1]} to {parts[0]}" if len(parts) == 2 else f"{name} (Reverse)"
                        name = name.replace("Course Finish", "Marshall Mesa Trailhead")
                    
                    mph = 60.0 / sec_pace if sec_pace > 0 else 0.0
                    dir_tag = "🔄 Reverse (CW)" if is_reverse else "Forward (CCW)"
                    strat_str = f"Hold {mph:.1f} mph ({dir_tag}, Loop {loop_idx})"
                    
                    sectors.append({
                        "loop": loop_idx,
                        "name": name,
                        "start_m": cur_m,
                        "end_m": cur_m + sec_dist_m,
                        "dist_m": sec_dist_m,
                        "pace": sec_pace,
                        "strat": strat_str
                    })
                    cur_m += sec_dist_m

            # Append out and back if requested
            if ob_dist_mi > 0:
                # Calculate remaining exact minutes to guarantee hitting total_target_min precisely
                accum_time = sum((s["dist_m"] / 1609.344) * s["pace"] for s in sectors)
                ob_time_min = total_target_min - accum_time
                ob_pace = ob_time_min / ob_dist_mi
                half_ob_m = (ob_dist_mi * 1609.344) / 2.0
                
                sectors.append({
                    "loop": self.args.loops + 1,
                    "name": "Marshall Mesa to Outbound Turnaround (Flat Leg)",
                    "start_m": cur_m,
                    "end_m": cur_m + half_ob_m,
                    "dist_m": half_ob_m,
                    "pace": ob_pace,
                    "strat": f"Hold {60.0/ob_pace:.1f} mph (Late-Race Outbound Flat Leg)"
                })
                cur_m += half_ob_m
                sectors.append({
                    "loop": self.args.loops + 1,
                    "name": "Outbound Turnaround to Course Finish (Inbound Flat)",
                    "start_m": cur_m,
                    "end_m": cur_m + half_ob_m,
                    "dist_m": half_ob_m,
                    "pace": ob_pace,
                    "strat": f"Hold {60.0/ob_pace:.1f} mph (Final Inbound Leg to Finish!)"
                })
                cur_m += half_ob_m

            # Build checkpoint progression (start + every sector end)
            checkpoints = [{
                "name": "Marshall Mesa Trailhead",
                "loop": 1,
                "dist_mi": 0.0,
                "el_min": 0.0,
                "eta_str": self.start_time.strftime("%a %I:%M %p"),
                "el_str": "0m",
                "pace_str": "--",
                "notes": "Race Start"
            }]
            
            el = 0.0
            for sec in sectors:
                t = (sec["dist_m"] / 1609.344) * sec["pace"]
                el += t
                parts = sec["name"].split(" to ")
                dest = parts[1] if len(parts) == 2 else sec["name"]
                
                # Clean up loop boundaries
                if abs(sec["end_m"] - self.base_loop_dist_m) < 1.0:
                    dest = "Marshall Mesa Trailhead (L1 Finish / L2 Start)"
                elif abs(sec["end_m"] - self.base_loop_dist_m * 2.0) < 1.0:
                    dest = "Marshall Mesa Trailhead (L2 Finish / L3 Start)"
                elif abs(sec["end_m"] - self.base_loop_dist_m * 3.0) < 1.0:
                    dest = "Marshall Mesa Trailhead (L3 Finish / Out-and-Back Start)"
                elif abs(sec["end_m"] - self.total_dist_m) < 1.0:
                    dest = "Course Finish (Marshall Mesa Trailhead)"

                eta = self.start_time + timedelta(minutes=el)
                checkpoints.append({
                    "name": dest,
                    "loop": sec["loop"],
                    "dist_mi": sec["end_m"] / 1609.344,
                    "el_min": el,
                    "eta_str": eta.strftime("%a %I:%M %p"),
                    "el_str": format_elapsed(el),
                    "pace_str": format_pace(sec["pace"]),
                    "notes": sec["strat"]
                })

            self.scenario_data[sname] = {
                "sectors": sectors,
                "checkpoints": checkpoints
            }

    def _generate_csv(self):
        """Generates the master multi-scenario planning spreadsheet (.csv)."""
        csv_path = f"{self.args.out_prefix}.csv"
        snames = list(self.scenarios.keys())
        primary_scenario = snames[len(snames) // 2]  # use middle/goal scenario as structure baseline

        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([f"{self.args.name.upper()} - MASTER PLANNING SPREADSHEET"])
            writer.writerow(["Start Time:", self.start_time.strftime("%A, %b %d, %Y at %I:%M %p")])
            writer.writerow(["Total Distance:", f"{self.total_dist_mi:.2f} Miles ({self.total_dist_mi * 1.60934:.2f} km)"])
            writer.writerow(["Official Cutoff:", "NONE (Self-Supported / Personal C-Goal Limit)" if self.args.no_cutoffs else "Official Cutoffs Enforced"])
            writer.writerow([])

            # Section 1: Checkpoint Matrix
            writer.writerow(["--- SECTION 1: SIDE-BY-SIDE AID STATION ARRIVAL TIMELINE (ETA) ---"])
            headers = ["Checkpoint / Aid Station", "Loop #", "Cum. Distance (mi)", "Cum. Distance (km)"]
            for sname in snames:
                headers.extend([f"{sname} ETA", f"{sname} Elapsed", f"{sname} Pace"])
            if not self.args.no_cutoffs:
                headers.append("Official Cutoff Time")
            writer.writerow(headers)

            for idx in range(len(self.scenario_data[primary_scenario]["checkpoints"])):
                row = []
                cp_base = self.scenario_data[primary_scenario]["checkpoints"][idx]
                row.extend([
                    cp_base["name"],
                    f"Loop {cp_base['loop']}",
                    f"{cp_base['dist_mi']:.2f}",
                    f"{cp_base['dist_mi'] * 1.60934:.2f}"
                ])
                for sname in snames:
                    cp = self.scenario_data[sname]["checkpoints"][idx]
                    row.extend([cp["eta_str"], cp["el_str"], cp["pace_str"]])
                writer.writerow(row)

            writer.writerow([])
            writer.writerow([])
            # Section 2: Detailed Sector Splits
            writer.writerow(["--- SECTION 2: DETAILED SECTOR SPLITS & STRATEGY ---"])
            sec_headers = ["Sector #", "Loop #", "Sector Description", "Sector Distance (mi)"]
            for sname in snames:
                sec_headers.extend([f"{sname} Pace", f"{sname} Leg Time"])
            sec_headers.append("Terrain / Strategy Notes")
            writer.writerow(sec_headers)

            for idx in range(len(self.scenario_data[primary_scenario]["sectors"])):
                row = []
                sec_base = self.scenario_data[primary_scenario]["sectors"][idx]
                d_mi = sec_base["dist_m"] / 1609.344
                row.extend([
                    f"S{idx+1:02d}",
                    f"Loop {sec_base['loop']}",
                    sec_base["name"],
                    f"{d_mi:.2f}"
                ])
                for sname in snames:
                    sec = self.scenario_data[sname]["sectors"][idx]
                    t_leg = (sec["dist_m"] / 1609.344) * sec["pace"]
                    row.extend([f"{format_pace(sec['pace'])} min/mi", format_elapsed(t_leg)])
                row.append(sec_base["strat"])
                writer.writerow(row)

        print(f"  -> Saved CSV: {csv_path}")

    def _generate_html(self) -> str:
        """Generates the interactive HTML matrix equipped with @page Landscape rules."""
        html_path = f"{self.args.out_prefix}.html"
        snames = list(self.scenarios.keys())
        primary_scenario = snames[len(snames) // 2]

        # Generate scenario summary cards
        cards_html = ""
        colors = ["#059669", "#ca8a04", "#1d4ed8", "#b45309", "#7c3aed"]
        bg_colors = ["#ecfdf5", "#fef9c3", "#eff6ff", "#fffbeb", "#f5f3ff"]
        for idx, (sname, total_min) in enumerate(self.scenarios.items()):
            c_main = colors[idx % len(colors)]
            c_bg = bg_colors[idx % len(bg_colors)]
            avg_pace = total_min / self.total_dist_mi
            cards_html += f"""
            <div class="meta-item" style="background: {c_bg}; border-color: {c_main}33;">
              <span class="meta-label" style="color: {c_main};">{html.escape(sname)} Scenario</span>
              <span class="meta-value" style="color: {c_main};">{total_min/60:.2f} Hrs <span style="font-size:13px;">({format_pace(avg_pace)}/mi)</span></span>
              <span style="font-size:11px; color:#475569; margin-top:2px;">Total Time: {format_elapsed(total_min)}</span>
            </div>"""

        # Generate checkpoint rows
        rows_html = ""
        for idx in range(len(self.scenario_data[primary_scenario]["checkpoints"])):
            cp_base = self.scenario_data[primary_scenario]["checkpoints"][idx]
            badge_style = "background: #dbeafe; color: #1e40af;"
            if cp_base["loop"] == 2: badge_style = "background: #fef3c7; color: #b45309;"
            elif cp_base["loop"] == 3: badge_style = "background: #d1fae5; color: #065f46;"
            elif cp_base["loop"] == 4: badge_style = "background: #f3e8ff; color: #6b21a8;"

            row_cols = f"""
              <td><strong>{html.escape(cp_base['name'])}</strong><br/><span class="badge" style="{badge_style} margin-top: 2px;">Loop {cp_base['loop']}</span></td>
              <td><strong>{cp_base['dist_mi']:.1f} mi</strong><br/><span style="font-size:11px;color:#64748b;">{(cp_base['dist_mi']*1.60934):.1f} km</span></td>"""

            for s_idx, sname in enumerate(snames):
                cp = self.scenario_data[sname]["checkpoints"][idx]
                c_main = colors[s_idx % len(colors)]
                row_cols += f"""
              <td><strong style="color: {c_main};">{cp['eta_str']}</strong><br/><span style="font-size:11px;color:#475569;">{cp['el_str']} | {cp['pace_str']}/mi</span></td>"""
            
            rows_html += f"\n            <tr>{row_cols}\n            </tr>"

        header_cols = "".join([f"\n        <th>{html.escape(sname)} ({self.scenarios[sname]/60:.1f}h)</th>" for sname in snames])

        html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{html.escape(self.args.name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
    @page {{
      size: letter {'landscape' if self.args.landscape else 'portrait'};
      margin: 12mm;
    }}
    body {{
      font-family: 'Inter', sans-serif;
      color: #0f172a;
      background: #fff;
      margin: 0;
      padding: 30px;
      line-height: 1.5;
    }}
    .header {{
      border-bottom: 3px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }}
    h1 {{ margin: 0; font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.5px; }}
    h2 {{ font-size: 16px; font-weight: 800; text-transform: uppercase; margin-top: 28px; margin-bottom: 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }}
    .subtitle {{ font-size: 13.5px; color: #475569; margin-top: 4px; }}
    .meta-grid {{
      display: grid;
      grid-template-columns: repeat({len(snames)}, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }}
    .meta-item {{ display: flex; flex-direction: column; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 8px; }}
    .meta-label {{ font-size: 11px; font-weight: 700; text-transform: uppercase; }}
    .meta-value {{ font-size: 17px; font-weight: 800; margin-top: 2px; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 28px; }}
    th {{ background: #0f172a; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 10px 12px; text-align: left; border: 1px solid #1e293b; }}
    td {{ padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12px; vertical-align: middle; }}
    tr:nth-child(even) {{ background-color: #f8fafc; }}
    .badge {{ display: inline-block; padding: 3px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }}
    @media print {{
      @page {{
        size: letter {'landscape' if self.args.landscape else 'portrait'};
        margin: 12mm;
      }}
      body {{ padding: 10px; }}
      th {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #0f172a !important; color: #fff !important; }}
      .meta-item {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
      tr {{ page-break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>{html.escape(self.args.name)}</h1>
      <div class="subtitle">Automated Multi-Scenario Execution Matrix &bull; {self.args.loops} Loops + Out-and-Back &bull; {'Self-Supported (No Official Cutoffs)' if self.args.no_cutoffs else 'Official Cutoffs Active'}</div>
    </div>
    <div style="text-align: right; font-size: 12px; color: #64748b;">
      <strong>Start:</strong> {self.start_time.strftime('%a %I:%M %p')}<br/>
      <strong>Total Distance:</strong> {self.total_dist_mi:.1f} Mi ({self.total_dist_mi * 1.60934:.1f} km)
    </div>
  </div>

  <div class="meta-grid">{cards_html}
  </div>

  <h2>📍 Aid Station Arrival Schedule (ETA Matrix)</h2>
  <table>
    <thead>
      <tr>
        <th>Aid Station / Landmark</th>
        <th>Distance</th>{header_cols}
      </tr>
    </thead>
    <tbody>{rows_html}
    </tbody>
  </table>

  <div style="font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px;">
    Generated by Ruff Terrain Automated Race Plan Engine &bull; Literate Programming &amp; Multi-Scenario Pacing Automation
  </div>
</body>
</html>
"""
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"  -> Saved HTML: {html_path}")
        return html_path

    def _compile_pdf(self, html_path: str):
        """Compiles the HTML report to a high-resolution PDF using Google Chrome Headless."""
        pdf_path = f"{self.args.out_prefix}.pdf"
        if not os.path.exists(self.args.chrome_path):
            print(f"  [!] Chrome not found at {self.args.chrome_path}. Skipping PDF compilation.")
            return
        cmd = [
            self.args.chrome_path,
            "--headless",
            "--disable-gpu",
            f"--print-to-pdf={os.path.abspath(pdf_path)}",
            os.path.abspath(html_path)
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"  -> Saved Landscape PDF: {pdf_path}")

    def _generate_gpx(self):
        """Builds multi-loop GPX file equipped with <ca:execution_plan> and multi-pass waypoints."""
        gpx_path = f"{self.args.out_prefix}.gpx"
        primary_scenario = list(self.scenarios.keys())[len(self.scenarios) // 2]
        sectors = self.scenario_data[primary_scenario]["sectors"]
        checkpoints = self.scenario_data[primary_scenario]["checkpoints"]

        # Update metadata extensions
        race_plan_el = self.base_root.find(".//ca:race_plan", NS_MAP)
        if race_plan_el is not None:
            race_plan_el.attrib["start_time"] = self.start_time.strftime("%H:%M")
            race_plan_el.attrib["target_duration_hrs"] = str(self.scenarios[primary_scenario] / 60.0)

        exec_plan_el = self.base_root.find(".//ca:execution_plan", NS_MAP)
        if exec_plan_el is not None:
            exec_plan_el.clear()
            for s in sectors:
                sec_el = ET.SubElement(exec_plan_el, f"{{{NS_MAP['ca']}}}sector", {
                    "start_dist_m": str(s["start_m"]),
                    "end_dist_m": str(s["end_m"]),
                    "name": s["name"],
                    "target_pace_min": str(s["pace"])
                })
                strat_el = ET.SubElement(sec_el, f"{{{NS_MAP['ca']}}}strategy")
                strat_el.text = s["strat"]

        # Update waypoints with multi-pass <ca:passes>
        for wpt in self.base_root.findall("gpx:wpt", NS_MAP):
            wname = wpt.find("gpx:name", NS_MAP).text
            ext = wpt.find("gpx:extensions", NS_MAP)
            if ext is None:
                ext = ET.SubElement(wpt, f"{{{NS_MAP['gpx']}}}extensions")
            station_el = ext.find("ca:station", NS_MAP)
            if station_el is None:
                st_id = re.sub(r"[^a-z0-9]+", "_", wname.lower())
                station_el = ET.SubElement(ext, f"{{{NS_MAP['ca']}}}station", {
                    "type": "segmenting",
                    "id": st_id,
                    "subtype": "aid_station"
                })
            passes_el = station_el.find("ca:passes", NS_MAP)
            if passes_el is None:
                passes_el = ET.SubElement(station_el, f"{{{NS_MAP['ca']}}}passes")
            else:
                passes_el.clear()

            matching = [cp for cp in checkpoints if wname in cp["name"] or (wname == "Course Finish" and cp["dist_mi"] == self.total_dist_mi)]
            for p_idx, mc in enumerate(matching, 1):
                ET.SubElement(passes_el, f"{{{NS_MAP['ca']}}}pass", {
                    "num": str(p_idx),
                    "dist_m": str(mc["dist_mi"] * 1609.344),
                    "label": f"Loop {mc['loop']} ({mc['notes']})",
                    "target_arrival": mc["eta_str"],
                    "cutoff_clock": "--" if self.args.no_cutoffs else mc.get("cutoff", "--")
                })

        self.base_tree.write(gpx_path, encoding="utf-8", xml_declaration=True)
        print(f"  -> Saved Course GPX: {gpx_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Automated Multi-Loop Race Execution Plan Generator")
    parser.add_argument("--base-gpx", required=True, help="Path to base single-loop GPX file")
    parser.add_argument("--loops", type=int, default=3, help="Number of main loops to generate")
    parser.add_argument("--direction", choices=["alternating", "same"], default="alternating", help="Loop direction strategy")
    parser.add_argument("--loop-penalty-min", type=float, default=20.0, help="Minutes slower per successive loop")
    parser.add_argument("--append-out-and-back-mi", type=float, default=5.0, help="Mileage added for out-and-back final leg")
    parser.add_argument("--ob-fatigue-factor", type=float, default=1.15, help="Pace multiplier relative to final loop for out-and-back")
    parser.add_argument("--scenarios", default="Optimistic:12.0,Sub-Goal:13.0,Goal:14.0,Max:15.0", help="Comma-separated Name:Hours scenarios")
    parser.add_argument("--start-time", default="2026-07-10T20:00:00", help="ISO start timestamp")
    parser.add_argument("--name", default="Ruff Terrain Ultra - 50-Mile Master Plan", help="Project display name")
    parser.add_argument("--out-prefix", default="ruff_terrain_50_miler_auto", help="Output file path prefix")
    parser.add_argument("--landscape", action="store_true", default=True, help="Use Landscape page orientation")
    parser.add_argument("--no-cutoffs", action="store_true", default=True, help="Omit official cutoff enforcement")
    parser.add_argument("--chrome-path", default="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", help="Path to Chrome executable for PDF compile")

    args = parser.parse_args()
    builder = RacePlanBuilder(args)
    builder.build_all()
