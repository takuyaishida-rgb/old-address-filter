// 郵便番号・旧住所フィルターの判定ロジック（DOM に依存しない）。
// index.html から <script src="resolver.js?v=..."> で読み込み、tests/resolver-cases.js から Node.js でも読み込む。
// 変更したら index.html の resolver.js?v= と DATA_VERSION を同じ値に上げる（テストが一致を確認する）。
// ============================================================
// 旧住所判定マスター
// ============================================================
const EXTINCT_DISTRICTS = [
  "亀田郡","上磯郡","下北郡","中津軽郡","胆沢郡","稗貫郡","東磐井郡",
  "桃生郡","志田郡","玉造郡","河辺郡","由利郡","仙北郡","東田川郡","飽海郡",
  "安達郡","石城郡","真壁郡","新治郡","都賀郡","上都賀郡","南那須郡",
  "勢多郡","新田郡","佐波郡","北埼玉郡","千葉郡","海上郡","匝瑳郡",
  "荏原郡","豊多摩郡","北豊島郡","南足立郡","南葛飾郡","北多摩郡","南多摩郡","東京府",
  "久良岐郡","橘樹郡","都筑郡","鎌倉郡","津久井郡",
  "北蒲原郡","中蒲原郡","南魚沼郡","婦負郡","上新川郡","東砺波郡","西砺波郡",
  "河北郡","石川郡","足羽郡","丹生郡","今立郡","遠敷郡",
  "東八代郡","東山梨郡","更級郡","南安曇郡",
  "山県郡","武儀郡","益田郡","郡上郡","庵原郡","富士郡","小笠郡",
  "愛知郡","幡豆郡","西加茂郡","東加茂郡","中島郡",
  "志摩郡","一志郡","飯南郡","神崎郡","野洲郡","甲賀郡","栗太郡","坂田郡",
  "中郡","竹野郡","熊野郡","東成郡","西成郡","中河内郡","北河内郡",
  "津名郡","緑郡","三原郡","氷上郡","城崎郡","出石郡","多紀郡","添上郡",
  "那賀郡","海草郡","気高郡","能義郡","大原郡","飯石郡",
  "苫田郡","御津郡","邑久郡","浅口郡","真庭郡",
  "佐伯郡","双三郡","世羅郡","都濃郡","大島郡","玖珂郡","厚狭郡","豊浦郡",
  "麻植郡","美馬郡","三好郡","大川郡","寒川郡","三豊郡",
  "温泉郡","周桑郡","越智郡","上浮穴郡","香美郡",
  "嘉穂郡","八女郡","三潴郡","佐賀郡","神埼郡","小城郡",
  "北高来郡","南高来郡","南松浦郡","飽託郡","下益城郡","宇土郡","天草郡",
  "大分郡","大野郡","直入郡","下毛郡","宇佐郡","宮崎郡",
  "日置郡","揖宿郡","川辺郡","南薩郡","姶良郡","宮古郡",
];

// 旧字体
const OLD_KANJI = /[國縣區驛濱邊澤關藏櫻龍廳]/;
// 旧字体→新字体 変換マップ（「武藏野市」→「武蔵野市」の照合や変換に利用）
const OLD_KANJI_MAP = {
  '藏':'蔵','國':'国','縣':'県','區':'区','驛':'駅',
  '濱':'浜','邊':'辺','澤':'沢','關':'関','櫻':'桜',
  '龍':'竜','廳':'庁',
};
function normalizeOldKanji(s) {
  return s ? s.replace(/[藏國縣區驛濱邊澤關櫻龍廳]/g, c => OLD_KANJI_MAP[c] || c) : s;
}

// 漢数字番地
// 「一番町」「二番町」「十番」「九番丁」等の地名が誤爆しないよう
//   (a) 「〇番地」は常に検出
//   (b) 「〇番」は後ろが [数字／ハイフン／の／ノ／号／文末] の時のみ検出
const KANJI_BANCHI = /[一二三四五六七八九十百千]+番地|[一二三四五六七八九十百千]+番(?=[\d０-９\-ー－のノ号]|$)/;

// カタカナ「ノ」区切り
const KATAKANA_NO = /[0-9０-９]+ノ[0-9０-９]+/;

// 外国住所キーワード（判定対象外にする）
const FOREIGN_KEYWORDS = /(台湾|大韓民国|中華人民共和国|中華民国|アメリカ合衆国|米国|イギリス|英国|カナダ|ドイツ|フランス|タイ国|中華|大韓|シンガポール|オーストラリア)/;

// 東京35区時代（1932-1947）の消滅区名 → 現行23区へのマッピング
const EXTINCT_TOKYO_WARD_MAP = {
  '麹町区':'千代田区','神田区':'千代田区',
  '日本橋区':'中央区','京橋区':'中央区',
  '芝区':'港区','麻布区':'港区','赤坂区':'港区',
  '四谷区':'新宿区','牛込区':'新宿区','淀橋区':'新宿区',
  '小石川区':'文京区','本郷区':'文京区',
  '下谷区':'台東区','浅草区':'台東区',
  '本所区':'墨田区','向島区':'墨田区',
  '深川区':'江東区','城東区':'江東区',
  '荏原区':'品川区',
  '大森区':'大田区','蒲田区':'大田区',
  '滝野川区':'北区','王子区':'北区',
};

// 入力住所から消滅東京旧区を最長一致で検出し、位置情報付きで返す（無ければ null）
function detectExtinctTokyoWard(address) {
  if (!address) return null;
  for (let i = 0; i < address.length; i++) {
    if (address[i] !== '区') continue;
    for (let len = 5; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (EXTINCT_TOKYO_WARD_MAP[cand]) {
        // 政令市の区（大阪市城東区・横浜市港北区など）や東京都以外の住所は、東京35区時代の区ではない
        const before = address.slice(0, start);
        if (/[市郡]$/.test(before) || /(北海道|京都府|大阪府|.{2,3}県)/.test(before)) continue;
        return {
          oldWard: cand,
          newWard: EXTINCT_TOKYO_WARD_MAP[cand],
          matchStart: start,
          matchEnd: i + 1,
        };
      }
    }
  }
  return null;
}
// ※ SHI_EXTRACT / GUN_EXTRACT regex は廃止。
// regex で除外文字を指定する方式は、「府」「都」「ケ」「ヶ」などが正式な市郡名に
// 含まれるケースを切ってしまうため誤爆が多い。代わりに dict-lookup 方式を使う。
// detectCity() / detectGun() を参照。

// 住所コンポーネントの境界：キーワードの直後に来る典型的な文字
// 大字・丁目・番地・数字（半角/全角）・漢数字・空白・中点、または文末
const ADDR_BOUNDARY = '(?=[大字丁番地号\\d０-９一二三四五六七八九十百千\\s・]|$)';
// 前境界：行頭 or 都道府県・市区郡の直後、空白、中点など
// 「共栄町」の内部の「栄町」をヒットさせないようにする
// ※「字」は含めない。「字XX町」は小字レベルで OLD_TOWNS（町村レベル）とは階層が異なるため、
//    字の直後にOLD_TOWNS名があっても誤爆させない（例:「字新田町」の新田町を群馬県の旧新田町と誤認しない）
const ADDR_PREBOUNDARY = '(?:^|[県都道府市区郡\\s・])';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 住所本体と建物名を分離するヒューリスティック
// 前提: 住所末尾 = 「数字／漢数字 + 丁目/番地/番/号/ハイフン」の連続ブロック
//       そのブロックの直後から先が建物名・部屋番号
// 例:
//   「横浜市南区二葉町三丁目２８番地１２ルクシェール横濱吉野町１００１」
//     → 住所「横浜市南区二葉町三丁目２８番地１２」／建物「ルクシェール横濱吉野町１００１」
//   「神奈川県鎌倉市由比ガ浜1-2-3」（建物名なし）
//     → 住所全体／建物「」
// 住所の数字起点の見極め方：
//   (a) 半角/全角数字から始まる … 例「２８番地」「1-2-3」
//   (b) 漢数字 + 丁目/番地/番/号  … 例「三丁目」「四番地」
//       ※「二葉町」の「二」のように丁目/番地が続かない漢数字は誤爆しない
function splitAddressAndBuilding(text) {
  if (!text) return { address: '', building: '' };
  // 住所末尾ブロックの開始トリガー:
  //   (a) 半角/全角数字1文字以上  … 「1-2-3」「２８番地」など
  //   (b) 漢数字 + 「丁目」または「番地」 … 「三丁目」「四番地」など
  //       ※「番」「号」単体は place name 誤爆（二番町・二番丁・一番町）のため不採用
  // マッチ後、[数字・漢数字・丁目・番地・番・号・ハイフン・「の／ノ」] を貪欲に吸収。
  // 空白は run から除外：「1-2-3 101号室」のような部屋番号を address 側に引き込まないため、
  // 空白があった時点で address パートは終了とみなす。
  const TAIL_CHARS = '[\\d０-９一二三四五六七八九十百千\\-ー－のノ]|丁目|番地|番|号';
  const startRe = new RegExp(
    '(?:[\\d０-９]|[一二三四五六七八九十百千]+(?:丁目|番地))' +
    '(?:' + TAIL_CHARS + ')*'
  );
  const m = startRe.exec(text);
  if (!m) return { address: text, building: '' };
  const end = m.index + m[0].length;
  return { address: text.slice(0, end), building: text.slice(end) };
}

// 地名に現れる異体字の対応表（1文字→1文字。文字数が変わらないため位置情報が保てる）
//   入力とマスターの両方を同じ字に寄せてから照合する。
//   例: 入力「俱知安町」(U+4FF1) と 日本郵便「倶知安町」(U+5036) は別の文字。
const JP_PLACE_VARIANTS = {
  '俱':'倶','髙':'高','﨑':'崎','濵':'浜','濱':'浜','邉':'辺','邊':'辺','曾':'曽',
  '眞':'真','德':'徳','瀨':'瀬','齋':'斎','齊':'斉','澤':'沢','國':'国','縣':'県',
  '區':'区','驛':'駅','關':'関','櫻':'桜','龍':'竜','廳':'庁','藏':'蔵','圓':'円',
  '麴':'麹','舘':'館','嶋':'島','嶌':'島','峯':'峰','栁':'柳','靑':'青','檜':'桧',
  '塚':'塚',  // 塚（互換漢字）→ 塚
    // 﨑 → 崎
  'ヶ':'ケ',
};
const JP_PLACE_VARIANT_RE = new RegExp('[' + Object.keys(JP_PLACE_VARIANTS).join('') + ']', 'g');
function normalizePlace(s) {
  return s ? String(s).replace(JP_PLACE_VARIANT_RE, c => JP_PLACE_VARIANTS[c] || c) : s;
}



// 日本郵便マスターから生成された現行の郡・市セット（cities.js で window に設定）
// マスター側の名称も異体字を寄せた形を併せて持つ（入力がどちらの字でも現行名と判定できるように）
function withNormalized(list) {
  const s = new Set(list || []);
  for (const x of list || []) s.add(normalizePlace(x));
  return s;
}
const CURRENT_GUNS = withNormalized((window.POSTAL_MASTER_CITIES && window.POSTAL_MASTER_CITIES.currentGuns) || []);
const CURRENT_CITIES = withNormalized((window.POSTAL_MASTER_CITIES && window.POSTAL_MASTER_CITIES.currentCities) || []);
// 旧市・旧郡セット（extinct_municipalities.json 由来、build script で生成）
const EXTINCT_CITIES_DICT = new Set((window.POSTAL_MASTER_CITIES && window.POSTAL_MASTER_CITIES.extinctCities) || []);
const EXTINCT_GUNS_DICT = new Set((window.POSTAL_MASTER_CITIES && window.POSTAL_MASTER_CITIES.extinctGuns) || []);
const HAS_POSTAL_MASTER = CURRENT_GUNS.size > 0;

// ヶ/ケ・旧字体の正規化を通して照合（「茅ヶ崎市」↔「茅ケ崎市」、「武藏野市」↔「武蔵野市」等）
function nameVariants(name) {
  const v = new Set([name]);
  v.add(name.replace(/ヶ/g, 'ケ'));
  v.add(name.replace(/ケ/g, 'ヶ'));
  const nk = normalizeOldKanji(name);
  v.add(nk);
  v.add(nk.replace(/ヶ/g, 'ケ'));
  v.add(nk.replace(/ケ/g, 'ヶ'));
  // 地名の異体字（俱/倶、髙/高 など）を寄せた形も現行名として扱う
  const np = normalizePlace(name);
  v.add(np);
  v.add(np.replace(/ケ/g, 'ヶ'));
  return [...v];
}
function citySetHas(name)    { return nameVariants(name).some(v => CURRENT_CITIES.has(v)); }
function extinctCityHas(name){ return nameVariants(name).some(v => EXTINCT_CITIES_DICT.has(v)); }
function gunSetHas(name)     { return nameVariants(name).some(v => CURRENT_GUNS.has(v)); }
function extinctGunHas(name) {
  return nameVariants(name).some(v => EXTINCT_GUNS_DICT.has(v) || EXTINCT_DISTRICTS.includes(v));
}

// 住所から最初の市を検出して { status: 'current'|'extinct', city: '...' } を返す（無ければ null）
// 3段階：
//   Phase 1: 現行市マスターとの最長一致（さいたま市／府中市／宇都宮市／茅ヶ崎市 など全部OK）
//   Phase 2: extinct_municipalities 由来の旧市 dict に掲載（大宮市／浦和市 など）
//   Phase 3: マスター外だが漢字・ひらがなのみで構成され「〇〇市」として妥当 → 不明扱いで flag
//            （ニューヨーク市・ク市・崎市のような誤爆を Phase 3 の漢字／ひらがな check で排除）
function isCityNamePrefix(prefix) {
  // prefix = 市の直前までの文字列
  if (!/^[一-龥ぁ-ゖ]+$/.test(prefix)) return false;       // 漢字・ひらがなのみ（カタカナ/数字/記号NG）
  if (/[都道府県市区町村郡字]/.test(prefix)) return false; // 行政接尾辞/字が含まれるのはNG
  return true;
}

function detectCity(address) {
  // Phase 1: 現行市マスターにある最長一致（住所全体を走査）
  //   「横浜市港北区」「さいたま市大宮区」のような政令市＋区も含めて最長一致したい
  //   末尾が 市 or 区 の位置を対象に、長さ 2〜8 で試行
  let best = null;
  for (let i = 0; i < address.length; i++) {
    const ch = address[i];
    if (ch !== '市' && ch !== '区') continue;
    for (let len = 8; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (citySetHas(cand)) {
        if (!best || cand.length > best.city.length) {
          best = { status: 'current', city: cand };
        }
        break; // このポジションで最長が取れたので次のポジションへ
      }
    }
  }
  if (best) return best;
  // Phase 2: 旧市 dict 掲載
  for (let i = 0; i < address.length; i++) {
    if (address[i] !== '市') continue;
    for (let len = 5; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (extinctCityHas(cand)) return { status: 'extinct', city: cand };
    }
  }
  // Phase 3: マスター・dict 外だが構造的に日本の市名として妥当 → extinct-unknown
  for (let i = 0; i < address.length; i++) {
    if (address[i] !== '市') continue;
    // 市の直後が町/丁/目/村/区/場 なら地名の一部に埋め込まれた 市 と判断してスキップ
    //   例: 「古市町」→ 市の次が町 →「古市」を市として拾わない
    //       「十日市場」→ 市の次が場 →「十日市」を市として拾わない
    const nextCh = address[i + 1] || '';
    if ('町丁目村区場'.includes(nextCh)) continue;
    for (let len = 5; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (!isCityNamePrefix(cand.slice(0, -1))) continue;
      if (!citySetHas(cand)) return { status: 'extinct', city: cand, note: 'マスター外' };
    }
  }
  return null;
}

function isGunNamePrefix(prefix) {
  if (!/^[一-龥ぁ-ゖ]+$/.test(prefix)) return false;
  if (/[都道府県市区町村]/.test(prefix)) return false;
  return true;
}

function detectGun(address) {
  // Phase 1: 現行郡
  for (let i = 0; i < address.length; i++) {
    if (address[i] !== '郡') continue;
    for (let len = 6; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (gunSetHas(cand)) return { status: 'current', gun: cand };
    }
  }
  // Phase 2: 旧郡 dict 掲載（extinct_municipalities 由来 + ハードコード）
  for (let i = 0; i < address.length; i++) {
    if (address[i] !== '郡') continue;
    for (let len = 5; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (extinctGunHas(cand)) {
        return { status: 'extinct', gun: cand };
      }
    }
  }
  // Phase 3: マスター・dict 外だが日本郡名として妥当 → extinct-unknown
  for (let i = 0; i < address.length; i++) {
    if (address[i] !== '郡') continue;
    // 郡の直後が 市/町/村 でないと郡として不自然（例: 「字堤ノ内逢隈上郡」の 郡 は地名の一部）
    const nextCh = address[i + 1] || '';
    if (!'市町村'.includes(nextCh)) continue;
    for (let len = 5; len >= 2; len--) {
      const start = i + 1 - len;
      if (start < 0) continue;
      const cand = address.slice(start, i + 1);
      if (!isGunNamePrefix(cand.slice(0, -1))) continue;
      if (!gunSetHas(cand)) return { status: 'extinct', gun: cand, note: 'マスター外' };
    }
  }
  return null;
}

// ============================================================
// 郵便番号リゾルバ（住所 → 郵便番号）
//
// 設計方針
//   1. 段階（ステージ）を明示し、各段は「決まったか / 決まらなかったか」だけを返す
//   2. 候補が複数出たときは precision（確度）→ 一致した町域名の長さ で機械的に選ぶ
//   3. 区・郡は「その市区町村にその町域が実在するか」でしか決めない
//      （旧市町村マップの代表郵便番号から区名を推測しない。存在しない住所を作るため）
//   4. 決められないものは埋めない。理由を返す
//
// precision: 4=小字まで一致 / 3=町域まで一致 / 2=市区町村まで（掲載外・町域なし） / 0=未確定
// ============================================================

const PREC = { KOAZA: 4, TOWN: 3, CITY: 2, NONE: 0 };

// --- 正規化 -------------------------------------------------
// 1文字→1文字の置換だけを行う（文字数が変わると住所内の位置がずれる）
function normAddr(s) {
  return toHalfWidthDigits(normalizePlace(String(s || '')));
}

// 算用数字 → 漢数字（1〜99）。マスターの「南一条西」「北四十二条東」に合わせるため
function numToKanji(n) {
  const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const v = parseInt(n, 10);
  if (!v || v > 99) return '';
  if (v < 10) return d[v];
  const t = Math.floor(v / 10), o = v % 10;
  return (t > 1 ? d[t] : '') + '十' + d[o];
}

// 漢数字 → 数値（1〜99）。マスターの「７条通」や丁目の判定に使う
function kanjiToNum(s) {
  const d = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const t = String(s || '');
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = t.match(/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/);
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0);
  return d[t] || 0;
}

// 全角数字 → 半角
function toHalfWidthDigits(s) {
  return s ? String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) : s;
}

// --- 逆引きインデックス -------------------------------------
// pref → { cities: {cityName: CityEntry}, cityKeysDesc, wardsOf, gunlessOf }
// CityEntry = { towns: {townName: [{zip, koaza, chome, side}]}, townKeysDesc, catchAllZip, anyZip }
function buildReverseIndex() {
  if (REVERSE_INDEX) return REVERSE_INDEX;
  const byPref = {};
  for (const zip in POSTAL_MASTER) {
    const rec = POSTAL_MASTER[zip];
    const pref = normAddr(rec.pref);
    const city = normAddr(rec.city);
    if (!pref || !city) continue;
    const p = byPref[pref] || (byPref[pref] = { cities: {} });
    const c = p.cities[city] || (p.cities[city] = { towns: {}, catchAllZip: '', anyZip: zip });
    // 1つの郵便番号が複数町域をカバーすることがある（alt に2件目以降が入る）
    const towns = [rec.town].concat(rec.alt || []).map(normAddr).filter(Boolean);
    if (!towns.length) {
      c.catchAllZip = zip;   // 「以下に掲載がない場合」
      continue;
    }
    for (const t of towns) {
      (c.towns[t] = c.towns[t] || []).push({
        zip,
        koaza: normAddr(rec.koaza || ''),
        chome: rec.chome || '',
        side: rec.side || '',
      });
    }
  }
  for (const pref in byPref) {
    const p = byPref[pref];
    p.cityKeysDesc = Object.keys(p.cities).sort((a, b) => b.length - a.length);
    p.wardsOf = {};      // 「名古屋市」→ ["名古屋市中区", ...]
    p.gunlessOf = {};    // 「大井町」→ ["足柄上郡大井町"]
    for (const key of p.cityKeysDesc) {
      const e = p.cities[key];
      e.townKeysDesc = Object.keys(e.towns).sort((a, b) => b.length - a.length);
      const ward = key.match(/^(.+市)(.+区)$/);
      if (ward) (p.wardsOf[ward[1]] = p.wardsOf[ward[1]] || []).push(key);
      const gun = key.match(/^(.+?郡)(.+[町村])$/);
      if (gun) (p.gunlessOf[gun[2]] = p.gunlessOf[gun[2]] || []).push(key);
    }
    p.prefKeys = null;
  }
  REVERSE_INDEX = { byPref, prefKeysDesc: Object.keys(byPref).sort((a, b) => b.length - a.length) };
  return REVERSE_INDEX;
}

// --- ステージ1: 町域名の照合候補を作る ----------------------
// 住所側の表記をマスターの町域名に寄せた候補列を返す。
// delta = 原文から取り除いた文字数（住所内の位置を補正するための近似値）
function townVariants(tail) {
  const out = [];
  const seen = new Set();
  const add = (s, delta) => { if (s && !seen.has(s)) { seen.add(s); out.push({ s, delta }); } };

  const expand = (s, delta) => {
    add(s, delta);
    // 「1条」→「一条」（マスターが漢数字）
    const toK = s.replace(/(\d{1,2})条/, (all, n) => numToKanji(n) ? numToKanji(n) + '条' : all);
    if (toK !== s) add(toK, delta + (s.length - toK.length));
    // 「七条通」→「7条通」（マスターが算用数字。旭川市など）
    const toN = s.replace(/([一二三四五六七八九十]+)(条通|条|丁目)/g, (all, k, suf) => {
      const n = kanjiToNum(k);
      return n ? n + suf : all;
    });
    if (toN !== s) add(toN, delta + (s.length - toN.length));
  };

  const base = String(tail || '');
  // 先頭のゴミ（空白・重複した「町」）を落とした形も候補にする
  const trimmed = base.replace(/^[\s　]+/, '').replace(/^町(?=[南北東西])/, '');
  for (const b of new Set([base, trimmed])) {
    const d0 = base.length - b.length;
    expand(b, d0);
    // 「字」「大字」はマスターの町域名に含まれない
    const aza = b.match(/^(大字|字)/);
    if (aza) expand(b.slice(aza[0].length), d0 + aza[0].length);
    // 「大字○○村字△△」→「○○△△」（合併後の町域名は村・字を挟まない）
    const packed = b.replace(/^大字/, '').replace(/村字/g, '').replace(/^字/, '');
    if (packed !== b) expand(packed, d0 + (b.length - packed.length));
  }
  return out;
}

// 町域名になり得る先頭の語（部分一致の手がかり）
//   「大字井出1704番地1」→「井出」／「梁川字薪ケ入357番地」→「梁川」
function leadingToken(tail) {
  let t = String(tail || '').replace(/^(大字|字)/, '');
  t = t.split(/[\d]/)[0].split('字')[0];
  t = t.replace(/(丁目|番地|番|号|大字).*$/, '');
  return t.trim().slice(0, 8);
}

// --- ステージ2: 同一町域名の複数候補を一意化する ------------
// 候補が複数あるのは、小字・丁目・方角で郵便番号が分かれている場合。
function pickCandidate(cands, tail, hadAza) {
  if (cands.length === 1) return { zip: cands[0].zip, precision: PREC.TOWN, level: '町域' };
  const cm = tail.match(/^([\d一二三四五六七八九十]{1,3})丁目/);

  // (a) 小字（「香良洲町稲葉」→ 稲葉）
  const koazas = cands
    .filter(c => c.koaza && c.koaza !== 'その他')
    .flatMap(c => c.koaza.split('|').map(k => ({ zip: c.zip, koaza: k })))
    .sort((a, b) => b.koaza.length - a.koaza.length);
  const byKoaza = koazas.find(c => tail.startsWith(c.koaza));
  if (byKoaza) {
    return { zip: byKoaza.zip, precision: PREC.KOAZA, level: '小字', extraLen: byKoaza.koaza.length };
  }

  // (b) 丁目の範囲（「南一条西（1〜19丁目）」）
  if (cm) {
    const n = kanjiToNum(cm[1]);
    const inRange = spec => spec.split(',').some(p => {
      const r = p.split('-');
      return r.length === 2 ? (n >= +r[0] && n <= +r[1]) : n === +r[0];
    });
    const hit = cands.filter(c => c.chome && inRange(c.chome));
    if (hit.length === 1) return { zip: hit[0].zip, precision: PREC.TOWN, level: '町域（丁目）' };
  }

  // (c) 方角（「南郷通（南）」）
  const sm = tail.match(/^[\d一二三四五六七八九十]{0,3}丁目([南北東西])/) || tail.match(/([南北東西])\s*$/);
  if (sm) {
    const hit = cands.filter(c => c.side === sm[1]);
    if (hit.length === 1) return { zip: hit[0].zip, precision: PREC.TOWN, level: '町域（方角）' };
  }

  // (d) 小字なしの候補が1つだけなら、それが町域全体の番号
  const bare = cands.filter(c => !c.koaza && !c.chome && !c.side);
  if (bare.length === 1) return { zip: bare[0].zip, precision: PREC.TOWN, level: '町域' };

  // (e) 列挙のどれにも当たらないときの受け皿「その他」を使う。
  //     使えるのは、住所側に判断材料があるか、列挙が小字ベースでない場合に限る。
  //       採用: 「鳴海町字坊主山」（小字が書かれていて列挙に無い）
  //             「潮江二丁目1番28」（列挙は1丁目1番・5丁目1番なので2丁目は該当しない）
  //             「戸山町28番地」（列挙は3丁目18・21番のみ）
  //       却下: 「香良洲町3032-1」（列挙は小字別で、住所に小字が無いので判断できない）
  const other = cands.filter(c => (c.koaza || '').split('|').includes('その他'));
  if (other.length === 1) {
    const enumerated = cands.filter(c => c !== other[0]);
    const koazaBased = enumerated.some(c => c.koaza && c.koaza !== 'その他');
    if (hadAza || cm || !koazaBased) {
      return { zip: other[0].zip, precision: PREC.TOWN, level: '町域（その他）' };
    }
  }

  return {
    zip: '', precision: PREC.NONE, level: '町域（複数候補）',
    candidates: cands.map(c => c.koaza || (c.chome && c.chome + '丁目') || c.side).filter(Boolean).slice(0, 5),
    ambiguousCount: cands.length,
  };
}

// --- ステージ3: 1つの市区町村の中で町域を照合 ---------------
function matchInCity(entry, tail, base) {
  // (1) 前方一致（長い町域名を優先）
  for (const v of townVariants(tail)) {
    for (const town of entry.townKeysDesc) {
      if (!v.s.startsWith(town)) continue;
      const rest0 = v.s.slice(town.length);
      const hadAza = /^(大字|字)/.test(rest0);
      const rest = rest0.replace(/^(大字|字)/, '');
      const r = pickCandidate(entry.towns[town], rest, hadAza);
      return Object.assign({
        matchedLen: base + v.delta + town.length + (r.extraLen || 0),
        townLen: town.length,
        town,
      }, r);
    }
  }
  // (2) 部分一致（合併で町域名に旧町村名が前置されるケース）。
  //     語を短くしながら探し、1つだけ当たれば採用、複数当たれば曖昧として返す。
  //     例:「大字井出1704」→「井出町」／「黒田第三十五号18番地」→ 上黒田・東黒田（曖昧）
  const head = leadingToken(tail);
  for (let len = head.length; len >= 2; len--) {
    const key = head.slice(0, len);
    const hits = entry.townKeysDesc.filter(t => t.includes(key));
    if (!hits.length) continue;
    if (hits.length === 1) {
      const town = hits[0];
      const r = pickCandidate(entry.towns[town], '', false);
      if (r.zip) {
        return Object.assign({ matchedLen: base, townLen: 0, town }, r, { level: r.level + '（部分一致）' });
      }
      return null;
    }
    // 複数当たった場合、その語が町域名の「末尾」を成しているなら本当に曖昧
    //   例:「黒田」→ 上黒田・東黒田（どちらか分からない）
    // 語が多くの町域名の「先頭」に共通しているだけなら、町域名としては未登録と判断する
    //   例:「歌登」→ 歌登大曲・歌登中央…（上幌別は登録が無いので掲載外扱いが正しい）
    if (hits.every(t => t.endsWith(key))) {
      return {
        zip: '', precision: PREC.NONE, level: '町域（複数候補）', matchedLen: base, townLen: 0,
        candidates: hits.slice(0, 5), ambiguousCount: hits.length,
      };
    }
    return null;
  }
  return null;
}

// 町域が当たらなかった市区町村の扱い
function cityLevelResult(entry, base) {
  // 町域の登録が無い市区町村は代表番号が唯一の正解
  if (!entry.townKeysDesc.length) {
    return { zip: entry.catchAllZip || entry.anyZip, precision: PREC.CITY, level: '市区町村（町域なし）', matchedLen: base, townLen: 0 };
  }
  // 町域は登録されているが住所の町域が無い → 「以下に掲載がない場合」が正解
  if (entry.catchAllZip) {
    return { zip: entry.catchAllZip, precision: PREC.CITY, level: '市区町村（掲載外）', matchedLen: base, townLen: 0 };
  }
  return { zip: '', precision: PREC.NONE, level: '市区町村', matchedLen: base, townLen: 0, cityZip: entry.anyZip };
}

// --- ステージ4: 市区町村の特定 ------------------------------
// 候補（市区町村, 続きの文字列, オフセット, ラベル）を優先度順に列挙する
function cityCandidates(searchFrom, prefEntry, base) {
  const list = [];
  // (1) 市区町村名の前方一致（最長優先）
  for (const city of prefEntry.cityKeysDesc) {
    if (searchFrom.startsWith(city)) {
      list.push({ city, tail: searchFrom.slice(city.length), base: base + city.length, label: '' });
      break;
    }
  }
  // (2) 政令市で区が書かれていない → 全区を候補にする
  //     区が書かれている場合は補完しない（「鶴見区尻手」を全区に当てて同名の町域「鶴見」を拾う誤りを防ぐ）
  const wardWritten = list.length > 0 && /^.+市.+区$/.test(list[0].city);
  for (const shi in prefEntry.wardsOf) {
    if (wardWritten || !searchFrom.startsWith(shi)) continue;
    for (const w of prefEntry.wardsOf[shi]) {
      list.push({ city: w, tail: searchFrom.slice(shi.length), base: base + shi.length, label: '（区を補完）' });
    }
  }
  // (3) 郡が省略・誤記された住所 → 町村名で探す（先頭から6文字以内に現れる場合）
  for (const gunless in prefEntry.gunlessOf) {
    const idx = searchFrom.indexOf(gunless);
    if (idx < 0 || idx > 6) continue;
    for (const city of prefEntry.gunlessOf[gunless]) {
      list.push({ city, tail: searchFrom.slice(idx + gunless.length), base: base + idx + gunless.length, label: '（郡を補完）' });
    }
  }
  return list;
}

// --- 本体 ---------------------------------------------------
// 住所文字列から郵便番号を解決する。決められない場合は zip を空で返す。
function resolveZip(rawAddress) {
  if (!rawAddress || !REVERSE_INDEX) return { zip: '', precision: PREC.NONE, level: '不明', matchedLen: 0 };
  const address = normAddr(rawAddress);
  const { byPref, prefKeysDesc } = REVERSE_INDEX;

  // 都道府県が書かれていればその県に限定する（他県への誤マッチを防ぐ）
  let prefs = [];
  for (const pref of prefKeysDesc) {
    const i = address.indexOf(pref);
    if (i >= 0) { prefs = [{ pref, from: address.slice(i + pref.length), base: i + pref.length }]; break; }
  }
  if (!prefs.length) prefs = prefKeysDesc.map(pref => ({ pref, from: address, base: 0 }));

  const perPref = [];
  for (const p of prefs) {
    const results = [];
    const entryPref = byPref[p.pref];
    const cands = cityCandidates(p.from, entryPref, p.base);
    const wardCands = cands.filter(c => c.label === '（区を補完）');
    for (const c of cands) {
      const hit = matchInCity(entryPref.cities[c.city], c.tail, c.base);
      if (hit) {
        // 町域名は当たったが一意に決まらない場合（小字・丁目・同名町域）。
        // ここで市区町村の代表番号に落とすと、町域が分かっているのに粗い番号を返すことになる。
        results.push(Object.assign({}, hit, { level: hit.level + c.label, city: c.city, tail: c.tail, label: c.label, pref: p.pref }));
        continue;
      }
      // 区を補完する探索では、町域が見つからない区は候補にしない（無関係な区の代表番号を拾わないため）
      if (c.label === '（区を補完）') continue;
      const cl = cityLevelResult(entryPref.cities[c.city], c.base);
      if (cl.zip || cl.cityZip) results.push(Object.assign({}, cl, { level: cl.level + c.label, city: c.city, tail: c.tail, label: c.label, pref: p.pref }));
    }
    if (results.length) perPref.push(results);
    void wardCands;
  }

  if (!perPref.length) {
    return { zip: '', precision: PREC.NONE, level: '不明', matchedLen: 0 };
  }
  const ests = perPref.map(pickBestEst);
  if (ests.length === 1) return ests[0];

  // 都道府県が書かれていない住所は全県を調べる。同名の市区町村（伊達市・府中市など）が複数県にあり、
  // 最初に当たった県の結果で確定すると別の県の住所に誤付与するため、県をまたいで比べる。
  //   確度（町域まで当たったか）→ 一致した町域名の長さ で最良を選び、同点が複数県にあれば特定できないとする
  const rank = e => (e.precision || 0) * 100 + Math.min(e.townLen || 0, 99);
  const top = Math.max(...ests.map(rank));
  const tops = ests.filter(e => rank(e) === top);
  // 他県にも町域まで当たる結果があるか（確度の判定に使う）
  const withCross = win => Object.assign({}, win, { otherPrefHits: ests.filter(e => e !== win && e.precision >= PREC.TOWN).length });
  if (tops.length === 1) return withCross(tops[0]);
  if (top > 0) {
    const prefsHit = [...new Set(tops.map(e => e.pref).filter(Boolean))];
    if (prefsHit.length > 1) {
      return {
        zip: '', precision: PREC.NONE, level: '都道府県が特定できない', matchedLen: tops[0].matchedLen || 0,
        candidates: prefsHit.slice(0, 5), ambiguousCount: prefsHit.length,
      };
    }
  }
  return withCross(tops[0]);
}

// 1つの県の候補（results）から、最良の結果を決める
function pickBestEst(results) {

  // 確度 → 一致した町域名の長さ で選ぶ。同点が複数あれば「特定できない」として返す
  // 町域名が当たった行（未確定でも）は、市区町村レベルの結果より優先して扱う
  const townish = results.filter(r => r.town);
  const pool = results.some(r => r.town && r.zip) ? results.filter(r => r.zip || r.town)
             : (townish.length ? townish : results);
  const best = pool.reduce((a, b) => {
    if (b.precision !== a.precision) return b.precision > a.precision ? b : a;
    if ((b.townLen || 0) !== (a.townLen || 0)) return (b.townLen || 0) > (a.townLen || 0) ? b : a;
    return a;
  });
  const tied = pool.filter(r => r.precision === best.precision && (r.townLen || 0) === (best.townLen || 0) && r.zip !== best.zip);
  if (best.precision >= PREC.TOWN && tied.length) {
    const wards = [best.city].concat(tied.map(r => r.city));
    return {
      zip: '', precision: PREC.NONE, level: '区が特定できない', matchedLen: best.matchedLen,
      candidates: [...new Set(wards)].slice(0, 5), ambiguousCount: wards.length,
    };
  }
  // 区が書かれているのに、その区に町域が無い（市区町村の「掲載外」止まり）場合、同じ市の他の区に町域があれば
  // 旧区の可能性がある。候補として添える（番号は使わず、住所の文字列とマスターの町域だけで判断）
  if (best.precision === PREC.CITY && best.label === '' && best.tail != null) {
    const sib = siblingWardHits(best);
    if (sib.length) return Object.assign({}, best, { siblingWards: sib });
  }
  return best;
}

// 区に該当町域が無いとき、同じ市の他の区で同じ町域を探す
function siblingWardHits(best) {
  const m = best.city.match(/^(.+市)(.+区)$/);
  const entryPref = REVERSE_INDEX && REVERSE_INDEX.byPref[best.pref];
  if (!m || !entryPref) return [];
  const out = [];
  for (const w of entryPref.wardsOf[m[1]] || []) {
    if (w === best.city) continue;
    const h = matchInCity(entryPref.cities[w], best.tail, 0);
    if (h && h.zip && h.precision >= PREC.TOWN && !/部分一致/.test(h.level)) out.push({ city: w, town: h.town, zip: h.zip });
  }
  return out;
}

// 郵便番号が一意に決まったか
function isZipResolved(est) {
  return !!(est && est.zip && est.precision >= PREC.CITY);
}

// --- 政令市の区再編表（人手）---------------------------------
// 旧区 → 後継区（一部が移った場合は複数）。住所の文字列と町域の実在だけで旧区を判定する際、
// 「この旧区からその区が分かれた」ことの裏付けに使う。裏付けがあれば自動補正（確度B）、無ければ候補提示（確度C）。
// 出所: 各市の区の変遷（区の新設・分区の年を併記）。追加・訂正は人が行う。
const WARD_REORG = {
  '川崎市': { '高津区': ['宮前区'], '多摩区': ['麻生区'] },                          // 1982 宮前区・麻生区新設
  '横浜市': { '緑区': ['青葉区', '都筑区'], '港北区': ['都筑区', '青葉区'],           // 1994 青葉区・都筑区新設
              '戸塚区': ['泉区', '栄区'], '旭区': ['瀬谷区'], '南区': ['港南区'],      // 1986 泉区・栄区／1969 瀬谷区・港南区
              '磯子区': ['金沢区'] },                                                  // 1948 金沢区
  '大阪市': { '城東区': ['鶴見区'], '住吉区': ['住之江区', '阿倍野区'], '東住吉区': ['平野区'] },  // 1974 鶴見区・住之江区・平野区／1955 阿倍野区
  '名古屋市': { '千種区': ['名東区'], '緑区': ['天白区'] },                            // 1975 名東区・天白区新設
  '札幌市': { '白石区': ['厚別区'], '豊平区': ['清田区'], '西区': ['手稲区'] },        // 1989 厚別区・手稲区／1997 清田区
  '京都市': { '右京区': ['西京区'], '東山区': ['山科区'] },                            // 1976 西京区・山科区新設
  '福岡市': { '早良区': ['西区'] },                                                      // 1982 西区新設
  '北九州市': { '小倉区': ['小倉北区', '小倉南区'], '八幡区': ['八幡東区', '八幡西区'] },   // 1974-04-01 小倉区・八幡区の分区
  '神戸市': { '垂水区': ['西区'] },                                                       // 1982 西区新設
  '浜松市': { '中区': ['中央区'], '東区': ['中央区'], '南区': ['中央区'], '西区': ['中央区', '浜名区'],
              '北区': ['浜名区'], '浜北区': ['浜名区'] },                                // 2024-01-01 区の再編（中央区・浜名区・天竜区）
};

// 旧市 → 政令市化後に含まれる区（許容区）。旧市名を新市の区に直すとき、無関係な区を選ばないための制約。
// 許容区は広めに持つ（絞り込みは町域の実在で行う）。
const OLD_CITY_WARDS = {
  '浦和市': ['浦和区', '南区', '緑区', '桜区', '見沼区'],
  '大宮市': ['大宮区', '北区', '西区', '見沼区', '桜区'],
  '与野市': ['中央区'],
  '岩槻市': ['岩槻区'],
  '清水市': ['清水区'],
};

// --- 旧区の判定（住所の文字列だけで判断。郵便番号は使わない）---
// 戻り値: null（旧区ではない／判断材料なし）または
//   { shi, oldWard, start, end, candidates:[{city,town,zip}], confirmed: 後継区名|'', grade: 'B'|'C' }
//   B: 再編表に載る後継区に町域が実在 → 自動補正してよい／C: 実在性だけの推定 → 候補提示
function detectOldWard(address, est) {
  if (!address || !REVERSE_INDEX) return null;
  const na = normAddr(address);
  let shi = '', oldWard = '', start = -1;
  const candidates = [];

  if (est && est.siblingWards && est.siblingWards.length && est.city) {
    // 書かれた区は現行にあるが、その区に町域が無く、同じ市の他の区にある
    const m = est.city.match(/^(.+市)(.+区)$/);
    shi = m[1]; oldWard = m[2];
    start = na.indexOf(est.city);
    if (start >= 0) start += shi.length;
    candidates.push(...est.siblingWards);
  } else {
    // 書かれた区の名前そのものが現行に無い（浜松市中区 など）→ 再編表の後継区で探す
    for (const city in WARD_REORG) {
      for (const w in WARD_REORG[city]) {
        const i = na.indexOf(city + w);
        if (i < 0) continue;
        if (Object.values(REVERSE_INDEX.byPref).some(pe => pe.cities[city + w])) continue;
        shi = city; oldWard = w; start = i + city.length;
        const pref = Object.keys(REVERSE_INDEX.byPref).find(pp => REVERSE_INDEX.byPref[pp].wardsOf[city]);
        const entryPref = pref && REVERSE_INDEX.byPref[pref];
        const tail = na.slice(start + w.length);
        for (const nw of WARD_REORG[city][w]) {
          const key = city + nw;
          if (!entryPref || !entryPref.cities[key]) continue;
          const h = matchInCity(entryPref.cities[key], tail, 0);
          if (h && h.zip && h.precision >= PREC.TOWN && !/部分一致/.test(h.level)) candidates.push({ city: key, town: h.town, zip: h.zip });
        }
        break;
      }
      if (oldWard) break;
    }
  }
  if (!oldWard || start < 0 || !candidates.length) return null;

  const reorg = (WARD_REORG[shi] || {})[oldWard] || [];
  const backed = candidates.filter(c => reorg.includes(c.city.slice(shi.length)));
  const confirmed = backed.length === 1 ? backed[0].city.slice(shi.length) : '';
  return {
    shi, oldWard, start, end: start + oldWard.length, candidates,
    confirmed, grade: confirmed ? 'B' : 'C',
  };
}

// 確度（A〜E）。「宛名の住所をどこまで機械的に信用してよいか」を、郵便番号を一切使わずに決める。
//   A: 原文の市区町村・町域が現行マスターにそのまま一致（補正なし）
//   B: 変遷表（旧市町村・区再編表・東京35区）に基づいて自動補正し、変換先で町域が一致
//   C: 実在性だけを根拠にした推定（区・郡の補完、部分一致、県名なし、再編表に裏付けの無い旧区候補）→ 宛名に使えるが要確認
//   D: 市区町村までしか決まらない（掲載外・町域なし）
//   E: 判定できない・矛盾（不明、区や県が決まらない、町域が複数候補、旧住所と判定したのに直せない）
//   番地は常に未検証（住居表示の実施などで番地体系が変わる住所は直せない）
function gradeAddress({ address, est, isOld, oldReason, current, convertedForZip, oldWard, override }) {
  if (!address) return { grade: 'E', reason: '住所が空欄' };
  if (override) return { grade: 'B', reason: '人手補正台帳で確定' };
  const lv = (est && est.level) || '';
  if (!est || !est.zip) {
    if (est && est.cityZip) return { grade: 'D', reason: '町域を特定できず市区町村止まり' };
    return { grade: 'E', reason: lv && lv !== '不明' ? lv : '住所から市区町村を特定できない' };
  }
  if (est.precision < PREC.TOWN) return { grade: 'D', reason: lv || '市区町村止まり' };

  // 旧住所と判定したのに現行住所を作れていない（表記系のフラグだけの場合は除く）
  const oldKind = /消滅|旧区/.test(oldReason || '');
  if (isOld && oldKind && !current && !(oldWard && oldWard.grade === 'B')) {
    return { grade: 'E', reason: '旧住所と判定したが現行住所を推定できない' };
  }

  // C: 実在性だけで決めたもの
  const why = [];
  if (/部分一致/.test(lv)) why.push('町域を部分一致で推定');
  if (est.viaVillageBase) why.push('旧村の大字を「大字名＋町」の町域と推定');
  if (/区を補完/.test(lv)) why.push('省略された区を町域から補完');
  if (/郡を補完/.test(lv)) why.push('省略された郡を補完');
  if (oldWard && oldWard.grade === 'C') why.push('旧区の可能性（再編表に裏付けなし）');
  const na = normAddr(address);
  const prefWritten = REVERSE_INDEX && REVERSE_INDEX.prefKeysDesc.some(pf => na.includes(pf));
  // 県名が無くても、他県に町域まで当たる結果が無ければ一意（全県を比べて決めている）
  if (!prefWritten && est.otherPrefHits > 0) why.push('都道府県の記載なし・他県にも同名の住所');
  if (why.length) return { grade: 'C', reason: why.join(' / ') };

  // B: 変遷表に基づく自動補正
  const fixed = !!(convertedForZip || (isOld && current) || (oldWard && oldWard.grade === 'B'));
  if (fixed) return { grade: 'B', reason: '変遷表に基づき現行に変換し、町域が一致' };

  return { grade: 'A', reason: '' };
}

// --- 人手補正台帳（人が確認して確定した補正。ルールより先に適用する）-------------
// 形式: { match, replace, zip, source, who, date }
//   match   : 元の住所の一部（表記ゆれは吸収して照合。空白は無視）。住所のどこに出てもよい
//   replace : match に当たった部分を置き換える文字列（番地など残りは原文のまま）
//   zip     : 任意。確定した郵便番号（7桁）
//   source  : 出典（自治体の資料・確認した人など）
// 人手で解決した旧→新の対応を溜めて、次回からルールより先に使う。
let OVERRIDES = [];
function stripSpaceMap(s) {
  const t = [], idx = [];
  const n = normAddr(s);
  for (let i = 0; i < n.length; i++) {
    if (/[\s　]/.test(n[i])) continue;
    t.push(n[i]); idx.push(i);
  }
  return { t: t.join(''), idx };
}
function setOverrides(list) {
  OVERRIDES = (list || [])
    .filter(e => e && e.match && e.replace != null)
    .map(e => {
      const key = stripSpaceMap(e.match).t;
      // 住所に県名が無くても当たるよう、先頭の都道府県を除いた形でも探す（十分に具体的な場合のみ）
      const noPref = key.replace(/^(?:北海道|東京都|京都府|大阪府|.{2,3}県)/, '');
      return Object.assign({}, e, { _key: key, _keyNoPref: noPref !== key && noPref.length >= 6 ? noPref : '' });
    })
    .filter(e => e._key)
    .sort((a, b) => b._key.length - a._key.length);   // 長い（具体的な）ものを優先
}
// 住所に当たる台帳の項目を探す。{ entry, start, end }（start/end は原文の位置）
function findOverride(address) {
  if (!OVERRIDES.length || !address) return null;
  const { t, idx } = stripSpaceMap(address);
  for (const e of OVERRIDES) {
    for (const key of [e._key, e._keyNoPref]) {
      if (!key) continue;
      const i = t.indexOf(key);
      if (i < 0) continue;
      return { entry: e, start: idx[i], end: idx[i + key.length - 1] + 1 };
    }
  }
  return null;
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
// CSV（列: 元の住所／補正後の住所／郵便番号／出典／確認者／確認日）→ 台帳の項目。補正後の住所が空の行は無視する
function parseOverridesCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const h = rows[0].map(x => x.trim());
  const col = name => h.findIndex(x => x.startsWith(name));
  const ci = { m: col('元の住所'), r: col('補正後'), z: col('郵便番号'), s: col('出典'), w: col('確認者'), d: col('確認日') };
  if (ci.m < 0 || ci.r < 0) return [];
  const out = [];
  for (const r of rows.slice(1)) {
    const match = (r[ci.m] || '').trim(), replace = (r[ci.r] || '').trim();
    if (!match || !replace) continue;
    const zip = ci.z >= 0 ? normalizeZip(r[ci.z]) : '';
    out.push({ match, replace, zip: /^\d{7}$/.test(zip) && zip !== '0000000' ? zip : '',
               source: ci.s >= 0 ? (r[ci.s] || '').trim() : '', who: ci.w >= 0 ? (r[ci.w] || '').trim() : '',
               date: ci.d >= 0 ? (r[ci.d] || '').trim() : '' });
  }
  return out;
}
function csvCell(v) {
  const t = String(v == null ? '' : v);
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
// 確度C〜Eの行から、人が補正を書き込むための台帳の雛形CSVを作る（参考列は取り込み時に無視される）
function buildOverrideTemplateCsv(rows) {
  const head = ['元の住所', '補正後の住所', '郵便番号', '出典', '確認者', '確認日', '（参考）確度', '（参考）理由', '（参考）ツールの補正案'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) lines.push([r.addr, '', '', '', '', '', r.grade, r.reason, r.auto].map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// 旧区の判定と、確度Bのときの郵便番号の取り直し。
//   戻り値: { oldWard, est, convertedForZip, flagReason（要対応の理由。Bのみ）, pending（未確定の理由。Cのみ）}
function applyOldWard(address, est, convertedForZip) {
  const oldWard = detectOldWard(address, est);
  const res = { oldWard, est, convertedForZip, flagReason: '', pending: '' };
  if (!oldWard) return res;
  if (oldWard.grade === 'B') {
    // 再編表の裏付けがある → 旧住所として扱い、区を直した住所で郵便番号を取り直す
    res.flagReason = `旧区「${oldWard.oldWard}」（現行: ${oldWard.shi}${oldWard.confirmed}。区の再編）`;
    const fixedAddr = address.slice(0, oldWard.start) + oldWard.confirmed + address.slice(oldWard.end);
    const d2 = resolveZipDeep(fixedAddr);
    if (isZipResolved(d2.est)) { res.est = d2.est; res.convertedForZip = fixedAddr; }
  } else {
    const cs = oldWard.candidates.map(c => c.city).join('・');
    res.pending = `区「${oldWard.oldWard}」に該当する町域が無い（${cs}に同名の町域。旧区の可能性・再編表に裏付けなし）`;
  }
  return res;
}

// --- 旧住所からの解決 ---------------------------------------
// 旧市町村マップの newName を現行マスターに載っている名称まで解決する（段階合併のチェーン）。
// 区は付けない（代表郵便番号から推測すると存在しない住所を作る）。
function resolveExtinctName(hit) {
  if (!hit) return '';
  let name = hit.entry.newName;
  const seen = new Set();
  while (name && !citySetHas(name) && EXTINCT_INDEX && EXTINCT_INDEX.byOldName) {
    if (seen.has(name)) break;
    seen.add(name);
    const next = EXTINCT_INDEX.byOldName[`${hit.entry.prefecture}|${name}`];
    if (!next || !next.newName || next.newName === name) break;
    name = next.newName;
  }
  return name;
}

// 旧住所を現行住所に置き換えて解決する。
// 合併では旧町村名が新しい町域名の一部として残ることがあるため、その形も試す。
//   例: 旧「鵜殿村1573」→ 現「紀宝町鵜殿1573」／旧「西枇杷島町泉町」→ 現「清須市西枇杷島町泉」
// 挿入した町村名自体を町域として掴む誤り（「三方町黒田」→「三方」）は検証で弾く。
function resolveZipFromExtinct(address, hit) {
  const name = resolveExtinctName(hit);
  if (!name) return null;
  const prefix = address.slice(0, hit.matchStart);
  const suffix = address.slice(hit.matchEnd);
  const plain = prefix + name + suffix;

  // 旧「市」名は新市の町域名の先頭に残ることが多い
  //   例: 旧「久居市新町」→ 現「津市久居新町」（「津市新町」という別の町域を先に掴まない）
  //       旧「平良市字下里」→ 現「宮古島市平良下里」
  const oldCoreCity = hit.entry.oldName.replace(/^.+?郡/, '');
  if (/.市$/.test(oldCoreCity) && oldCoreCity !== name) {
    const bareCity = oldCoreCity.replace(/市$/, '');
    const cand = prefix + name + bareCity + suffix.replace(/^(大字|字)/, '');
    const e = resolveZip(cand);
    if (isZipResolved(e) && e.precision >= PREC.TOWN) {
      const town = normAddr((POSTAL_MASTER[e.zip] || {}).town || '');
      if (town.startsWith(normAddr(bareCity)) && town.length > bareCity.length) {
        return { est: e, address: cand, name };
      }
    }
  }

  const plainEst = resolveZip(plain);
  // 旧「村」が市に編入された場合、住所の大字は新市の「大字名＋町」の町域として残ることが多い
  //   例: 旧「新治郡上大津村神立」→ 現「土浦市神立町」（同名の神立東・神立中央は丁目に分かれた新しい町域）
  //   町域が決まらなかった場合に限り、大字名に「町」だけ足した町域が実在するときだけ採る
  if (/.村$/.test(oldCoreCity) && !(isZipResolved(plainEst) && plainEst.precision >= PREC.TOWN)) {
    const tail0 = normAddr(suffix).replace(/^(大字|字)/, '');
    const tok = leadingToken(tail0);
    if (tok.length >= 2) {
      const cand = prefix + name + tok + '町' + suffix.replace(/^(大字|字)/, '').slice(tok.length);
      const e = resolveZip(cand);
      if (isZipResolved(e) && e.precision >= PREC.TOWN && e.town === normAddr(tok + '町')) {
        return { est: Object.assign({}, e, { level: e.level + '（旧村の基本町域を推定）', viaVillageBase: true }), address: cand, name };
      }
    }
  }
  // 旧市が政令市の区に分かれた場合は、許容区の中だけで町域を探す（無関係な区を選ばない）
  const allowed = OLD_CITY_WARDS[oldCoreCity];
  if (allowed && /^.+市$/.test(name)) {
    const hits = [];
    for (const w of allowed) {
      const cand = prefix + name + w + suffix;
      const e = resolveZip(cand);
      if (isZipResolved(e) && e.precision >= PREC.TOWN && e.city === name + w && !/部分一致/.test(e.level)) hits.push({ est: e, address: cand, name });
    }
    if (hits.length === 1) return hits[0];
    // 複数の区に同じ町域がある、またはどの許容区にも無い → 区を決めない
    return {
      est: {
        zip: '', precision: PREC.NONE, level: hits.length ? '区が特定できない' : '許容区に町域なし', matchedLen: 0,
        candidates: hits.map(h => h.est.city),
      },
      address: plain, name,
    };
  }
  if (isZipResolved(plainEst) && plainEst.precision >= PREC.TOWN) {
    return { est: plainEst, address: plain, name };
  }

  const oldCore = hit.entry.oldName.replace(/^.+?郡/, '');
  if (/[町村]$/.test(oldCore) && oldCore !== name) {
    const bare = oldCore.replace(/[町村]$/, '');
    const tail = suffix.replace(/^(大字|字)/, '');
    const tries = [prefix + name + oldCore + suffix];
    // 町村名だけを挿入する形は、後ろが番地から始まる住所に限る
    if (/^\d/.test(normAddr(tail))) tries.push(prefix + name + bare + suffix);
    for (const cand of tries) {
      const e = resolveZip(cand);
      if (!isZipResolved(e) || e.precision < PREC.TOWN) continue;
      const town = normAddr((POSTAL_MASTER[e.zip] || {}).town || '');
      const nextCh = normAddr(cand).charAt(e.matchedLen || 0);
      if (town.startsWith(oldCore) || (town === bare && nextCh !== '町' && nextCh !== '村')) {
        return { est: e, address: cand, name };
      }
    }
    // 町域まで決まらず、番地から始まる住所は、旧町村名の中心部分（小月村→小月）を大字として残す
    // （旧町村名は新市の大字名として残ることが多く、消すと情報が欠ける。町域は決まっていないので確度は上がらない）
    if (/^\d/.test(normAddr(tail)) && bare.length >= 2) {
      return { est: plainEst, address: prefix + name + bare + suffix, name };
    }
  }
  return { est: plainEst, address: plain, name };
}

// 住所から郵便番号を解決する統合入口。旧住所なら変換して取り直す。
//   戻り値: { est, converted }  converted は旧住所変換を使った場合の現行住所
function resolveZipDeep(address) {
  const est = resolveZip(address);
  if (isZipResolved(est) && est.precision >= PREC.TOWN) return { est, converted: '' };
  const hit = lookupExtinct(normAddr(address));
  if (!hit) return { est, converted: '' };
  const viaOld = resolveZipFromExtinct(address, hit);
  if (!viaOld) return { est, converted: '' };
  // 採用の条件。変換で町域名が消えることがある（「津市香良洲町」→「津市」）ため、
  // 元の住所で町域名を掴めている場合は、町域レベル以上でしか上書きしない。
  const vp = viaOld.est.precision || 0, ep = est.precision || 0;
  if (est.town) {
    if (vp >= PREC.TOWN && vp > ep) return { est: viaOld.est, converted: viaOld.address };
    return { est, converted: '' };
  }
  // 町域を掴めていない（旧市町村名のせいで市区町村すら引けない）場合は、
  // 市区町村レベルの結果や曖昧の理由でも旧住所経由の方が情報が多い
  if (vp > ep || (est.level === '不明' && viaOld.est.level !== '不明')) {
    return { est: viaOld.est, converted: viaOld.address };
  }
  return { est, converted: '' };
}

// 郵便番号マスター（Bモード・逆引き共通、遅延読込）
let POSTAL_MASTER = null;
let REVERSE_INDEX = null;  // { byPref, prefKeysDesc }
// 旧市町村 → 新市町村＋代表郵便番号マップ（遅延読込）
let EXTINCT_INDEX = null;  // { byPref: { [pref]: entries[] }, all: entries[] }
// 住所→緯度経度インデックス（遅延読込、geolonia 由来）
let GEOCODING = null;       // { city: {pref+city: [lat,lng]}, oaza: {pref+city+oaza: [lat,lng]} }

// 重複検出のための正規化
//   「東京都府中市浅間町３丁目２番地の34」「府中市浅間町3-2-34」「府中市浅間町3丁目2-34」を
//   全て同じキー「府中市浅間町3-2-34」相当に正規化（建物名・部屋番号は保持して別比較）
const KANJI_DIGIT_MAP = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
function kanjiNumToDigit(s) {
  // 番地に出てくる範囲（〜99）でカバー
  s = s.replace(/([一二三四五六七八九])十([一二三四五六七八九])/g, (_, a, b) => KANJI_DIGIT_MAP[a] * 10 + KANJI_DIGIT_MAP[b]);
  s = s.replace(/([一二三四五六七八九])十/g, (_, a) => KANJI_DIGIT_MAP[a] * 10);
  s = s.replace(/十([一二三四五六七八九])/g, (_, a) => 10 + KANJI_DIGIT_MAP[a]);
  s = s.replace(/十/g, '10');
  s = s.replace(/[一二三四五六七八九]/g, m => KANJI_DIGIT_MAP[m]);
  return s;
}

function normalizeAddressKey(addr) {
  if (!addr) return '';
  let s = addr;
  // 旧字体→新字体（武藏野市→武蔵野市）
  s = normalizeOldKanji(s);
  // ヶ→ケ
  s = s.replace(/ヶ/g, 'ケ');
  // 全角英数→半角
  s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // 番地に登場する漢数字を半角化（「三丁目」→「3丁目」、「二十一番地」→「21番地」）
  s = s.replace(/([一二三四五六七八九十]+)(丁目|番地|番|号|条|区画)/g, (_, num, suf) => kanjiNumToDigit(num) + suf);
  // 数字に挟まれた区切り表現を統一ハイフンへ（連続区切りに対応するため反復）
  let prev;
  do {
    prev = s;
    s = s.replace(/(\d)\s*(?:丁目|番地の|番地|番|号|の|ノ)\s*(\d)/g, '$1-$2');
  } while (s !== prev);
  // 末尾の番地・番・号は削除
  s = s.replace(/(\d)(?:番地|番|号)\s*$/g, '$1');
  // 各種ハイフン類を ASCII '-' に統一
  s = s.replace(/[ー－―‐−–—]/g, '-');
  // 連続ハイフン圧縮、末尾ハイフン除去
  s = s.replace(/-+/g, '-').replace(/-+$/g, '');
  // 空白除去（半角・全角・タブ）
  s = s.replace(/[\s　]/g, '');
  // 都道府県は省略可だが、付いてれば残す
  return s;
}

// マスター生成物のバージョン。data/ を再生成したら必ず更新する。
// これが無いとブラウザが古いJSONをキャッシュしたまま使い続ける。
const DATA_VERSION = '20261003';

async function ensurePostalMaster(onProgress) {
  if (POSTAL_MASTER) return POSTAL_MASTER;
  if (onProgress) onProgress('郵便番号マスターを読み込み中...（初回のみ数秒）');
  const resp = await fetch('data/postal_master.json?v=' + DATA_VERSION);
  if (!resp.ok) throw new Error('postal_master.json の読み込みに失敗しました');
  POSTAL_MASTER = await resp.json();
  if (onProgress) onProgress('');
  return POSTAL_MASTER;
}

async function ensureGeocoding(onProgress) {
  if (GEOCODING) return GEOCODING;
  if (onProgress) onProgress('地理データ（緯度経度）を読み込み中...（初回のみ数秒）');
  const resp = await fetch('data/geocoding.json?v=' + DATA_VERSION);
  if (!resp.ok) throw new Error('geocoding.json の読み込みに失敗しました');
  GEOCODING = await resp.json();
  if (onProgress) onProgress('');
  return GEOCODING;
}

// 郵便番号 → POSTAL_MASTER → (pref, city, town) を経由して緯度経度を引く
function geocodeFromZip(zipcode) {
  if (!GEOCODING || !POSTAL_MASTER || !zipcode) return null;
  const ref = POSTAL_MASTER[zipcode];
  if (!ref) return null;
  const cleanTown = (ref.town || '').replace(/（.*$/, '').trim();
  // 1) oaza レベル（最も精度高）
  if (cleanTown) {
    const k = ref.pref + ref.city + cleanTown;
    if (GEOCODING.oaza[k]) return { lat: GEOCODING.oaza[k][0], lng: GEOCODING.oaza[k][1], level: '町域' };
  }
  // 2) city レベル（重心）
  const ck = ref.pref + ref.city;
  if (GEOCODING.city[ck]) return { lat: GEOCODING.city[ck][0], lng: GEOCODING.city[ck][1], level: '市区町村' };
  return null;
}

// 旧市町村マップの遅延読込
// 旧市町村マップから検索用の索引を作る。
// 旧名と新名が同じ項目（市制施行・区域変更などで名称が変わらないもの。一宮市・津市など）は旧市町村ではないので除く
function buildExtinctIndex(arr) {
  arr = arr.filter(e => e.oldName && e.oldName !== e.newName);
  const byPref = {};
  for (const e of arr) {
    const k = e.prefecture || '不明';
    (byPref[k] = byPref[k] || []).push(e);
  }
  // 各県ごとに oldName 長さ降順にソート（最長一致のため）
  for (const k in byPref) {
    byPref[k].sort((a, b) => b.oldName.length - a.oldName.length);
  }
  // all も同じく長さ降順：都道府県未指定の入力時に最長一致を優先するため
  const all = arr.slice().sort((a, b) => b.oldName.length - a.oldName.length);
  // oldName 直引き（チェーン解決用）：「保谷市 → 西東京市」など
  const byOldName = {};
  for (const e of arr) {
    const k = `${e.prefecture}|${e.oldName}`;   // 同名の町村が別県にあるため県を含める
    if (!byOldName[k]) byOldName[k] = e;
  }
  return { byPref, all, byOldName };
}

// 公開の補正台帳（data/overrides.json）。無ければ空として扱う
let PUBLIC_OVERRIDES = null;      // 読み込み済みの公開台帳（配列）
let LOCAL_OVERRIDES = [];         // 画面から追加で読み込んだ台帳
async function ensureOverrides() {
  if (PUBLIC_OVERRIDES === null) {
    try {
      const resp = await fetch('data/overrides.json?v=' + DATA_VERSION);
      PUBLIC_OVERRIDES = resp.ok ? await resp.json() : [];
    } catch (e) { PUBLIC_OVERRIDES = []; }
    if (!Array.isArray(PUBLIC_OVERRIDES)) PUBLIC_OVERRIDES = [];
  }
  setOverrides(PUBLIC_OVERRIDES.concat(LOCAL_OVERRIDES));
}

async function ensureExtinctMap(onProgress) {
  if (EXTINCT_INDEX) return EXTINCT_INDEX;
  if (onProgress) onProgress('旧市町村マップを読み込み中...');
  const resp = await fetch('data/extinct_municipalities.json?v=' + DATA_VERSION);
  if (!resp.ok) throw new Error('extinct_municipalities.json の読み込みに失敗しました');
  EXTINCT_INDEX = buildExtinctIndex(await resp.json());
  if (onProgress) onProgress('');
  return EXTINCT_INDEX;
}

// 旧市町村の検索：入力住所に oldName（任意で 郡名 が前置）の出現位置を見つけて返す
function lookupExtinct(address) {
  if (!EXTINCT_INDEX || !address) return null;
  const { byPref, all } = EXTINCT_INDEX;

  // 都道府県ヒントで候補を絞る
  let candidates = null;
  for (const p of Object.keys(byPref)) {
    if (address.includes(p)) { candidates = byPref[p]; break; }
  }
  if (!candidates) candidates = all;

  // 郡前置パート: 都道府県・市町村を跨がない漢字/かな1〜5文字 + 郡（任意）
  // 郡名には「都」「府」が含まれうる（下都賀郡・伊都郡）。都道府県名の直後か先頭に限って許可する。
  const gunOptional = '(?:(?:^|(?<=[都道府県]))(?:(?![県道市町村])[一-龥ぁ-ゖァ-ヺ]){1,5}郡)?';

  for (const e of candidates) {
    const re = new RegExp(gunOptional + escapeRegex(e.oldName));
    const m = re.exec(address);
    if (m) {
      return {
        entry: e,
        matchStart: m.index,
        matchEnd: m.index + m[0].length,
        matchedText: m[0],
      };
    }
  }
  return null;
}


// 住所から番地以降をフォールバック抽出（逆引きが効かない場合用）
// 例: 「神奈川県橘樹郡田島町1-2-3 ビル5階」→「1-2-3 ビル5階」
function extractBanchiSuffix(address) {
  if (!address) return '';
  const m = address.match(/[\d０-９]+.*$/) ||
            address.match(/[一二三四五六七八九十百千]+(?:番地|番|丁目).*$/);
  return m ? m[0] : '';
}

// 郵便番号（既存 or 推定）を使って現行住所を組み立てる
// matchedLen: resolveZip が一致した「都道府県+市区町村+町域」の文字数。
//   これがあれば原文のその位置以降を suffix として使う（字・丁目表記を保持）。
// 補正後住所の先頭（都道府県＋市区町村＋町域）は、住所から自前で解決した結果（est）で作る。
// 既存の郵便番号は使わない（番号は住所から日本郵便データを引いて付けた派生値で、住所の新旧の根拠にならない）。
// 1つの郵便番号が複数町域を持つ場合（alt）でも、一致した町域（est.town）をそのまま使う。
function buildCurrentAddress(originalAddress, est) {
  if (!est || !est.zip || !POSTAL_MASTER) return '';
  const ref = POSTAL_MASTER[est.zip];
  if (!ref) return '';
  const matchedLen = est.matchedLen;
  let suffix;
  if (typeof matchedLen === 'number' && matchedLen > 0 && matchedLen <= originalAddress.length) {
    suffix = originalAddress.slice(matchedLen);
  } else {
    suffix = extractBanchiSuffix(originalAddress);
  }
  // 異体字を寄せた est.town ではなく、マスターの表記（primary/alt のうち est.town に当たるもの）を使う
  let town = '';
  if (est.town) {
    town = [ref.town].concat(ref.alt || []).find(t => t && normAddr(t) === est.town) || est.town;
  }
  const head = ref.pref + ref.city + town;
  return suffix ? `${head}${suffix}` : head;
}

// 下流（現行住所・緯度経度・重複検出）で使う郵便番号。自前の解決結果だけを使う
function pickUsableZip(est) {
  return est && est.zip && isZipResolved(est) ? est.zip : '';
}








function normalizeZip(raw) {
  if (!raw) return '';
  return String(raw).replace(/[^\d]/g, '').padStart(7, '0').slice(-7);
}

// --- 番地・丁目の漢数字 → 半角数字 ----------------------------
// 登記簿は「壱弐参」「〇」など漢数字で番地を書く。DMの宛名・突合・重複検出で扱いやすいよう半角数字にそろえる。
//   例: 「草加市氷川町七番地参」→「草加市氷川町7番地3」／「府中市七壱〇弐番地の壱」→「府中市7102番地の1」
//       「板橋区常盤台一丁目五九番壱壱ー壱〇弐号」→「板橋区常盤台1丁目59番11-102号」
// 地名の漢数字（三ツ井・五番町・十日市・千代田）は変換しない。数字として読むのは、直後が
// 丁目・番地・番・号・地割・「の」のとき、または直前が番地・番・号・「の」・ハイフンのときだけ。
const KANJI_DIGITS = { 〇:0, 零:0, 一:1, 壱:1, 壹:1, 二:2, 弐:2, 貳:2, 三:3, 参:3, 參:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
const KANJI_UNITS = { 十:10, 拾:10, 百:100, 千:1000 };
const KANJI_NUM_CHARS = '〇零一壱壹二弐貳三参參四五六七八九十拾百千';
const KANJI_RUN_RE = new RegExp('[' + KANJI_NUM_CHARS + ']+', 'g');
function kanjiRunToNumber(run) {
  if (![...run].some(c => KANJI_UNITS[c])) {
    return [...run].map(c => KANJI_DIGITS[c]).join('');   // 位取り（七壱〇弐→7102）
  }
  let total = 0, cur = 0;
  for (const c of run) {
    if (c in KANJI_DIGITS) cur = KANJI_DIGITS[c];
    else { total += (cur || 1) * KANJI_UNITS[c]; cur = 0; }   // 十・百・千（二十三→23）
  }
  return String(total + cur);
}
function toHalfWidthAscii(s) {
  return s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[‐‑–—−ー](?=\d)/g, '-');
}
function convertKanjiNumbers(address) {
  if (!address) return address;
  let out = String(address).replace(KANJI_RUN_RE, (run, offset, whole) => {
    const next = whole.charAt(offset + run.length);
    const after = whole.slice(offset + run.length);
    const prev = whole.slice(0, offset);
    const followed = /^(丁目|番地|地割|号|の|ノ)/.test(after) || (next === '番' && !/^番町/.test(after));
    const preceded = /(番地|番|号|の|ノ|[-ー－‐])$/.test(prev) || /\d$/.test(prev);
    // 「十日市」「千代田」のような地名は、単独の十・百・千（単位だけ）では数字とみなさない
    if (!(followed || preceded)) return run;
    if (/^[十拾百千]+$/.test(run) && !followed) return run;
    return kanjiRunToNumber(run);
  });
  return toHalfWidthAscii(out);
}

// 同じ県に、その名前の現行の市区町村があるか（旧名と同じ名前の現行の自治体を旧住所と誤検知しないため）
function isCurrentMunicipality(name, pref) {
  const pe = REVERSE_INDEX && REVERSE_INDEX.byPref[normAddr(pref)];
  if (!pe) return citySetHas(name);
  const n = normAddr(name);
  return !!(pe.cities[n] || (pe.gunlessOf && pe.gunlessOf[n]));
}

function judgeOldAddress(fullAddress) {
  if (!fullAddress || typeof fullAddress !== 'string' || !fullAddress.trim()) return { isOld: false, reason: '' };
  // 外国住所（台湾・中華・アメリカ・タイ等）は判定対象外
  if (FOREIGN_KEYWORDS.test(fullAddress)) return { isOld: false, reason: '' };
  // 建物名を分離して、住所本体だけで判定する
  const { address } = splitAddressAndBuilding(fullAddress);
  const reasons = [];
  const hit = new Set();  // 同じ理由の重複抑制

  // 郡判定（dict-lookup）：現行マスター → 旧郡 dict → 日本語validな未掲載郡 の順
  const gunHit = detectGun(address);
  if (gunHit && gunHit.status === 'extinct' && !hit.has(gunHit.gun)) {
    const suffix = gunHit.note ? `（${gunHit.note}）` : '';
    reasons.push(`消滅郡名${suffix}「${gunHit.gun}」`);
    hit.add(gunHit.gun);
  }

  // 市判定（dict-lookup）：現行マスター → 旧市 dict → 日本語validな未掲載市 の順
  const cityHit = detectCity(address);
  if (cityHit && cityHit.status === 'extinct' && !hit.has(cityHit.city)) {
    const suffix = cityHit.note ? `（${cityHit.note}）` : '';
    reasons.push(`消滅市名${suffix}「${cityHit.city}」`);
    hit.add(cityHit.city);
  }

  // 東京35区時代の消滅区判定（蒲田区・小石川区・神田区 等）
  const wardHit = detectExtinctTokyoWard(address);
  if (wardHit && !hit.has(wardHit.oldWard)) {
    reasons.push(`消滅区名「${wardHit.oldWard}」`);
    hit.add(wardHit.oldWard);
  }

  // 旧市町村マップによる判定（旧名の一覧はマップ1本）
  //   市区町村の位置（都道府県・郡の直後）に出現した場合だけ採用する。町域名との誤検知（栄町・本町など）を避けるため
  //   同じ県に同名の現行市区町村がある場合、県名が無く他県に同名の現行・旧の市区町村がある場合は旧住所と断定しない
  if (!reasons.some(r => r.startsWith('消滅'))) {
    const eh = lookupExtinct(address);
    if (eh) {
      const core = eh.entry.oldName.replace(/^.+?郡/, '');
      const before = address.slice(0, eh.matchStart).replace(/^(?:北海道|東京都|京都府|大阪府|.{2,3}県)/, '');
      const prefWritten = before.length < eh.matchStart;
      const ambiguous = !prefWritten && (citySetHas(core) || EXTINCT_INDEX.all.some(e => e !== eh.entry && e.oldName === eh.entry.oldName && e.prefecture !== eh.entry.prefecture));
      if (!before.trim() && !ambiguous && !isCurrentMunicipality(core, eh.entry.prefecture)) {
        reasons.push(`消滅市町村名「${eh.entry.oldName}」（現: ${resolveExtinctName(eh)}）`);
      }
    }
  }

  const m = address.match(OLD_KANJI);
  if (m) reasons.push(`旧字体「${m[0]}」`);
  if (KATAKANA_NO.test(address)) reasons.push('カタカナ「ノ」区切り');

  return { isOld: reasons.length > 0, reason: reasons.join(' / ') };
}

function formatZip(z) {
  const s = String(z || '').replace(/[^\d]/g, '');
  return s.length === 7 ? s.slice(0, 3) + '-' + s.slice(3) : s;
}

// 既存の郵便番号の品質チェック（元リストの番号付けが住所と整合しているか）。
// 番号は住所から日本郵便データを引いて付けた派生値なので、住所が現行か旧かの根拠にはしない。
//   state: none（番号なし）／ok／bad（番号が存在しない・市区町村が食い違う）／
//          warn（町域未確定の仮番号・区の食い違い。番号付けの品質情報）／skip（旧市町村名のため照合対象外）
function checkZipMatch(address, rawZip, est) {
  const z = normalizeZip(rawZip);
  if (!z || z.length !== 7) return { state: 'none', text: '' };
  const ref = POSTAL_MASTER ? POSTAL_MASTER[z] : null;
  if (!ref) return { state: 'bad', text: `マスターに存在しない郵便番号（${formatZip(z)}）` };
  // 下4桁0000は市区町村の代表（町域が引けなかったときの仮番号）。元リストの番号付けが町域まで届いていない
  if (z.slice(3) === '0000') {
    const hint = est && isZipResolved(est) && est.zip !== z
      ? `住所からは ${formatZip(est.zip)} と推定` : '住所の町域を引けていない';
    return { state: 'warn', text: `郵便番号が市区町村の代表番号（${formatZip(z)}）で町域未確定。${hint}` };
  }
  // 異体字を寄せてから比較する（例: マスターの「宝塚市」は塚がU+FA10のことがある）
  const addr = normalizePlace(address);
  const city = normalizePlace(ref.city);
  // 住所が旧市町村名のときは、現行の市区町村名と比べても意味がない（旧住所かどうかは別列で判定する）
  const old = lookupExtinct(address);
  if (old) {
    const now = normalizePlace(resolveExtinctName(old));
    if (now && city.includes(now.replace(/^.+?郡/, ''))) {
      return { state: 'skip', text: `旧市町村名のため照合対象外（番号は現行の${resolveExtinctName(old)}内）` };
    }
  }
  if (addr.includes(city)) return { state: 'ok', text: '一致' };
  const gun = city.match(/^(.+郡)(.+)$/);
  if (gun && addr.includes(gun[2])) return { state: 'ok', text: '一致' };
  // 政令市の区が住所側で省略されているだけなら矛盾ではない
  const seirei = city.match(/^(.+市)(.+区)$/);
  if (seirei && addr.includes(seirei[1])) {
    const after = addr.slice(addr.indexOf(seirei[1]) + seirei[1].length);
    const wardWritten = after.match(/^[^\d]{1,5}?区/);
    if (!wardWritten) return { state: 'ok', text: `一致（住所に区の記載なし: ${ref.city}）` };
    // 区が食い違う。どちらが正しいかは番号からは言えない（旧区の判定は住所側で別に行う）
    return { state: 'warn', text: `住所の区（${wardWritten[0]}）と郵便番号の区が異なる（郵便番号→${ref.pref}${ref.city}）` };
  }
  return { state: 'bad', text: `住所と不一致（郵便番号→${ref.pref}${ref.city}）` };
}

// 補正後住所を作る。旧市町村・旧区の現行化 → 漢数字・全角の半角化の順
//   current: 旧住所を現行に直した住所（直せなければ空）／notes: 何を直したか
function correctAddress({ address, est, isOld, extHit, convertedForZip, convertOld, oldWard, override }) {
  // 人手補正台帳に当たった場合は、ルールより先にその補正を採用する
  if (override) {
    const fixed = address.slice(0, override.start) + override.entry.replace + address.slice(override.end);
    const half0 = convertKanjiNumbers(fixed);
    const notes1 = ['人手補正台帳' + (override.entry.source ? `（${override.entry.source}）` : '')];
    if (half0 !== fixed) notes1.push('漢数字・全角を半角化');
    return { current: fixed, corrected: half0, notes: notes1 };
  }
  let current = '';
  const notes0 = [];
  if (convertOld) {
    // 部分一致（旧町村名を手がかりに町域を1つに絞ったもの）は、町域まで直すと実在しない住所を作りうる
    // （例: 田無市本町→「西東京市田無町田無本町」）。この場合は市区町村名だけを現行にして、町域は原文のまま残す
    const partial = !!(est && /部分一致/.test(est.level || '') && !est.viaVillageBase);
    if (partial && extHit) {
      const oldCore = extHit.entry.oldName.replace(/^.+?郡/, '');
      const keepOld = /町$/.test(oldCore) ? oldCore : '';   // 旧町名は新しい町域名の一部に残ることが多いので消さない（村は市に編入されると町域名に残らないことが多い）
      current = address.slice(0, extHit.matchStart) + resolveExtinctName(extHit) + keepOld + address.slice(extHit.matchEnd);
      notes0.push('市区町村名のみ現行化（町域は原文のまま・要確認）');
    }
    if (!partial && isOld && est && est.zip && isZipResolved(est) && est.matchedLen > 0) {
      // 旧住所を変換して解決した場合、matchedLen は変換後の住所での位置なので、変換後の住所を基準にする
      current = buildCurrentAddress(convertedForZip || address, est);
    }
    if (isOld && !current && extHit) {
      // 郵便番号の解決で使った変換結果があればそれを使う（旧町村名を町域に残した形を含む）
      current = convertedForZip ||
        (address.slice(0, extHit.matchStart) + resolveExtinctName(extHit) + address.slice(extHit.matchEnd));
    }
    if (isOld && !current) {
      const wh = detectExtinctTokyoWard(address);
      if (wh) current = address.slice(0, wh.matchStart) + wh.newWard + address.slice(wh.matchEnd);
    }
    if (isOld && !current && /[國縣區驛濱邊澤關藏櫻龍廳]/.test(address)) current = normalizeOldKanji(address);
  }
  let corrected = current || address;
  const notes = notes0.slice();
  if (current && !notes0.length) notes.push(oldWard && oldWard.grade === 'B' ? `旧区を現行に変換（${oldWard.oldWard}→${oldWard.confirmed}）` : '旧住所を現行に変換');
  // 旧区: 再編表の裏付けがあるもの（確度B）だけ直す。裏付けの無いもの（確度C）は直さず、理由欄に候補を出す
  if (!current && oldWard && oldWard.grade === 'B') {
    corrected = address.slice(0, oldWard.start) + oldWard.confirmed + address.slice(oldWard.end);
    notes.push(`旧区を現行に変換（${oldWard.oldWard}→${oldWard.confirmed}）`);
  }
  const half = convertKanjiNumbers(corrected);
  if (half !== corrected) { notes.push('漢数字・全角を半角化'); corrected = half; }
  return { current, corrected, notes };
}
