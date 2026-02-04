#!/usr/bin/env python3
"""
Daily processing script for Lampioni.
Uses multiple Overpass API endpoints with fallback to Postpass.

Usage:
    python process_daily.py [--data-dir DATA_DIR]
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# Overpass API endpoints (in order of preference)
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",  # Often lags behind
]

# Postpass API (fallback - no metadata)
POSTPASS_URL = "https://postpass.geofabrik.de/api/0.2/interpreter"

# Tags to preserve for street lamps
STREETLAMP_TAGS = [
    "lamp_mount", "lamp_type", "support", "ref", "operator",
    "height", "direction", "colour", "light:colour", "light:count",
    "manufacturer", "model", "start_date"
]

# Baseline date - lamps created after this are "new"
BASELINE_DATE = "2026-02-01T00:00:00Z"

# Italy bounding box (approximate)
ITALY_BBOX = "35.5,6.5,47.5,19.0"  # south,west,north,east

# Maximum acceptable data lag (hours)
MAX_DATA_LAG_HOURS = 24


def check_overpass_timestamp(result, endpoint):
    """
    Check the timestamp_osm_base from Overpass response.
    Returns (is_fresh, lag_hours, timestamp_str).
    """
    timestamp_str = result.get('osm3s', {}).get('timestamp_osm_base', '')
    if not timestamp_str:
        return True, 0, "unknown"  # Can't check, assume OK

    try:
        # Parse ISO timestamp like "2026-02-03T12:00:00Z"
        data_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        lag = now - data_time
        lag_hours = lag.total_seconds() / 3600

        is_fresh = lag_hours <= MAX_DATA_LAG_HOURS
        return is_fresh, lag_hours, timestamp_str
    except Exception:
        return True, 0, timestamp_str  # Can't parse, assume OK


def overpass_query(query, timeout_sec=300, min_freshness_hours=None):
    """
    Execute an Overpass query, trying multiple endpoints.
    If min_freshness_hours is set, skip endpoints with stale data.
    """
    data = query.encode('utf-8')
    last_error = None
    freshness_threshold = min_freshness_hours or MAX_DATA_LAG_HOURS

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            req = Request(endpoint, data=data, headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Lampioni/1.0 (https://github.com/your-repo/lampioni)'
            })
            print(f"  Trying {endpoint.split('/')[2]}...")

            with urlopen(req, timeout=timeout_sec) as response:
                result = response.read().decode('utf-8')
                parsed = json.loads(result)

                # Check data freshness
                is_fresh, lag_hours, ts = check_overpass_timestamp(parsed, endpoint)
                if lag_hours > 0:
                    print(f"    Data timestamp: {ts} ({lag_hours:.1f}h ago)")

                if not is_fresh:
                    print(f"    WARNING: Data is {lag_hours:.1f}h old (threshold: {freshness_threshold}h), trying next endpoint...")
                    last_error = Exception(f"Data too stale: {lag_hours:.1f}h old")
                    continue

                return parsed

        except HTTPError as e:
            print(f"    HTTP {e.code}: {e.reason}")
            last_error = e
            if e.code == 429:  # Rate limited - wait before trying next
                time.sleep(5)
            continue

        except URLError as e:
            print(f"    Error: {e.reason}")
            last_error = e
            continue

        except Exception as e:
            print(f"    Error: {e}")
            last_error = e
            continue

    raise Exception(f"All Overpass endpoints failed. Last error: {last_error}")


def postpass_query(sql):
    """Execute a Postpass SQL query (fallback, no metadata)."""
    from urllib.parse import urlencode

    data = urlencode({'data': sql}).encode('utf-8')

    try:
        req = Request(POSTPASS_URL, data=data, headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Lampioni/1.0'
        })
        print(f"  Using Postpass fallback...")

        with urlopen(req, timeout=300) as response:
            result = response.read().decode('utf-8')
            return json.loads(result)

    except Exception as e:
        raise Exception(f"Postpass query failed: {e}")


def fetch_new_streetlamps_overpass(since_date):
    """Fetch street lamps created since the given date using Overpass."""
    query = f"""
[out:json][timeout:180][bbox:{ITALY_BBOX}];
node["highway"="street_lamp"](newer:"{since_date}");
out meta;
"""

    print(f"Fetching street lamps created since {since_date}...")
    result = overpass_query(query)

    lamps = {}
    for element in result.get('elements', []):
        if element.get('type') != 'node':
            continue

        osm_id = element['id']
        tags = element.get('tags', {})

        props = {
            "osm_type": "node",
            "osm_id": osm_id,
            "user": element.get('user', 'unknown'),
            "timestamp": element.get('timestamp', '')
        }

        # Copy relevant tags
        for tag in STREETLAMP_TAGS:
            if tag in tags:
                props[tag] = tags[tag]

        lamps[osm_id] = {
            "type": "Feature",
            "id": f"node/{osm_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [element['lon'], element['lat']]
            },
            "properties": props
        }

    return lamps


def fetch_streetlamps_postpass():
    """Fetch ALL street lamps from Postpass (fallback - no user metadata)."""
    # Italy bbox: minlon, minlat, maxlon, maxlat
    sql = """
SELECT osm_id, tags, geom
FROM postpass_point
WHERE tags->>'highway' = 'street_lamp'
AND geom && st_makeenvelope(6.5, 35.5, 19.0, 47.5, 4326)
"""

    print("Fetching street lamps from Postpass...")
    result = postpass_query(sql)

    lamps = {}
    for feature in result.get('features', []):
        props = feature.get('properties', {})
        osm_id = props.get('osm_id')
        if not osm_id:
            continue

        tags = props.get('tags', {})
        coords = feature.get('geometry', {}).get('coordinates', [])

        lamp_props = {
            "osm_type": "node",
            "osm_id": osm_id,
            "user": "unknown",  # Postpass doesn't have user metadata
            "timestamp": ""
        }

        # Copy relevant tags
        for tag in STREETLAMP_TAGS:
            if tag in tags:
                lamp_props[tag] = tags[tag]

        lamps[osm_id] = {
            "type": "Feature",
            "id": f"node/{osm_id}",
            "geometry": {
                "type": "Point",
                "coordinates": coords
            },
            "properties": lamp_props
        }

    return lamps


def fetch_new_streetlamps(since_date, use_postpass_fallback=True):
    """
    Fetch new street lamps, trying Overpass first, Postpass as fallback.
    Returns (lamps_dict, has_metadata).
    """
    try:
        lamps = fetch_new_streetlamps_overpass(since_date)
        return lamps, True
    except Exception as e:
        print(f"  Overpass failed: {e}")
        if use_postpass_fallback:
            print("  Falling back to Postpass (no user metadata)...")
            lamps = fetch_streetlamps_postpass()
            return lamps, False
        raise


def fetch_all_streetlamp_ids():
    """Fetch ALL current street lamp IDs to detect deletions."""
    query = f"""
[out:json][timeout:180][bbox:{ITALY_BBOX}];
node["highway"="street_lamp"];
out ids;
"""

    print("Fetching all current street lamp IDs...")
    result = overpass_query(query)

    return {el['id'] for el in result.get('elements', []) if el.get('type') == 'node'}


def write_geojson_lines(output_path, features):
    """Write GeoJSON with one feature per line for cleaner git diffs."""
    with open(output_path, 'w') as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        for i, feat in enumerate(features):
            line = json.dumps(feat, separators=(',', ':'))
            if i < len(features) - 1:
                f.write(line + ',\n')
            else:
                f.write(line + '\n')
        f.write(']}\n')


def main():
    parser = argparse.ArgumentParser(description="Daily update for Lampioni")
    parser.add_argument("--data-dir", "-d", default="data",
                        help="Data directory (default: data)")
    parser.add_argument("--full-refresh", action="store_true",
                        help="Re-fetch all new lamps since baseline, not just recent")
    parser.add_argument("--no-postpass-fallback", action="store_true",
                        help="Disable Postpass fallback (fail if all Overpass endpoints fail)")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}", file=sys.stderr)
        print("Run process_baseline.py first to create baseline data.", file=sys.stderr)
        sys.exit(1)

    # Load existing data
    known_ids_path = data_dir / "known-ids.json"
    new_lamps_path = data_dir / "streetlamps-new.geojson"
    stats_path = data_dir / "stats.json"

    if not known_ids_path.exists():
        print(f"Error: {known_ids_path} not found. Run process_baseline.py first.", file=sys.stderr)
        sys.exit(1)

    with open(known_ids_path) as f:
        known_ids = json.load(f)

    with open(new_lamps_path) as f:
        existing_new = json.load(f)

    with open(stats_path) as f:
        stats = json.load(f)

    # Build set of baseline IDs
    baseline_ids = set(known_ids["baseline_ids"])

    # Existing new lamps by ID (to preserve date_added)
    existing_by_id = {f["properties"]["osm_id"]: f for f in existing_new.get("features", [])}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"Daily update: {today}")
    print(f"Baseline IDs: {len(baseline_ids):,}")
    print(f"Existing new lamps: {len(existing_by_id):,}")
    print()

    # Fetch new street lamps
    use_fallback = not args.no_postpass_fallback
    new_lamps_data, has_metadata = fetch_new_streetlamps(BASELINE_DATE, use_fallback)
    print(f"  Found {len(new_lamps_data):,} lamps created since {BASELINE_DATE}")

    if not has_metadata:
        print("  WARNING: Using Postpass data - leaderboard will show 'unknown' users")

    # Filter out baseline lamps (they existed before Feb 1)
    truly_new = {k: v for k, v in new_lamps_data.items() if k not in baseline_ids}
    print(f"  After filtering baseline: {len(truly_new):,} new lamps")

    # Build new features list
    new_features = []
    new_today_count = 0

    for osm_id, feature in truly_new.items():
        # Check if we already knew about this lamp
        if osm_id in existing_by_id:
            # Preserve the original date_added and user from previous data
            existing = existing_by_id[osm_id]
            feature["properties"]["date_added"] = existing["properties"].get("date_added", today)
            # Preserve user if current fetch has no metadata
            if not has_metadata and existing["properties"].get("user", "unknown") != "unknown":
                feature["properties"]["user"] = existing["properties"]["user"]
        else:
            # First time seeing this lamp
            # Try to extract date from timestamp, otherwise use today
            ts = feature["properties"].get("timestamp", "")
            if ts:
                feature["properties"]["date_added"] = ts[:10]  # YYYY-MM-DD
            else:
                feature["properties"]["date_added"] = today
            new_today_count += 1

        new_features.append(feature)

    # Sort by date_added (newest first), then by ID
    new_features.sort(key=lambda f: (f["properties"].get("date_added", "0000-00-00"), -f["properties"]["osm_id"]), reverse=True)

    # Update stats
    stats["new_count"] = len(new_features)
    stats["last_updated"] = datetime.now(timezone.utc).isoformat()
    stats["data_source"] = "overpass" if has_metadata else "postpass"

    # Calculate leaderboard
    user_counts = {}
    for f in new_features:
        user = f["properties"].get("user", "unknown")
        user_counts[user] = user_counts.get(user, 0) + 1

    stats["leaderboard"] = [
        {"user": user, "count": count}
        for user, count in sorted(user_counts.items(), key=lambda x: -x[1])[:20]
    ]

    # Daily additions by date
    daily = {}
    for f in new_features:
        date = f["properties"].get("date_added", "unknown")
        daily[date] = daily.get(date, 0) + 1
    stats["daily_additions"] = dict(sorted(daily.items()))

    # Update known_ids with newly discovered IDs
    all_new_ids = list(truly_new.keys())
    known_ids["new_ids"] = {today: all_new_ids}  # Simplified: just track current new IDs

    # Save all updated files
    print("\nSaving updated files...")

    with open(known_ids_path, 'w') as f:
        json.dump(known_ids, f, separators=(',', ':'))
    print(f"  {known_ids_path.name}")

    write_geojson_lines(new_lamps_path, new_features)
    print(f"  {new_lamps_path.name} ({len(new_features):,} features)")

    with open(stats_path, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"  {stats_path.name}")

    # Write last-updated timestamp
    with open(data_dir / "last-updated.txt", 'w') as f:
        f.write(stats["last_updated"])

    print("\n" + "="*50)
    print("Daily update complete!")
    print(f"  Data source:     {'Overpass (with metadata)' if has_metadata else 'Postpass (no metadata)'}")
    print(f"  Baseline:        {stats['baseline_count']:,}")
    print(f"  New since Feb 1: {stats['new_count']:,}")
    print(f"  Discovered today: {new_today_count:,}")

    if stats["leaderboard"]:
        print("\nTop contributors:")
        for i, entry in enumerate(stats["leaderboard"][:10], 1):
            print(f"  {i}. {entry['user']}: {entry['count']}")


if __name__ == "__main__":
    main()
