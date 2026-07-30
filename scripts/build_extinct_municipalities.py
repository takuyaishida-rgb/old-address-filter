"""
旧市町村 → 新市町村 + 代表郵便番号のマッピングを生成する。

データソース:
  - NAreaCode (timej/NAreaCode, MIT)
      * StandardAreaCodeList.json … 団体コードと期間
      * ChangeEventList.json      … 変更イベント（編入/市制施行/名称変更等）
  - 日本郵便 ken_all.zip          … 代表郵便番号の取得

出力:
  data/extinct_municipalities.json
  [
    {
      "oldName": "志太郡大井川町",
      "oldCode": 22446,
      "prefecture": "静岡県",
      "newName": "焼津市",
      "newCode": 22212,
      "mergedAt": "2008-11-01",
      "representativeZip": "4210304"
    },
    ...
  ]
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
DATA_DIR = ROOT / "data"

NAREACODE_BASE = "https://raw.githubusercontent.com/timej/NAreaCode/master/NAreaCode/data"
KEN_ALL_PATH = RAW_DIR / "ken_all.zip"  # build_postal_master.py で取得済みの想定

# 都道府県コード（上位2桁）→ 都道府県名
PREF_MAP = {
    1: "北海道", 2: "青森県", 3: "岩手県", 4: "宮城県", 5: "秋田県",
    6: "山形県", 7: "福島県", 8: "茨城県", 9: "栃木県", 10: "群馬県",
    11: "埼玉県", 12: "千葉県", 13: "東京都", 14: "神奈川県", 15: "新潟県",
    16: "富山県", 17: "石川県", 18: "福井県", 19: "山梨県", 20: "長野県",
    21: "岐阜県", 22: "静岡県", 23: "愛知県", 24: "三重県", 25: "滋賀県",
    26: "京都府", 27: "大阪府", 28: "兵庫県", 29: "奈良県", 30: "和歌山県",
    31: "鳥取県", 32: "島根県", 33: "岡山県", 34: "広島県", 35: "山口県",
    36: "徳島県", 37: "香川県", 38: "愛媛県", 39: "高知県", 40: "福岡県",
    41: "佐賀県", 42: "長崎県", 43: "熊本県", 44: "大分県", 45: "宮崎県",
    46: "鹿児島県", 47: "沖縄県",
}

# 種別コード: 1=都道府県以上 / 3=政令市 / 4=市 / 5=町村 / 6=特別区 など
# "施行年月日"=1970-04-01 かつ "廃止年月日"=9999-... なら現行
CURRENT_SENTINEL = "9999-12-31"

# NAreaCode の変更事由コード（実データ観察から推定）:
#   0: 郡の区域変更のみ（名前同一、コード変更） — 旧住所判定には無関係なので除外
#   1: 新設合併（A+B+C→新D） — 平成大合併の主要パターン ★最重要
#   2: 編入（A→Bに編入）                          ★
#   3: 政令指定都市施行（同名でコード変化のみ）   — 除外
#   4: 市制施行（A町→A市）                        ★
#   5: 大島郡等の離島再編                         — 除外
#   6: 町制施行（A村→A町）                        ★
#   7: 名称変更                                   ★
#   11: 市制＋名称変更（複合）                    ★
RELEVANT_REASONS = {1, 2, 4, 6, 7, 11}


def download(url: str, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_size > 0:
        print(f"[skip] {out}")
        return out
    print(f"[dl]   {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(out, "wb") as f:
        f.write(r.read())
    print(f"[ok]   {out} ({out.stat().st_size:,} bytes)")
    return out


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def prefecture_from_code(code: int) -> str:
    # 1〜47: 都道府県コードそのもの
    # 101〜47XXX: 先頭2桁が都道府県コード（整数化で先頭0が落ちる）
    if 1 <= code <= 47:
        return PREF_MAP.get(code, "")
    # 北海道（01xxx）は id=1xxx （4桁）
    if code < 10000:
        pref = code // 1000  # 1xxx → 1 (北海道)
    else:
        pref = code // 1000  # 例 13201 → 13
    return PREF_MAP.get(pref, "")


def full_name_with_gun(entry: dict) -> str:
    name = entry.get("名称", "")
    gun = entry.get("郡名称") or ""
    return (gun + name) if gun else name


def build_code_index(std_list):
    """id -> [entries...]（同じIDに複数期間のレコードがある）"""
    idx = defaultdict(list)
    for e in std_list:
        idx[e["id"]].append(e)
    return idx


def find_extinct(std_list):
    """廃止年月日が9999未満で種別が市/町/村/区のもの"""
    result = []
    for e in std_list:
        end = e.get("廃止年月日", "")
        if end.startswith(CURRENT_SENTINEL):
            continue
        kind = e.get("種別")
        if kind not in (3, 4, 5, 6):
            continue
        result.append(e)
    return result


def resolve_new_for_extinct(extinct_entry, events, code_index):
    """廃止データ（events idのリスト）から新地域コードを取得して、現行エントリを返す。"""
    halt_ids = extinct_entry.get("廃止データ", []) or []
    if not halt_ids:
        return None, None
    # 最後のイベント（配列末尾）を採用
    last_event_id = halt_ids[-1]
    ev = events.get(last_event_id)
    if not ev:
        return None, None
    if ev.get("変更事由") not in RELEVANT_REASONS:
        return None, None
    new_codes = ev.get("変更後地域", []) or []
    merged_at = (ev.get("施行年月日") or "")[:10]
    # 変更後地域の中で「現行エントリ」を優先して選ぶ
    for nc in new_codes:
        candidates = code_index.get(nc, [])
        for c in candidates:
            if c.get("廃止年月日", "").startswith(CURRENT_SENTINEL):
                return c, merged_at
    # 現行が見つからなければ最初の候補
    for nc in new_codes:
        candidates = code_index.get(nc, [])
        if candidates:
            return candidates[0], merged_at
    return None, merged_at


def load_ken_all() -> list:
    """ken_all.zip を読み込み行リストを返す。"""
    with zipfile.ZipFile(KEN_ALL_PATH) as z:
        name = next(n for n in z.namelist() if n.upper().endswith(".CSV"))
        raw = z.read(name)
    text = raw.decode("cp932")
    reader = csv.reader(io.StringIO(text))
    return list(reader)


def build_zip_index(ken_rows):
    """全国地方公共団体コード(5桁) → 代表郵便番号(最初に見つかったもの)"""
    idx = {}
    for row in ken_rows:
        if len(row) < 9:
            continue
        code_str = row[0].strip()  # 全国地方公共団体コード(5or6桁の先頭5桁が市区町村)
        zipcode = row[2].strip()
        if not code_str or not zipcode:
            continue
        try:
            code = int(code_str[:5])
        except ValueError:
            continue
        idx.setdefault(code, zipcode)
    return idx


def build_zip_by_town(ken_rows):
    """(新市区町村名, 旧町村名 の部分文字列)で町域を探すため、ken_allの住所全集を保持"""
    # new_code -> list of (town, zip)
    idx = defaultdict(list)
    for row in ken_rows:
        if len(row) < 9:
            continue
        try:
            code = int(row[0].strip()[:5])
        except ValueError:
            continue
        zipcode = row[2].strip()
        town = row[8].strip()
        idx[code].append((town, zipcode))
    return idx


def build_zip_by_city_name(ken_rows):
    """市区町村名（全形）→ 代表郵便番号（先頭一致）"""
    idx = {}
    for row in ken_rows:
        if len(row) < 9:
            continue
        zipcode = row[2].strip()
        city_full = row[7].strip()
        if city_full and city_full not in idx:
            idx[city_full] = zipcode
    return idx


def representative_zip(old_name, new_entry, zip_city_idx, zip_town_idx, zip_city_name_idx):
    """旧町村名を残している町域があれば優先して返し、なければ市区町村代表、
    それでも無ければ新市名に旧名の核が含まれる行政区（さいたま市浦和区 等）を検索。"""
    new_code = new_entry["id"]
    new_name = new_entry.get("名称", "")
    # 旧の核になる名前（「志太郡大井川町」→「大井川」）
    core = re.sub(r"^.+?郡", "", old_name)
    core = re.sub(r"[市町村区]$", "", core)
    # (1) 町域に旧名の核を含むもの
    if core and core != old_name:
        for town, zipcode in zip_town_idx.get(new_code, []):
            if core in town:
                return zipcode
    # (2) 新団体コード直接の代表
    if new_code in zip_city_idx:
        return zip_city_idx[new_code]
    # (3) 新市名＋旧名の核の組み合わせに該当する行政区名（例: 「さいたま市浦和区」）
    if core and new_name:
        needle = new_name + core  # "さいたま市浦和"
        for city_full, zipcode in zip_city_name_idx.items():
            if city_full.startswith(needle):
                return zipcode
    # (4) 新市名だけで一致する最初
    if new_name:
        for city_full, zipcode in zip_city_name_idx.items():
            if city_full == new_name or city_full.startswith(new_name):
                return zipcode
    return ""


def load_showa_addendum(zip_city_name_idx: dict, zip_city_idx: dict) -> list:
    """昭和合併等の手作業キュレーションデータを読み込み、rep zip を補完する"""
    path = DATA_DIR / "showa_addendum.json"
    if not path.exists():
        print(f"[skip] {path} 無し（addendum なし）")
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in raw:
        # _section 等のメタ（oldName を持たないエントリ）はスキップ
        if not r.get("oldName"):
            continue
        old_name_core = r["oldName"]
        gun = r.get("_gun") or ""
        old_full = (gun + old_name_core) if gun else old_name_core
        new_name = r["newName"]
        # rep zip lookup from ken_all by city name
        rep_zip = ""
        if zip_city_name_idx:
            # 完全一致 or 前方一致
            if new_name in zip_city_name_idx:
                rep_zip = zip_city_name_idx[new_name]
            else:
                for cf, z in zip_city_name_idx.items():
                    if cf.startswith(new_name):
                        rep_zip = z
                        break
        out.append({
            "oldName": old_full,
            "oldCode": 0,
            "prefecture": r["prefecture"],
            "newName": new_name,
            "newCode": 0,
            "mergedAt": r.get("mergedAt", ""),
            "representativeZip": rep_zip,
        })
    return out


def main():
    print("=== NAreaCode DL ===")
    std_path = download(f"{NAREACODE_BASE}/StandardAreaCodeList.json", RAW_DIR / "StandardAreaCodeList.json")
    evt_path = download(f"{NAREACODE_BASE}/ChangeEventList.json", RAW_DIR / "ChangeEventList.json")

    std_list = load_json(std_path)
    evt_list = load_json(evt_path)
    events = {e["id"]: e for e in evt_list}

    code_index = build_code_index(std_list)

    if not KEN_ALL_PATH.exists():
        print(f"[warn] ken_all.zip not found at {KEN_ALL_PATH} — run build_postal_master.py first")
        ken_rows = []
    else:
        ken_rows = load_ken_all()

    zip_city_idx = build_zip_index(ken_rows) if ken_rows else {}
    zip_town_idx = build_zip_by_town(ken_rows) if ken_rows else {}
    zip_city_name_idx = build_zip_by_city_name(ken_rows) if ken_rows else {}

    extinct = find_extinct(std_list)
    print(f"[info] extinct entries: {len(extinct):,}")

    out = []
    skipped = 0
    for e in extinct:
        new_entry, merged_at = resolve_new_for_extinct(e, events, code_index)
        if not new_entry:
            skipped += 1
            continue
        old_name = full_name_with_gun(e)
        pref = prefecture_from_code(e["id"])
        rep_zip = representative_zip(old_name, new_entry, zip_city_idx, zip_town_idx, zip_city_name_idx)
        out.append({
            "oldName": old_name,
            "oldCode": e["id"],
            "prefecture": pref,
            "newName": full_name_with_gun(new_entry),
            "newCode": new_entry["id"],
            "mergedAt": merged_at,
            "representativeZip": rep_zip,
        })

    # 昭和合併等の手作業 addendum をマージ
    showa = load_showa_addendum(zip_city_name_idx, zip_city_idx)
    print(f"[info] showa addendum: {len(showa)} entries")
    out.extend(showa)

    # 同じ oldName が別期間で複数出る可能性があるので、最新の mergedAt を残す
    dedup = {}
    for item in out:
        key = (item["prefecture"], item["oldName"])
        if key not in dedup or item["mergedAt"] > dedup[key]["mergedAt"]:
            dedup[key] = item
    final = sorted(dedup.values(), key=lambda x: (x["prefecture"], x["oldName"]))

    out_path = DATA_DIR / "extinct_municipalities.json"
    out_path.write_text(json.dumps(final, ensure_ascii=False, indent=0, separators=(",", ":")), encoding="utf-8")
    print(f"[ok]   wrote {out_path} ({len(final):,} entries, skipped {skipped} ambiguous)")

    # 簡易サンプル
    samples = ["志太郡大井川町", "浦和市", "大宮市", "津久井町", "具志川市", "北多摩郡国立町", "南多摩郡多摩村", "武儀郡倉知村"]
    for s in samples:
        hit = next((x for x in final if x["oldName"].endswith(s) or x["oldName"] == s), None)
        print(f"  sample {s!r:25s} -> {hit}")


if __name__ == "__main__":
    sys.exit(main())
