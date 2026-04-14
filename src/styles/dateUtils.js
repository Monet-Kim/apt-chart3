// src/utils/dateUtils.js

// 'YYYY-MM' → Date (해당 월 1일)
export const ymToDate = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1);
};

// Date → 'YYYY-MM'
export const dateToYM = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Date → 'YYYY-MM-01'
export const dateToISOYM = (d) => `${dateToYM(d)}-01`;

// Date에 n개월 더하기
export const addMonths = (d, n) =>
  new Date(d.getFullYear(), d.getMonth() + n, 1);

// a → b 개월 차이
export const diffMonths = (a, b) =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
