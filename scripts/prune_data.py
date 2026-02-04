#!/usr/bin/env python3
"""
One-time script to prune data that was fetched using the old bounding box query.
Re-fetches current IDs using the relation-based query and removes any that are outside Italy.

Usage:
    python prune_data.py --data-dir data
"""

import argparse
import json
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# Italy relation ID in OSM
ITALY_RELATION_ID = 365331

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def overpass_query(query, timeout_sec=300):
    """Execute an Overpass query, trying multiple endpoints."""
    data = query.encode('utf-8')

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            req = Request(endpoint, data=data, headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Lampioni/1.0 (https://github.com/watmildon/Lampioni)'
            })
            print(f"  Trying {endpoint.split('/')[2]}...")

            with urlopen(req, timeout=timeout_sec) as response:
                result = response.read().decode('utf-8')
                return json.loads(result)

        except (HTTPError, URLError) as e:
            print(f"    Error: {e}")
            continue

    raise Exception("All Overpass endpoints failed")


def fetch_italy_lamp_ids():
    """Fetch all current street lamp IDs within Italy using relation boundary."""
    query = f"""
[out:json][timeout:300];
rel({ITALY_RELATION_ID});
map_to_area->.italy;
node["highway"="street_lamp"](area.italy);
out ids;
"""
    print("Fetching all street lamp IDs within Italy boundary...")
    result = overpass_query(query)
    return {el['id'] for el in result.get('elements', []) if el.get('type') == 'node'}


def main():
    parser = argparse.ArgumentParser(description="Prune data outside Italy boundary")
    parser.add_argument("--data-dir", "-d", default="data", help="Data directory")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be removed without changing files")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)

    # Load existing data
    known_ids_path = data_dir / "known-ids.json"
    new_lamps_path = data_dir / "streetlamps-new.geojson"
    baseline_path = data_dir / "streetlamps-baseline.geojson"
    stats_path = data_dir / "stats.json"

    print("Loading existing data...")
    with open(known_ids_path) as f:
        known_ids = json.load(f)
    with open(new_lamps_path) as f:
        new_lamps = json.load(f)
    with open(baseline_path) as f:
        baseline = json.load(f)
    with open(stats_path) as f:
        stats = json.load(f)

    old_baseline_count = len(baseline['features'])
    old_new_count = len(new_lamps['features'])
    old_known_count = len(known_ids['baseline_ids'])

    print(f"  Baseline features: {old_baseline_count:,}")
    print(f"  New lamp features: {old_new_count:,}")
    print(f"  Known baseline IDs: {old_known_count:,}")
    print()

    # Fetch valid IDs from Overpass
    valid_ids = fetch_italy_lamp_ids()
    print(f"  Valid IDs in Italy: {len(valid_ids):,}")
    print()

    # Filter baseline features
    baseline_features = [f for f in baseline['features'] if f['properties']['osm_id'] in valid_ids]
    baseline_removed = old_baseline_count - len(baseline_features)

    # Filter new lamp features
    new_features = [f for f in new_lamps['features'] if f['properties']['osm_id'] in valid_ids]
    new_removed = old_new_count - len(new_features)

    # Filter known IDs
    valid_baseline_ids = [id for id in known_ids['baseline_ids'] if id in valid_ids]
    known_removed = old_known_count - len(valid_baseline_ids)

    print("Results:")
    print(f"  Baseline: {old_baseline_count:,} -> {len(baseline_features):,} (removed {baseline_removed:,})")
    print(f"  New lamps: {old_new_count:,} -> {len(new_features):,} (removed {new_removed:,})")
    print(f"  Known IDs: {old_known_count:,} -> {len(valid_baseline_ids):,} (removed {known_removed:,})")

    if args.dry_run:
        print("\n--dry-run: No files modified")
        return

    # Save updated files
    print("\nSaving updated files...")

    # Baseline
    baseline['features'] = baseline_features
    with open(baseline_path, 'w') as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        for i, feat in enumerate(baseline_features):
            line = json.dumps(feat, separators=(',', ':'))
            if i < len(baseline_features) - 1:
                f.write(line + ',\n')
            else:
                f.write(line + '\n')
        f.write(']}\n')
    print(f"  {baseline_path.name}")

    # New lamps
    with open(new_lamps_path, 'w') as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        for i, feat in enumerate(new_features):
            line = json.dumps(feat, separators=(',', ':'))
            if i < len(new_features) - 1:
                f.write(line + ',\n')
            else:
                f.write(line + '\n')
        f.write(']}\n')
    print(f"  {new_lamps_path.name}")

    # Known IDs
    known_ids['baseline_ids'] = valid_baseline_ids
    with open(known_ids_path, 'w') as f:
        json.dump(known_ids, f, separators=(',', ':'))
    print(f"  {known_ids_path.name}")

    # Update stats
    stats['baseline_count'] = len(baseline_features)
    stats['new_count'] = len(new_features)
    with open(stats_path, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"  {stats_path.name}")

    print("\nPruning complete!")


if __name__ == "__main__":
    main()
