/**
 * 郵便番号リゾルバの回帰テスト（Node.js）
 *
 *   node tests/resolver-cases.js
 *
 * index.html のロジック部分をそのまま読み込み、data/ の生成物を使って
 * 実住所のケースを検証する。ロジックを触ったら必ずこれを通す。
 * 期待値は日本郵便 ken_all の実データで確認済み。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// --- index.html からロジック部分（UI より前）を取り出す ---
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const scriptStart = html.indexOf('<script>\n', html.indexOf('</head>')) ;
const body = html.slice(scriptStart + 9, html.indexOf('</script>', scriptStart));
const logic = body.slice(0, body.indexOf('// ============================================================\n// UI'));

global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'data', 'cities.js'), 'utf-8'));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'postal_master.json'), 'utf-8'));
const extinct = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extinct_municipalities.json'), 'utf-8'));

const api = new Function('window', 'MASTER', 'EXT', logic + `
  POSTAL_MASTER = MASTER;
  buildReverseIndex();
  const byPref = {};
  for (const e of EXT) { const k = e.prefecture || '不明'; (byPref[k] = byPref[k] || []).push(e); }
  for (const k in byPref) byPref[k].sort((a, b) => b.oldName.length - a.oldName.length);
  const byOldName = {};
  for (const e of EXT) if (e.oldName && !byOldName[e.oldName]) byOldName[e.oldName] = e;
  EXTINCT_INDEX = { byPref, all: EXT.slice().sort((a, b) => b.oldName.length - a.oldName.length), byOldName };
  return { resolveZipDeep, isZipResolved };
`)(global.window, master, extinct);

// --- ケース: [住所, 期待する郵便番号（空文字は「未確定であるべき」）, 観点] ---
const CASES = [
  // 表記ゆれ
  ['北海道虻田郡俱知安町南4条西2丁目2番地117', '044-0034', '異体字（俱 U+4FF1 と 倶 U+5036）'],
  ['北海道虻田郡倶知安町字樺山116番地9', '044-0078', '「字」を読み飛ばす'],
  ['北海道虻田郡倶知安町ニセコひらふ1条3丁目2番6号', '044-0080', '算用数字の条→漢数字'],
  ['北海道虻田郡倶知安町南２条東１丁目６番地１', '044-0012', '全角数字'],
  ['旭川市七条通十三丁目右7号', '070-0037', 'マスターが算用数字（７条通）'],
  ['北海道札幌市東区北42条東15丁目1-1', '007-0842', '2桁の条'],
  // 町域が丁目・方角・小字で分かれる
  ['札幌市中央区南一条西二十三丁目1番15-305号', '064-0801', '丁目の範囲（20〜28丁目）'],
  ['札幌市白石区南郷通七丁目南1番28号', '003-0022', '方角（南）'],
  ['三重県津市香良洲町稲葉2000', '514-0311', '小字で一意化'],
  ['三重県津市香良洲町3032-1', '', '小字が書かれていない → 未確定'],
  ['名古屋市緑区鳴海町字坊主山118番地', '458-0801', '小字が列挙外 → その他'],
  ['兵庫県尼崎市潮江二丁目1番28-206号', '661-0976', '丁目が列挙外（1丁目1番・5丁目1番のみ）→ その他'],
  ['東京都新宿区西早稲田三丁目12番4-702号', '169-0051', '同上'],
  ['東京都新宿区戸山町28番地', '162-0052', '列挙は3丁目18・21番のみ → その他'],
  ['東京都江戸川区西瑞江二丁目22番地43', '', '2丁目がマスターに無い → 未確定'],
  // 区・郡の補完
  ['千葉市末広町一丁目98番地', '260-0843', '政令市で区が省略 → 町域から特定'],
  ['千葉市稲毛海岸四丁目8番8号', '261-0005', '同名町域より最長一致を優先'],
  ['神奈川県足柄上部大井町金子734番地1', '258-0019', '郡名の誤記'],
  ['神奈川県相模原市大野台二丁目21番7号', '', '中央区と南区の両方に大野台 → 未確定'],
  ['神奈川県相模原市下九沢280番地28', '', '緑区と中央区の両方に下九沢 → 未確定'],
  // 旧住所
  ['千葉県海上郡飯岡町飯岡2414番地', '289-2705', '消滅郡＋消滅町'],
  ['埼玉県大宮市本郷町1173番地', '331-0802', '政令市化。区は町域から決める（北区）'],
  ['静岡県清水市有東坂538番地3', '424-0873', '同上（清水区）。「有東」と競合させない'],
  ['広島県佐伯郡五日市町五月が丘二丁目3番地7', '731-5101', '同上（佐伯区）'],
  ['三重県南牟婁郡鵜殿村1573番地6', '519-5701', '旧村名が町域名になる'],
  ['愛知県西春日井郡西枇杷島町泉町29番地', '452-0015', '旧町名が町域名の一部として残る'],
  ['福井県三方郡三方町黒田第三十五号18番地', '', '上黒田と東黒田があり決まらない → 未確定'],
  ['山梨県中巨摩郡竜王町西八幡2819番地2', '400-0117', '郡に残る別の町（昭和町）を掴まない'],
  ['神奈川県高座郡綾瀬町大上308番地25', '252-1104', '同上（寒川町を掴まない）'],
  ['栃木県下都賀郡国分寺町大字小金井1210番地5', '329-0414', '郡名に「都」を含む'],
  ['和歌山県伊都郡高野口町大字田原186番地', '649-7216', '同上'],
  ['空知郡栗沢町字茂世丑338番地', '068-0114', '合併後の町域名に旧町名が前置される'],
  ['群馬県群馬郡群馬町大字井出1704番地1', '370-3534', '同上（井出町）'],
  // 掲載外
  ['雨龍郡妹背牛町字妹背牛361番地', '079-0500', '町域の登録が無い → 以下に掲載がない場合'],
  ['枝幸郡歌登町大字歌登村字上幌別六線120番地', '098-5800', '旧住所＋掲載外'],
  ['東京都保谷市本町五丁目4番B-805号', '202-0000', '同上'],
  ['北海道虻田郡倶知安町字189-16', '044-0000', '町域名が欠落 → 市区町村まで'],
];

const fmt = z => (z ? String(z).slice(0, 3) + '-' + String(z).slice(3) : '');
let ng = 0;
for (const [addr, want, note] of CASES) {
  const d = api.resolveZipDeep(addr);
  const got = api.isZipResolved(d.est) ? fmt(d.est.zip) : '';
  const ok = got === want;
  if (!ok) ng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} ${addr}`);
  if (!ok) console.log(`      期待=${want || '(未確定)'} 実際=${got || '(未確定)'} [${d.est.level}] ${note}`);
}
console.log(`\n${CASES.length - ng} / ${CASES.length} 通過${ng ? `（NG ${ng}件）` : ''}`);
process.exit(ng ? 1 : 0);
