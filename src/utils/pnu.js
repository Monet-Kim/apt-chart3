/**
 * PNU (필지고유번호) 관련 유틸
 *
 * PNU 구조: {법정동코드 10자리}{토지구분 1자리}{본번 4자리}{부번 4자리} = 19자리
 * 토지구분: 1=일반 (대부분 단지)
 */

/**
 * kaptAddr 끝 토큰에서 지번 파싱 → PNU 19자리 조립
 * @param {string} kaptAddr  예) "서울특별시 송파구 가락동 98-3 레이팰리스"
 * @param {string|number} bjdCode  10자리 법정동코드 (예: "1171010400")
 * @returns {string|null} PNU 19자리, 파싱 실패 시 null
 */
export function buildPNU(kaptAddr, bjdCode) {
  if (!kaptAddr || !bjdCode) return null;
  const tokens = String(kaptAddr).trim().split(/\s+/);

  // 지번 형식 "숫자" 또는 "숫자-숫자" 토큰을 뒤에서부터 찾음
  let jibun = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^\d+(-\d+)?$/.test(tokens[i])) {
      jibun = tokens[i];
      break;
    }
  }
  if (!jibun) return null;

  const parts = jibun.split('-');
  const bonNum = parseInt(parts[0], 10);
  const buNum  = parts[1] ? parseInt(parts[1], 10) : 0;
  if (!Number.isFinite(bonNum) || bonNum <= 0) return null;

  const code = String(bjdCode).padStart(10, '0');
  return `${code}1${String(bonNum).padStart(4, '0')}${String(buNum).padStart(4, '0')}`;
}

/**
 * PNU 정확히 일치하는 필지만 반환
 * @param {string} basePNU  19자리 PNU
 * @param {object} index    { PNU: [[lat,lng],...] }
 * @returns {string[]} 매칭된 PNU 목록 (정확히 일치하는 것만)
 */
export function findRelatedPNUs(basePNU, index) {
  if (!basePNU || !index) return [];
  return basePNU in index ? [basePNU] : [];
}
