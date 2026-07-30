"""
geolonia/japanese-addresses CSV から、住所→緯度経度のインデックスを生成する。

出力:
  data/geocoding.json
    {
      "city":  { "{pref}{city}": [lat, lng], ... },          // 市区町村レベル重心
      "oaza":  { "{pref}{city}{oaza}": [lat, lng], ... }     // 大字町丁目レベル代表点
    }

実行:
  python scripts/build_geocoding_index.py
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
DATA_DIR = ROOT / "data"
GEOLONIA_CSV = RAW_DIR / "geolonia_latest.csv"


def parse_float(s: str):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def main():
    if not GEOLONIA_CSV.exists():
        print(f"[error] {GEOLONIA_CSV} not found. Run build_aza_conflicts.py first to download it.")
        sys.exit(1)

    city_sum = defaultdict(lambda: [0.0, 0.0, 0])  # [lat_sum, lng_sum, count]
    oaza = {}
    seen_rows = 0

    with open(GEOLONIA_CSV, encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if len(row) < 14:
                continue
            pref = row[1].strip()
            city = row[5].strip()
            oa = row[8].strip()
            lat = parse_float(row[12])
            lng = parse_float(row[13])
            if not pref or not city or lat is None or lng is None:
                continue
            seen_rows += 1
            ck = pref + city
            city_sum[ck][0] += lat
            city_sum[ck][1] += lng
            city_sum[ck][2] += 1
            if oa:
                ok = pref + city + oa
                if ok not in oaza:
                    oaza[ok] = [round(lat, 6), round(lng, 6)]

    city = {k: [round(v[0] / v[2], 6), round(v[1] / v[2], 6)] for k, v in city_sum.items()}

    out_path = DATA_DIR / "geocoding.json"
    out_path.write_text(
        json.dumps({"city": city, "oaza": oaza}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"[ok]   wrote {out_path} ({out_path.stat().st_size:,} bytes)")
    print(f"[info] scanned {seen_rows:,} rows / city={len(city):,} oaza={len(oaza):,}")


if __name__ == "__main__":
    sys.exit(main())
