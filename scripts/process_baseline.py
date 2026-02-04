#!/usr/bin/env python3
"""
Process baseline street lamp data from a full-history OSM PBF file.
Extracts the state as of February 1, 2026.

Usage:
    python process_baseline.py /path/to/italy-internal.osm.pbf
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Target date for baseline
BASELINE_DATE = "2026-02-01T00:00:00Z"

# Tags to preserve for street lamps
STREETLAMP_TAGS = [
    "lamp_mount", "lamp_type", "support", "ref", "operator",
    "height", "direction", "colour", "light:colour", "light:count",
    "manufacturer", "model", "start_date"
]

# Tags/values that indicate lit features
LIT_VALUES = ["yes", "24/7", "automatic", "limited", "interval", "sunset-sunrise"]


def write_known_ids(path, known_ids):
    """Write known-ids.json with one ID per line for better git diffs."""
    with open(path, 'w') as f:
        f.write('{\n')
        f.write('  "baseline_ids": [\n')
        baseline = known_ids.get("baseline_ids", [])
        for i, id_ in enumerate(baseline):
            comma = "," if i < len(baseline) - 1 else ""
            f.write(f'    {id_}{comma}\n')
        f.write('  ],\n')
        f.write('  "new_ids": {\n')
        new_ids = known_ids.get("new_ids", {})
        dates = list(new_ids.keys())
        for di, date in enumerate(dates):
            ids = new_ids[date]
            date_comma = "," if di < len(dates) - 1 else ""
            f.write(f'    "{date}": [\n')
            for i, id_ in enumerate(ids):
                comma = "," if i < len(ids) - 1 else ""
                f.write(f'      {id_}{comma}\n')
            f.write(f'    ]{date_comma}\n')
        f.write('  }\n')
        f.write('}\n')


def run_osmium(args, description):
    """Run an osmium command and handle errors."""
    cmd = ["osmium"] + args
    print(f"  {description}...")
    print(f"    $ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result


def extract_features_to_geojson(pbf_path, output_path, filter_expr, tags_to_keep):
    """Extract features from PBF and convert to GeoJSON with selected tags."""
    import osmium

    class FeatureHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.features = []
            self.node_coords = {}

        def node(self, n):
            if n.location.valid():
                self.node_coords[n.id] = (n.location.lon, n.location.lat)

                tags = dict(n.tags)
                if self._matches_filter(tags, filter_expr):
                    self.features.append(self._make_feature(
                        "node", n.id,
                        {"type": "Point", "coordinates": [n.location.lon, n.location.lat]},
                        tags
                    ))

        def way(self, w):
            tags = dict(w.tags)
            if self._matches_filter(tags, filter_expr):
                coords = []
                for node in w.nodes:
                    if node.ref in self.node_coords:
                        coords.append(list(self.node_coords[node.ref]))

                if len(coords) >= 2:
                    self.features.append(self._make_feature(
                        "way", w.id,
                        {"type": "LineString", "coordinates": coords},
                        tags
                    ))

        def _matches_filter(self, tags, filter_expr):
            """Check if tags match the filter expression."""
            key, values = filter_expr
            if key not in tags:
                return False
            if values is None:
                return True
            return tags[key] in values

        def _make_feature(self, osm_type, osm_id, geometry, tags):
            """Create a GeoJSON feature with filtered properties."""
            props = {
                "osm_type": osm_type,
                "osm_id": osm_id
            }
            for tag in tags_to_keep:
                if tag in tags:
                    props[tag] = tags[tag]

            return {
                "type": "Feature",
                "id": f"{osm_type}/{osm_id}",
                "geometry": geometry,
                "properties": props
            }

    handler = FeatureHandler()
    handler.apply_file(str(pbf_path), locations=True)

    write_geojson_lines(output_path, handler.features)

    return len(handler.features)


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
    parser = argparse.ArgumentParser(description="Process baseline OSM data for Lampioni")
    parser.add_argument("pbf_file", help="Path to full-history Italy PBF file")
    parser.add_argument("--output-dir", "-o", default="data",
                        help="Output directory (default: data)")
    parser.add_argument("--skip-time-filter", action="store_true",
                        help="Skip time filtering (if PBF is already filtered)")
    args = parser.parse_args()

    pbf_path = Path(args.pbf_file)
    if not pbf_path.exists():
        print(f"Error: PBF file not found: {pbf_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Processing baseline data from: {pbf_path}")
    print(f"Output directory: {output_dir}")
    print()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # Step 1: Filter to baseline date
        if args.skip_time_filter:
            filtered_pbf = pbf_path
            print("Skipping time filter (--skip-time-filter)")
        else:
            filtered_pbf = tmpdir / "italy-feb1.osm.pbf"
            run_osmium(
                ["time-filter", str(pbf_path), BASELINE_DATE, "-o", str(filtered_pbf)],
                f"Filtering to {BASELINE_DATE}"
            )

        # Step 2: Extract street lamps
        print("\nExtracting street lamps (highway=street_lamp)...")
        lamps_pbf = tmpdir / "streetlamps.osm.pbf"
        run_osmium(
            ["tags-filter", str(filtered_pbf), "n/highway=street_lamp", "-o", str(lamps_pbf)],
            "Filtering street lamp nodes"
        )

        # Step 3: Convert to GeoJSON
        print("\nConverting to GeoJSON...")
        lamps_geojson = output_dir / "streetlamps-baseline.geojson"
        lamp_count = extract_features_to_geojson(
            lamps_pbf, lamps_geojson,
            ("highway", {"street_lamp"}),
            STREETLAMP_TAGS
        )
        print(f"  Extracted {lamp_count:,} street lamps")

        # Step 4: Extract lit features
        print("\nExtracting lit features (lit=yes/24/7/automatic/limited/interval)...")
        lit_pbf = tmpdir / "lit.osm.pbf"
        lit_filter = "nwr/lit=" + ",".join(LIT_VALUES)
        run_osmium(
            ["tags-filter", str(filtered_pbf), lit_filter, "-o", str(lit_pbf)],
            "Filtering lit features"
        )

        lit_geojson = output_dir / "lit-features.geojson"
        lit_count = extract_features_to_geojson(
            lit_pbf, lit_geojson,
            ("lit", set(LIT_VALUES)),
            ["lit", "highway", "name"]
        )
        print(f"  Extracted {lit_count:,} lit features")

        # Step 5: Create known-ids.json
        print("\nCreating known-ids.json...")
        with open(lamps_geojson) as f:
            lamps_data = json.load(f)

        known_ids = {
            "baseline_ids": [f["properties"]["osm_id"] for f in lamps_data["features"]],
            "new_ids": {}
        }

        known_ids_path = output_dir / "known-ids.json"
        write_known_ids(known_ids_path, known_ids)
        print(f"  Saved {len(known_ids['baseline_ids']):,} baseline IDs")

        # Step 6: Create initial stats.json
        print("\nCreating stats.json...")
        stats = {
            "baseline_count": lamp_count,
            "new_count": 0,
            "last_updated": BASELINE_DATE,
            "leaderboard": [],
            "daily_additions": {}
        }

        stats_path = output_dir / "stats.json"
        with open(stats_path, 'w') as f:
            json.dump(stats, f, indent=2)

        # Step 7: Create empty new lamps file
        empty_new = {
            "type": "FeatureCollection",
            "features": []
        }
        new_lamps_path = output_dir / "streetlamps-new.geojson"
        with open(new_lamps_path, 'w') as f:
            json.dump(empty_new, f)

        print("\n" + "="*50)
        print("Baseline processing complete!")
        print(f"  Street lamps:  {lamp_count:,}")
        print(f"  Lit features:  {lit_count:,}")
        print(f"\nOutput files in {output_dir}/:")
        for f in sorted(output_dir.glob("*")):
            size = f.stat().st_size
            if size > 1024*1024:
                size_str = f"{size/1024/1024:.1f} MB"
            elif size > 1024:
                size_str = f"{size/1024:.1f} KB"
            else:
                size_str = f"{size} bytes"
            print(f"  {f.name}: {size_str}")


if __name__ == "__main__":
    main()
