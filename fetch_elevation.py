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
import urllib.request
import json
import urllib.parse
import os
import time

def fetch_from_open_meteo(batch):
    lats = ",".join(str(c[0]) for c in batch)
    lons = ",".join(str(c[1]) for c in batch)
    url = f"https://api.open-meteo.com/v1/elevation?latitude={lats}&longitude={lons}"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode())
        if 'elevation' in data:
            return data['elevation']
    raise Exception("No elevation data in Open-Meteo response")

def fetch_from_open_elevation(batch):
    url = "https://api.open-elevation.com/api/v1/lookup"
    payload = {
        "locations": [{"latitude": c[0], "longitude": c[1]} for c in batch]
    }
    req_data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url, 
        data=req_data, 
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode())
        if 'results' in data:
            return [loc['elevation'] for loc in data['results']]
    raise Exception("No elevation data in Open-Elevation response")

def fetch_elevations(coords):
    # Conservative batch size of 20 to prevent HTTP 414 and 400.
    batch_size = 20
    elevations = []
    
    for i in range(0, len(coords), batch_size):
        batch = coords[i:i+batch_size]
        print(f"Fetching batch {i // batch_size + 1}/{len(coords) // batch_size + 1} ({len(batch)} points)...", flush=True)
        
        success = False
        retries = 3
        backoff = 2
        
        while not success and retries > 0:
            # Method 1: Try Open-Meteo
            try:
                elevations.extend(fetch_from_open_meteo(batch))
                success = True
            except Exception as e:
                print(f"Open-Meteo failed: {e}. Trying fallback Open-Elevation...", flush=True)
                # Method 2: Try Open-Elevation fallback
                try:
                    elevations.extend(fetch_from_open_elevation(batch))
                    success = True
                except Exception as e2:
                    print(f"Open-Elevation fallback failed: {e2}.", flush=True)
                    retries -= 1
                    if retries > 0:
                        print(f"Retrying in {backoff} seconds...", flush=True)
                        time.sleep(backoff)
                        backoff *= 2
                        
        if not success:
            print("Failed to fetch batch from all providers. Filling with 0.0.", flush=True)
            elevations.extend([0.0] * len(batch))
            
        # 0.3 second sleep between requests to be gentle and prevent rate-limiting (429)
        time.sleep(0.3)
            
    return elevations

def process_gpx(filepath):
    print(f"Processing {filepath}...", flush=True)
    ET.register_namespace('', 'http://www.topografix.com/GPX/1/1')
    
    tree = ET.parse(filepath)
    root = tree.getroot()
    
    ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
    
    trkpts = root.findall('.//gpx:trkpt', ns)
    N = len(trkpts)
    print(f"Found {N} trackpoints.", flush=True)
    
    if not N:
        return
        
    coords = []
    for pt in trkpts:
        lat = float(pt.get('lat'))
        lon = float(pt.get('lon'))
        coords.append((lat, lon))
        
    # Sample every 10th point (~220 meters) and always include the last point (N-1)
    step = 10
    sample_indices = list(range(0, N, step))
    if (N - 1) not in sample_indices:
        sample_indices.append(N - 1)
        
    sample_coords = [coords[idx] for idx in sample_indices]
    print(f"Sampling {len(sample_coords)} points for elevation APIs (10x reduction)...", flush=True)
    
    sample_elevations = fetch_elevations(sample_coords)
    
    # Map back and linearly interpolate
    full_elevations = [0.0] * N
    for idx, ele in zip(sample_indices, sample_elevations):
        full_elevations[idx] = ele
        
    for k in range(len(sample_indices) - 1):
        start_idx = sample_indices[k]
        end_idx = sample_indices[k+1]
        start_ele = full_elevations[start_idx]
        end_ele = full_elevations[end_idx]
        
        diff = end_idx - start_idx
        if diff > 1:
            for i in range(start_idx + 1, end_idx):
                fraction = (i - start_idx) / diff
                full_elevations[i] = start_ele + fraction * (end_ele - start_ele)
                
    for pt, ele in zip(trkpts, full_elevations):
        ele_elem = pt.find('gpx:ele', ns)
        if ele_elem is not None:
            ele_elem.text = f"{ele:.2f}"
        else:
            new_ele = ET.Element('{http://www.topografix.com/GPX/1/1}ele')
            new_ele.text = f"{ele:.2f}"
            pt.insert(0, new_ele)
            
    tree.write(filepath, xml_declaration=True, encoding='utf-8')
    print(f"Finished writing elevations to {filepath}\n", flush=True)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
        if os.path.exists(filepath):
            process_gpx(filepath)
        else:
            print(f"File not found: {filepath}", flush=True)
    else:
        print("Usage: python3 fetch_elevation.py <path_to_gpx>")
