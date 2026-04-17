// 전체 LWC 차트 공통 높이 계산
export const getChartHeight = (isMobile, width) =>
  Math.min(Math.round(width * (2 / 3)), 400);

// 전체 LWC 차트 공통 폭 비율 (패널 너비 대비)
export const CHART_WIDTH_RATIO = 0.85;

// 스크롤 양보 오버레이 너비 (CHART_WIDTH_RATIO에 비례)
export const OVERLAY_LEFT_W  = 10;
export const OVERLAY_RIGHT_W = 10;
