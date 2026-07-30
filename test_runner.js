/**
 * 旧住所フィルタ テストランナー（Node.js版）
 * test_addresses.csv を読み込み、判定結果を表示
 */
const fs = require('fs');
const path = require('path');

// ============================================================
// 郵便番号マスター読み込み
// ============================================================
const postalMasterPath = path.join(__dirname, 'masters', '14KANAGA_UTF8.CSV');
const postalData = new Map(); // city -> Set<town>
const validTowns = new Set(); // "city+town"

if (fs.existsSync(postalMasterPath)) {
  const lines = fs.readFileSync(postalMasterPath, 'utf-8').split('\n');
  for (const line of lines) {
    const cols = line.match(/(".*?"|[^,]+)/g);
    if (!cols || cols.length < 9) continue;
    const city = cols[7].replace(/"/g, '').trim();
    const town = cols[8].replace(/"/g, '').trim();
    if (town.includes('以下に掲載がない場合')) continue;

    validTowns.add(`${city}${town}`);
    if (!postalData.has(city)) postalData.set(city, new Set());
    postalData.get(city).add(town);
  }
  console.log(`[INFO] 郵便番号マスター: ${validTowns.size}町域, ${postalData.size}市区町村`);
}

// ============================================================
// 旧住所判定マスター
// ============================================================
const EXTINCT_DISTRICTS = {
  '久良岐郡': { current: '横浜市', extinct: '1927', years: 90 },
  '橘樹郡': { current: '横浜市・川崎市', extinct: '1938', years: 85 },
  '都筑郡': { current: '横浜市', extinct: '1939', years: 85 },
  '鎌倉郡': { current: '横浜市・藤沢市等', extinct: '1948', years: 75 },
  '津久井郡': { current: '相模原市', extinct: '2007', years: 15 },
};

const HEISEI_MERGED = {
  '津久井町': { current: '相模原市緑区', date: '2006' },
  '相模湖町': { current: '相模原市緑区', date: '2006' },
  '城山町': { current: '相模原市緑区', date: '2007' },
  '藤野町': { current: '相模原市緑区', date: '2007' },
};

const OLD_KANJI_RE = /[國縣區驛濱邊澤關藏櫻龍廳]/;
const KANJI_BANCHI_RE = /[一二三四五六七八九十百千]+(番地|番)/;
const KATAKANA_NO_RE = /[0-9０-９]+ノ[0-9０-９]+/;
const OAZA_RE = /大字[\u4e00-\u9fff]/;

function judgeAddress(address) {
  const result = {
    isOld: false,
    confidence: '',
    reasons: [],
    years: 0,
    hint: '',
  };

  if (!address) return result;

  // 判定1: 消滅済み郡名
  for (const [district, info] of Object.entries(EXTINCT_DISTRICTS)) {
    if (address.includes(district)) {
      result.isOld = true;
      result.confidence = 'HIGH';
      result.reasons.push(`消滅済み郡名「${district}」（${info.extinct}年消滅）`);
      result.years = Math.max(result.years, info.years);
      result.hint = info.current;
    }
  }

  // 判定2: 平成の大合併
  for (const [town, info] of Object.entries(HEISEI_MERGED)) {
    if (address.includes(town)) {
      result.isOld = true;
      result.confidence = 'HIGH';
      result.reasons.push(`消滅町名「${town}」→${info.current}`);
      result.years = Math.max(result.years, 15);
      result.hint = info.current;
    }
  }

  // 判定3: 旧字体
  const oldKanjiMatch = address.match(OLD_KANJI_RE);
  if (oldKanjiMatch) {
    result.isOld = true;
    if (result.confidence !== 'HIGH') result.confidence = 'MEDIUM';
    result.reasons.push(`旧字体「${oldKanjiMatch[0]}」検出`);
    result.years = Math.max(result.years, 20);
  }

  // 判定4: 漢数字番地
  if (KANJI_BANCHI_RE.test(address)) {
    result.isOld = true;
    if (result.confidence !== 'HIGH') result.confidence = 'MEDIUM';
    result.reasons.push('漢数字番地表記');
    result.years = Math.max(result.years, 15);
  }

  // 判定5: カタカナ「ノ」
  if (KATAKANA_NO_RE.test(address)) {
    result.isOld = true;
    if (result.confidence !== 'HIGH') result.confidence = 'MEDIUM';
    result.reasons.push('カタカナ「ノ」区切り');
    result.years = Math.max(result.years, 15);
  }

  // 判定6: 大字
  if (OAZA_RE.test(address)) {
    result.reasons.push('「大字」表記（現行の可能性もあり）');
    if (!result.confidence) result.confidence = 'LOW';
  }

  // 判定7: 郵便番号マスター突合
  if (postalData.size > 0) {
    const addr = address.replace(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/, '');

    let matchedCity = '';
    const cities = [...postalData.keys()].sort((a, b) => b.length - a.length);
    for (const city of cities) {
      if (addr.startsWith(city) || addr.includes(city)) {
        matchedCity = city;
        break;
      }
    }

    if (matchedCity) {
      const remaining = addr.slice(addr.indexOf(matchedCity) + matchedCity.length);

      // 丁目付き判定: 「入谷１丁目」→ baseTown=「入谷」, hasChoumeは true
      const choumeMatch = remaining.match(/^(.+?)[0-9０-９一二三四五六七八九十]+丁目/);
      const hasChoume = !!choumeMatch;
      const baseTownFromChoume = choumeMatch ? choumeMatch[1] : '';

      // 番地部分を除去して町域名を抽出
      const townPart = remaining.split(/[0-9０-９一二三四五六七八九十]+/)[0]
        .replace(/[丁目番地号\-ー－]$/g, '');

      if (townPart) {
        const fullTown = `${matchedCity}${townPart}`;
        const cityTowns = postalData.get(matchedCity) || new Set();

        let found = false;
        // 完全一致
        if (validTowns.has(fullTown)) {
          found = true;
        }

        // 丁目付きの場合は厳密判定:
        // 「入谷１丁目」→ マスターに「入谷」(丁目あり列=1)が存在するかを厳密チェック
        // 「入谷西」にstartsWith一致させない
        if (!found && hasChoume) {
          // 丁目付き住所の場合、baseTown が完全一致する町域のみ許可
          for (const t of cityTowns) {
            if (t === baseTownFromChoume) {
              found = true;
              break;
            }
          }
          // 丁目付きなのにbaseTownがマスターにない → 旧住所確定（部分一致しない）
        }

        // 丁目なしの場合のみ部分一致を許可
        if (!found && !hasChoume) {
          for (const t of cityTowns) {
            if (townPart.startsWith(t) || t.startsWith(townPart)) {
              found = true;
              break;
            }
          }
        }

        if (!found) {
          result.isOld = true;
          if (result.confidence !== 'HIGH') result.confidence = 'MEDIUM';
          const similar = [...cityTowns]
            .filter(t => townPart.length >= 2 && (t.includes(townPart.slice(0, 2)) || townPart.includes(t.slice(0, 2))))
            .slice(0, 3);
          const similarHint = similar.length > 0 ? `（類似: ${similar.join(', ')}）` : '';
          result.reasons.push(`郵便番号マスター不一致: ${matchedCity}内に「${townPart}」なし${similarHint}`);
          result.years = Math.max(result.years, 10);
          if (similar.length > 0 && !result.hint) {
            result.hint = `${matchedCity}${similar[0]}`;
          }
        }
      }
    }
  }

  return result;
}

// ============================================================
// テスト実行
// ============================================================
const testFile = path.join(__dirname, 'test_addresses.csv');
const lines = fs.readFileSync(testFile, 'utf-8').split('\n').filter(l => l.trim());
const header = lines[0];

console.log('\n' + '='.repeat(90));
console.log('  旧住所フィルタ テスト結果');
console.log('='.repeat(90));

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  if (cols.length < 3) continue;
  const id = cols[0];
  const name = cols[1];
  const address = cols[2];

  const r = judgeAddress(address);
  const flag = r.isOld ? '⚠️ 旧住所' : '✅ 送付OK';
  const dm = r.isOld && ['HIGH', 'MEDIUM'].includes(r.confidence) ? '除外推奨' :
             r.isOld ? '要確認' : '送付OK';

  console.log(`\n[${id}] ${name}`);
  console.log(`  住所: ${address}`);
  console.log(`  判定: ${flag} | 確信度: ${r.confidence || '-'} | DM: ${dm}`);
  if (r.reasons.length > 0) console.log(`  理由: ${r.reasons.join(' / ')}`);
  if (r.hint) console.log(`  現住所ヒント: ${r.hint}`);
  if (r.years > 0) console.log(`  推定放置: ${r.years}年以上`);
}

console.log('\n' + '='.repeat(90));
