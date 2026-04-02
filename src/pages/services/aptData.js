// src/pages/services/aptData.js
import { ymToDate, dateToYM, addMonths, diffMonths } from '../../utils/dateUtils';
import { parseCSV } from '../../utils/csvUtils';

const R2_BASE = process.env.NODE_ENV === 'production'
  ? "https://pub-8c65c427a291446c9384665be9201bea.r2.dev"
  : "";
const workbookCache = new Map(); // code5 -> { wb, url }  (Rdata)
const pdataCache   = new Map(); // code5 -> { wb, url }  (Pdata)
const tradeCache   = new Map(); // `${pnu}#${areaNorm}#${withP}#${sw}` -> result

const enc = (s) => encodeURIComponent(s);

const toNum = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// 아파트명 정규화: 공백 제거 + '아파트' suffix 제거
export const normAptNm = (s) =>
  (s || '').replace(/\s+/g, '').replace(/아파트$/, '').toLowerCase();

export const floor1 = (x) => Math.floor(x * 10) / 10;

// 면적들을 ±tol㎡로 묶고 각 그룹의 평균(대표값)을 반환
export function groupAreasToRep(areas, tol = 0.5) {
  if (!areas?.length) return [];
  const sorted = [...areas].sort((a, b) => a - b);
  const reps = [];
  let g = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i] - g[g.length - 1]) <= tol) g.push(sorted[i]);
    else { reps.push(g.reduce((a, b) => a + b, 0) / g.length); g = [sorted[i]]; }
  }
  reps.push(g.reduce((a, b) => a + b, 0) / g.length);
  return reps.map(v => Math.round(v * 10) / 10);
}

// pnu 생성: bjdCode(10) + '1' + 본번4 + 부번4
export function buildPNU(row) {
  try {
    const bjdCode = String(row['bjdCode'] || '').trim();
    const as = [row['as1'], row['as2'], row['as3'], row['as4']]
      .map(v => (v || '').trim())
      .filter(Boolean);
    const addr = String(row['kaptAddr'] || '').trim();
    if (!bjdCode || !addr || as.length < 2) return { pnu: null, reason: 'pnu 생성 실패(필드 누락)' };

    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^\\s*' + as.map(esc).join('\\s+') + '\\s*');
    const tail = addr.replace(re, '').trim();

    const m = tail.match(/(\d+)(?:\s*-\s*(\d+))?/);
    if (!m) return { pnu: null, reason: 'pnu 생성 실패(지번 숫자 없음)' };

    const bon = String(m[1]).padStart(4, '0');
    const bu  = String(m[2] || '0').padStart(4, '0');
    const pnu = `${bjdCode}1${bon}${bu}`;

    if (pnu.length !== 19) return { pnu: null, reason: 'pnu 자리수 오류' };
    return { pnu, reason: null };
  } catch {
    return { pnu: null, reason: 'pnu 생성 예외' };
  }
}

// index.json → 연도별 CSV 병렬 로드 (공통 로직)
async function fetchIndexedCsvs(folder, candidates) {
  let lastErr = null;
  for (const name of candidates) {
    const url = `${R2_BASE}/${folder}/${enc(name)}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }

      const idx = await res.json();
      const years = Array.isArray(idx?.years) ? idx.years : [];
      if (!years.length) { lastErr = 'index.json years 비어있음'; continue; }

      const prefix = name.replace(/_index\.json$/i, '');
      const tasks = years.map((y) => {
        const csvUrl = `/${folder}/${enc(`${prefix}_${y}.csv`)}`;
        return fetch(csvUrl, { cache: 'no-store' }).then(async (r) => {
          if (!r.ok) throw new Error(`CSV HTTP ${r.status}`);
          return parseCSV(await r.text(), false);
        });
      });

      const wb = (await Promise.all(tasks)).flat();
      return { wb, url };
    } catch (e) {
      lastErr = e?.message || 'fetch 실패';
    }
  }
  throw new Error(`${folder} index.json 미존재: ${lastErr || ''}`);
}

// Rdata 로드
export async function fetchWorkbook(as1, as2, code5) {
  if (workbookCache.has(code5)) return workbookCache.get(code5);
  const S1 = (as1 || '').trim(), S2 = (as2 || '').trim();
  const candidates = [
    `Rdata_${S1}_${S2}_${code5}_index.json`,
    `Rdata_${S1}_${code5}_index.json`,
    `Rdata_${S1}_${S2}_${S2}_${code5}_index.json`,
    `Rdata_${code5}_index.json`,
  ];
  const ret = await fetchIndexedCsvs('Rdata', candidates);
  workbookCache.set(code5, ret);
  return ret;
}

// Pdata 로드 (Rdata와 동일한 패턴, /Pdata/ 경로)
export async function fetchPdata(as1, as2, code5) {
  if (pdataCache.has(code5)) return pdataCache.get(code5);
  const S1 = (as1 || '').trim(), S2 = (as2 || '').trim();
  const candidates = [
    `Pdata_${S1}_${S2}_${code5}_index.json`,
    `Pdata_${S1}_${code5}_index.json`,
    `Pdata_${S1}_${S2}_${S2}_${code5}_index.json`,
    `Pdata_${code5}_index.json`,
  ];
  const ret = await fetchIndexedCsvs('Pdata', candidates);
  pdataCache.set(code5, ret);
  return ret;
}

// 특정 pnu의 전용면적 목록(버림 1자리, 오름차순)
// PNU 매칭 결과가 없고 kaptName이 주어지면 aptNm 기반 fallback
export function listAreasForPnu(wb, pnu, kaptName = null) {
  const set = new Set();
  const pnuStr = String(pnu);
  for (const obj of (wb || [])) {
    if (String(obj.pnu).trim() !== pnuStr) continue;
    const ar = toNum(obj.excluUseAr);
    if (!Number.isFinite(ar)) continue;
    set.add(floor1(ar));
  }
  // PNU가 데이터에 없을 때 aptNm으로 fallback (재건축 등 지번 불일치 케이스)
  if (set.size === 0 && kaptName) {
    const targetNorm = normAptNm(kaptName);
    for (const obj of (wb || [])) {
      if (normAptNm(obj.aptNm) !== targetNorm) continue;
      const ar = toNum(obj.excluUseAr);
      if (!Number.isFinite(ar)) continue;
      set.add(floor1(ar));
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * pnu + area로 월별 집계 (보정, 보간, 연장 포함)
 *
 * @param {object[]} wb       - Rdata rows
 * @param {object[]|null} pdWb - Pdata rows (없으면 null)
 * @param {string} pnu
 * @param {string|null} kaptName - 선택 아파트명 (Pdata aptNm 매칭용)
 * @param {number} areaNorm
 * @param {number} areaTol
 *
 * @returns {{ x, vol, avg, ptsX, ptsY, pPtsX, pPtsY }}
 *   ptsX/ptsY  = Rdata 개별거래 산점
 *   pPtsX/pPtsY = Pdata 개별거래 산점 (색상 구분용)
 */
// 중심 이동평균: NaN 무시, 양쪽 경계는 가용 데이터만으로 평균
function centeredSMA(arr, w) {
  if (w <= 1) return arr;
  const half = Math.floor(w / 2);
  return arr.map((v, i) => {
    if (!Number.isFinite(v)) return v;
    let sum = 0, cnt = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < arr.length && Number.isFinite(arr[k])) { sum += arr[k]; cnt++; }
    }
    return cnt > 0 ? sum / cnt : v;
  });
}

export function aggregateTradesForArea({ wb, pdWb = null, pnu, kaptName = null, areaNorm, areaTol = 0.5, smoothWindow = 3 }) {
  const cacheKey = `${pnu}#${areaNorm}#${pdWb ? '1' : '0'}#${smoothWindow}`;
  if (tradeCache.has(cacheKey)) return tradeCache.get(cacheKey);

  // monthMap: ym -> { amounts(만원), vol }  — Rdata + Pdata 통합 (avg/vol 라인용)
  const monthMap = new Map();
  let minYM = null, maxYM = null;

  const updateMinMax = (ym) => {
    if (!minYM || ym < minYM) minYM = ym;
    if (!maxYM || ym > maxYM) maxYM = ym;
  };

  // ── Rdata 집계 ──────────────────────────────────────────
  const rPtsX = [], rPtsY = [];

  // PNU가 데이터에 존재하는지 먼저 확인 → 없으면 aptNm fallback (재건축 등)
  const pnuStr = String(pnu);
  const hasPnu = (wb || []).some(obj => String(obj.pnu).trim() === pnuStr);
  const rFallbackNorm = (!hasPnu && kaptName) ? normAptNm(kaptName) : null;

  for (const obj of (wb || [])) {
    if (rFallbackNorm ? normAptNm(obj.aptNm) !== rFallbackNorm
                      : String(obj.pnu).trim() !== pnuStr) continue;

    const ar = toNum(obj.excluUseAr);
    if (!Number.isFinite(ar) || Math.abs(ar - areaNorm) > areaTol) continue;

    const yy = toNum(obj.dealYear), mm = toNum(obj.dealMonth);
    if (!Number.isFinite(yy) || !Number.isFinite(mm)) continue;
    const ym = `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;

    let amt = toNum(obj.dealAmount);
    if (!Number.isFinite(amt)) continue;
    const fl = toNum(obj.floor);
    if (fl === 1 || fl === 2) amt *= 1.08;

    if (!monthMap.has(ym)) monthMap.set(ym, { amounts: [], vol: 0 });
    const rec = monthMap.get(ym);
    rec.amounts.push(amt);
    rec.vol += 1;

    rPtsX.push(ym);
    rPtsY.push(amt / 10000);
    updateMinMax(ym);
  }

  // ── Pdata 집계 ──────────────────────────────────────────
  const pPtsX = [], pPtsY = [];

  if (pdWb && kaptName) {
    const targetNorm = normAptNm(kaptName);

    for (const obj of pdWb) {
      // 취소된 거래 제외
      if (toNum(obj.isCanceled) === 1) continue;

      // 아파트명 매칭 (공백 제거 + '아파트' suffix 제거 후 비교)
      if (normAptNm(obj.aptNm) !== targetNorm) continue;

      const ar = toNum(obj.excluUseAr);
      if (!Number.isFinite(ar) || Math.abs(ar - areaNorm) > areaTol) continue;

      const yy = toNum(obj.dealYear), mm = toNum(obj.dealMonth);
      if (!Number.isFinite(yy) || !Number.isFinite(mm)) continue;
      const ym = `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;

      // dealAmount_mw(숫자형) 우선, 없으면 dealAmount(콤마 포함)
      let amt = toNum(obj.dealAmount_mw);
      if (!Number.isFinite(amt)) amt = toNum(obj.dealAmount);
      if (!Number.isFinite(amt)) continue;

      const fl = toNum(obj.floor);
      if (fl === 1 || fl === 2) amt *= 1.08;

      // monthMap에 통합 (avg/vol 라인에 Pdata도 반영)
      if (!monthMap.has(ym)) monthMap.set(ym, { amounts: [], vol: 0 });
      const rec = monthMap.get(ym);
      rec.amounts.push(amt);
      rec.vol += 1;

      pPtsX.push(ym);
      pPtsY.push(amt / 10000);
      updateMinMax(ym);
    }
  }

  // ── 타임라인 생성 ────────────────────────────────────────
  if (!minYM || !maxYM) {
    const res = { x: [], vol: [], avg: [], ptsX: [], ptsY: [], pPtsX: [], pPtsY: [] };
    tradeCache.set(cacheKey, res);
    return res;
  }

  const start = ymToDate(minYM);
  const curYM = dateToYM(new Date());
  const end = ymToDate(maxYM < curYM ? curYM : maxYM);
  const nMonths = diffMonths(start, end) + 1;

  const x = [];
  const vol = new Array(nMonths).fill(0);
  const avg = new Array(nMonths).fill(NaN);

  for (let i = 0; i < nMonths; i++) {
    const ym = dateToYM(addMonths(start, i));
    x.push(ym);
    const rec = monthMap.get(ym);
    if (rec) {
      vol[i] = rec.vol;
      avg[i] = rec.amounts.reduce((a, b) => a + b, 0) / rec.amounts.length / 10000;
    }
  }

  // 내부 결측 보간
  let lastIdx = -1;
  for (let i = 0; i < nMonths; i++) {
    if (Number.isFinite(avg[i])) {
      if (lastIdx >= 0 && lastIdx + 1 < i) {
        const y0 = avg[lastIdx], y1 = avg[i], gap = i - lastIdx;
        for (let k = lastIdx + 1; k < i; k++) {
          avg[k] = y0 + (y1 - y0) * ((k - lastIdx) / gap);
        }
      }
      lastIdx = i;
    }
  }

  // 스무딩 (보간 후, FFill 전)
  if (smoothWindow > 1) {
    const smoothed = centeredSMA(avg, smoothWindow);
    for (let i = 0; i < nMonths; i++) avg[i] = smoothed[i];
  }

  // 최신월 연장 (FFill)
  let lastVal = NaN;
  for (let i = 0; i < nMonths; i++) if (Number.isFinite(avg[i])) lastVal = avg[i];
  if (Number.isFinite(lastVal)) {
    for (let i = nMonths - 1; i >= 0 && !Number.isFinite(avg[i]); i--) avg[i] = lastVal;
  }

  const res = { x, vol, avg, ptsX: rPtsX, ptsY: rPtsY, pPtsX, pPtsY };
  tradeCache.set(cacheKey, res);
  return res;
}

// 85㎡에 가장 가까운 초기 선택
export function pickInitialArea(areas) {
  if (!areas?.length) return null;
  let best = areas[0], bestDiff = Math.abs(areas[0] - 85);
  for (let i = 1; i < areas.length; i++) {
    const d = Math.abs(areas[i] - 85);
    if (d < bestDiff) { best = areas[i]; bestDiff = d; }
  }
  return best;
}
