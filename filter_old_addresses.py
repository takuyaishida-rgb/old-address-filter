"""
旧住所フィルタリングスクリプト - Phase 3（全国対応版）
=================================================================
DM送付リストから旧住所を判定し、除外候補をフラグ付けする。

対応都道府県: 全47都道府県

使い方:
    python filter_old_addresses.py <入力CSVパス> [--output <出力CSVパス>] [--prefecture 東京都]

入力CSV要件:
    - 「所有者住所」列（または --address-col で指定）を含むCSV
    - エンコーディング: UTF-8 or Shift-JIS（自動判定）
"""

import csv
import re
import sys
import os
import argparse
from dataclasses import dataclass, field
from typing import List, Tuple, Dict, Set
from datetime import datetime


# ============================================================
# 郵便番号データ（KEN_ALL）ローダー
# ============================================================

# KEN_ALL.CSV カラム定義
# 0: 全国地方公共団体コード, 1: 旧郵便番号(5桁), 2: 郵便番号(7桁)
# 3: 都道府県名(カナ), 4: 市区町村名(カナ), 5: 町域名(カナ)
# 6: 都道府県名, 7: 市区町村名, 8: 町域名
# 9-13: フラグ, 14: 更新表示(2=廃止), 15: 変更理由(6=廃止)

class PostalMaster:
    """郵便番号マスターデータ"""

    def __init__(self):
        self.valid_towns: Set[str] = set()        # 現行の「市区町村名+町域名」セット
        self.valid_cities: Set[str] = set()        # 現行の「市区町村名」セット
        self.city_towns: Dict[str, Set[str]] = {}  # 市区町村名 → 町域名のセット
        self.loaded = False

    def load_from_csv(self, filepath: str):
        """KEN_ALL形式のCSVを読み込む"""
        if not os.path.exists(filepath):
            print(f"[WARN] 郵便番号マスターが見つかりません: {filepath}")
            return

        encodings = ["utf-8-sig", "utf-8", "shift_jis", "cp932"]
        content = None
        for enc in encodings:
            try:
                with open(filepath, "r", encoding=enc) as f:
                    content = f.read()
                break
            except (UnicodeDecodeError, UnicodeError):
                continue

        if not content:
            print(f"[WARN] 郵便番号マスターの読み取りに失敗: {filepath}")
            return

        reader = csv.reader(content.splitlines())
        for row in reader:
            if len(row) < 9:
                continue
            city = row[7].strip().replace('"', '')
            town = row[8].strip().replace('"', '')

            # 「以下に掲載がない場合」は除外
            if "以下に掲載がない場合" in town:
                continue

            self.valid_cities.add(city)
            self.valid_towns.add(f"{city}{town}")

            if city not in self.city_towns:
                self.city_towns[city] = set()
            self.city_towns[city].add(town)

        self.loaded = True
        print(f"[INFO] 郵便番号マスター読み込み完了: {len(self.valid_towns)}町域, {len(self.valid_cities)}市区町村")

    def find_town_in_address(self, address: str) -> dict:
        """
        住所から市区町村名・町域名を抽出し、マスターに存在するか確認。

        Returns:
            dict: {
                "city_found": bool,       市区町村名がマスターに存在するか
                "town_found": bool,       町域名がマスターに存在するか
                "matched_city": str,      マッチした市区町村名
                "matched_town": str,      マッチした町域名
                "similar_towns": list,    類似する現行町域名（不一致時）
            }
        """
        result = {
            "city_found": False,
            "town_found": False,
            "matched_city": "",
            "matched_town": "",
            "similar_towns": [],
        }

        if not self.loaded or not address:
            return result

        # 都道府県名を除去
        addr = re.sub(r"^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)", "", address)

        # 市区町村名を探す
        matched_city = ""
        for city in sorted(self.valid_cities, key=len, reverse=True):
            if addr.startswith(city) or city in addr:
                matched_city = city
                result["city_found"] = True
                result["matched_city"] = city
                break

        if not matched_city:
            return result

        # 市区町村名以降の部分を取得
        remaining = addr[addr.index(matched_city) + len(matched_city):]

        # 丁目付き判定: 「入谷１丁目」→ base_town=「入谷」, has_choume=True
        choume_match = re.match(r"^(.+?)[0-9０-９一二三四五六七八九十]+丁目", remaining)
        has_choume = bool(choume_match)
        base_town_from_choume = choume_match.group(1) if choume_match else ""

        # 番地部分を除去（数字・ハイフン以降）
        remaining_clean = re.split(r"[0-9０-９一二三四五六七八九十]+", remaining)[0]
        remaining_clean = remaining_clean.rstrip("丁目番地号の-ー－")

        if not remaining_clean:
            return result

        # 完全一致チェック
        full_town = f"{matched_city}{remaining_clean}"
        if full_town in self.valid_towns:
            result["town_found"] = True
            result["matched_town"] = remaining_clean
            return result

        if matched_city in self.city_towns:
            city_town_set = self.city_towns[matched_city]

            # 丁目付きの場合は厳密判定:
            # 「入谷１丁目」→ マスターに「入谷」が完全一致する町域のみ許可
            if has_choume:
                if base_town_from_choume in city_town_set:
                    result["town_found"] = True
                    result["matched_town"] = base_town_from_choume
                    return result
            else:
                # 丁目なしの場合のみ部分一致を許可
                for town in city_town_set:
                    if remaining_clean.startswith(town) or town.startswith(remaining_clean):
                        result["town_found"] = True
                        result["matched_town"] = town
                        return result

            # 不一致の場合、類似町域名を提示
            similar = [t for t in city_town_set
                       if len(remaining_clean) >= 2 and (remaining_clean[:2] in t or t[:2] in remaining_clean)]
            result["similar_towns"] = similar[:5]

        return result


# グローバルインスタンス
postal_master = PostalMaster()


# ============================================================
# 旧自治体マスターローダー
# ============================================================

def load_old_municipalities(filepath: str) -> dict:
    """
    旧自治体CSVを読み込み、辞書形式で返す。
    Returns: { 旧住所キーワード: { "current": 現市町村名, "date": 変遷年月日, "note": 備考 } }
    """
    result = {}
    if not os.path.exists(filepath):
        return result

    encodings = ["utf-8-sig", "utf-8", "shift_jis", "cp932"]
    for enc in encodings:
        try:
            with open(filepath, "r", encoding=enc) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    keyword = row.get("旧住所キーワード", "").strip().strip('"')
                    current = row.get("現市町村名", "").strip().strip('"')
                    date = row.get("変遷年月日", "").strip().strip('"')
                    note = row.get("備考", "").strip().strip('"')
                    if keyword:
                        result[keyword] = {"current": current, "date": date, "note": note}
            break
        except (UnicodeDecodeError, UnicodeError):
            continue

    return result


# ============================================================
# 都県別マスター設定
# ============================================================

PREFECTURE_CONFIG = {
    "北海道": {
        "municipalities_csv": "01HOKKAI.CSV",
        "old_muni_csv": "hokkaido_old_municipalities.csv",
        "extinct_districts": {
            "亀田郡": {"current": "函館市", "extinct_date": "2004-12-01", "min_years": 20},
            "上磯郡": {"current": "北斗市", "extinct_date": "2006-02-01", "min_years": 18},
        },
        "heisei_merged": {
            "戸井町": {"current": "函館市", "merged_date": "2004-12-01"},
            "恵山町": {"current": "函館市", "merged_date": "2004-12-01"},
            "椴法華村": {"current": "函館市", "merged_date": "2004-12-01"},
            "南茅部町": {"current": "函館市", "merged_date": "2004-12-01"},
            "上磯町": {"current": "北斗市", "merged_date": "2006-02-01"},
            "大野町": {"current": "北斗市", "merged_date": "2006-02-01"},
            "阿寒町": {"current": "釧路市", "merged_date": "2005-10-11"},
            "音別町": {"current": "釧路市", "merged_date": "2005-10-11"},
            "虻田町": {"current": "洞爺湖町", "merged_date": "2006-03-27"},
            "洞爺村": {"current": "洞爺湖町", "merged_date": "2006-03-27"},
            "鷹栖町": {"current": "旭川市", "merged_date": "2005-09-01"},
        },
    },
    "青森県": {
        "municipalities_csv": "02AOMORI.CSV",
        "old_muni_csv": "aomori_old_municipalities.csv",
        "extinct_districts": {
            "下北郡": {"current": "むつ市", "extinct_date": "2005-03-14", "min_years": 20},
            "中津軽郡": {"current": "弘前市", "extinct_date": "2006-02-27", "min_years": 18},
        },
        "heisei_merged": {
            "大畑町": {"current": "むつ市", "merged_date": "2005-03-14"},
            "川内町": {"current": "むつ市", "merged_date": "2005-03-14"},
            "脇野沢村": {"current": "むつ市", "merged_date": "2005-03-14"},
            "浪岡町": {"current": "青森市", "merged_date": "2005-04-01"},
            "岩木町": {"current": "弘前市", "merged_date": "2006-02-27"},
            "相馬村": {"current": "弘前市", "merged_date": "2006-02-27"},
            "木造町": {"current": "つがる市", "merged_date": "2005-02-11"},
            "平賀町": {"current": "平川市", "merged_date": "2006-01-01"},
        },
    },
    "岩手県": {
        "municipalities_csv": "03IWATE.CSV",
        "old_muni_csv": "iwate_old_municipalities.csv",
        "extinct_districts": {
            "胆沢郡": {"current": "奥州市", "extinct_date": "2006-02-20", "min_years": 18},
            "稗貫郡": {"current": "花巻市", "extinct_date": "2006-01-01", "min_years": 18},
            "東磐井郡": {"current": "一関市", "extinct_date": "2011-09-26", "min_years": 14},
        },
        "heisei_merged": {
            "水沢市": {"current": "奥州市", "merged_date": "2006-02-20"},
            "江刺市": {"current": "奥州市", "merged_date": "2006-02-20"},
            "前沢町": {"current": "奥州市", "merged_date": "2006-02-20"},
            "胆沢町": {"current": "奥州市", "merged_date": "2006-02-20"},
            "衣川村": {"current": "奥州市", "merged_date": "2006-02-20"},
            "石鳥谷町": {"current": "花巻市", "merged_date": "2006-01-01"},
            "大迫町": {"current": "花巻市", "merged_date": "2006-01-01"},
            "東和町": {"current": "花巻市", "merged_date": "2006-01-01"},
            "三陸町": {"current": "大船渡市", "merged_date": "2001-11-15"},
        },
    },
    "宮城県": {
        "municipalities_csv": "04MIYAGI.CSV",
        "old_muni_csv": "miyagi_old_municipalities.csv",
        "extinct_districts": {
            "桃生郡": {"current": "石巻市", "extinct_date": "2005-04-01", "min_years": 20},
            "志田郡": {"current": "大崎市", "extinct_date": "2006-03-31", "min_years": 18},
            "玉造郡": {"current": "大崎市", "extinct_date": "2006-03-31", "min_years": 18},
        },
        "heisei_merged": {
            "河南町": {"current": "石巻市", "merged_date": "2005-04-01"},
            "河北町": {"current": "石巻市", "merged_date": "2005-04-01"},
            "雄勝町": {"current": "石巻市", "merged_date": "2005-04-01"},
            "北上町": {"current": "石巻市", "merged_date": "2005-04-01"},
            "牡鹿町": {"current": "石巻市", "merged_date": "2005-04-01"},
            "古川市": {"current": "大崎市", "merged_date": "2006-03-31"},
            "松山町": {"current": "大崎市", "merged_date": "2006-03-31"},
            "三本木町": {"current": "大崎市", "merged_date": "2006-03-31"},
            "鹿島台町": {"current": "大崎市", "merged_date": "2006-03-31"},
            "岩出山町": {"current": "大崎市", "merged_date": "2006-03-31"},
            "鳴子町": {"current": "大崎市", "merged_date": "2006-03-31"},
            "田尻町": {"current": "大崎市", "merged_date": "2006-03-31"},
            "小牛田町": {"current": "美里町", "merged_date": "2006-03-31"},
            "南郷町": {"current": "美里町", "merged_date": "2006-03-31"},
        },
    },
    "秋田県": {
        "municipalities_csv": "05AKITA.CSV",
        "old_muni_csv": "akita_old_municipalities.csv",
        "extinct_districts": {
            "河辺郡": {"current": "秋田市", "extinct_date": "2005-01-11", "min_years": 20},
            "由利郡": {"current": "由利本荘市", "extinct_date": "2005-03-22", "min_years": 20},
            "仙北郡": {"current": "大仙市・仙北市", "extinct_date": "2005-09-20", "min_years": 20},
        },
        "heisei_merged": {
            "河辺町": {"current": "秋田市", "merged_date": "2005-01-11"},
            "雄和町": {"current": "秋田市", "merged_date": "2005-01-11"},
            "本荘市": {"current": "由利本荘市", "merged_date": "2005-03-22"},
            "大曲市": {"current": "大仙市", "merged_date": "2005-03-22"},
            "角館町": {"current": "仙北市", "merged_date": "2005-09-20"},
            "田沢湖町": {"current": "仙北市", "merged_date": "2005-09-20"},
            "西木村": {"current": "仙北市", "merged_date": "2005-09-20"},
        },
    },
    "山形県": {
        "municipalities_csv": "06YAMAGAT.CSV",
        "old_muni_csv": "yamagata_old_municipalities.csv",
        "extinct_districts": {
            "東田川郡": {"current": "鶴岡市", "extinct_date": "2005-10-01", "min_years": 20},
            "飽海郡": {"current": "酒田市", "extinct_date": "2005-11-01", "min_years": 20},
        },
        "heisei_merged": {
            "藤島町": {"current": "鶴岡市", "merged_date": "2005-10-01"},
            "羽黒町": {"current": "鶴岡市", "merged_date": "2005-10-01"},
            "櫛引町": {"current": "鶴岡市", "merged_date": "2005-10-01"},
            "朝日村": {"current": "鶴岡市", "merged_date": "2005-10-01"},
            "温海町": {"current": "鶴岡市", "merged_date": "2005-10-01"},
            "八幡町": {"current": "酒田市", "merged_date": "2005-11-01"},
            "松山町": {"current": "酒田市", "merged_date": "2005-11-01"},
            "平田町": {"current": "酒田市", "merged_date": "2005-11-01"},
        },
    },
    "福島県": {
        "municipalities_csv": "07FUKUSIM.CSV",
        "old_muni_csv": "fukushima_old_municipalities.csv",
        "extinct_districts": {
            "安達郡": {"current": "二本松市・本宮市", "extinct_date": "2007-01-01", "min_years": 18},
        },
        "heisei_merged": {
            "岩代町": {"current": "二本松市", "merged_date": "2005-12-01"},
            "東和町": {"current": "二本松市", "merged_date": "2005-12-01"},
            "本宮町": {"current": "本宮市", "merged_date": "2007-01-01"},
            "喜多方市": {"current": "喜多方市", "merged_date": "2006-01-04"},
            "熱塩加納村": {"current": "喜多方市", "merged_date": "2006-01-04"},
            "勿来市": {"current": "いわき市", "merged_date": "1966-10-01"},
            "内郷市": {"current": "いわき市", "merged_date": "1966-10-01"},
            "平市": {"current": "いわき市", "merged_date": "1966-10-01"},
            "常磐市": {"current": "いわき市", "merged_date": "1966-10-01"},
        },
    },
    "茨城県": {
        "municipalities_csv": "08IBARAKI.CSV",
        "old_muni_csv": "ibaraki_old_municipalities.csv",
        "extinct_districts": {
            "真壁郡": {"current": "桜川市・筑西市", "extinct_date": "2005-10-01", "min_years": 20},
            "新治郡": {"current": "土浦市・つくば市等", "extinct_date": "2006-02-20", "min_years": 18},
        },
        "heisei_merged": {
            "真壁町": {"current": "桜川市", "merged_date": "2005-10-01"},
            "大和村": {"current": "桜川市", "merged_date": "2005-10-01"},
            "岩瀬町": {"current": "桜川市", "merged_date": "2005-10-01"},
            "下館市": {"current": "筑西市", "merged_date": "2005-03-28"},
            "内原町": {"current": "水戸市", "merged_date": "2005-02-01"},
            "波崎町": {"current": "神栖市", "merged_date": "2005-08-01"},
        },
    },
    "栃木県": {
        "municipalities_csv": "09TOCHIGI.CSV",
        "old_muni_csv": "tochigi_old_municipalities.csv",
        "extinct_districts": {
            "都賀郡": {"current": "栃木市", "extinct_date": "2011-10-01", "min_years": 14},
            "上都賀郡": {"current": "鹿沼市", "extinct_date": "2006-01-01", "min_years": 18},
            "南那須郡": {"current": "那須烏山市・那珂川町", "extinct_date": "2005-10-01", "min_years": 20},
        },
        "heisei_merged": {
            "都賀町": {"current": "栃木市", "merged_date": "2010-03-29"},
            "粟野町": {"current": "鹿沼市", "merged_date": "2006-01-01"},
            "今市市": {"current": "日光市", "merged_date": "2006-03-20"},
            "藤原町": {"current": "日光市", "merged_date": "2006-03-20"},
            "足尾町": {"current": "日光市", "merged_date": "2006-03-20"},
            "烏山町": {"current": "那須烏山市", "merged_date": "2005-10-01"},
            "黒磯市": {"current": "那須塩原市", "merged_date": "2005-10-01"},
        },
    },
    "群馬県": {
        "municipalities_csv": "10GUNMA.CSV",
        "old_muni_csv": "gunma_old_municipalities.csv",
        "extinct_districts": {
            "勢多郡": {"current": "前橋市", "extinct_date": "2009-05-05", "min_years": 16},
            "新田郡": {"current": "太田市・みどり市", "extinct_date": "2006-03-27", "min_years": 18},
            "佐波郡": {"current": "伊勢崎市", "extinct_date": "2005-01-01", "min_years": 20},
        },
        "heisei_merged": {
            "富士見村": {"current": "前橋市", "merged_date": "2009-05-05"},
            "新田町": {"current": "太田市", "merged_date": "2005-03-28"},
            "笠懸町": {"current": "みどり市", "merged_date": "2006-03-27"},
            "鬼石町": {"current": "藤岡市", "merged_date": "2006-01-01"},
            "境町": {"current": "伊勢崎市", "merged_date": "2005-01-01"},
        },
    },
    "神奈川県": {
        "municipalities_csv": "14KANAGA_UTF8.CSV",
        "old_muni_csv": "kanagawa_old_municipalities.csv",
        # 消滅済み郡名（確実にHIGH）
        "extinct_districts": {
            "久良岐郡": {"current": "横浜市", "extinct_date": "1927-04-01", "min_years": 90},
            "橘樹郡": {"current": "横浜市・川崎市", "extinct_date": "1938-10-01", "min_years": 85},
            "都筑郡": {"current": "横浜市", "extinct_date": "1939-04-01", "min_years": 85},
            "鎌倉郡": {"current": "横浜市・藤沢市等", "extinct_date": "1948-06-01", "min_years": 75},
            "津久井郡": {"current": "相模原市", "extinct_date": "2007-03-11", "min_years": 15},
        },
        # 平成合併で消滅した町名（HIGH）
        "heisei_merged": {
            "津久井町": {"current": "相模原市緑区", "merged_date": "2006-03-20"},
            "相模湖町": {"current": "相模原市緑区", "merged_date": "2006-03-20"},
            "城山町": {"current": "相模原市緑区", "merged_date": "2007-03-11"},
            "藤野町": {"current": "相模原市緑区", "merged_date": "2007-03-11"},
        },
    },
    "埼玉県": {
        "municipalities_csv": "11SAITAM.CSV",
        "old_muni_csv": "saitama_old_municipalities.csv",
        "extinct_districts": {
            "北埼玉郡": {"current": "加須市等", "extinct_date": "2010-03-23", "min_years": 15},
        },
        "heisei_merged": {
            "浦和市": {"current": "さいたま市", "merged_date": "2001-05-01"},
            "大宮市": {"current": "さいたま市", "merged_date": "2001-05-01"},
            "与野市": {"current": "さいたま市", "merged_date": "2001-05-01"},
            "岩槻市": {"current": "さいたま市岩槻区", "merged_date": "2005-04-01"},
            "鳩ヶ谷市": {"current": "川口市", "merged_date": "2011-10-11"},
            "上福岡市": {"current": "ふじみ野市", "merged_date": "2005-10-01"},
            "大井町": {"current": "ふじみ野市", "merged_date": "2005-10-01"},
            "庄和町": {"current": "春日部市", "merged_date": "2005-10-01"},
            "妻沼町": {"current": "熊谷市", "merged_date": "2005-10-01"},
            "江南町": {"current": "熊谷市", "merged_date": "2007-02-13"},
            "岡部町": {"current": "深谷市", "merged_date": "2006-01-01"},
            "川本町": {"current": "深谷市", "merged_date": "2006-01-01"},
            "花園町": {"current": "深谷市", "merged_date": "2006-01-01"},
            "児玉町": {"current": "本庄市", "merged_date": "2006-01-10"},
            "吉田町": {"current": "秩父市", "merged_date": "2005-04-01"},
            "荒川村": {"current": "秩父市", "merged_date": "2005-04-01"},
            "大滝村": {"current": "秩父市", "merged_date": "2005-04-01"},
            "名栗村": {"current": "飯能市", "merged_date": "2005-01-01"},
            "騎西町": {"current": "加須市", "merged_date": "2010-03-23"},
            "北川辺町": {"current": "加須市", "merged_date": "2010-03-23"},
            "大利根町": {"current": "加須市", "merged_date": "2010-03-23"},
            "鷲宮町": {"current": "久喜市", "merged_date": "2010-03-23"},
            "菖蒲町": {"current": "久喜市", "merged_date": "2010-03-23"},
            "栗橋町": {"current": "久喜市", "merged_date": "2010-03-23"},
            "吹上町": {"current": "鴻巣市", "merged_date": "2005-10-01"},
            "川里町": {"current": "鴻巣市", "merged_date": "2005-10-01"},
        },
    },
    "千葉県": {
        "municipalities_csv": "12CHIBA.CSV",
        "old_muni_csv": "chiba_old_municipalities.csv",
        "extinct_districts": {
            "千葉郡": {"current": "千葉市等", "extinct_date": "2005-03-28", "min_years": 20},
            "海上郡": {"current": "旭市", "extinct_date": "2005-07-01", "min_years": 20},
            "匝瑳郡": {"current": "匝瑳市", "extinct_date": "2006-01-23", "min_years": 18},
        },
        "heisei_merged": {
            "関宿町": {"current": "野田市", "merged_date": "2003-06-06"},
            "三芳村": {"current": "館山市", "merged_date": "2006-03-20"},
            "富山町": {"current": "南房総市", "merged_date": "2006-03-20"},
            "白浜町": {"current": "南房総市", "merged_date": "2006-03-20"},
            "千倉町": {"current": "南房総市", "merged_date": "2006-03-20"},
            "丸山町": {"current": "南房総市", "merged_date": "2006-03-20"},
            "和田町": {"current": "南房総市", "merged_date": "2006-03-20"},
            "天津小湊町": {"current": "鴨川市", "merged_date": "2004-11-01"},
            "大原町": {"current": "いすみ市", "merged_date": "2009-03-23"},
            "岬町": {"current": "いすみ市", "merged_date": "2009-03-23"},
            "夷隅町": {"current": "いすみ市", "merged_date": "2009-03-23"},
            "佐原市": {"current": "香取市", "merged_date": "2006-03-27"},
            "小見川町": {"current": "香取市", "merged_date": "2006-03-27"},
            "山田町": {"current": "香取市", "merged_date": "2006-03-27"},
            "栗源町": {"current": "香取市", "merged_date": "2006-03-27"},
            "八日市場市": {"current": "匝瑳市", "merged_date": "2006-01-23"},
            "野栄町": {"current": "匝瑳市", "merged_date": "2006-01-23"},
            "海上町": {"current": "旭市", "merged_date": "2005-07-01"},
            "飯岡町": {"current": "旭市", "merged_date": "2005-07-01"},
            "干潟町": {"current": "旭市", "merged_date": "2005-07-01"},
            "山武町": {"current": "山武市", "merged_date": "2006-03-27"},
            "蓮沼村": {"current": "山武市", "merged_date": "2006-03-27"},
            "松尾町": {"current": "山武市", "merged_date": "2006-03-27"},
            "成東町": {"current": "山武市", "merged_date": "2006-03-27"},
            "沼南町": {"current": "柏市", "merged_date": "2005-03-28"},
            "本埜村": {"current": "印西市", "merged_date": "2010-03-23"},
            "印旛村": {"current": "印西市", "merged_date": "2010-03-23"},
            "都賀町": {"current": "千葉市若葉区", "merged_date": "2005-03-28"},
        },
    },
    "東京都": {
        "municipalities_csv": "13TOKYO.CSV",
        "old_muni_csv": "tokyo_old_municipalities.csv",
        "extinct_districts": {
            "荏原郡": {"current": "世田谷区・目黒区・品川区・大田区", "extinct_date": "1932-10-01", "min_years": 90},
            "豊多摩郡": {"current": "新宿区・渋谷区・中野区・杉並区", "extinct_date": "1932-10-01", "min_years": 90},
            "北豊島郡": {"current": "豊島区・板橋区・荒川区・足立区・北区", "extinct_date": "1932-10-01", "min_years": 90},
            "南足立郡": {"current": "足立区", "extinct_date": "1932-10-01", "min_years": 90},
            "南葛飾郡": {"current": "葛飾区・江戸川区", "extinct_date": "1932-10-01", "min_years": 90},
            "北多摩郡": {"current": "立川市・府中市・調布市・三鷹市等", "extinct_date": "1970-10-01", "min_years": 55},
            "南多摩郡": {"current": "八王子市・多摩市・稲城市等", "extinct_date": "1967-01-01", "min_years": 55},
            "東京府": {"current": "東京都", "extinct_date": "1943-07-01", "min_years": 80},
        },
        "heisei_merged": {
            "保谷市": {"current": "西東京市", "merged_date": "2001-01-21"},
            "田無市": {"current": "西東京市", "merged_date": "2001-01-21"},
            "秋川市": {"current": "あきる野市", "merged_date": "1995-09-01"},
            "五日市町": {"current": "あきる野市", "merged_date": "1995-09-01"},
            # 1947年区再編（消滅した区）
            "城東区": {"current": "江東区・江戸川区", "merged_date": "1947-03-15"},
            "深川区": {"current": "江東区", "merged_date": "1947-03-15"},
            "本所区": {"current": "墨田区", "merged_date": "1947-03-15"},
            "向島区": {"current": "墨田区", "merged_date": "1947-03-15"},
            "浅草区": {"current": "台東区", "merged_date": "1947-03-15"},
            "下谷区": {"current": "台東区", "merged_date": "1947-03-15"},
            "神田区": {"current": "千代田区", "merged_date": "1947-03-15"},
            "麹町区": {"current": "千代田区", "merged_date": "1947-03-15"},
            "日本橋区": {"current": "中央区", "merged_date": "1947-03-15"},
            "京橋区": {"current": "中央区", "merged_date": "1947-03-15"},
            "芝区": {"current": "港区", "merged_date": "1947-03-15"},
            "麻布区": {"current": "港区", "merged_date": "1947-03-15"},
            "赤坂区": {"current": "港区", "merged_date": "1947-03-15"},
            "四谷区": {"current": "新宿区", "merged_date": "1947-03-15"},
            "牛込区": {"current": "新宿区", "merged_date": "1947-03-15"},
            "淀橋区": {"current": "新宿区", "merged_date": "1947-03-15"},
            "小石川区": {"current": "文京区", "merged_date": "1947-03-15"},
            "本郷区": {"current": "文京区", "merged_date": "1947-03-15"},
            "滝野川区": {"current": "北区", "merged_date": "1947-03-15"},
            "王子区": {"current": "北区", "merged_date": "1947-03-15"},
            "蒲田区": {"current": "大田区", "merged_date": "1947-03-15"},
            "荏原区": {"current": "大田区・品川区", "merged_date": "1947-03-15"},
        },
    },
    "新潟県": {
        "municipalities_csv": "15NIIGAT.CSV",
        "old_muni_csv": "niigata_old_municipalities.csv",
        "extinct_districts": {
            "北蒲原郡": {"current": "新発田市・聖籠町", "extinct_date": "2010-03-31", "min_years": 15},
            "中蒲原郡": {"current": "新潟市", "extinct_date": "2005-03-21", "min_years": 20},
            "南魚沼郡": {"current": "南魚沼市・湯沢町", "extinct_date": "2004-11-01", "min_years": 20},
        },
        "heisei_merged": {
            "豊栄市": {"current": "新潟市北区", "merged_date": "2005-03-21"},
            "新津市": {"current": "新潟市秋葉区", "merged_date": "2005-03-21"},
            "亀田町": {"current": "新潟市江南区", "merged_date": "2005-03-21"},
            "巻町": {"current": "新潟市西蒲区", "merged_date": "2005-03-21"},
            "六日町": {"current": "南魚沼市", "merged_date": "2004-11-01"},
            "大和町": {"current": "南魚沼市", "merged_date": "2004-11-01"},
            "栄町": {"current": "三条市", "merged_date": "2005-05-01"},
            "下田村": {"current": "三条市", "merged_date": "2005-05-01"},
        },
    },
    "富山県": {
        "municipalities_csv": "16TOYAMA.CSV",
        "old_muni_csv": "toyama_old_municipalities.csv",
        "extinct_districts": {
            "婦負郡": {"current": "富山市", "extinct_date": "2008-11-01", "min_years": 16},
            "上新川郡": {"current": "富山市", "extinct_date": "2005-04-01", "min_years": 20},
            "東砺波郡": {"current": "南砺市・砺波市", "extinct_date": "2004-11-01", "min_years": 20},
            "西砺波郡": {"current": "南砺市", "extinct_date": "2004-11-01", "min_years": 20},
        },
        "heisei_merged": {
            "大山町": {"current": "富山市", "merged_date": "2005-04-01"},
            "八尾町": {"current": "富山市", "merged_date": "2005-04-01"},
            "細入村": {"current": "富山市", "merged_date": "2008-11-01"},
            "福野町": {"current": "南砺市", "merged_date": "2004-11-01"},
            "城端町": {"current": "南砺市", "merged_date": "2004-11-01"},
            "福光町": {"current": "南砺市", "merged_date": "2004-11-01"},
            "庄川町": {"current": "砺波市", "merged_date": "2004-11-01"},
        },
    },
    "石川県": {
        "municipalities_csv": "17ISHIKA.CSV",
        "old_muni_csv": "ishikawa_old_municipalities.csv",
        "extinct_districts": {
            "河北郡": {"current": "かほく市・津幡町・内灘町", "extinct_date": "2004-03-01", "min_years": 20},
            "石川郡": {"current": "白山市・野々市市", "extinct_date": "2011-11-11", "min_years": 14},
        },
        "heisei_merged": {
            "宇ノ気町": {"current": "かほく市", "merged_date": "2004-03-01"},
            "高松町": {"current": "かほく市", "merged_date": "2004-03-01"},
            "七塚町": {"current": "かほく市", "merged_date": "2004-03-01"},
            "松任市": {"current": "白山市", "merged_date": "2005-02-01"},
            "野々市町": {"current": "野々市市", "merged_date": "2011-11-11"},
            "門前町": {"current": "輪島市", "merged_date": "2006-02-01"},
        },
    },
    "福井県": {
        "municipalities_csv": "18FUKUI.CSV",
        "old_muni_csv": "fukui_old_municipalities.csv",
        "extinct_districts": {
            "足羽郡": {"current": "福井市", "extinct_date": "2006-02-01", "min_years": 18},
            "丹生郡": {"current": "越前市・越前町", "extinct_date": "2005-02-01", "min_years": 20},
            "今立郡": {"current": "越前市", "extinct_date": "2005-02-01", "min_years": 20},
            "遠敷郡": {"current": "小浜市・若狭町", "extinct_date": "2005-03-31", "min_years": 20},
        },
        "heisei_merged": {
            "美山町": {"current": "福井市", "merged_date": "2006-02-01"},
            "武生市": {"current": "越前市", "merged_date": "2005-10-01"},
            "今立町": {"current": "越前市", "merged_date": "2005-02-01"},
            "上中町": {"current": "若狭町", "merged_date": "2005-03-31"},
        },
    },
    "山梨県": {
        "municipalities_csv": "19YAMANAS.CSV",
        "old_muni_csv": "yamanashi_old_municipalities.csv",
        "extinct_districts": {
            "東八代郡": {"current": "笛吹市・山梨市・甲州市", "extinct_date": "2006-03-01", "min_years": 18},
            "東山梨郡": {"current": "山梨市・甲州市", "extinct_date": "2005-11-01", "min_years": 20},
        },
        "heisei_merged": {
            "石和町": {"current": "笛吹市", "merged_date": "2004-10-12"},
            "春日居町": {"current": "笛吹市", "merged_date": "2004-10-12"},
            "塩山市": {"current": "甲州市", "merged_date": "2005-11-01"},
            "若草町": {"current": "南アルプス市", "merged_date": "2003-04-01"},
            "白根町": {"current": "南アルプス市", "merged_date": "2003-04-01"},
            "田富町": {"current": "中央市", "merged_date": "2006-02-20"},
        },
    },
    "長野県": {
        "municipalities_csv": "20NAGANO.CSV",
        "old_muni_csv": "nagano_old_municipalities.csv",
        "extinct_districts": {
            "更級郡": {"current": "千曲市", "extinct_date": "2003-09-01", "min_years": 22},
            "南安曇郡": {"current": "松本市・安曇野市", "extinct_date": "2005-10-01", "min_years": 20},
        },
        "heisei_merged": {
            "更埴市": {"current": "千曲市", "merged_date": "2003-09-01"},
            "戸倉町": {"current": "千曲市", "merged_date": "2003-09-01"},
            "穂高町": {"current": "安曇野市", "merged_date": "2005-10-01"},
            "豊科町": {"current": "安曇野市", "merged_date": "2005-10-01"},
            "四賀村": {"current": "松本市", "merged_date": "2005-04-01"},
            "豊野町": {"current": "長野市", "merged_date": "2005-01-01"},
            "戸隠村": {"current": "長野市", "merged_date": "2005-01-01"},
        },
    },
    "岐阜県": {
        "municipalities_csv": "21GIFU.CSV",
        "old_muni_csv": "gifu_old_municipalities.csv",
        "extinct_districts": {
            "山県郡": {"current": "山県市・本巣市等", "extinct_date": "2003-04-01", "min_years": 22},
            "武儀郡": {"current": "関市", "extinct_date": "2005-02-07", "min_years": 20},
            "益田郡": {"current": "下呂市", "extinct_date": "2004-03-01", "min_years": 20},
            "郡上郡": {"current": "郡上市", "extinct_date": "2004-03-01", "min_years": 20},
        },
        "heisei_merged": {
            "高富町": {"current": "山県市", "merged_date": "2003-04-01"},
            "美山町": {"current": "山県市", "merged_date": "2003-04-01"},
            "萩原町": {"current": "下呂市", "merged_date": "2004-03-01"},
            "八幡町": {"current": "郡上市", "merged_date": "2004-03-01"},
        },
    },
    "静岡県": {
        "municipalities_csv": "22SHIZUOK.CSV",
        "old_muni_csv": "shizuoka_old_municipalities.csv",
        "extinct_districts": {
            "庵原郡": {"current": "静岡市・富士市", "extinct_date": "2010-04-01", "min_years": 15},
            "富士郡": {"current": "富士市", "extinct_date": "2008-11-01", "min_years": 16},
            "小笠郡": {"current": "菊川市・掛川市", "extinct_date": "2005-04-01", "min_years": 20},
        },
        "heisei_merged": {
            "清水市": {"current": "静岡市清水区", "merged_date": "2003-04-01"},
            "蒲原町": {"current": "静岡市清水区", "merged_date": "2008-11-01"},
            "富士川町": {"current": "富士市", "merged_date": "2008-11-01"},
            "菊川町": {"current": "菊川市", "merged_date": "2005-01-17"},
            "天竜市": {"current": "浜松市天竜区", "merged_date": "2005-07-01"},
            "浜北市": {"current": "浜松市浜北区", "merged_date": "2005-07-01"},
        },
    },
    "愛知県": {
        "municipalities_csv": "23AICHI.CSV",
        "old_muni_csv": "aichi_old_municipalities.csv",
        "extinct_districts": {
            "愛知郡": {"current": "長久手市・東郷町", "extinct_date": "2012-01-04", "min_years": 13},
            "幡豆郡": {"current": "西尾市", "extinct_date": "2011-04-01", "min_years": 14},
            "西加茂郡": {"current": "豊田市", "extinct_date": "2005-04-01", "min_years": 20},
            "東加茂郡": {"current": "豊田市", "extinct_date": "2005-04-01", "min_years": 20},
            "中島郡": {"current": "稲沢市", "extinct_date": "2005-04-01", "min_years": 20},
        },
        "heisei_merged": {
            "一色町": {"current": "西尾市", "merged_date": "2011-04-01"},
            "吉良町": {"current": "西尾市", "merged_date": "2011-04-01"},
            "長久手町": {"current": "長久手市", "merged_date": "2012-01-04"},
            "藤岡町": {"current": "豊田市", "merged_date": "2005-04-01"},
            "足助町": {"current": "豊田市", "merged_date": "2005-04-01"},
            "祖父江町": {"current": "稲沢市", "merged_date": "2005-04-01"},
        },
    },
    "三重県": {
        "municipalities_csv": "24MIE.CSV",
        "old_muni_csv": "mie_old_municipalities.csv",
        "extinct_districts": {
            "志摩郡": {"current": "志摩市", "extinct_date": "2004-10-01", "min_years": 20},
            "一志郡": {"current": "津市・松阪市", "extinct_date": "2006-01-01", "min_years": 18},
            "飯南郡": {"current": "松阪市", "extinct_date": "2005-01-01", "min_years": 20},
        },
        "heisei_merged": {
            "阿児町": {"current": "志摩市", "merged_date": "2004-10-01"},
            "浜島町": {"current": "志摩市", "merged_date": "2004-10-01"},
            "飯南町": {"current": "松阪市", "merged_date": "2005-01-01"},
            "飯高町": {"current": "松阪市", "merged_date": "2005-01-01"},
        },
    },
    "滋賀県": {
        "municipalities_csv": "25SHIGA.CSV",
        "old_muni_csv": "shiga_old_municipalities.csv",
        "extinct_districts": {
            "神崎郡": {"current": "東近江市", "extinct_date": "2006-02-13", "min_years": 18},
            "野洲郡": {"current": "野洲市・守山市", "extinct_date": "2004-10-01", "min_years": 20},
            "甲賀郡": {"current": "甲賀市・湖南市", "extinct_date": "2004-10-01", "min_years": 20},
            "栗太郡": {"current": "栗東市", "extinct_date": "2001-10-01", "min_years": 24},
            "坂田郡": {"current": "米原市・長浜市", "extinct_date": "2010-01-01", "min_years": 15},
        },
        "heisei_merged": {
            "八日市市": {"current": "東近江市", "merged_date": "2005-02-11"},
            "水口町": {"current": "甲賀市", "merged_date": "2004-10-01"},
            "甲西町": {"current": "湖南市", "merged_date": "2004-10-01"},
            "野洲町": {"current": "野洲市", "merged_date": "2004-10-01"},
            "安土町": {"current": "近江八幡市", "merged_date": "2010-03-21"},
            "伊吹町": {"current": "米原市", "merged_date": "2005-02-14"},
        },
    },
    "京都府": {
        "municipalities_csv": "26KYOTO.CSV",
        "old_muni_csv": "kyoto_old_municipalities.csv",
        "extinct_districts": {
            "中郡": {"current": "京丹後市", "extinct_date": "2004-04-01", "min_years": 20},
            "竹野郡": {"current": "京丹後市", "extinct_date": "2004-04-01", "min_years": 20},
            "熊野郡": {"current": "京丹後市", "extinct_date": "2004-04-01", "min_years": 20},
        },
        "heisei_merged": {
            "木津町": {"current": "木津川市", "merged_date": "2007-03-12"},
            "加茂町": {"current": "木津川市", "merged_date": "2007-03-12"},
            "山城町": {"current": "木津川市", "merged_date": "2007-03-12"},
            "丹波町": {"current": "京丹波町", "merged_date": "2005-10-11"},
            "園部町": {"current": "南丹市", "merged_date": "2006-01-01"},
            "峰山町": {"current": "京丹後市", "merged_date": "2004-04-01"},
            "大宮町": {"current": "京丹後市", "merged_date": "2004-04-01"},
        },
    },
    "大阪府": {
        "municipalities_csv": "27OSAKA.CSV",
        "old_muni_csv": "osaka_old_municipalities.csv",
        "extinct_districts": {
            "東成郡": {"current": "大阪市", "extinct_date": "1925-04-01", "min_years": 100},
            "西成郡": {"current": "大阪市", "extinct_date": "1925-04-01", "min_years": 100},
            "中河内郡": {"current": "東大阪市・八尾市等", "extinct_date": "1971-04-01", "min_years": 55},
            "北河内郡": {"current": "各市", "extinct_date": "1971-04-01", "min_years": 55},
        },
        "heisei_merged": {
            "布施市": {"current": "東大阪市", "merged_date": "1967-02-01"},
            "河内市": {"current": "東大阪市", "merged_date": "1967-02-01"},
            "枚岡市": {"current": "東大阪市", "merged_date": "1967-02-01"},
        },
    },
    "兵庫県": {
        "municipalities_csv": "28HYOGO.CSV",
        "old_muni_csv": "hyogo_old_municipalities.csv",
        "extinct_districts": {
            "津名郡": {"current": "洲本市・淡路市", "extinct_date": "2006-02-11", "min_years": 18},
            "緑郡": {"current": "南あわじ市", "extinct_date": "2005-01-11", "min_years": 20},
            "三原郡": {"current": "南あわじ市", "extinct_date": "2005-01-11", "min_years": 20},
            "氷上郡": {"current": "丹波市", "extinct_date": "2004-11-01", "min_years": 20},
            "城崎郡": {"current": "豊岡市", "extinct_date": "2005-04-01", "min_years": 20},
            "出石郡": {"current": "豊岡市", "extinct_date": "2005-04-01", "min_years": 20},
            "多紀郡": {"current": "丹波篠山市", "extinct_date": "1999-04-01", "min_years": 26},
        },
        "heisei_merged": {
            "一宮町": {"current": "淡路市", "merged_date": "2005-04-01"},
            "東浦町": {"current": "淡路市", "merged_date": "2005-04-01"},
            "西淡町": {"current": "南あわじ市", "merged_date": "2005-01-11"},
            "柏原町": {"current": "丹波市", "merged_date": "2004-11-01"},
            "城崎町": {"current": "豊岡市", "merged_date": "2005-04-01"},
            "出石町": {"current": "豊岡市", "merged_date": "2005-04-01"},
            "篠山町": {"current": "丹波篠山市", "merged_date": "1999-04-01"},
        },
    },
    "奈良県": {
        "municipalities_csv": "29NARA.CSV",
        "old_muni_csv": "nara_old_municipalities.csv",
        "extinct_districts": {
            "添上郡": {"current": "奈良市", "extinct_date": "2005-04-01", "min_years": 20},
        },
        "heisei_merged": {
            "月ヶ瀬村": {"current": "奈良市", "merged_date": "2005-04-01"},
            "都祁村": {"current": "奈良市", "merged_date": "2005-04-01"},
            "榛原町": {"current": "宇陀市", "merged_date": "2006-01-01"},
            "大宇陀町": {"current": "宇陀市", "merged_date": "2006-01-01"},
            "西吉野村": {"current": "五條市", "merged_date": "2005-09-26"},
        },
    },
    "和歌山県": {
        "municipalities_csv": "30WAKAYAM.CSV",
        "old_muni_csv": "wakayama_old_municipalities.csv",
        "extinct_districts": {
            "那賀郡": {"current": "紀の川市", "extinct_date": "2005-11-07", "min_years": 20},
            "海草郡": {"current": "紀美野町", "extinct_date": "2006-01-01", "min_years": 18},
        },
        "heisei_merged": {
            "打田町": {"current": "紀の川市", "merged_date": "2005-11-07"},
            "粉河町": {"current": "紀の川市", "merged_date": "2005-11-07"},
            "南部町": {"current": "みなべ町", "merged_date": "2004-10-01"},
            "熊野川町": {"current": "新宮市", "merged_date": "2005-10-01"},
        },
    },
    "鳥取県": {
        "municipalities_csv": "31TOTTORI.CSV",
        "old_muni_csv": "tottori_old_municipalities.csv",
        "extinct_districts": {
            "気高郡": {"current": "鳥取市", "extinct_date": "2004-11-01", "min_years": 20},
        },
        "heisei_merged": {
            "気高町": {"current": "鳥取市", "merged_date": "2004-11-01"},
            "鹿野町": {"current": "鳥取市", "merged_date": "2004-11-01"},
            "青谷町": {"current": "鳥取市", "merged_date": "2004-11-01"},
            "赤碕町": {"current": "琴浦町", "merged_date": "2004-09-01"},
            "大栄町": {"current": "北栄町", "merged_date": "2005-10-01"},
        },
    },
    "島根県": {
        "municipalities_csv": "32SHIMANE.CSV",
        "old_muni_csv": "shimane_old_municipalities.csv",
        "extinct_districts": {
            "能義郡": {"current": "安来市", "extinct_date": "2005-03-31", "min_years": 20},
            "大原郡": {"current": "雲南市", "extinct_date": "2005-03-31", "min_years": 20},
            "飯石郡": {"current": "雲南市・飯南町", "extinct_date": "2005-03-31", "min_years": 20},
        },
        "heisei_merged": {
            "広瀬町": {"current": "安来市", "merged_date": "2005-03-31"},
            "大東町": {"current": "雲南市", "merged_date": "2005-03-31"},
            "木次町": {"current": "雲南市", "merged_date": "2005-03-31"},
            "桜江町": {"current": "江津市", "merged_date": "2004-10-01"},
        },
    },
    "岡山県": {
        "municipalities_csv": "33OKAYAMA.CSV",
        "old_muni_csv": "okayama_old_municipalities.csv",
        "extinct_districts": {
            "苫田郡": {"current": "津山市・鏡野町", "extinct_date": "2005-02-28", "min_years": 20},
            "御津郡": {"current": "岡山市北区", "extinct_date": "2007-01-22", "min_years": 18},
            "邑久郡": {"current": "瀬戸内市", "extinct_date": "2004-11-01", "min_years": 20},
            "浅口郡": {"current": "浅口市・里庄町", "extinct_date": "2006-03-21", "min_years": 18},
            "真庭郡": {"current": "真庭市・新庄村", "extinct_date": "2005-03-31", "min_years": 20},
        },
        "heisei_merged": {
            "加茂町": {"current": "津山市", "merged_date": "2005-02-28"},
            "御津町": {"current": "岡山市北区", "merged_date": "2007-01-22"},
            "邑久町": {"current": "瀬戸内市", "merged_date": "2004-11-01"},
            "金光町": {"current": "浅口市", "merged_date": "2006-03-21"},
            "勝山町": {"current": "真庭市", "merged_date": "2005-03-31"},
        },
    },
    "広島県": {
        "municipalities_csv": "34HIROSHI.CSV",
        "old_muni_csv": "hiroshima_old_municipalities.csv",
        "extinct_districts": {
            "佐伯郡": {"current": "廿日市市", "extinct_date": "2005-11-03", "min_years": 20},
            "双三郡": {"current": "三次市", "extinct_date": "2004-04-01", "min_years": 20},
            "山県郡": {"current": "北広島町・安芸太田町", "extinct_date": "2005-02-01", "min_years": 20},
            "世羅郡": {"current": "世羅町", "extinct_date": "2004-10-01", "min_years": 20},
        },
        "heisei_merged": {
            "吉和村": {"current": "廿日市市", "merged_date": "2003-03-01"},
            "大野町": {"current": "廿日市市", "merged_date": "2005-11-03"},
            "宮島町": {"current": "廿日市市", "merged_date": "2005-11-03"},
            "加計町": {"current": "安芸太田町", "merged_date": "2004-10-01"},
            "三良坂町": {"current": "三次市", "merged_date": "2004-04-01"},
            "豊平町": {"current": "北広島町", "merged_date": "2005-02-01"},
        },
    },
    "山口県": {
        "municipalities_csv": "35YAMAGUC.CSV",
        "old_muni_csv": "yamaguchi_old_municipalities.csv",
        "extinct_districts": {
            "都濃郡": {"current": "周南市", "extinct_date": "2003-04-21", "min_years": 22},
            "大島郡": {"current": "周防大島町", "extinct_date": "2004-10-01", "min_years": 20},
            "玖珂郡": {"current": "岩国市・和木町", "extinct_date": "2006-03-20", "min_years": 18},
            "厚狭郡": {"current": "山陽小野田市", "extinct_date": "2005-03-22", "min_years": 20},
            "豊浦郡": {"current": "下関市", "extinct_date": "2005-02-13", "min_years": 20},
        },
        "heisei_merged": {
            "新南陽市": {"current": "周南市", "merged_date": "2003-04-21"},
            "小野田市": {"current": "山陽小野田市", "merged_date": "2005-03-22"},
            "菊川町": {"current": "下関市", "merged_date": "2005-02-13"},
            "東和町": {"current": "周防大島町", "merged_date": "2004-10-01"},
        },
    },
    "徳島県": {
        "municipalities_csv": "36TOKUSHI.CSV",
        "old_muni_csv": "tokushima_old_municipalities.csv",
        "extinct_districts": {
            "麻植郡": {"current": "吉野川市", "extinct_date": "2004-10-01", "min_years": 20},
            "美馬郡": {"current": "美馬市・つるぎ町", "extinct_date": "2005-03-01", "min_years": 20},
            "三好郡": {"current": "三好市・東みよし町", "extinct_date": "2006-03-01", "min_years": 18},
        },
        "heisei_merged": {
            "鴨島町": {"current": "吉野川市", "merged_date": "2004-10-01"},
            "脇町": {"current": "美馬市", "merged_date": "2005-03-01"},
            "池田町": {"current": "三好市", "merged_date": "2006-03-01"},
            "宍喰町": {"current": "海陽町", "merged_date": "2006-03-31"},
        },
    },
    "香川県": {
        "municipalities_csv": "37KAGAWA.CSV",
        "old_muni_csv": "kagawa_old_municipalities.csv",
        "extinct_districts": {
            "大川郡": {"current": "東かがわ市", "extinct_date": "2003-04-01", "min_years": 22},
            "寒川郡": {"current": "さぬき市", "extinct_date": "2002-04-01", "min_years": 23},
            "三豊郡": {"current": "三豊市", "extinct_date": "2006-01-01", "min_years": 18},
        },
        "heisei_merged": {
            "引田町": {"current": "東かがわ市", "merged_date": "2003-04-01"},
            "白鳥町": {"current": "東かがわ市", "merged_date": "2003-04-01"},
            "津田町": {"current": "さぬき市", "merged_date": "2002-04-01"},
            "豊中町": {"current": "三豊市", "merged_date": "2006-01-01"},
            "綾上町": {"current": "綾川町", "merged_date": "2006-03-21"},
            "池田町": {"current": "小豆島町", "merged_date": "2006-03-21"},
        },
    },
    "愛媛県": {
        "municipalities_csv": "38EHIME.CSV",
        "old_muni_csv": "ehime_old_municipalities.csv",
        "extinct_districts": {
            "温泉郡": {"current": "松山市・東温市", "extinct_date": "2004-09-21", "min_years": 20},
            "周桑郡": {"current": "西条市・東温市", "extinct_date": "2004-11-01", "min_years": 20},
            "越智郡": {"current": "今治市・上島町", "extinct_date": "2004-04-01", "min_years": 20},
            "上浮穴郡": {"current": "久万高原町", "extinct_date": "2004-08-01", "min_years": 20},
        },
        "heisei_merged": {
            "重信町": {"current": "東温市", "merged_date": "2004-09-21"},
            "北条市": {"current": "松山市", "merged_date": "2005-01-01"},
            "玉川町": {"current": "今治市", "merged_date": "2004-04-01"},
            "久万町": {"current": "久万高原町", "merged_date": "2004-08-01"},
        },
    },
    "高知県": {
        "municipalities_csv": "39KOCHI.CSV",
        "old_muni_csv": "kochi_old_municipalities.csv",
        "extinct_districts": {
            "香美郡": {"current": "香美市・香南市", "extinct_date": "2006-03-01", "min_years": 18},
        },
        "heisei_merged": {
            "土佐山田町": {"current": "香美市", "merged_date": "2006-03-01"},
            "中村市": {"current": "四万十市", "merged_date": "2005-04-10"},
            "窪川町": {"current": "四万十町", "merged_date": "2006-03-20"},
            "赤岡町": {"current": "香南市", "merged_date": "2006-03-01"},
            "野市町": {"current": "香南市", "merged_date": "2006-03-01"},
        },
    },
    "福岡県": {
        "municipalities_csv": "40FUKUOKA.CSV",
        "old_muni_csv": "fukuoka_old_municipalities.csv",
        "extinct_districts": {
            "嘉穂郡": {"current": "嘉麻市・桂川町", "extinct_date": "2006-03-27", "min_years": 18},
            "八女郡": {"current": "八女市・広川町", "extinct_date": "2010-02-01", "min_years": 15},
            "三潴郡": {"current": "柳川市・大木町", "extinct_date": "2005-03-21", "min_years": 20},
        },
        "heisei_merged": {
            "山田市": {"current": "嘉麻市", "merged_date": "2006-03-27"},
            "黒木町": {"current": "八女市", "merged_date": "2010-02-01"},
            "柳川市": {"current": "柳川市", "merged_date": "2005-03-21"},
            "那珂川町": {"current": "那珂川市", "merged_date": "2018-10-01"},
            "若宮町": {"current": "宮若市", "merged_date": "2006-02-11"},
        },
    },
    "佐賀県": {
        "municipalities_csv": "41SAGA.CSV",
        "old_muni_csv": "saga_old_municipalities.csv",
        "extinct_districts": {
            "佐賀郡": {"current": "佐賀市", "extinct_date": "2007-10-01", "min_years": 18},
            "神埼郡": {"current": "神埼市・吉野ヶ里町", "extinct_date": "2006-03-20", "min_years": 18},
            "小城郡": {"current": "小城市", "extinct_date": "2005-03-01", "min_years": 20},
        },
        "heisei_merged": {
            "大和町": {"current": "佐賀市", "merged_date": "2005-10-01"},
            "諸富町": {"current": "佐賀市", "merged_date": "2007-10-01"},
            "神埼町": {"current": "神埼市", "merged_date": "2006-03-20"},
            "小城町": {"current": "小城市", "merged_date": "2005-03-01"},
        },
    },
    "長崎県": {
        "municipalities_csv": "42NAGASAK.CSV",
        "old_muni_csv": "nagasaki_old_municipalities.csv",
        "extinct_districts": {
            "北高来郡": {"current": "諫早市", "extinct_date": "2005-03-01", "min_years": 20},
            "南高来郡": {"current": "雲仙市・南島原市", "extinct_date": "2006-03-31", "min_years": 18},
            "南松浦郡": {"current": "新上五島町", "extinct_date": "2004-08-01", "min_years": 20},
        },
        "heisei_merged": {
            "国見町": {"current": "雲仙市", "merged_date": "2005-10-11"},
            "小浜町": {"current": "雲仙市", "merged_date": "2005-10-11"},
            "加津佐町": {"current": "南島原市", "merged_date": "2006-03-31"},
            "西彼町": {"current": "西海市", "merged_date": "2005-04-01"},
            "有川町": {"current": "新上五島町", "merged_date": "2004-08-01"},
        },
    },
    "熊本県": {
        "municipalities_csv": "43KUMAMOT.CSV",
        "old_muni_csv": "kumamoto_old_municipalities.csv",
        "extinct_districts": {
            "飽託郡": {"current": "熊本市", "extinct_date": "1991-04-01", "min_years": 34},
            "下益城郡": {"current": "宇城市・美里町", "extinct_date": "2005-01-15", "min_years": 20},
            "宇土郡": {"current": "宇城市", "extinct_date": "2005-01-15", "min_years": 20},
            "天草郡": {"current": "上天草市・天草市・苓北町", "extinct_date": "2006-03-27", "min_years": 18},
        },
        "heisei_merged": {
            "飽田町": {"current": "熊本市", "merged_date": "1991-04-01"},
            "松橋町": {"current": "宇城市", "merged_date": "2005-01-15"},
            "本渡市": {"current": "天草市", "merged_date": "2006-03-27"},
            "牛深市": {"current": "天草市", "merged_date": "2006-03-27"},
        },
    },
    "大分県": {
        "municipalities_csv": "44OITA.CSV",
        "old_muni_csv": "oita_old_municipalities.csv",
        "extinct_districts": {
            "大分郡": {"current": "由布市・大分市", "extinct_date": "2005-10-01", "min_years": 20},
            "大野郡": {"current": "豊後大野市", "extinct_date": "2005-03-31", "min_years": 20},
            "直入郡": {"current": "竹田市", "extinct_date": "2005-04-01", "min_years": 20},
            "下毛郡": {"current": "中津市", "extinct_date": "2005-03-01", "min_years": 20},
            "宇佐郡": {"current": "宇佐市", "extinct_date": "2005-03-31", "min_years": 20},
        },
        "heisei_merged": {
            "挾間町": {"current": "由布市", "merged_date": "2005-10-01"},
            "湯布院町": {"current": "由布市", "merged_date": "2005-10-01"},
            "三重町": {"current": "豊後大野市", "merged_date": "2005-03-31"},
            "三光村": {"current": "中津市", "merged_date": "2005-03-01"},
            "安心院町": {"current": "宇佐市", "merged_date": "2005-03-31"},
        },
    },
    "宮崎県": {
        "municipalities_csv": "45MIYAZAK.CSV",
        "old_muni_csv": "miyazaki_old_municipalities.csv",
        "extinct_districts": {
            "宮崎郡": {"current": "宮崎市", "extinct_date": "2010-03-23", "min_years": 15},
        },
        "heisei_merged": {
            "佐土原町": {"current": "宮崎市", "merged_date": "2006-01-01"},
            "田野町": {"current": "宮崎市", "merged_date": "2010-03-23"},
            "清武町": {"current": "宮崎市", "merged_date": "2010-03-23"},
            "須木村": {"current": "小林市", "merged_date": "2010-03-23"},
            "北方町": {"current": "延岡市", "merged_date": "2006-02-20"},
        },
    },
    "鹿児島県": {
        "municipalities_csv": "46KAGOSHI.CSV",
        "old_muni_csv": "kagoshima_old_municipalities.csv",
        "extinct_districts": {
            "日置郡": {"current": "日置市・いちき串木野市", "extinct_date": "2005-11-07", "min_years": 20},
            "揖宿郡": {"current": "指宿市", "extinct_date": "2006-01-01", "min_years": 18},
            "川辺郡": {"current": "南九州市", "extinct_date": "2007-12-01", "min_years": 17},
            "南薩郡": {"current": "南さつま市", "extinct_date": "2005-11-07", "min_years": 20},
            "姶良郡": {"current": "姶良市・霧島市等", "extinct_date": "2011-03-23", "min_years": 14},
        },
        "heisei_merged": {
            "川内市": {"current": "薩摩川内市", "merged_date": "2004-10-12"},
            "伊集院町": {"current": "日置市", "merged_date": "2005-05-01"},
            "山川町": {"current": "指宿市", "merged_date": "2006-01-01"},
            "知覧町": {"current": "南九州市", "merged_date": "2007-12-01"},
            "加世田市": {"current": "南さつま市", "merged_date": "2005-11-07"},
            "串木野市": {"current": "いちき串木野市", "merged_date": "2005-10-11"},
        },
    },
    "沖縄県": {
        "municipalities_csv": "47OKINAWA.CSV",
        "old_muni_csv": "okinawa_old_municipalities.csv",
        "extinct_districts": {
            "宮古郡": {"current": "宮古島市・多良間村", "extinct_date": "2005-10-01", "min_years": 20},
        },
        "heisei_merged": {
            "豊見城村": {"current": "豊見城市", "merged_date": "2002-04-01"},
            "佐敷町": {"current": "南城市", "merged_date": "2006-01-01"},
            "具志川市": {"current": "うるま市", "merged_date": "2005-04-01"},
            "石川市": {"current": "うるま市", "merged_date": "2005-04-01"},
            "与那城町": {"current": "うるま市", "merged_date": "2005-04-01"},
            "平良市": {"current": "宮古島市", "merged_date": "2005-10-01"},
        },
    },
}

# 旧字体パターン（全都県共通）
OLD_KANJI = re.compile(r"[國縣區驛濱邊澤關藏櫻龍廳]")

# 大字パターン
OAZA_PATTERN = re.compile(r"大字[\u4e00-\u9fff]")

# 漢数字番地パターン
KANJI_BANCHI = re.compile(r"[一二三四五六七八九十百千]+(番地|番)")

# カタカナ「ノ」区切りパターン
KATAKANA_NO = re.compile(r"[0-9０-９]+ノ[0-9０-９]+")


@dataclass
class JudgmentResult:
    """旧住所判定結果"""
    is_old_address: bool = False
    confidence: str = ""          # HIGH / MEDIUM / LOW
    reasons: List[str] = field(default_factory=list)
    estimated_years: int = 0
    current_address_hint: str = ""


def judge_address(address: str, prefecture: str = "神奈川県") -> JudgmentResult:
    """
    住所文字列を分析し、旧住所かどうかを判定する。
    対応: 全47都道府県

    Returns:
        JudgmentResult: 判定結果
    """
    result = JudgmentResult()

    if not address or not isinstance(address, str):
        return result

    config = PREFECTURE_CONFIG.get(prefecture, PREFECTURE_CONFIG["神奈川県"])
    extinct_districts = config.get("extinct_districts", {})
    heisei_merged = config.get("heisei_merged", {})

    # --- 判定1: 消滅済み郡名 ---
    for district, info in extinct_districts.items():
        if district in address:
            result.is_old_address = True
            result.confidence = "HIGH"
            result.reasons.append(f"消滅済み郡名「{district}」検出（{info['extinct_date']}消滅）")
            result.estimated_years = max(result.estimated_years, info["min_years"])
            result.current_address_hint = info["current"]

    # --- 判定2: 消滅した市町村名（平成合併・昭和以前含む） ---
    for town, info in heisei_merged.items():
        if town in address:
            result.is_old_address = True
            result.confidence = "HIGH"
            result.reasons.append(f"消滅地名「{town}」検出（{info['merged_date']}に{info['current']}へ変遷）")
            years = 2026 - int(info["merged_date"][:4])
            result.estimated_years = max(result.estimated_years, years)
            result.current_address_hint = info["current"]

    # --- 判定3: 旧字体 ---
    match = OLD_KANJI.search(address)
    if match:
        result.is_old_address = True
        if result.confidence != "HIGH":
            result.confidence = "MEDIUM"
        result.reasons.append(f"旧字体「{match.group()}」検出")
        result.estimated_years = max(result.estimated_years, 20)

    # --- 判定4: 大字表記 ---
    if OAZA_PATTERN.search(address):
        if result.confidence != "HIGH":
            result.confidence = "LOW"
        result.reasons.append("「大字」表記検出（現行住所の可能性もあり）")
        result.estimated_years = max(result.estimated_years, 10)

    # --- 判定5: 漢数字番地 ---
    if KANJI_BANCHI.search(address):
        if not result.is_old_address:
            result.confidence = "MEDIUM"
        result.is_old_address = True
        result.reasons.append("漢数字番地表記検出")
        result.estimated_years = max(result.estimated_years, 15)

    # --- 判定6: カタカナ「ノ」区切り ---
    if KATAKANA_NO.search(address):
        if not result.is_old_address:
            result.confidence = "MEDIUM"
        result.is_old_address = True
        result.reasons.append("カタカナ「ノ」区切り検出")
        result.estimated_years = max(result.estimated_years, 15)

    # --- 判定7: 郵便番号マスター突合 ---
    if postal_master.loaded:
        postal_check = postal_master.find_town_in_address(address)

        if postal_check["city_found"] and not postal_check["town_found"]:
            result.is_old_address = True
            if result.confidence != "HIGH":
                result.confidence = "MEDIUM"
            similar_hint = ""
            if postal_check["similar_towns"]:
                similar_hint = f"（類似現行住所: {', '.join(postal_check['similar_towns'])}）"
            result.reasons.append(
                f"郵便番号マスター不一致: {postal_check['matched_city']}内に該当町域なし{similar_hint}"
            )
            result.estimated_years = max(result.estimated_years, 10)
            if postal_check["similar_towns"]:
                result.current_address_hint = (
                    result.current_address_hint or
                    f"{postal_check['matched_city']}{postal_check['similar_towns'][0]}"
                )

        elif not postal_check["city_found"] and address:
            if not result.is_old_address:
                result.reasons.append("郵便番号マスター: 市区町村名の一致なし（要確認）")
                if result.confidence == "":
                    result.confidence = "LOW"

    return result


def detect_encoding(filepath: str) -> str:
    """CSVファイルのエンコーディングを自動判定"""
    encodings = ["utf-8-sig", "utf-8", "shift_jis", "cp932"]
    for enc in encodings:
        try:
            with open(filepath, "r", encoding=enc) as f:
                f.read(1024)
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return "utf-8"


def find_address_column(headers: List[str]) -> int:
    """住所列を自動検出"""
    candidates = ["所有者住所", "住所", "所有者_住所", "owner_address", "address"]
    for i, h in enumerate(headers):
        h_clean = h.strip().replace('"', '')
        for c in candidates:
            if c in h_clean:
                return i
    return -1


def process_csv(input_path: str, output_path: str = None, address_col: str = None,
                prefecture: str = "神奈川県", postal_csv: str = None):
    """
    CSVファイルを処理し、旧住所フラグを付与して出力する。
    """
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_filtered{ext}"

    # 郵便番号マスター読み込み
    masters_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "masters")

    if postal_csv:
        postal_master.load_from_csv(postal_csv)
    else:
        config = PREFECTURE_CONFIG.get(prefecture, {})
        muni_csv = config.get("municipalities_csv", "")
        default_postal = os.path.join(masters_dir, muni_csv)
        if os.path.exists(default_postal):
            postal_master.load_from_csv(default_postal)
        else:
            print(f"[WARN] 郵便番号マスター未配置: {default_postal}")
            print(f"[WARN] 日本郵便サイトから {muni_csv} をダウンロードして masters/ に配置してください")

    encoding = detect_encoding(input_path)
    print(f"[INFO] 入力ファイル: {input_path}")
    print(f"[INFO] 都県: {prefecture}")
    print(f"[INFO] エンコーディング: {encoding}")

    results = {
        "total": 0,
        "old_address": 0,
        "high_confidence": 0,
        "medium_confidence": 0,
        "low_confidence": 0,
    }

    with open(input_path, "r", encoding=encoding) as infile, \
         open(output_path, "w", encoding="utf-8-sig", newline="") as outfile:

        reader = csv.reader(infile)
        writer = csv.writer(outfile)

        # ヘッダー処理
        headers = next(reader)

        if address_col:
            addr_idx = None
            for i, h in enumerate(headers):
                if address_col in h.strip():
                    addr_idx = i
                    break
            if addr_idx is None:
                print(f"[ERROR] 指定列「{address_col}」が見つかりません")
                sys.exit(1)
        else:
            addr_idx = find_address_column(headers)
            if addr_idx == -1:
                print(f"[ERROR] 住所列が見つかりません。--address-col で列名を指定してください")
                print(f"  利用可能な列: {headers}")
                sys.exit(1)

        print(f"[INFO] 住所列: {headers[addr_idx]} (index={addr_idx})")

        # 出力ヘッダー（元の列 + 判定結果列）
        out_headers = headers + [
            "旧住所フラグ",
            "確信度",
            "判定理由",
            "推定放置年数",
            "現住所ヒント",
            "DM送付推奨"
        ]
        writer.writerow(out_headers)

        for row in reader:
            results["total"] += 1

            if len(row) <= addr_idx:
                writer.writerow(row + ["", "", "", "", "", ""])
                continue

            address = row[addr_idx].strip()
            judgment = judge_address(address, prefecture)

            if judgment.is_old_address:
                results["old_address"] += 1
                if judgment.confidence == "HIGH":
                    results["high_confidence"] += 1
                elif judgment.confidence == "MEDIUM":
                    results["medium_confidence"] += 1
                else:
                    results["low_confidence"] += 1

            # DM送付推奨判定
            if judgment.is_old_address and judgment.confidence in ("HIGH", "MEDIUM"):
                dm_recommend = "除外推奨"
            elif judgment.is_old_address and judgment.confidence == "LOW":
                dm_recommend = "要確認"
            else:
                dm_recommend = "送付OK"

            writer.writerow(row + [
                "YES" if judgment.is_old_address else "NO",
                judgment.confidence if judgment.is_old_address else "",
                " / ".join(judgment.reasons) if judgment.reasons else "",
                str(judgment.estimated_years) if judgment.estimated_years > 0 else "",
                judgment.current_address_hint,
                dm_recommend,
            ])

    # サマリー出力
    print("\n" + "=" * 60)
    print("  旧住所フィルタリング結果サマリー")
    print("=" * 60)
    print(f"  対象都県:         {prefecture}")
    print(f"  対象件数:         {results['total']:,}")
    print(f"  旧住所検出:       {results['old_address']:,} ({results['old_address']/max(results['total'],1)*100:.1f}%)")
    print(f"    HIGH（確実）:   {results['high_confidence']:,}")
    print(f"    MEDIUM（濃厚）: {results['medium_confidence']:,}")
    print(f"    LOW（要確認）:  {results['low_confidence']:,}")
    print(f"  送付OK:           {results['total'] - results['old_address']:,}")
    print(f"\n  出力ファイル: {output_path}")
    print("=" * 60)

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="旧住所フィルタリングスクリプト（全47都道府県対応版）"
    )
    parser.add_argument("input", help="入力CSVファイルパス")
    parser.add_argument("--output", "-o", help="出力CSVファイルパス（省略時: 入力ファイル名_filtered.csv）")
    parser.add_argument("--address-col", help="住所列名（省略時: 自動検出）")
    parser.add_argument(
        "--prefecture", default="神奈川県",
        choices=list(PREFECTURE_CONFIG.keys()),
        help="対象都道府県（デフォルト: 神奈川県）"
    )
    parser.add_argument("--postal-csv", help="郵便番号マスターCSVパス（省略時: mastersフォルダから自動選択）")

    args = parser.parse_args()
    process_csv(args.input, args.output, args.address_col, args.prefecture, args.postal_csv)
