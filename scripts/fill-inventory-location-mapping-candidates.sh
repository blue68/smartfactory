#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/fill-inventory-location-mapping-candidates.sh <input_csv> <warehouse_code> <location_code> [output_csv]

Notes:
  - Will only fill empty warehouse_code/location_code cells.
  - Keeps existing filled values unchanged.
USAGE
}

if [[ $# -lt 3 ]]; then
  usage
  exit 1
fi

INPUT_CSV="$1"
WAREHOUSE_CODE="$2"
LOCATION_CODE="$3"
OUTPUT_CSV="${4:-}"

if [[ ! -f "$INPUT_CSV" ]]; then
  echo "input csv not found: $INPUT_CSV" >&2
  exit 1
fi

if [[ -z "$OUTPUT_CSV" ]]; then
  BASENAME="$(basename "$INPUT_CSV" .csv)"
  TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
  OUTPUT_CSV="$(dirname "$INPUT_CSV")/${BASENAME}-filled-${TIMESTAMP}.csv"
fi

mkdir -p "$(dirname "$OUTPUT_CSV")"

python3 - "$INPUT_CSV" "$OUTPUT_CSV" "$WAREHOUSE_CODE" "$LOCATION_CODE" <<'PY'
import csv
import sys

src, dst, warehouse_code, location_code = sys.argv[1:5]

with open(src, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    if reader.fieldnames is None:
        raise SystemExit("CSV header missing")

    required = [
        "entity_type",
        "sku_code",
        "source_note",
        "warehouse_code",
        "location_code",
        "status",
        "candidate_count",
    ]
    missing = [c for c in required if c not in reader.fieldnames]
    if missing:
        raise SystemExit("CSV header invalid, missing columns: " + ",".join(missing))

    rows = list(reader)

rows_total = len(rows)
rows_filled = 0
rows_unchanged = 0

for row in rows:
    wh = (row.get("warehouse_code") or "").strip()
    loc = (row.get("location_code") or "").strip()
    changed = False

    if not wh:
        row["warehouse_code"] = warehouse_code
        changed = True
    if not loc:
        row["location_code"] = location_code
        changed = True

    if changed:
        rows_filled += 1
    else:
        rows_unchanged += 1

with open(dst, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"rows_total={rows_total}")
print(f"rows_filled={rows_filled}")
print(f"rows_unchanged={rows_unchanged}")
print(dst)
PY
