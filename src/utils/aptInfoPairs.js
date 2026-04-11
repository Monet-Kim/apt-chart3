// src/utils/aptInfoPairs.js
// LeftPanel 단지정보 팝업 및 ChartPanel 상세비교에서 공유하는 info pair 빌더

function pick(row, k) {
  if (!row) return null;
  const v = row[k];
  return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
}

function fmtDate(v) {
  if (!v || v.length !== 8) return v;
  return `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6, 8)}`;
}

function fmtArea(v) {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? `${n.toLocaleString()}㎡` : v;
}

function stripAptName(addr, name) {
  if (!addr || !name) return addr;
  return addr.replace(
    new RegExp('\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'),
    ''
  ).trim();
}

/**
 * @param {object} listRow   - KaptList CSV 행 (selectedApt)
 * @param {object|null} detailRow - KaptDetail CSV 행
 * @param {{ includeAddress?: boolean }} options
 * @returns {Array<[string, string]>}
 */
export function buildAptInfoPairs(listRow, detailRow, { includeAddress = true } = {}) {
  if (!listRow) return [];

  const L = (k) => pick(listRow, k);
  const D = (k) => pick(detailRow, k);

  const 총주차대수 = (() => {
    const a = parseFloat(D('kaptdPcnt') || '');
    const b = parseFloat(D('kaptdPcntu') || '');
    if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
    const total = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
    const units = parseFloat(L('kaptdaCnt') || '');
    const perUnit = (Number.isFinite(units) && units > 0) ? (total / units).toFixed(1) : null;
    return perUnit ? `${total} (세대당 ${perUnit})` : String(total);
  })();

  const 승강기수 = (() => {
    const cnt = parseFloat(D('kaptdEcnt') || '');
    if (!Number.isFinite(cnt)) return null;
    const dong = parseFloat(L('kaptDongCnt') || '');
    const perDong = (Number.isFinite(dong) && dong > 0) ? (cnt / dong).toFixed(1) : null;
    return perDong ? `${cnt}대 (${perDong}/동)` : `${cnt}대`;
  })();

  const CCTV수 = (() => {
    const cnt = parseFloat(D('kaptdCccnt') || '');
    if (!Number.isFinite(cnt)) return null;
    const area = parseFloat(L('kaptTarea') || '');
    const per = (Number.isFinite(area) && area > 0) ? (cnt / area * 10000).toFixed(1) : null;
    return per ? `${cnt} (1만㎡당 ${per}대)` : String(cnt);
  })();

  const 전기차충전기 = (() => {
    const a = parseFloat(D('groundElChargerCnt') || '');
    const b = parseFloat(D('undergroundElChargerCnt') || '');
    if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
    return `${(Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0)}대`;
  })();

  const 전기용량 = (() => {
    const cap = parseFloat(D('kaptdEcapa') || '');
    if (!Number.isFinite(cap)) return null;
    const units = parseFloat(L('kaptdaCnt') || '');
    const perUnit = (Number.isFinite(units) && units > 0) ? (cap / units).toFixed(1) : null;
    return perUnit ? `${cap.toLocaleString()} (${perUnit}kW/세대)` : cap.toLocaleString();
  })();

  const pairs = [
    ['사용승인일',   fmtDate(L('kaptUsedate'))],
    ['건물유형',     L('codeAptNm')],
    ['세대수',       L('kaptdaCnt') ? `${String(L('kaptdaCnt')).replace(/\.0+$/, '')}세대` : null],
    ['총주차대수',   총주차대수],
    ['분양유형',     L('codeSaleNm')],
    ['난방',         L('codeHeatNm')],
    ['시행사',       L('kaptAcompany')],
    ['시공사',       L('kaptBcompany')],
    ['승강기수',     승강기수],
    ['구조',         L('codeHallNm')],
    ['CCTV수',       CCTV수],
    ['전기차충전기', 전기차충전기],
    ...(includeAddress ? [
      ['주소(지번)',   stripAptName(L('kaptAddr'), L('kaptName'))],
      ['주소(도로명)', stripAptName(L('doroJuso'), L('kaptName'))],
      ['우편번호',     L('zipcode')],
    ] : []),
    ['단지면적',     fmtArea(L('kaptTarea'))],
    ['동 수',        L('kaptDongCnt') ? `${L('kaptDongCnt')}동` : null],
    ['최고층',       L('kaptTopFloor') ? `${L('kaptTopFloor')}층` : null],
    ['지하층',       L('kaptBaseFloor') ? `${L('kaptBaseFloor')}층` : null],
    ['관리직원수',   D('kaptMgrCnt') ? `${D('kaptMgrCnt')}명` : null],
    ['관리회사',     D('kaptCcompany')],
    ['경비원수',     D('kaptdScnt') ? `${D('kaptdScnt')}명` : null],
    ['경비용역사',   D('kaptdSecCom')],
    ['청소부수',     D('kaptdClcnt') ? `${D('kaptdClcnt')}명` : null],
    ['전기용량(kW)', 전기용량],
    ['화재경보기',   D('codeFalarm')],
    ['복지시설',     D('welfareFacility')],
  ];

  return pairs.filter(([, v]) => v !== null && v !== undefined && v !== '');
}
