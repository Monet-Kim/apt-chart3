// 전체 LWC 차트 공통 높이 계산
export const getChartHeight = (isMobile, width) =>
  isMobile ? Math.round(width * (2 / 3)) : 280;
