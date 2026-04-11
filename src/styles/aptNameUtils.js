// src/utils/aptNameUtils.js

// 아파트명 뒤에 붙는 불필요한 단어 제거 (마커·차트 표기 간략화)
const APT_SUFFIXES = ['주상복합아파트', '주상복합', '아파트'];

export const trimAptName = (name) => {
  if (!name) return name;
  let s = name.trim();
  for (const suffix of APT_SUFFIXES) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length).trim();
      break;
    }
  }
  return s;
};
