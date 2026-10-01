/**
 * 郵便番号リゾルバの回帰テスト（Node.js）
 *
 *   node tests/resolver-cases.js
 *
 * resolver.js をそのまま読み込み、data/ の生成物を使って
 * 実住所のケースを検証する。ロジックを触ったら必ずこれを通す。
 * 期待値は日本郵便 ken_all の実データで確認済み。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// --- ロジックは resolver.js（DOM に依存しない）をそのまま読み込む ---
const logic = fs.readFileSync(path.join(ROOT, 'resolver.js'), 'utf-8');

global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'data', 'cities.js'), 'utf-8'));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'postal_master.json'), 'utf-8'));
const extinct = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extinct_municipalities.json'), 'utf-8'));

const api = new Function('window', 'MASTER', 'EXT', logic + `
  POSTAL_MASTER = MASTER;
  buildReverseIndex();
  EXTINCT_INDEX = buildExtinctIndex(EXT);
  return { resolveZipDeep, isZipResolved, judgeOldAddress, checkZipMatch, convertKanjiNumbers, correctAddress, lookupExtinct, normalizeZip, pickUsableZip, applyOldWard, gradeAddress, setOverrides, findOverride, parseOverridesCsv, buildOverrideTemplateCsv };
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
  // 区名と同名の町域を持つ政令市（区が書かれているのに区補完で同名町域を拾わない）
  ['横浜市鶴見区尻手一丁目１番８－６０３号', '230-0003', '鶴見区に町域「鶴見」がある'],
  ['千葉市中央区本町二丁目６番３６号', '260-0012', '中央区に町域「中央」がある'],
  // 旧市名が新市の町域名の先頭に残る
  ['三重県久居市新町612番地5', '514-1118', '津市新町ではなく津市久居新町'],
  ['沖縄県平良市字下里719番地', '906-0013', '宮古島市平良下里（字を落とす）'],
  // 異体字
  ['東京都千代田区麴町三丁目５番１３号', '102-0083', '麴（U+9E74）と麹'],
  // 昭和の町村合併の旧村（1970年より前）。大字が「大字名＋町」の町域として残る
  ['茨城県新治郡上大津村神立4011番地27', '300-0013', '旧村→土浦市。神立東・神立中央ではなく神立町'],
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
// --- 既存の郵便番号列との突合・旧住所判定 ---
// [住所, 郵便番号, 期待state, 結果の文言に含まれるべき語, 観点]
const ZIP_CASES = [
  ['愛知県一宮市三ツ井五丁目3番1号', '491-0000', 'warn', '491-0827', '下4桁0000は町域未確定の仮番号（品質情報）。住所から推定した番号を併記'],
  ['東京都葛飾区下小松町439番地', '124-0000', 'warn', '町域未確定', '町域が引けていない'],
  ['愛知県一宮市三ツ井五丁目3番1号', '491-0827', 'ok', '', '正しい番号'],
  ['川崎市高津区宮崎二丁目11番地11', '216-0033', 'warn', '区が異なる', '区が食い違う。どちらが正しいかは番号から言えないので品質情報にとどめる'],
  ['千葉市末広町一丁目98番地', '260-0843', 'ok', '', '区の省略は矛盾ではない'],
  ['埼玉県大宮市大字小深作946番地8', '337-0005', 'skip', '照合対象外', '旧市名は現行の市区町村名と比べない（「一致」とは表示しない）'],
  ['三重県久居市新町612番地5', '514-1118', 'skip', '照合対象外', '同上'],
  ['東京都千代田区麴町三丁目5番13号', '999-9999', 'bad', '存在しない', 'マスターに無い番号'],
];
let zng = 0;
for (const [addr, zip, state, word, note] of ZIP_CASES) {
  const est = api.resolveZipDeep(addr).est;
  const r = api.checkZipMatch(addr, zip, est);
  const ok = r.state === state && r.text.includes(word);
  if (!ok) zng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [突合] ${addr} / ${zip}`);
  if (!ok) console.log(`      期待=${state}+「${word}」 実際=${r.state} ${r.text} ${note}`);
}
const OLD_CASES = [
  ['石川県石川郡野々市町本町三丁目7番12号', '消滅市町村名', '旧市町村マップの町村（ハードコード一覧に無い）'],
  ['岩手県和賀郡湯田町29地割70番地6', '消滅市町村名', '同上'],
  ['石川県野々市市本町三丁目7番12号', '', '現行は誤検知しない'],
  ['埼玉県さいたま市浦和区高砂三丁目15番1号', '', '現行は誤検知しない'],
  ['埼玉県浦和市原山四丁目3番23号', '消滅市名', '既存の市名判定は維持（二重に付けない）'],
  ['大阪市城東区成育五丁目23番2号', '', '大阪市の城東区は東京35区時代の区ではない'],
  ['北海道夕張郡長沼町東六線北3番地', '', '福島県の旧長沼町と取り違えない（県名が無くても北海道の現行の町）'],
  ['夕張郡長沼町北町二丁目5番6号', '', '同上（県名なし）'],
  ['福島県岩瀬郡長沼町大字長沼1番地', '消滅市町村名', '福島県の旧長沼町は旧住所'],
  ['福島県平市字大町1番地', '消滅市名', 'ハードコード一覧から旧市町村マップへ移した平市（いわき市）'],
  ['愛知県名古屋市中区栄一丁目1番1号', '', '町域名の栄は旧住所ではない'],
  ['静岡県焼津市栄町一丁目1番地', '', '現行の栄町を旧住所と誤検知しない'],
  ['東京都蒲田区蒲田一丁目1番1号', '消滅区名', '東京の旧区は維持'],
];
let ong = 0;
for (const [addr, word, note] of OLD_CASES) {
  const r = api.judgeOldAddress(addr);
  const ok = word ? r.reason.includes(word) : !r.isOld;
  const dup = (r.reason.match(/消滅/g) || []).length > 1;
  if (!ok || dup) ong++;
  console.log(`${ok && !dup ? 'OK  ' : 'NG  '} [旧住所] ${addr}`);
  if (!ok || dup) console.log(`      期待=${word || '(旧住所でない)'} 実際=${r.reason || '(なし)'} ${note}`);
}
const KANJI_CASES = [
  ['埼玉県草加市氷川町七番地参', '埼玉県草加市氷川町7番地3'],
  ['東京都府中市七壱〇弐番地の壱ライオンズマンション東府中四〇五号', '東京都府中市7102番地の1ライオンズマンション東府中405号'],
  ['板橋区常盤台一丁目五九番壱壱ー壱〇弐号', '板橋区常盤台1丁目59番11-102号'],
  ['町田市本町田弐五七七番地', '町田市本町田2577番地'],
  ['岩手県和賀郡湯田町弐九地割七〇番地六', '岩手県和賀郡湯田町29地割70番地6'],
  ['千代田区五番町四番地四', '千代田区五番町4番地4'],
  ['愛知県一宮市三ツ井五丁目３番１号シェノン２０３号', '愛知県一宮市三ツ井5丁目3番1号シェノン203号'],
  ['東京都葛飾区二十三番地', '東京都葛飾区23番地'],
  ['千葉県八千代市大字村上２０９０番地８４', '千葉県八千代市大字村上2090番地84'],
  ['東京都港区海岸一丁目６番１－２３０６号', '東京都港区海岸1丁目6番1-2306号'],
  ['京都市上京区十日市町', '京都市上京区十日市町'],
];
let kng = 0;
for (const [src, want] of KANJI_CASES) {
  const got = api.convertKanjiNumbers(src);
  const ok = got === want;
  if (!ok) kng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [数字化] ${src}`);
  if (!ok) console.log(`      期待=${want} 実際=${got}`);
}
const FIX_CASES = [
  // [住所, 補正後住所, 補正内容に含まれるべき語, 含まれてはいけない語]
  ['埼玉県大宮市大字小深作九四六番地の八', '埼玉県さいたま市見沼区小深作946番地の8', '旧住所', ''],
  // 部分一致（町域まで直すと実在しない住所になる）→ 市区町村名だけ現行化し、町域は原文のまま
  ['東京都田無市本町3丁目1番1号', '東京都西東京市本町3丁目1番1号', '市区町村名のみ', '西東京市田無町'],
  ['岩手県胆沢郡前沢町字五合田100', '岩手県奥州市前沢町字五合田100', '市区町村名のみ', ''],
  ['三重県久居市新町六壱弐番地の五', '三重県津市久居新町612番地の5', '旧住所', ''],
  ['沖縄県平良市字下里７１９番地', '沖縄県宮古島市平良下里719番地', '旧住所', ''],
  ['石川県石川郡野々市町本町三丁目七番壱弐号', '石川県野々市市本町3丁目7番12号', '旧住所', ''],
  ['草加市氷川町七番地参', '草加市氷川町7番地3', '半角化', '旧住所'],
  // 旧区は、住所の区に町域が無く、再編表に載る後継区に町域がある場合だけ直す（郵便番号は使わない）
  ['川崎市高津区宮崎二丁目１１番地１１', '神奈川県川崎市宮前区宮崎2丁目11番地11', '旧区', ''],
  ['神奈川県横浜市緑区さつきが丘弐番地四六', '神奈川県横浜市青葉区さつきが丘2番地46', '旧区', ''],
  ['横浜市戸塚区桂町３０３番地１', '神奈川県横浜市栄区桂町303番地1', '旧区', ''],
  ['静岡県浜松市中区板屋町100番地', '静岡県浜松市中央区板屋町100番地', '旧区', ''],
];
let fxng = 0;
for (const [addr, want, word, ng_word] of FIX_CASES) {
  const d = api.resolveZipDeep(addr);
  const isOld = api.judgeOldAddress(addr).isOld;
  const extHit = (!api.isZipResolved(d.est) || d.converted) ? api.lookupExtinct(addr) : null;
  const ow = api.applyOldWard(addr, d.est, d.converted);
  const fx = api.correctAddress({ address: addr, est: ow.est, isOld: isOld || !!ow.flagReason, extHit, convertedForZip: ow.convertedForZip, convertOld: true, oldWard: ow.oldWard });
  const notes = fx.notes.join('/');
  const ok = fx.corrected === want && notes.includes(word) && (!ng_word || !notes.includes(ng_word));
  if (!ok) fxng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [補正] ${addr}`);
  if (!ok) console.log(`      期待=${want} 実際=${fx.corrected} [${notes}]`);
}
// --- 旧区の判定（住所の文字列だけ。郵便番号は使わない）---
// [住所, 期待する後継区（確度B）, 期待する確度, 観点]  後継区が空なら「旧区ではない」
const WARD_CASES = [
  ['川崎市高津区宮崎二丁目11番地11', '宮前区', 'B', '1982 高津区→宮前区'],
  ['神奈川県横浜市緑区さつきが丘2番地46', '青葉区', 'B', '1994 緑区→青葉区'],
  ['横浜市戸塚区桂町303番地1', '栄区', 'B', '1986 戸塚区→栄区'],
  ['静岡県浜松市中区板屋町100番地', '中央区', 'B', '2024 浜松市の区再編（区名自体が現行に無い）'],
  ['横浜市鶴見区尻手一丁目1番8号', '', '', '現行の区に町域がある'],
  ['大阪市城東区成育五丁目23番2号', '', '', '現行の区に町域がある'],
  ['千葉市中央区本町二丁目6番36号', '', '', '区名と同名の町域を持つ区'],
];
let wng = 0;
for (const [addr, want, grade, note] of WARD_CASES) {
  const d = api.resolveZipDeep(addr);
  const ow = api.applyOldWard(addr, d.est, d.converted).oldWard;
  const got = ow ? ow.confirmed : '';
  const ok = got === want && (!want || ow.grade === grade);
  if (!ok) wng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [旧区] ${addr}`);
  if (!ok) console.log(`      期待=${want || '(旧区でない)'} 実際=${ow ? ow.confirmed + '/' + ow.grade + '/' + ow.candidates.map(c => c.city) : '(なし)'} ${note}`);
}
// 旧市が政令市の区に分かれた場合に無関係な区を選ばない
const OLDCITY_CASES = [
  // [住所, 選んではいけない区, 期待する区（空なら決めない）]
  ['埼玉県浦和市本町二丁目1番1号', 'さいたま市岩槻区', ''],
  ['埼玉県大宮市本郷町1173番地', '', 'さいたま市北区'],
];
let ocng = 0;
for (const [addr, forbid, wantCity] of OLDCITY_CASES) {
  const e = api.resolveZipDeep(addr).est;
  const ok = (!forbid || e.city !== forbid) && (!wantCity || e.city === wantCity);
  if (!ok) ocng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [旧市→区] ${addr}`);
  if (!ok) console.log(`      実際=${e.city} ${e.level} zip=${e.zip}`);
}
// 都道府県が書かれていない住所: 最初に当たった県で確定せず、県をまたいで比べる
const NOPREF_CASES = [
  // [住所, 期待する郵便番号（空なら未確定）, 観点]
  ['伊達市梅本町61番地', '052-0022', '福島県の伊達市は「掲載外」止まり、北海道は町域まで当たる → 北海道'],
  ['東京都府中市本町1番1号', '183-0027', '都道府県あり（同名の府中市がある広島県に引きずられない）'],
];
let npng = 0;
for (const [addr, want, note] of NOPREF_CASES) {
  const d = api.resolveZipDeep(addr);
  const got = api.isZipResolved(d.est) ? fmt(d.est.zip) : '';
  const ok = got === want;
  if (!ok) npng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [県名なし] ${addr}`);
  if (!ok) console.log(`      期待=${want || '(未確定)'} 実際=${got || '(未確定)'} [${d.est.level}] ${note}`);
}
// --- 確度（A〜E）---
const GRADE_CASES = [
  // [住所, 期待する確度, 観点]
  ['東京都千代田区鍛冶町二丁目6番2号', 'A', '原文のまま現行に一致'],
  ['札幌市中央区南一条西二十三丁目1番15号', 'A', '丁目の範囲で一意化（マスターの規則）'],
  ['千葉市末広町一丁目98番地', 'C', '省略された区を補完'],
  ['神奈川県足柄上部大井町金子734番地1', 'C', '郡の誤記を補完'],
  ['伊達市梅本町61番地', 'A', '県名なしでも、他県（福島の伊達市）に町域まで当たる結果が無ければ一意'],
  ['東京都田無市本町3丁目1番1号', 'C', '町域を部分一致で推定'],
  ['埼玉県大宮市大字小深作946番地の8', 'B', '旧市名を変遷表で現行に変換'],
  ['川崎市高津区宮崎二丁目11番地11', 'B', '区再編表に基づく旧区の変換'],
  ['雨龍郡妹背牛町字妹背牛361番地', 'D', '町域の登録が無く市区町村止まり'],
  ['北海道虻田郡倶知安町字189-16', 'D', '町域名が欠落'],
  ['東京都江戸川区西瑞江二丁目22番地43', 'E', '町域が決まらない'],
];
let gng = 0;
for (const [addr, want, note] of GRADE_CASES) {
  const d = api.resolveZipDeep(addr);
  const isOldRes = api.judgeOldAddress(addr);
  const extHit = (!api.isZipResolved(d.est) || d.converted) ? api.lookupExtinct(addr) : null;
  const ow = api.applyOldWard(addr, d.est, d.converted);
  const isOld = isOldRes.isOld || !!ow.flagReason;
  const fx = api.correctAddress({ address: addr, est: ow.est, isOld, extHit, convertedForZip: ow.convertedForZip, convertOld: true, oldWard: ow.oldWard });
  const g = api.gradeAddress({ address: addr, est: ow.est, isOld, oldReason: isOldRes.reason + (ow.flagReason || ''), current: fx.current, convertedForZip: ow.convertedForZip, oldWard: ow.oldWard });
  const ok = g.grade === want;
  if (!ok) gng++;
  console.log(`${ok ? 'OK  ' : 'NG  '} [確度${want}] ${addr}`);
  if (!ok) console.log(`      期待=${want} 実際=${g.grade}（${g.reason}） ${note}`);
}
// --- 人手補正台帳 ---
const OVR_CSV = '\uFEFF元の住所,補正後の住所,郵便番号,出典,確認者,確認日,（参考）確度\r\n"茨城県新治郡上大津村神立4011",茨城県土浦市神立町4011,300-0013,土浦市の資料,石田,2026-10-01,C\r\n空の行,,,,,,\r\n';
const ovrEntries = api.parseOverridesCsv(OVR_CSV);
let ong2 = 0;
const chk = (label, ok, detail) => { if (!ok) ong2++; console.log(`${ok ? 'OK  ' : 'NG  '} [台帳] ${label}`); if (!ok) console.log('      ' + detail); };
chk('CSVの取り込み（補正後が空の行は無視）', ovrEntries.length === 1 && ovrEntries[0].zip === '3000013', JSON.stringify(ovrEntries));
api.setOverrides(ovrEntries);
const ovAddr = '新治郡上大津村神立４０１１番地２７';
const hit = api.findOverride(ovAddr);
chk('住所に当たる台帳を見つける（表記ゆれ・県名なし）', !!hit && hit.start === 0, JSON.stringify(hit && hit.start));
const fxo = api.correctAddress({ address: ovAddr, est: null, isOld: false, extHit: null, convertedForZip: '', convertOld: true, oldWard: null, override: hit });
chk('台帳の補正が最優先で適用される', fxo.corrected === '茨城県土浦市神立町4011番地27'.replace('4011番地27', '4011番地27') && fxo.notes[0].startsWith('人手補正台帳'), fxo.corrected + ' ' + fxo.notes);
chk('台帳に当たれば確度B', api.gradeAddress({ address: ovAddr, est: null, isOld: false, oldReason: '', current: fxo.current, convertedForZip: '', oldWard: null, override: hit }).grade === 'B', '');
chk('当たらない住所は台帳が効かない', api.findOverride('茨城県土浦市神立町3535番地') === null, '');
const tpl = api.buildOverrideTemplateCsv([{ addr: '新治郡上大津村神立1', grade: 'C', reason: '推定', auto: '' }]);
chk('雛形CSVを取り込んでも、補正後が空なので何も登録されない', api.parseOverridesCsv(tpl).length === 0, tpl);
api.setOverrides([]);
// --- resolver.js のキャッシュ対策: index.html の ?v= と DATA_VERSION が一致していること ---
const htmlText = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const tagVer = (htmlText.match(/resolver\.js\?v=(\d+)/) || [])[1];
const codeVer = (logic.match(/const DATA_VERSION = '(\d+)'/) || [])[1];
const verOk = !!tagVer && tagVer === codeVer;
console.log(`${verOk ? 'OK  ' : 'NG  '} [バージョン] index.html の resolver.js?v=${tagVer} と DATA_VERSION ${codeVer} が一致`);
const total = CASES.length + ZIP_CASES.length + OLD_CASES.length + KANJI_CASES.length + FIX_CASES.length + WARD_CASES.length + OLDCITY_CASES.length + NOPREF_CASES.length + GRADE_CASES.length + 5 + 1;
const fails = ng + zng + ong + kng + fxng + wng + ocng + npng + gng + ong2 + (verOk ? 0 : 1);
console.log(`
全体 ${total - fails} / ${total} 通過`);
process.exit(fails ? 1 : 0);
