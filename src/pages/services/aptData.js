// src/pages/services/aptData.js
import { ymToDate, dateToYM, addMonths, diffMonths } from '../../styles/dateUtils';
import { parseCSV } from '../../styles/csvUtils';

const R2_BASE = process.env.NODE_ENV === 'production'
  ? "https://pub-8c65c427a291446c9384665be9201bea.r2.dev"
  : "";
const workbookCache  = new Map(); // code5 -> { wb, url }  (Rdata)
const pdataCache     = new Map(); // code5 -> { wb, url }  (Pdata)
const kaptDetailCache = new Map(); // code5 -> Map<kaptCode, row>
const kaptListCache   = new Map(); // code5 -> Map<normAptNm, row>
const tradeCache     = new Map(); // `${pnu}#${areaNorm}#${withP}#${sw}` -> result
let code5MapCache    = null;

const RECENT_YEARS = 6; // 초기 로드 연도 수 (차트 기본 5년 + 여유 1년)

async function loadCode5Map() {
  if (code5MapCache) return code5MapCache;
  try {
    const r = await fetch(`${R2_BASE}/KaptList/code5_map.json`, { cache: 'no-store' });
    if (r.ok) code5MapCache = await r.json();
  } catch { /* 로드 실패 시 null 유지 */ }
  return code5MapCache;
}

// code5_map.json 파일명에서 시군구 부분 추출 (예: "경기도_화성시_동탄구_41597_list_coord.csv" → "화성시_동탄구")
async function getAltS2(as1, code5) {
  const map = await loadCode5Map();
  if (!map?.[code5]) return null;
  const fname = map[code5]; // e.g. "경기도_화성시_동탄구_41597_list_coord.csv"
  const suffix = `_${code5}_list_coord.csv`;
  const prefix = `${as1}_`;
  if (!fname.startsWith(prefix) || !fname.endsWith(suffix)) return null;
  return fname.slice(prefix.length, fname.length - suffix.length) || null;
}

const enc = (s) => encodeURIComponent(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rdata 행에서 도로명 키 생성: "위례성대로|176|0"
function buildRoadKey(roadNm, bonbun, bubun) {
  const nm = (roadNm || '').trim();
  if (!nm) return null;
  return `${nm}|${parseInt(bonbun) || 0}|${parseInt(bubun) || 0}`;
}

// doroJuso에서 행정구역 prefix 제거 후 road 키 생성
// "서울특별시 송파구 위례성대로 176" → "위례성대로|176|0"
export function parseDoroKey(doroJuso, as1, as2, as3, as4) {
  if (!doroJuso) return null;
  const parts = [as1, as2, as3, as4].map(v => (v || '').trim()).filter(Boolean);
  let stripped = doroJuso.trim();
  for (let len = parts.length; len >= 1; len--) {
    const re = new RegExp('^' + parts.slice(0, len).map(esc).join('\\s+') + '\\s+');
    const s = stripped.replace(re, '');
    if (s !== stripped) { stripped = s.trim(); break; }
  }
  // "위례성대로 176" or "마천로7길 4-7"
  const m = stripped.match(/^(.+?)\s+(\d+)(?:-(\d+))?(?:\s|$)/);
  if (!m) return null;
  return `${m[1]}|${parseInt(m[2])}|${parseInt(m[3] || 0)}`;
}

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
// 면적별 차등 tolerance: 85㎡ 이하 ±0.9㎡, 초과 ±1%
const areaTolFor = (ref) => ref <= 85 ? 0.9 : ref * 0.01;

// PNU 매칭 Rdata와 aptNm 매칭 Pdata의 aptNm이 다를 때 구 단지 여부 판별 → drop 여부 반환
// Path A: 신규 단지의 전월세(Pdata) 최초 거래일 > 구 단지 Rdata 최종 거래일
// Path B: 신규 단지의 매매(Rdata, 동일 PNU+aptNm) 최초 거래일 > 구 단지 Rdata 최종 거래일
function shouldDropRdataDiffPnu(rPnuDiffRows, pdNameRows, rPnuSameRows = []) {
  if (!rPnuDiffRows?.length) return false;

  // maxR: 구 단지(다른 aptNm) Rdata 최종 거래월
  let maxR = null;
  for (const obj of rPnuDiffRows) {
    const ym = `${String(obj.dealYear || '').padStart(4, '0')}-${String(obj.dealMonth || '').padStart(2, '0')}`;
    if (!maxR || ym > maxR) maxR = ym;
  }
  if (maxR === null) return false;

  // Path A (기존): 신규 단지 전월세 최초 거래일 > maxR
  if (pdNameRows?.length) {
    let minP = null;
    for (const obj of pdNameRows) {
      if (toNum(obj.isCanceled) === 1) continue;
      const ym = `${String(obj.dealYear || '').padStart(4, '0')}-${String(obj.dealMonth || '').padStart(2, '0')}`;
      if (!minP || ym < minP) minP = ym;
    }
    if (minP !== null && minP > maxR) return true;
  }

  // Path B (신규): 신규 단지 매매 최초 거래일 > maxR (Pdata 없어도 재건축 판별 가능)
  if (rPnuSameRows?.length) {
    let minRSame = null;
    for (const obj of rPnuSameRows) {
      const ym = `${String(obj.dealYear || '').padStart(4, '0')}-${String(obj.dealMonth || '').padStart(2, '0')}`;
      if (!minRSame || ym < minRSame) minRSame = ym;
    }
    if (minRSame !== null && minRSame > maxR) return true;
  }

  return false;
}

export function groupAreasToRep(areas) {
  if (!areas?.length) return [];
  const sorted = [...areas].sort((a, b) => a - b);
  const reps = [];
  let g = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i] - g[g.length - 1]) <= areaTolFor(g[g.length - 1])) g.push(sorted[i]);
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

// rows 배열로 pnuIndex, nameIndex, roadIndex 생성
function buildIndexes(rows) {
  const pnuIndex  = new Map(); // pnu(string) → row[]
  const nameIndex = new Map(); // normAptNm   → row[]
  const roadIndex = new Map(); // "roadNm|bonbun|bubun" → row[]
  for (const obj of rows) {
    const pnu = String(obj.pnu || '').trim();
    if (pnu) {
      if (!pnuIndex.has(pnu)) pnuIndex.set(pnu, []);
      pnuIndex.get(pnu).push(obj);
    }
    const nm = normAptNm(obj.aptNm);
    if (nm) {
      if (!nameIndex.has(nm)) nameIndex.set(nm, []);
      nameIndex.get(nm).push(obj);
    }
    const rk = buildRoadKey(obj.roadNm, obj.roadNmBonbun, obj.roadNmBubun);
    if (rk) {
      if (!roadIndex.has(rk)) roadIndex.set(rk, []);
      roadIndex.get(rk).push(obj);
    }
  }
  return { pnuIndex, nameIndex, roadIndex };
}

// index.json → 연도별 CSV 병렬 로드 (공통 로직)
// onFullLoad: 백그라운드로 구형 연도 로드 완료 시 호출되는 콜백
async function fetchIndexedCsvs(folder, candidates, onFullLoad = null) {
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
      const fetchYear = (y) => {
        const csvUrl = `${R2_BASE}/${folder}/${enc(`${prefix}_${y}.csv`)}`;
        return fetch(csvUrl, { cache: 'no-store' }).then(async (r) => {
          if (!r.ok) throw new Error(`CSV HTTP ${r.status}`);
          return parseCSV(await r.text(), false);
        });
      };

      const recentYears = years.slice(-RECENT_YEARS);
      const olderYears  = years.slice(0, -RECENT_YEARS);

      // Phase 1: 최근 연도만 즉시 로드
      const recentRows = (await Promise.all(recentYears.map(fetchYear))).flat();
      const partial = { wb: recentRows, url, ...buildIndexes(recentRows), isPartial: olderYears.length > 0 };

      // Phase 2: 구형 연도 백그라운드 로드
      if (olderYears.length > 0 && onFullLoad) {
        partial.fullPromise = Promise.all(olderYears.map(fetchYear))
          .then(results => {
            const allRows = [...results.flat(), ...recentRows];
            const full = { wb: allRows, url, ...buildIndexes(allRows), isPartial: false };
            onFullLoad(full);
            return full;
          })
          .catch(() => null);
      }

      return partial;
    } catch (e) {
      lastErr = e?.message || 'fetch 실패';
    }
  }
  throw new Error(`${folder} index.json 미존재: ${lastErr || ''}`);
}

// code5_map.json에서 파일명 prefix 추출 (예: "충청남도_천안시_서북구_44133")
async function getFilePrefix(code5) {
  const map = await loadCode5Map();
  const listFile = map?.[code5];
  if (listFile && listFile.endsWith(`_${code5}_list_coord.csv`)) {
    return listFile.replace(/_list_coord\.csv$/, '');
  }
  return null;
}

// Rdata 로드
export async function fetchWorkbook(as1, as2, code5) {
  if (workbookCache.has(code5)) return workbookCache.get(code5);
  const prefix = await getFilePrefix(code5);
  const S1 = (as1 || '').trim(), S2 = (as2 || '').trim();
  const candidates = [
    ...(prefix ? [`Rdata_${prefix}_index.json`] : []),
    `Rdata_${S1}_${S2}_${code5}_index.json`,
    `Rdata_${S1}_${code5}_index.json`,
  ];
  const ret = await fetchIndexedCsvs('Rdata', candidates, (full) => {
    workbookCache.set(code5, full);
  });
  workbookCache.set(code5, ret);
  return ret;
}

// Pdata 로드
export async function fetchPdata(as1, as2, code5) {
  if (pdataCache.has(code5)) return pdataCache.get(code5);
  const prefix = await getFilePrefix(code5);
  const S1 = (as1 || '').trim(), S2 = (as2 || '').trim();
  const candidates = [
    ...(prefix ? [`Pdata_${prefix}_index.json`] : []),
    `Pdata_${S1}_${S2}_${code5}_index.json`,
    `Pdata_${S1}_${code5}_index.json`,
  ];
  const ret = await fetchIndexedCsvs('Pdata', candidates, (full) => {
    pdataCache.set(code5, full);
  });
  pdataCache.set(code5, ret);
  return ret;
}

// pnu에 해당하는 tradeCache 항목 무효화 (백그라운드 full 로드 후 재집계 보장)
export function clearTradeCacheForPnu(pnu) {
  const prefix = `${pnu}#`;
  for (const key of tradeCache.keys()) {
    if (key.startsWith(prefix)) tradeCache.delete(key);
  }
}

// 특정 pnu의 전용면적 목록(버림 1자리, 오름차순)
export function listAreasForPnu(wb, pnu, kaptName = null, pdWb = null,
                                roadKey = null, roadIndex = null, nameIndex = null, pnuIndex = null) {
  const set = new Set();
  const pnuStr = pnu ? String(pnu) : null;
  const targetNorm = kaptName ? normAptNm(kaptName) : null;

  // Pdata aptNm 매칭 행 (재건축 판별에도 사용)
  const pdNameRows = (pdWb && targetNorm)
    ? pdWb.filter(obj => toNum(obj.isCanceled) !== 1 && normAptNm(obj.aptNm) === targetNorm)
    : [];

  // PNU로 찾은 Rdata 중 aptNm이 다른 행 → 재건축 여부 판별 대상
  const pnuRows = pnuStr
    ? (pnuIndex ? (pnuIndex.get(pnuStr) || []) : (wb || []).filter(obj => String(obj.pnu).trim() === pnuStr))
    : [];
  const rPnuDiffRows = (pnuStr && targetNorm)
    ? pnuRows.filter(obj => normAptNm(obj.aptNm) !== targetNorm)
    : [];
  const rPnuSameRows = (pnuStr && targetNorm)
    ? pnuRows.filter(obj => normAptNm(obj.aptNm) === targetNorm)
    : [];
  const dropRdataDiffPnu = shouldDropRdataDiffPnu(rPnuDiffRows, pdNameRows, rPnuSameRows);

  // 1순위: Rdata PNU 매칭 (aptNm 같으면 항상 포함, 다르면 재건축 판별 결과에 따라)
  for (const obj of pnuRows) {
    const sameNm = targetNorm && normAptNm(obj.aptNm) === targetNorm;
    if (!sameNm && dropRdataDiffPnu) continue;
    const ar = toNum(obj.excluUseAr);
    if (Number.isFinite(ar)) set.add(floor1(ar));
  }

  // 2순위: Rdata aptNm 매칭 (다필지 단지 대응) — nameIndex Map 조회
  if (targetNorm) {
    const rows = nameIndex ? (nameIndex.get(targetNorm) || [])
      : (wb || []).filter(obj => normAptNm(obj.aptNm) === targetNorm);
    for (const obj of rows) {
      const ar = toNum(obj.excluUseAr);
      if (Number.isFinite(ar)) set.add(floor1(ar));
    }
  }

  // 3순위: road 매칭 (PNU 오류·이름 불일치 fallback)
  if (roadKey && roadIndex) {
    for (const obj of (roadIndex.get(roadKey) || [])) {
      const ar = toNum(obj.excluUseAr);
      if (Number.isFinite(ar)) set.add(floor1(ar));
    }
  }

  // Pdata aptNm 매칭 (신규 단지·분양권 전매 포함)
  for (const obj of pdNameRows) {
    const ar = toNum(obj.excluUseAr);
    if (Number.isFinite(ar)) set.add(floor1(ar));
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

export function aggregateTradesForArea({ wb, pdWb = null, pnu, kaptName = null, areaNorm, areaTol = null, smoothWindow = 3, pnuIndex = null, nameIndex = null, pdNameIndex = null, roadKey = null, roadIndex = null, pdRoadIndex = null }) {
  const tol = areaTol ?? areaTolFor(areaNorm);
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

  const pnuStr = pnu ? String(pnu) : null;
  const rNormName = kaptName ? normAptNm(kaptName) : null;

  // 인덱스로 후보 rows 추출 (없으면 전체 스캔 폴백)
  let rCandidates;
  let byRoadSet = null; // road-only 매칭 행 추적 (rMatches 예외 처리용)
  if (pnuIndex || nameIndex || roadIndex) {
    const byPnu  = (pnuStr     && pnuIndex?.get(pnuStr))       || [];
    const byName = (rNormName  && nameIndex?.get(rNormName))   || [];
    const byRoad = (roadKey    && roadIndex?.get(roadKey))     || [];
    if (byRoad.length) byRoadSet = new Set(byRoad);
    const merged = [...new Set([...byPnu, ...byName, ...byRoad])];
    rCandidates = merged.length ? merged : (wb || []);
  } else {
    rCandidates = wb || [];
  }

  // PNU 매칭 중 aptNm이 다른 행 → 재건축 여부 판별
  const rPnuDiffRows = (pnuStr && rNormName)
    ? rCandidates.filter(obj => String(obj.pnu).trim() === pnuStr && normAptNm(obj.aptNm) !== rNormName)
    : [];
  const rPnuSameRows = (pnuStr && rNormName)
    ? rCandidates.filter(obj => String(obj.pnu).trim() === pnuStr && normAptNm(obj.aptNm) === rNormName)
    : [];
  const pdNameRows = (pdWb && rNormName)
    ? (pdNameIndex?.get(rNormName) || pdWb.filter(obj => toNum(obj.isCanceled) !== 1 && normAptNm(obj.aptNm) === rNormName))
    : [];
  const dropRdataDiffPnu = shouldDropRdataDiffPnu(rPnuDiffRows, pdNameRows, rPnuSameRows);

  // aptNm 일치 → 항상 포함 / PNU 일치 + aptNm 다름 → 재건축 판별 결과에 따라
  // road-only 매칭 행(PNU/aptNm 둘 다 안 맞는 경우) → fallback 허용
  const rMatches = (obj) => {
    if (rNormName && normAptNm(obj.aptNm) === rNormName) return true;
    if (pnuStr && String(obj.pnu).trim() === pnuStr) {
      if (dropRdataDiffPnu) return false;
      return true;
    }
    if (byRoadSet?.has(obj)) return true; // 도로명 fallback
    return false;
  };

  for (const obj of rCandidates) {
    if (!rMatches(obj)) continue;
    if (String(obj.cdealType || '').trim() !== '') continue;      // 취소 거래: dot·avg 모두 제외
    const isDirect = String(obj.dealingGbn || '').trim() === '직거래';

    const ar = toNum(obj.excluUseAr);
    if (!Number.isFinite(ar) || Math.abs(ar - areaNorm) > tol) continue;

    const yy = toNum(obj.dealYear), mm = toNum(obj.dealMonth);
    if (!Number.isFinite(yy) || !Number.isFinite(mm)) continue;
    const ym = `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;

    let amt = toNum(obj.dealAmount);
    if (!Number.isFinite(amt)) continue;
    const fl = toNum(obj.floor);
    if (fl === 1 || fl === 2) amt *= 1.08;

    // 직거래는 평균가 계산에서 제외, dot은 찍음
    if (!isDirect) {
      if (!monthMap.has(ym)) monthMap.set(ym, { amounts: [], vol: 0 });
      const rec = monthMap.get(ym);
      rec.amounts.push(amt);
      rec.vol += 1;
    }

    rPtsX.push(ym);
    rPtsY.push(amt / 10000);
    updateMinMax(ym);
  }

  // ── Pdata 집계 ──────────────────────────────────────────
  const pPtsX = [], pPtsY = [];

  if (pdWb && kaptName) {
    const targetNorm = normAptNm(kaptName);
    // pdNameIndex → pdRoadIndex → 전체 스캔 순 폴백
    const pdByName = pdNameIndex?.get(targetNorm);
    const pdByRoad = (!pdByName?.length && roadKey) ? (pdRoadIndex?.get(roadKey) ?? null) : null;
    const pdCandidates = pdByName ?? pdByRoad ?? pdWb;

    for (const obj of pdCandidates) {
      // 취소된 거래: dot·avg 모두 제외
      if (toNum(obj.isCanceled) === 1) continue;
      const isDirect = String(obj.dealingGbn || '').trim() === '직거래';

      // 아파트명 매칭 (road fallback 시 건물이 같아도 이름이 다를 수 있으므로 생략)
      if (!pdByRoad && normAptNm(obj.aptNm) !== targetNorm) continue;

      const ar = toNum(obj.excluUseAr);
      if (!Number.isFinite(ar) || Math.abs(ar - areaNorm) > tol) continue;

      const yy = toNum(obj.dealYear), mm = toNum(obj.dealMonth);
      if (!Number.isFinite(yy) || !Number.isFinite(mm)) continue;
      const ym = `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;

      // dealAmount_mw(숫자형) 우선, 없으면 dealAmount(콤마 포함)
      let amt = toNum(obj.dealAmount_mw);
      if (!Number.isFinite(amt)) amt = toNum(obj.dealAmount);
      if (!Number.isFinite(amt)) continue;

      const fl = toNum(obj.floor);
      if (fl === 1 || fl === 2) amt *= 1.08;

      // 직거래는 평균가 계산에서 제외, dot은 찍음
      if (!isDirect) {
        if (!monthMap.has(ym)) monthMap.set(ym, { amounts: [], vol: 0 });
        const rec = monthMap.get(ym);
        rec.amounts.push(amt);
        rec.vol += 1;
      }

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

// KaptDetail CSV 로드: kaptCode → row Map 반환
export async function fetchKaptDetail(as1, as2, code5) {
  if (kaptDetailCache.has(code5)) return kaptDetailCache.get(code5);

  // 1순위: code5_map.json으로 정확한 파일명 도출 (Depth2/3 무관)
  const code5map = await loadCode5Map();
  const listFile = code5map?.[code5];
  const candidates = [];
  if (listFile && listFile.endsWith(`_${code5}_list_coord.csv`)) {
    candidates.push(listFile.replace(/_list_coord\.csv$/, '_Details.csv'));
  }
  // 2순위: as1_as2_code5 패턴 (code5_map.json 미등록 시 fallback)
  const S1 = (as1 || '').trim(), S2 = (as2 || '').trim();
  if (S1 && S2) candidates.push(`${S1}_${S2}_${code5}_Details.csv`);
  let lastErr = null;
  for (const name of candidates) {
    const url = `${R2_BASE}/KaptDetail/${enc(name)}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const rows = parseCSV(await res.text(), true);
      const map = new Map();
      for (const row of rows) {
        const code = String(row['kaptCode'] || '').trim();
        if (code) map.set(code, row);
      }
      kaptDetailCache.set(code5, map);
      return map;
    } catch (e) {
      lastErr = e?.message || 'fetch 실패';
    }
  }
  throw new Error(`KaptDetail 로드 실패 (${code5}): ${lastErr || ''}`);
}

// KaptList CSV 로드: normAptNm(kaptName) → row Map 반환
export async function fetchKaptList(as1, as2, code5) {
  if (kaptListCache.has(code5)) return kaptListCache.get(code5);
  const S1 = (as1 || '').trim(), S2 = (as2 || '').trim();
  const altS2 = await getAltS2(S1, code5);
  const candidates = [
    `${S1}_${S2}_${code5}_list_coord.csv`,
    ...(altS2 && altS2 !== S2 ? [`${S1}_${altS2}_${code5}_list_coord.csv`] : []),
  ];
  for (const name of candidates) {
    const url = `${R2_BASE}/KaptList/${enc(name)}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const rows = parseCSV(await res.text(), true);
      const map = new Map();
      for (const row of rows) {
        const code = String(row['kaptCode'] || '').trim();
        if (code) map.set(code, row);
      }
      kaptListCache.set(code5, map);
      return map;
    } catch { /* 다음 후보로 */ }
  }
  throw new Error(`KaptList 로드 실패 (${code5})`);
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
