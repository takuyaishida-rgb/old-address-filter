"""
日本郵便の全国郵便番号データ（ken_all.zip）をDLして、旧住所フィルター用のデータに整形する。

出力:
  data/cities.js          … 現行の「都道府県 + 市区町村 + 郡」ホワイトリスト（Aモード用、JS配列）
  data/postal_master.json … 郵便番号 → {pref, city, town} マップ（Bモード用）
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

KEN_ALL_URL = "https://www.post.japanpost.jp/zipcode/dl/kogaki/zip/ken_all.zip"

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
DATA_DIR = ROOT / "data"
HTML_PATH = ROOT / "index.html"


def load_old_towns_from_html(html_path: Path) -> list:
    """index.html の const OLD_TOWNS = [...] をパースして旧町名リストを取得"""
    if not html_path.exists():
        return []
    content = html_path.read_text(encoding="utf-8")
    m = re.search(r"const OLD_TOWNS = \[([\s\S]*?)\];", content)
    if not m:
        return []
    return [x for x in re.findall(r'"([^"]+)"', m.group(1)) if x.strip()]


def load_extinct_city_gun_names() -> tuple:
    """extinct_municipalities.json から市・郡名を抽出"""
    path = DATA_DIR / "extinct_municipalities.json"
    if not path.exists():
        print(f"[warn] {path} not found; extinct city/gun dict will be empty")
        return [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    cities = set()
    guns = set()
    for e in data:
        name = e.get("oldName", "")
        if not name:
            continue
        # 純粋な旧市名（「〇〇市」）
        if name.endswith("市") and "郡" not in name:
            cities.add(name)
        # 旧郡接頭辞（「志太郡大井川町」→「志太郡」、「山県郡」など単独形も）
        gm = re.match(r"^(.+?郡)", name)
        if gm:
            guns.add(gm.group(1))
    return sorted(cities), sorted(guns)


def download_ken_all() -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = RAW_DIR / "ken_all.zip"
    if zip_path.exists() and zip_path.stat().st_size > 1_000_000:
        print(f"[skip] already downloaded: {zip_path}")
        return zip_path
    print(f"[dl]   {KEN_ALL_URL}")
    req = urllib.request.Request(KEN_ALL_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(zip_path, "wb") as f:
        f.write(resp.read())
    print(f"[ok]   saved: {zip_path} ({zip_path.stat().st_size:,} bytes)")
    return zip_path


def extract_csv(zip_path: Path) -> str:
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.upper().endswith(".CSV"))
        raw = z.read(name)
    # 日本郵便のCSVはShift_JIS
    return raw.decode("cp932")


# 町域名に含まれる補足表記を除去
PAREN_RE = re.compile(r"（[^）]*）")
TRAILING_PAREN_RE = re.compile(r"（.*$")


def clean_town(town: str) -> str:
    if not town or town == "以下に掲載がない場合":
        return ""
    t = PAREN_RE.sub("", town)
    t = TRAILING_PAREN_RE.sub("", t)  # 続き括弧
    return t.strip()


# 郡表記「〇〇郡××町」→ 郡名「〇〇郡」と町村名「××町」を分離
GUN_RE = re.compile(r"^(.+?郡)(.+)$")
# 政令指定都市表記「〇〇市××区」→ 市名「〇〇市」と区名「××区」を分離
SEIREI_RE = re.compile(r"^(.+?市)(.+?区)$")


def parse_rows(csv_text: str, old_towns: list):
    reader = csv.reader(io.StringIO(csv_text))
    pref_set = set()
    city_set = set()          # 「市」「区」「町」「村」単位
    gun_set = set()           # 現行の「郡」
    postal = {}               # zipcode → {pref, city, town}
    # OLD_TOWNS の町域が現行 ken_all のどの市に存在するか
    # キーは "市名|旧町名"、例: "焼津市|栄町"
    old_towns_sorted = sorted(old_towns, key=lambda s: -len(s))
    conflict_set = set()
    raw_reader = csv.reader(io.StringIO(csv_text))
    for row in raw_reader:
        if len(row) < 9:
            continue
        zipcode = row[2].strip()
        pref = row[6].strip()
        city = row[7].strip()
        town_raw = row[8].strip()
        town = clean_town(town_raw)
        if not zipcode or not pref or not city:
            continue
        pref_set.add(pref)

        m = GUN_RE.match(city)
        if m:
            gun_set.add(m.group(1))
            city_set.add(m.group(2))   # 郡の下の町村
            city_set.add(city)          # "〇〇郡××町" 全体もマッチ用に保持
        else:
            city_set.add(city)
            # 政令指定都市「〇〇市××区」→ 「〇〇市」単体も現行扱いで追加
            sm = SEIREI_RE.match(city)
            if sm:
                city_set.add(sm.group(1))

        postal[zipcode] = {"pref": pref, "city": city, "town": town}

        # OLD_TOWNS conflict 判定：町域名が OLD_TOWNS のいずれかに等しい or 前方一致
        # 例: ken_all に "焼津市 / 栄町六丁目" → "焼津市|栄町" を conflict に追加
        if old_towns:
            tn = town_raw
            for ot in old_towns_sorted:
                if tn == ot or tn.startswith(ot):
                    conflict_set.add(f"{city}|{ot}")
                    break  # 最長一致で1件だけ記録

    return sorted(pref_set), sorted(city_set), sorted(gun_set), postal, sorted(conflict_set)


def write_cities_js(prefs, cities, guns, conflicts, extinct_cities, extinct_guns, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedFrom": "japanpost ken_all.zip (kogaki)",
        "prefectures": prefs,
        "currentCities": cities,
        "currentGuns": guns,
        "oldTownConflicts": conflicts,         # ["焼津市|栄町", ...]
        "extinctCities": extinct_cities,        # ["大宮市", "浦和市", ...]
        "extinctGuns": extinct_guns,            # ["志太郡", "橘樹郡", ...]
    }
    out.write_text(
        "// Auto-generated by scripts/build_postal_master.py — DO NOT EDIT by hand\n"
        "// Source: https://www.post.japanpost.jp/zipcode/dl/kogaki-zip.html\n"
        "window.POSTAL_MASTER_CITIES = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"[ok]   wrote {out} (prefs={len(prefs)}, cities={len(cities)}, guns={len(guns)}, conflicts={len(conflicts)}, extinctCities={len(extinct_cities)}, extinctGuns={len(extinct_guns)})")


def write_postal_json(postal: dict, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(postal, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[ok]   wrote {out} ({len(postal):,} entries, {out.stat().st_size:,} bytes)")


def main():
    zip_path = download_ken_all()
    csv_text = extract_csv(zip_path)
    old_towns = load_old_towns_from_html(HTML_PATH)
    print(f"[info] OLD_TOWNS from index.html: {len(old_towns)} entries")
    prefs, cities, guns, postal, conflicts = parse_rows(csv_text, old_towns)
    extinct_cities, extinct_guns = load_extinct_city_gun_names()
    print(f"[info] extinct cities/guns: {len(extinct_cities)} / {len(extinct_guns)}")
    write_cities_js(prefs, cities, guns, conflicts, extinct_cities, extinct_guns, DATA_DIR / "cities.js")
    write_postal_json(postal, DATA_DIR / "postal_master.json")
    print("[done]")


if __name__ == "__main__":
    sys.exit(main())
