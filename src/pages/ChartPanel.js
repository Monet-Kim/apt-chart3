// src/pages/ChartPanel.js
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import ReactDOM from 'react-dom';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';
import { cssVar, SERIES_COLORS } from '../styles/themes';
import { FavChip } from '../components/FavoriteButton';
import { createChart, LineSeries } from 'lightweight-charts';
import { getChartHeight, CHART_WIDTH_RATIO, OVERLAY_LEFT_W, OVERLAY_RIGHT_W } from '../styles/chartHeight';
import { ymToDate } from '../styles/dateUtils';
import {
  buildPNU, fetchWorkbook, fetchPdata,
  listAreasForPnu, aggregateTradesForArea, groupAreasToRep, normAptNm,
  fetchKaptDetail, clearTradeCacheForPnu,
} from './services/aptData';
import { trimAptName } from '../styles/aptNameUtils';
import { buildAptInfoPairs } from '../styles/aptInfoPairs';

// ────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────
const YEAR_WINDOW   = 5;
const SMOOTH_WINDOW = 3;

// ────────────────────────────────────────────
// 스타일 주입
// ────────────────────────────────────────────
const hotKeyframes = `
@keyframes hotWiggle {
  0%   { transform: rotate(-12deg) scale(1);   }
  25%  { transform: rotate(-16deg) scale(1.08); }
  50%  { transform: rotate(-12deg) scale(1);   }
  75%  { transform: rotate(-8deg)  scale(1.08); }
  100% { transform: rotate(-12deg) scale(1);   }
}`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('hot-wiggle-style-chart');
  if (!s) { s = document.createElement('style'); s.id = 'hot-wiggle-style-chart'; document.head.appendChild(s); }
  s.textContent = hotKeyframes;
}

const areaScrollbarStyle = `
.chart-area-tab-scroll::-webkit-scrollbar { height: 3px; }
.chart-area-tab-scroll::-webkit-scrollbar-track { background: transparent; }
.chart-area-tab-scroll::-webkit-scrollbar-thumb { background: var(--color-scrollbar); border-radius: 2px; }
.chart-area-tab-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-scrollbar-hover); }`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('chart-area-scroll-style');
  if (!s) { s = document.createElement('style'); s.id = 'chart-area-scroll-style'; document.head.appendChild(s); }
  s.textContent = areaScrollbarStyle;
}

// ────────────────────────────────────────────
// 공통 LWC 옵션 (LeftPanel / FinanceChart 동일)
// ────────────────────────────────────────────
function makeChartOptions(height, width = 800) {
  return {
    height,
    width: 0, // ResizeObserver가 실제 width를 세팅 — 초기 0으로 overflow 방지
    watermark: { visible: false },
    layout: {
      background: { color: cssVar('--color-surface') },
      textColor: cssVar('--color-text-sub'),
      fontSize: width < 400 ? 9 : width < 600 ? 10 : 11,
      fontFamily: 'Pretendard, -apple-system, sans-serif',
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: 'rgba(0,0,0,0.12)' },
      horzLines: { color: 'rgba(0,0,0,0.08)' },
    },
    crosshair: {
      mode: 1,
      vertLine: { color: cssVar('--color-text-sub'), width: 1, style: 0, labelBackgroundColor: cssVar('--color-text-sub') },
      horzLine: { color: cssVar('--color-text-sub'), width: 1, style: 0, labelBackgroundColor: cssVar('--color-text-sub') },
    },
    timeScale: {
      borderColor: cssVar('--color-border'),
      timeVisible: true,
      secondsVisible: false,
      minBarSpacing: 0.1,
      tickMarkFormatter: (time) => {
        const d = typeof time === 'object'
          ? new Date(time.year, time.month - 1, time.day)
          : new Date(time);
        return String(d.getFullYear());
      },
    },
    localization: {
      timeFormatter: (time) => {
        const d = typeof time === 'object'
          ? new Date(time.year, time.month - 1, time.day)
          : new Date(time);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      },
    },
    rightPriceScale: { borderColor: cssVar('--color-border') },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  };
}

function toTime(ym) {
  return ym.length === 7 ? `${ym}-01` : ym;
}

// ────────────────────────────────────────────
// G1: 다중 시리즈 평균가 라인 + 실거래/입주권 dot
// LeftPanel AptTradeChart를 다중 시리즈로 확장
// ────────────────────────────────────────────
function MultiSeriesTradeChart({ series, isMobile }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRefsMap = useRef({}); // id -> avgSeriesRef
  const svgRef       = useRef(null);
  const seriesRef    = useRef(series); // 항상 최신 props 참조

  const [chartHeight, setChartHeight] = useState(() => getChartHeight(isMobile, window.innerWidth));
  const [tooltip, setTooltip] = useState(null);

  // chartHeight 변경 시 차트에 반영
  useEffect(() => { chartRef.current?.applyOptions({ height: chartHeight }); }, [chartHeight]);

  // 최신 series를 ref로 유지
  seriesRef.current = series;

  // SVG dot 재그리기 — RAF 루프가 매 프레임 호출
  const redrawDotsRef = useRef(null);
  redrawDotsRef.current = () => {
    const svg = svgRef.current;
    const chart = chartRef.current;
    if (!svg || !chart) return;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', chartHeight);

    const visibleRange = chart.timeScale().getVisibleRange();

    seriesRef.current.forEach((s, idx) => {
      const avgSeries = seriesRefsMap.current[s.id];
      if (!avgSeries) return;

      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      // 40% 불투명 fill
      const fillColor = color + '66';

      const drawDots = (xs, ys, shape) => {
        xs.forEach((xVal, i) => {
          const timeStr = toTime(xVal);
          if (visibleRange && (timeStr < visibleRange.from || timeStr > visibleRange.to)) return;
          const xCoord = chart.timeScale().timeToCoordinate(timeStr);
          const yCoord = avgSeries.priceToCoordinate(ys[i]);
          if (xCoord == null || yCoord == null) return;

          if (shape === 'circle') {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            el.setAttribute('cx', xCoord);
            el.setAttribute('cy', yCoord);
            el.setAttribute('r', 3);
            el.setAttribute('fill', fillColor);
            el.setAttribute('stroke', 'none');
            svg.appendChild(el);
          } else if (shape === 'triangle') {
            const size = 4;
            const points = `${xCoord},${yCoord - size} ${xCoord - size},${yCoord + size} ${xCoord + size},${yCoord + size}`;
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            el.setAttribute('points', points);
            el.setAttribute('fill', fillColor);
            el.setAttribute('stroke', 'none');
            svg.appendChild(el);
          }
        });
      };

      if (s.ptsX?.length)  drawDots(s.ptsX,  s.ptsY,  'circle');
      if (s.pPtsX?.length) drawDots(s.pPtsX, s.pPtsY, 'triangle');
    });
  };

  // 차트 초기화 (마운트 시 1회)
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      ...makeChartOptions(chartHeight, containerRef.current.clientWidth),
      leftPriceScale: { visible: false },
      rightPriceScale: {
        visible: true,
        borderColor: cssVar('--color-border'),
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
    });
    chartRef.current = chart;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      const vals = {};
      Object.entries(seriesRefsMap.current).forEach(([id, s]) => {
        const d = param.seriesData.get(s);
        if (d) vals[id] = d.value;
      });
      setTooltip({ time: param.time, vals });
    });

    // RAF 루프 — dot 항상 최신 상태 유지
    let rafId;
    const loop = () => { redrawDotsRef.current?.(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);

    // ResizeObserver — 마운트 직후 width/height 즉시 반영
    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.clientWidth || 0;
      const fontSize = w < 400 ? 9 : w < 600 ? 10 : 11;
      chart.applyOptions({ width: w, layout: { fontSize } });
      setChartHeight(getChartHeight(isMobile, w));
    });
    ro.observe(containerRef.current);
    // 초기 width/height 강제 세팅
    const initW = containerRef.current.clientWidth;
    chart.applyOptions({ width: initW, layout: { fontSize: initW < 400 ? 9 : initW < 600 ? 10 : 11 } });
    setChartHeight(getChartHeight(isMobile, initW));

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefsMap.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // series 변경 시 — 추가/제거 동기화
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentIds = new Set(series.map(s => s.id));
    const existingIds = new Set(Object.keys(seriesRefsMap.current));

    // 제거된 시리즈 삭제
    existingIds.forEach(id => {
      if (!currentIds.has(id)) {
        try { chart.removeSeries(seriesRefsMap.current[id]); } catch {}
        delete seriesRefsMap.current[id];
      }
    });

    // 추가/갱신
    series.forEach((s, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];

      if (!seriesRefsMap.current[s.id]) {
        // 새 시리즈 생성
        const avgSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceScaleId: 'right',
          lastValueVisible: true,
          priceLineVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
          priceFormat: {
            type: 'custom',
            formatter: (v) => `${v.toFixed(1)}억`,
            minMove: 0.01,
          },
        });
        seriesRefsMap.current[s.id] = avgSeries;
      } else {
        // 색상만 갱신 (인덱스 변경 대비)
        seriesRefsMap.current[s.id].applyOptions({ color });
      }

      // 평균가 데이터 세팅
      const avgData = (s.x || []).map((ym, i) => ({
        time: toTime(ym),
        value: s.y[i] || null,
      })).filter(d => d.value).sort((a, b) => a.time > b.time ? 1 : -1);
      seriesRefsMap.current[s.id].setData(avgData);
    });

    // X축 범위 설정
    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date();
      start.setFullYear(start.getFullYear() - YEAR_WINDOW);
      try {
        chartRef.current.timeScale().setVisibleRange({ from: start.toISOString().slice(0, 10), to: today });
      } catch {
        chartRef.current.timeScale().fitContent();
      }
    });
  }, [series]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ width: `${CHART_WIDTH_RATIO * 100}%`, margin: '0 auto' }}>
    <div style={{ position: 'relative', width: '100%', height: chartHeight, border: '1px solid var(--color-border)', borderRadius: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: chartHeight }} />
      <svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }} />
      {/* 스크롤 양보 오버레이 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: OVERLAY_LEFT_W, height: '100%', zIndex: 10 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: OVERLAY_RIGHT_W, height: '100%', zIndex: 10 }} />
      {tooltip && Object.keys(tooltip.vals).length > 0 && (
        <div style={{
          position: 'absolute', top: 36, left: 8,
          background: 'rgba(31,29,27,0.88)', color: '#fff',
          borderRadius: 6, padding: '3px 7px',
          fontSize: '0.68rem', fontWeight: 600,
          pointerEvents: 'none', zIndex: 20, lineHeight: 1.6,
        }}>
          <div style={{ color: 'var(--color-text-disabled)', marginBottom: 2 }}>
            {typeof tooltip.time === 'object'
              ? `${tooltip.time.year}/${String(tooltip.time.month).padStart(2, '0')}`
              : String(tooltip.time).slice(0, 7).replace('-', '/')}
          </div>
          {series.map((s, idx) => {
            const v = tooltip.vals[s.id];
            if (v == null) return null;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: SERIES_COLORS[idx % SERIES_COLORS.length], flexShrink: 0,
                }} />
                <span style={{ color: SERIES_COLORS[idx % SERIES_COLORS.length] === '#0047AB' ? '#fff' : SERIES_COLORS[idx % SERIES_COLORS.length] }}>
                  {trimAptName(s.kaptName)} {s.area}㎡
                </span>
                <span style={{ color: '#fff' }}>
                  {v.toFixed(1)}억
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
    {/* 범례 — 차트 아래 */}
    {series.length > 0 && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '4px 0 0' }}>
        {series.map((s, idx) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
            <span style={{ width: 16, height: 2, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2 }} />
            {trimAptName(s.kaptName)} {s.area}㎡
          </span>
        ))}
      </div>
    )}
    </div>
  );
}

// ────────────────────────────────────────────
// G2: 다중 시리즈 정규화(%) 비교 차트
// FinanceChart NormChart 방식 — 공통 단일 기준 날짜
// normSeries: [{ id, kaptName, area, color, x (YM[]), y (억[]) }]
// normMonthsAgo: 오늘로부터 N개월 전을 100% 기준
// ────────────────────────────────────────────
function NormCompareChart({ series, normMonthsAgo, isMobile, onNormChange }) {
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const seriesRefsMap = useRef({}); // id -> lwc series
  const baseTimeRef   = useRef(null);
  const seriesDataRef = useRef(series);
  seriesDataRef.current = series;

  const [baseLineX, setBaseLineX]         = useState(null);
  const [timeScaleHeight, setTimeScaleHeight] = useState(38);
  const [tooltip, setTooltip]             = useState(null);
  const [dragX, setDragX]                 = useState(null); // null=비드래그, number=드래그 중 X

  const [chartHeight, setChartHeight] = useState(() => getChartHeight(isMobile, window.innerWidth));

  // chartHeight 변경 시 차트에 반영
  useEffect(() => { chartRef.current?.applyOptions({ height: chartHeight }); }, [chartHeight]);

  const isDragging = dragX !== null;

  const handleFlagMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const getClientX = (ev) => ev.clientX ?? ev.touches?.[0]?.clientX;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragX(Math.max(0, Math.min(getClientX(e) - rect.left, rect.width)));

    const snapX = (rawX) => {
      if (!chartRef.current) return rawX;
      const time = chartRef.current.timeScale().coordinateToTime(rawX);
      if (!time) return rawX;
      const snapped = chartRef.current.timeScale().timeToCoordinate(time);
      return snapped != null ? snapped : rawX;
    };

    const onMove = (ev) => {
      const cx = getClientX(ev);
      if (cx == null) return;
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const raw = Math.max(0, Math.min(cx - r.left, r.width));
      setDragX(snapX(raw));
    };
    const onUp = (ev) => {
      const cx = ev.clientX ?? ev.changedTouches?.[0]?.clientX;
      if (cx != null && containerRef.current && chartRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(cx - r.left, r.width));
        const time = chartRef.current.timeScale().coordinateToTime(x);
        if (time) {
          const d = typeof time === 'object'
            ? new Date(time.year, time.month - 1, 1)
            : new Date(time);
          const now = new Date();
          const months = Math.round((now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
          onNormChange(Math.max(0, months));
        }
      }
      setDragX(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [onNormChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // 기준 날짜 문자열 (YYYY-MM-DD)
  const baseDateStr = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - normMonthsAgo);
    return d.toISOString().slice(0, 10);
  }, [normMonthsAgo]);

  const updateBaseLineX = useCallback(() => {
    if (!baseTimeRef.current || !chartRef.current) return;
    const x = chartRef.current.timeScale().timeToCoordinate(baseTimeRef.current);
    setBaseLineX(x != null ? x : null);
  }, []);

  // 차트 초기화 (1회)
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      ...makeChartOptions(chartHeight, containerRef.current.clientWidth),
      rightPriceScale: { visible: true, borderColor: cssVar('--color-border'), scaleMargins: { top: 0.05, bottom: 0.05 } },
    });
    chartRef.current = chart;
    setTimeout(() => setTimeScaleHeight(chart.timeScale().height() || 38), 0);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      const vals = {};
      Object.entries(seriesRefsMap.current).forEach(([id, s]) => {
        const d = param.seriesData.get(s);
        if (d) vals[id] = d.value;
      });
      setTooltip({ time: param.time, vals });
    });

    chart.timeScale().subscribeVisibleTimeRangeChange(() => updateBaseLineX());

    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.clientWidth || 0;
      const fontSize = w < 400 ? 9 : w < 600 ? 10 : 11;
      chart.applyOptions({ width: w, layout: { fontSize } });
      setChartHeight(getChartHeight(isMobile, w));
      setTimeScaleHeight(chart.timeScale().height() || 38);
      updateBaseLineX();
    });
    ro.observe(containerRef.current);
    const initW = containerRef.current.clientWidth;
    chart.applyOptions({ width: initW, layout: { fontSize: initW < 400 ? 9 : initW < 600 ? 10 : 11 } });
    setChartHeight(getChartHeight(isMobile, initW));

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefsMap.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // series 또는 normMonthsAgo 변경 시 — 전체 재계산
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // 기존 시리즈 전체 제거
    Object.values(seriesRefsMap.current).forEach(s => { try { chart.removeSeries(s); } catch {} });
    seriesRefsMap.current = {};
    baseTimeRef.current = null;
    setBaseLineX(null);
    setTooltip(null);

    if (!series.length) return;

    const baseTs = new Date(baseDateStr).getTime();

    series.forEach((s, idx) => {
      const xs = s.x || [], ys = s.y || [];
      if (!xs.length || !ys.length) return;

      // 월 데이터 → { time, value } 포인트 배열
      const points = xs.map((ym, i) => ({
        time: toTime(ym),
        value: ys[i],
      })).filter(p => Number.isFinite(p.value)).sort((a, b) => a.time > b.time ? 1 : -1);
      if (!points.length) return;

      // 기준 날짜에 가장 가까운 포인트 찾기 (FinanceChart 동일 방식)
      const basePoint = points.reduce((prev, curr) =>
        Math.abs(new Date(curr.time).getTime() - baseTs) <
        Math.abs(new Date(prev.time).getTime() - baseTs) ? curr : prev
      );
      const baseValue = basePoint.value;
      if (!baseValue) return;

      // 공유 기준일을 수직선 위치로 사용 (핀 고정 계열도 점선은 baseDateStr 기준)
      // 차트 데이터는 YYYY-MM-01 형식이므로 월의 1일로 맞춤
      if (idx === 0) baseTimeRef.current = baseDateStr.slice(0, 7) + '-01';

      // 정규화
      const normalized = points.map(p => ({
        time: p.time,
        value: Math.round((p.value / baseValue) * 10000) / 100,
      }));

      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const lwcSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceScaleId: 'right',
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        priceFormat: { type: 'custom', formatter: v => Math.round(v) + '%', minMove: 1 },
      });
      lwcSeries.setData(normalized);
      seriesRefsMap.current[s.id] = lwcSeries;
    });

    // X축 범위: normMonthsAgo 기준보다 1년 더 앞부터 표시
    const normYears = normMonthsAgo / 12;
    const visibleStart = new Date();
    visibleStart.setFullYear(visibleStart.getFullYear() - Math.max(YEAR_WINDOW, normYears + 1));
    const today = new Date().toISOString().slice(0, 10);

    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      try {
        chartRef.current.timeScale().setVisibleRange({ from: visibleStart.toISOString().slice(0, 10), to: today });
      } catch {
        chartRef.current.timeScale().fitContent();
      }
      updateBaseLineX();
    });
  }, [series, normMonthsAgo, baseDateStr, updateBaseLineX]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ width: `${CHART_WIDTH_RATIO * 100}%`, margin: '0 auto' }}>
    <div style={{ position: 'relative', width: '100%', border: '1px solid var(--color-border)', borderRadius: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: chartHeight }} />
      {/* 스크롤 양보 오버레이 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: OVERLAY_LEFT_W, height: '100%', zIndex: 10 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: OVERLAY_RIGHT_W, height: '100%', zIndex: 10 }} />

      {/* 공통 기준점 수직 점선 — 드래그 가능 */}
      {(baseLineX != null || isDragging) && (() => {
        const displayX = isDragging ? dragX : baseLineX;
        const hitW = isMobile ? 44 : 20;
        return (
          <div
            onMouseDown={handleFlagMouseDown}
            onTouchStart={handleFlagMouseDown}
            style={{
              position: 'absolute', top: 0, bottom: timeScaleHeight,
              left: displayX - hitW / 2, width: hitW,
              cursor: isDragging ? 'grabbing' : 'ew-resize',
              zIndex: 15, userSelect: 'none',
            }}
          >
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: '50%', width: 0,
              borderLeft: isDragging ? '2px solid var(--color-text-main)' : '1.5px dashed var(--color-text-sub)',
              pointerEvents: 'none',
            }} />
            <div style={{
              position: 'absolute', top: 7, left: '50%',
              transform: 'translateX(-50%)',
              background: isDragging ? 'rgba(50,42,38,0.97)' : 'rgba(107,98,91,0.75)',
              color: '#fff',
              fontSize: '0.68rem', fontWeight: 700,
              borderRadius: 4, padding: '2px 6px',
              textAlign: 'center', lineHeight: 1.4, whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: isDragging ? '0 2px 8px rgba(0,0,0,0.35)' : 'none',
            }}>
              100%<br />
              {baseTimeRef.current
                ? (() => { const d = new Date(baseTimeRef.current); return `${d.getFullYear()}/${d.getMonth() + 1}`; })()
                : ''}
            </div>
          </div>
        );
      })()}

      {/* 툴팁 */}
      {!isMobile && tooltip && Object.keys(tooltip.vals).length > 0 && (
        <div style={{
          position: 'absolute', top: 36, left: 8,
          background: 'rgba(31,29,27,0.88)', color: '#fff',
          borderRadius: 6, padding: '3px 7px',
          fontSize: '0.68rem', fontWeight: 600,
          pointerEvents: 'none', zIndex: 20, lineHeight: 1.6,
        }}>
          <div style={{ color: 'var(--color-text-disabled)', marginBottom: 2 }}>
            {typeof tooltip.time === 'object'
              ? `${tooltip.time.year}/${String(tooltip.time.month).padStart(2, '0')}`
              : String(tooltip.time).slice(0, 7).replace('-', '/')}
          </div>
          {series.map((s, idx) => {
            const v = tooltip.vals[s.id];
            if (v == null) return null;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: SERIES_COLORS[idx % SERIES_COLORS.length], flexShrink: 0,
                }} />
                <span style={{ color: SERIES_COLORS[idx % SERIES_COLORS.length] === '#0047AB' ? '#fff' : SERIES_COLORS[idx % SERIES_COLORS.length] }}>
                  {trimAptName(s.kaptName)} {s.area}㎡
                </span>
                <span style={{ color: '#fff' }}>
                  {Math.round(v)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
    {/* 범례 — 차트 아래 */}
    {series.length > 0 && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '4px 0 0' }}>
        {series.map((s, idx) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
            <span style={{ width: 16, height: 2, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2 }} />
            {trimAptName(s.kaptName)} {s.area}㎡
          </span>
        ))}
      </div>
    )}
    </div>
  );
}

// ────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────
export default function ChartPanel({ isOpen = false, favApts = [], removeFavoriteApt, isMobile = false, isTablet = false, onWritePost, user, boardIsWriting = false, restoreKey = 0, theme = 'rose_slate', onOpenMinimap }) {
  const [activeKey, setActiveKey]   = useState(null);
  const g1Ref = useRef(null); // 실거래 평균가 차트
  const g2Ref = useRef(null); // 정규화 비교 차트
  const [normMonthsAgo, setNormMonthsAgo] = useState(36); // 기본: 36개월(3년) 전 = 100%
  const [pressedNorm, setPressedNorm]     = useState(null); // 'back' | 'forward' | null

  const [areasByKey, setAreasByKey]     = useState({});
  const [hotAreasByKey, setHotAreasByKey] = useState({});
  const [loadingKey, setLoadingKey]     = useState(null);
  const [errMsg, setErrMsg]             = useState('');

  // 누적 시리즈: [{ id, key, kaptName, area, x, y, ptsX, ptsY, pPtsX, pPtsY }]
  const [series, setSeries] = useState([]);

  // 자동 초기화: 탭이 열릴 때 favApts가 바뀌었으면 재초기화
  const lastFavKeysRef  = useRef(null);
  const prevIsOpenRef   = useRef(false);
  const lastRestoreKey  = useRef(restoreKey);

  useEffect(() => {
    const justOpened   = isOpen && !prevIsOpenRef.current;
    const forceRestore = restoreKey !== lastRestoreKey.current;
    prevIsOpenRef.current  = isOpen;
    lastRestoreKey.current = restoreKey;
    if (forceRestore) lastFavKeysRef.current = null; // 강제 재초기화

    if (!isOpen || !favApts.length) return;

    const currentKeys = favApts.map(f => f.key).join(',');
    const isFirst = lastFavKeysRef.current === null;
    const favsChanged = lastFavKeysRef.current !== currentKeys;

    // 첫 오픈이거나, restore 트리거이거나, 탭이 다시 열렸을 때 favApts가 바뀐 경우만 초기화
    if (!isFirst && !forceRestore && (!justOpened || !favsChanged)) return;

    lastFavKeysRef.current = currentKeys;

    // 기존 시리즈/상태 초기화
    setSeries([]);
    setAreasByKey({});
    setHotAreasByKey({});
    setActiveKey(null);

    const top3 = favApts.slice(0, 3);
    const cutoff3y = (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 3);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    setActiveKey(top3[0].key);

    Promise.allSettled(top3.map(async (fav) => {
      const { pnu } = buildPNU(fav);
      const code5 = String(fav.bjdCode || '').slice(0, 5);
      const [rRes, pRes] = await Promise.allSettled([
        fetchWorkbook(fav.as1, fav.as2, code5),
        fetchPdata(fav.as1, fav.as2, code5),
      ]);
      if (rRes.status === 'rejected') return;
      const { wb } = rRes.value;
      const pdWb = pRes.status === 'fulfilled' ? pRes.value?.wb ?? null : null;

      // 면적 결정: favApts에 저장된 값 우선, 없으면 workbook에서 재계산
      let list, hotArea;
      if (fav.areas?.length) {
        list = fav.areas;
        hotArea = fav.hotAreas?.[0] ?? pickInitialArea(list);
      } else {
        const rawList = listAreasForPnu(wb, pnu, fav.kaptName || null, pdWb);
        list = groupAreasToRep(rawList);
        if (!list.length) return;

        const pnuStr   = pnu ? String(pnu) : null;
        const normName = fav.kaptName ? normAptNm(fav.kaptName) : null;
        const volMap   = new Map();
        const tol = (r) => r <= 85 ? 0.9 : r * 0.01;

        for (const obj of (wb || [])) {
          const match = (pnuStr && String(obj.pnu).trim() === pnuStr) ||
                        (normName && normAptNm(obj.aptNm) === normName);
          if (!match) continue;
          const yy = String(obj.dealYear || '').padStart(4, '0');
          const mm = String(obj.dealMonth || '').padStart(2, '0');
          if (`${yy}-${mm}` < cutoff3y) continue;
          const ar = parseFloat(obj.excluUseAr);
          if (!Number.isFinite(ar)) continue;
          const rep = list.find(r => Math.abs(r - ar) <= tol(r));
          if (rep == null) continue;
          volMap.set(rep, (volMap.get(rep) || 0) + 1);
        }
        for (const obj of (pdWb || [])) {
          if (parseFloat(obj.isCanceled) === 1) continue;
          if (normName && normAptNm(obj.aptNm) !== normName) continue;
          const yy = String(obj.dealYear || '').padStart(4, '0');
          const mm = String(obj.dealMonth || '').padStart(2, '0');
          if (`${yy}-${mm}` < cutoff3y) continue;
          const ar = parseFloat(obj.excluUseAr);
          if (!Number.isFinite(ar)) continue;
          const rep = list.find(r => Math.abs(r - ar) <= tol(r));
          if (rep == null) continue;
          volMap.set(rep, (volMap.get(rep) || 0) + 1);
        }
        hotArea = volMap.size > 0
          ? [...volMap.entries()].sort((a, b) => b[1] - a[1])[0][0]
          : list[0];
      }

      if (!list.length) return;

      // setAreasByKey / setHotAreasByKey 는 fav당 1회
      setAreasByKey(prev => ({ ...prev, [fav.key]: list }));
      if (fav.hotAreas?.length) {
        setHotAreasByKey(prev => ({ ...prev, [fav.key]: fav.hotAreas }));
      }

      // hotLevel1(1순위 면적)만 로드
      const areasToLoad = [hotArea];

      for (const areaVal of areasToLoad) {
        const areaNorm = Math.round(areaVal * 10) / 10;
        const id = `${fav.key}#${areaNorm}`;

        const pack = aggregateTradesForArea({
          wb, pdWb, pnu, kaptName: fav.kaptName || null,
          areaNorm, smoothWindow: SMOOTH_WINDOW,
        });
        setSeries(prev => {
          if (prev.some(s => s.id === id)) return prev;
          return [...prev, {
            id, key: fav.key, kaptName: fav.kaptName, area: areaNorm,
            x: pack.x || [], y: pack.avg || [],
            ptsX: pack.ptsX || [], ptsY: pack.ptsY || [],
            pPtsX: pack.pPtsX || [], pPtsY: pack.pPtsY || [],
          }];
        });

        // 백그라운드: 구형 연도 로드 완료 후 시리즈 조용히 갱신
        if (rRes.value.isPartial && rRes.value.fullPromise) {
          rRes.value.fullPromise.then((fullResult) => {
            if (!fullResult) return;
            clearTradeCacheForPnu(pnu);
            const fullPack = aggregateTradesForArea({
              wb: fullResult.wb, pdWb, pnu,
              kaptName: fav.kaptName || null,
              areaNorm, smoothWindow: SMOOTH_WINDOW,
            });
            setSeries(prev => prev.map(s => s.id !== id ? s : {
              ...s,
              x: fullPack.x || [], y: fullPack.avg || [],
              ptsX: fullPack.ptsX || [], ptsY: fullPack.ptsY || [],
              pPtsX: fullPack.pPtsX || [], pPtsY: fullPack.pPtsY || [],
            }));
          }).catch(() => {});
        }
      }
    }));
  }, [isOpen, favApts, restoreKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 상세비교 모달
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [selectedKeys, setSelectedKeys]       = useState([]);
  const [compareLoading, setCompareLoading]   = useState(false);
  const [compareData, setCompareData]         = useState(null);
  const [compareBtnActive, setCompareBtnActive] = useState(false);


  const activeFav = useMemo(() => favApts.find((a) => a.key === activeKey), [favApts, activeKey]);

  // 기준 연월 표시 레이블 (FinanceChart 동일)
  const baseLabel = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - normMonthsAgo);
    return normMonthsAgo === 0
      ? `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`
      : `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  }, [normMonthsAgo]);

  // -3월 비활성: 시리즈 중 가장 오래된 데이터보다 더 이전이면 막기
  const canGoBack = useMemo(() => {
    if (!series.length) return true;
    const earliest = series
      .map(s => s.x?.[0])
      .filter(Boolean)
      .sort()
      .at(0); // 가장 오래된 YM
    if (!earliest) return true;
    const nextBase = new Date();
    nextBase.setMonth(nextBase.getMonth() - (normMonthsAgo + 3));
    const earliestDate = ymToDate(earliest);
    return nextBase >= earliestDate;
  }, [series, normMonthsAgo]);

  const canGoForward = normMonthsAgo > 0;

  // ── 면적 목록 로드 ──
  const loadAreas = async (fav) => {
    if (!fav || areasByKey[fav.key]?.length) return;
    setErrMsg('');
    setLoadingKey(fav.key);
    try {
      const { pnu } = buildPNU(fav);
      const code5 = String(fav.bjdCode || '').slice(0, 5);
      const [rResult, pResult] = await Promise.allSettled([
        fetchWorkbook(fav.as1, fav.as2, code5),
        fetchPdata(fav.as1, fav.as2, code5),
      ]);
      if (rResult.status === 'rejected') throw rResult.reason;
      const { wb } = rResult.value;
      const pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;
      const rawList = listAreasForPnu(wb, pnu, fav.kaptName || null, pdWb);
      const list = groupAreasToRep(rawList);
      setAreasByKey(prev => ({ ...prev, [fav.key]: list }));
      if (!list.length) setErrMsg('면적 목록이 없습니다.');

      // Hot 순위: favApts에 저장된 값 우선, 없으면 3년 거래량으로 계산
      if (fav.hotAreas?.length) {
        setHotAreasByKey(prev => ({ ...prev, [fav.key]: fav.hotAreas }));
      } else {
        const cutoff = (() => {
          const d = new Date(); d.setFullYear(d.getFullYear() - 3);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const pnuStr   = pnu ? String(pnu) : null;
        const normName = fav.kaptName ? normAptNm(fav.kaptName) : null;
        const volMap   = new Map();

        for (const obj of (wb || [])) {
          const match = (pnuStr && String(obj.pnu).trim() === pnuStr) ||
                        (normName && normAptNm(obj.aptNm) === normName);
          if (!match) continue;
          const yy = String(obj.dealYear || '').padStart(4, '0');
          const mm = String(obj.dealMonth || '').padStart(2, '0');
          if (`${yy}-${mm}` < cutoff) continue;
          const ar = parseFloat(obj.excluUseAr);
          if (!Number.isFinite(ar)) continue;
          const rep = list.find(r => Math.abs(r - ar) <= (r <= 85 ? 0.9 : r * 0.01));
          if (rep == null) continue;
          volMap.set(rep, (volMap.get(rep) || 0) + 1);
        }
        for (const obj of (pdWb || [])) {
          if (parseFloat(obj.isCanceled) === 1) continue;
          if (normName && normAptNm(obj.aptNm) !== normName) continue;
          const yy = String(obj.dealYear || '').padStart(4, '0');
          const mm = String(obj.dealMonth || '').padStart(2, '0');
          if (`${yy}-${mm}` < cutoff) continue;
          const ar = parseFloat(obj.excluUseAr);
          if (!Number.isFinite(ar)) continue;
          const rep = list.find(r => Math.abs(r - ar) <= (r <= 85 ? 0.9 : r * 0.01));
          if (rep == null) continue;
          volMap.set(rep, (volMap.get(rep) || 0) + 1);
        }
        const hotTop2 = [...volMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([area]) => area);
        setHotAreasByKey(prev => ({ ...prev, [fav.key]: hotTop2 }));
      }
    } catch {
      setErrMsg('면적 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingKey(null);
    }
  };

  // ── 시리즈 추가/토글 ──
  const addSeries = async (fav, areaNorm) => {
    if (!fav || !areaNorm) return;
    const id = `${fav.key}#${areaNorm}`;
    if (series.some(s => s.id === id)) {
      setSeries(prev => prev.filter(s => s.id !== id));
      return;
    }
    setErrMsg('');
    try {
      const { pnu } = buildPNU(fav);
      const code5 = String(fav.bjdCode || '').slice(0, 5);
      const [rResult, pResult] = await Promise.allSettled([
        fetchWorkbook(fav.as1, fav.as2, code5),
        fetchPdata(fav.as1, fav.as2, code5),
      ]);
      if (rResult.status === 'rejected') throw rResult.reason;
      const { wb }  = rResult.value;
      const _pdWb   = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;
      const pack    = aggregateTradesForArea({
        wb, pdWb: _pdWb, pnu,
        kaptName: fav.kaptName || null,
        areaNorm, smoothWindow: SMOOTH_WINDOW,
      });
      setSeries(prev => {
        const next = prev.filter(s => s.id !== id);
        next.push({
          id, key: fav.key, kaptName: fav.kaptName, area: areaNorm,
          x: pack.x || [], y: pack.avg || [],
          ptsX: pack.ptsX || [], ptsY: pack.ptsY || [],
          pPtsX: pack.pPtsX || [], pPtsY: pack.pPtsY || [],
        });
        return next;
      });
      if (!pack.x?.length) setErrMsg('실거래 데이터가 없습니다.');

      // 백그라운드: 구형 연도 로드 완료 후 시리즈 조용히 갱신
      if (rResult.value.isPartial && rResult.value.fullPromise) {
        rResult.value.fullPromise.then((fullResult) => {
          if (!fullResult) return;
          clearTradeCacheForPnu(pnu);
          const fullPack = aggregateTradesForArea({
            wb: fullResult.wb, pdWb: _pdWb, pnu,
            kaptName: fav.kaptName || null,
            areaNorm, smoothWindow: SMOOTH_WINDOW,
          });
          setSeries(prev => prev.map(s => s.id !== id ? s : {
            ...s,
            x: fullPack.x || [], y: fullPack.avg || [],
            ptsX: fullPack.ptsX || [], ptsY: fullPack.ptsY || [],
            pPtsX: fullPack.pPtsX || [], pPtsY: fullPack.pPtsY || [],
          }));
        }).catch(() => {});
      }
    } catch {
      setErrMsg('실거래 데이터를 불러오지 못했습니다.');
    }
  };

  // ── 상세비교 데이터 로드 ──
  const loadCompareData = async (keys) => {
    setCompareLoading(true);
    try {
      const apts = keys.map(k => favApts.find(f => f.key === k)).filter(Boolean);
      const results = await Promise.all(apts.map(async (fav) => {
        const code5 = String(fav.bjdCode || '').slice(0, 5);
        const detailMap = await fetchKaptDetail(fav.as1, fav.as2, code5).catch(() => null);
        const detailRow = detailMap && fav.kaptCode
          ? detailMap.get(String(fav.kaptCode).trim()) ?? null : null;
        return { fav, listRow: fav, detailRow, pairs: buildAptInfoPairs(fav, detailRow) };
      }));
      setCompareData(results);
      setShowSelectModal(false);
    } finally {
      setCompareLoading(false);
    }
  };

  const padding = isMobile ? '14px 16px' : isTablet ? '16px 20px' : '20px 24px';

  return (
    <aside style={{ ...commonPanelStyle, boxSizing: 'border-box' }}>

      {/* ── 헤더 ── */}
      <div style={commonHeaderStyle}>
        {(isMobile || isTablet) ? (
          <span onClick={onOpenMinimap} style={{ color: 'rgba(255,255,255,0.9)', flexShrink: 0, cursor: 'pointer', borderRadius: 6, padding: 2, display: 'flex', alignItems: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="6" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
              <line x1="2" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
              <line x1="10" y1="6" x2="10" y2="22" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
              <path d="M16 0C13.2 0 11 2.2 11 5c0 3.5 5 9 5 9s5-5.5 5-9c0-2.8-2.2-5-5-5z" fill="currentColor"/>
              <circle cx="16" cy="5" r="1.8" fill="white"/>
            </svg>
          </span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
              <polyline points="3,17 8,10 12,13 16,7 21,9"/>
              <line x1="3" y1="21" x2="21" y2="21"/>
              <line x1="3" y1="21" x2="3" y2="4"/>
            </svg>
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#fff', flex: 1 }}>
          단지 비교
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => {
              if (compareData || showSelectModal) {
                setCompareData(null);
                setShowSelectModal(false);
                return;
              }
              const keys = favApts.map(f => f.key);
              if (keys.length <= 3 && keys.length >= 2) {
                setSelectedKeys(keys);
                loadCompareData(keys);
              } else if (keys.length === 1) {
                setSelectedKeys(keys);
                loadCompareData(keys);
              } else {
                setSelectedKeys([]);
                setShowSelectModal(true);
              }
            }}
            onMouseDown={() => setCompareBtnActive(true)}
            onMouseUp={() => setCompareBtnActive(false)}
            onMouseLeave={() => setCompareBtnActive(false)}
            onTouchStart={() => setCompareBtnActive(true)}
            onTouchEnd={() => setCompareBtnActive(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: compareBtnActive ? 'rgba(255,255,255,0.25)' : 'none',
              border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 8,
              padding: '0 10px', height: 30, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600,
              color: '#fff',
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={13} height={13}>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            상세비교
          </button>
          <button
            onClick={async () => {
              if (!user) { alert('로그인 후 이용할 수 있습니다.'); return; }
              if (!g2Ref.current) { alert('차트에 데이터가 없습니다.'); return; }
              if (boardIsWriting && !window.confirm('작성중인 글을 지울까요?')) return;
              try {
                const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#ffffff';
                const opts = { useCORS: true, scale: 2, backgroundColor: bgColor, logging: false };
                const c2 = await html2canvas(g2Ref.current, opts);
                const imgHtml = `<img src="${c2.toDataURL('image/png')}" style="max-width:100%;border-radius:8px;display:block;margin:6px 0;" />`;
                const legendStr = series.map(s => `${trimAptName(s.kaptName)} ${s.area}㎡`).join(' / ');
                const autoTitle = `[비교] ${legendStr}`;
                const byKey = new Map();
                for (const s of series) {
                  const fav = favApts.find(f => f.key === s.key);
                  if (!fav) continue;
                  if (!byKey.has(s.key)) byKey.set(s.key, { fav, areas: [] });
                  byKey.get(s.key).areas.push(s.area);
                }
                const chartMeta = {
                  apts: [...byKey.values()].map(({ fav, areas }) => ({ ...fav, hotAreas: areas })),
                };
                onWritePost?.(imgHtml, autoTitle, chartMeta);
              } catch (e) {
                alert('차트 캡처 중 오류가 발생했습니다.');
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 8,
              padding: '0 10px', height: 30, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600,
              color: user ? '#fff' : 'rgba(255,255,255,0.4)',
            }}
            title={user ? '게시판 글로 보내기' : '로그인 후 이용 가능'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            작성하기
          </button>
        </div>
      </div>

{/* ── 콘텐츠 영역 ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding, boxSizing: 'border-box', ...((isMobile || isTablet) && { paddingBottom: isMobile ? 34 : 36 }) }}>

      {/* ── 즐겨찾기 단지 목록 + 면적 선택 ── */}
      {favApts.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 즐겨찾기 버튼 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {favApts.map(fav => {
                const isActive = fav.key === activeKey;
                return (
                  <FavChip
                    key={fav.key}
                    fav={fav}
                    isActive={isActive}
                    theme={theme}
                    onClick={async () => { setActiveKey(fav.key); await loadAreas(fav); }}
                    onRemove={(key) => {
                      removeFavoriteApt?.(key);
                      if (activeKey === key) setActiveKey(null);
                      setSeries(prev => prev.filter(s => s.key !== key));
                    }}
                  />
                );
              })}
            </div>
            {/* 면적 선택 */}
            {activeFav ? (
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--color-text-disabled)' }} />
                  전용면적 중복 가능
                  {(() => {
                    const areas = areasByKey[activeKey] || [];
                    if (!areas.length) return null;
                    const mn = Math.min(...areas).toFixed(1);
                    const mx = Math.max(...areas).toFixed(1);
                    return <span>{mn === mx ? `(${mn}㎡)` : `(${mn}~${mx}㎡)`}</span>;
                  })()}
                </div>
                <div
                  style={{
                    display: 'flex', gap: 0, flexWrap: 'wrap',
                  }}
                >
                  {loadingKey === activeKey ? (
                    <span style={{ padding: '6px 10px', color: 'var(--color-text-sub)', fontSize: '0.82rem' }}>로딩…</span>
                  ) : !(areasByKey[activeKey] || []).length ? (
                    <span style={{ padding: '6px 10px', color: '#c33', fontSize: '0.82rem' }}>면적 목록이 없습니다.</span>
                  ) : (
                    (areasByKey[activeKey] || []).map((ar) => {
                      const hotList  = hotAreasByKey[activeKey] || [];
                      const hotRank  = hotList.indexOf(ar);
                      const hotLabel = hotRank === 0 ? 'Hot1' : hotRank === 1 ? 'Hot2' : null;
                      const inSeries = series.some(s => s.key === activeKey && s.area === ar);
                      return (
                        <div key={ar} onClick={() => addSeries(activeFav, ar)}
                          style={{
                            flex: '0 0 auto', padding: '6px 10px',
                            fontSize: '0.78rem',
                            fontWeight: inSeries ? 700 : 400,
                            color: inSeries ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                            borderBottom: inSeries ? '2px solid var(--color-text-main)' : '2px solid transparent',
                            marginBottom: -1, cursor: 'pointer',
                            position: 'relative', whiteSpace: 'nowrap', transition: 'color 0.1s',
                          }}
                          title="클릭하면 그래프에 누적 추가"
                        >
                          {ar.toFixed(1)}㎡
                          {hotLabel && (
                            <span style={{
                              position: 'absolute', top: 0, right: 2,
                              color: '#b35a00', fontSize: '0.62rem', fontWeight: 900,
                              pointerEvents: 'none', transform: 'rotate(-12deg)',
                              transformOrigin: 'center center', lineHeight: 1,
                            }}>{hotLabel}</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                {errMsg && <div style={{ marginTop: 4, color: '#c33', fontSize: '0.82rem' }}>{errMsg}</div>}
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-disabled)' }}>위에서 단지를 클릭하면 면적을 선택할 수 있습니다.</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ color: 'var(--color-text-disabled)', fontSize: '0.9rem', padding: '4px 0' }}>추가된 아파트가 없습니다.</div>
      )}

      {/* ── 활성 시리즈 범례 ── */}
      {series.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', flex: 1 }}>
            {series.map((s, idx) => (
              <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
                <span style={{ width: 8, height: 8, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: '50%', flexShrink: 0 }} />
                <span>{trimAptName(s.kaptName)} {s.area}㎡</span>
                <button onClick={() => setSeries(prev => prev.filter(x => x.id !== s.id))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-disabled)', lineHeight: 1, padding: 0, fontSize: '0.6rem' }}
                  title="그래프에서 제거">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── G2: 정규화 비교 ── */}
      <div ref={g2Ref} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-text-main)' }}>정규화 비교</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>시점 {baseLabel}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => {
                if (!canGoBack) return;
                const next = normMonthsAgo + 3;
                setNormMonthsAgo(next);
                setPressedNorm('back');
                setTimeout(() => setPressedNorm(null), 300);
              }}
              disabled={!canGoBack}
              style={{
                height: 22, padding: '0 6px', borderRadius: 6,
                border: pressedNorm === 'back' ? '1.5px solid var(--color-text-sub)' : '1px solid var(--color-text-disabled)',
                background: pressedNorm === 'back' ? 'var(--color-text-sub)' : 'var(--color-bg)',
                color: pressedNorm === 'back' ? '#fff' : canGoBack ? 'var(--color-text-sub)' : 'var(--color-text-disabled)',
                fontWeight: 700, fontSize: '0.72rem', cursor: canGoBack ? 'pointer' : 'default',
              }}
            >-3월</button>
            <button
              onClick={() => {
                if (!canGoForward) return;
                setNormMonthsAgo(p => p - 3);
                setPressedNorm('forward');
                setTimeout(() => setPressedNorm(null), 300);
              }}
              disabled={!canGoForward}
              style={{
                height: 22, padding: '0 6px', borderRadius: 6,
                border: pressedNorm === 'forward' ? '1.5px solid var(--color-text-sub)' : '1px solid var(--color-text-disabled)',
                background: pressedNorm === 'forward' ? 'var(--color-text-sub)' : 'var(--color-bg)',
                color: pressedNorm === 'forward' ? '#fff' : canGoForward ? 'var(--color-text-sub)' : 'var(--color-text-disabled)',
                fontWeight: 700, fontSize: '0.72rem', cursor: canGoForward ? 'pointer' : 'default',
              }}
            >+3월</button>
          </div>
        </div>

        {series.length > 0 ? (
          <NormCompareChart series={series} normMonthsAgo={normMonthsAgo} isMobile={isMobile} onNormChange={(months) => setNormMonthsAgo(Math.max(0, months))} />
        ) : (
          <div style={{ height: getChartHeight(isMobile, window.innerWidth), display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', borderRadius: 8, color: 'var(--color-text-disabled)', fontSize: '0.85rem' }}>
            면적을 선택하면 차트가 표시됩니다
          </div>
        )}
      </div>

      {/* ── G1: 실거래 평균가 ── */}
      <div ref={g1Ref} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-text-main)' }}>실거래 평균가</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>단위: 억원</span>
        </div>
        {series.length > 0 ? (
          <MultiSeriesTradeChart series={series} isMobile={isMobile} />
        ) : (
          <div style={{ height: getChartHeight(isMobile, window.innerWidth), display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', borderRadius: 8, color: 'var(--color-text-disabled)', fontSize: '0.85rem' }}>
            면적을 선택하면 차트가 표시됩니다
          </div>
        )}
      </div>

      </div>{/* ── 콘텐츠 영역 끝 ── */}

      {/* ── 상세비교 단지 선택 모달 ── */}
      {showSelectModal && !compareData && (() => {
        const selectContent = (
          <>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text-main)' }}>비교할 단지 선택</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>최대 3개</span>
              <button onClick={() => setShowSelectModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-disabled)', fontSize: '1rem', padding: '0 0 0 8px', lineHeight: 1 }}>✕</button>
            </div>
            {/* 목록 */}
            <div style={{ padding: '12px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, ...(isMobile ? { flex: 1 } : { maxHeight: 320 }) }}>
              {favApts.length === 0 ? (
                <div style={{ color: 'var(--color-text-disabled)', fontSize: '0.8rem', textAlign: 'center', padding: '24px 0' }}>즐겨찾기에 추가된 단지가 없습니다.</div>
              ) : favApts.map(fav => {
                const isSelected = selectedKeys.includes(fav.key);
                const isDisabled = !isSelected && selectedKeys.length >= 3;
                return (
                  <div
                    key={fav.key}
                    onClick={() => {
                      if (isDisabled) return;
                      setSelectedKeys(prev => prev.includes(fav.key) ? prev.filter(k => k !== fav.key) : [...prev, fav.key]);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 8, cursor: isDisabled ? 'not-allowed' : 'pointer',
                      border: isSelected ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border)',
                      background: isSelected ? 'var(--color-surface-3)' : 'var(--color-surface)',
                      opacity: isDisabled ? 0.4 : 1, transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, background: isSelected ? 'var(--color-accent)' : 'var(--color-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isSelected && <svg viewBox="0 0 12 10" width={11} height={9} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,5 4.5,8.5 11,1"/></svg>}
                    </div>
                    <div style={{ flex: 1, textAlign: 'center', fontSize: '0.82rem', fontWeight: isSelected ? 700 : 500, color: 'var(--color-text-main)' }}>
                      {trimAptName(fav.kaptName)}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 하단 버튼 */}
            <div style={{ display: 'flex', gap: 8, padding: '8px 20px 12px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
              <button onClick={() => setShowSelectModal(false)} style={{ flex: 1, height: 30, padding: '0 10px', borderRadius: 8, border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-sub)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>취소</button>
              <button
                disabled={selectedKeys.length < 2 || compareLoading}
                onClick={() => loadCompareData(selectedKeys)}
                style={{ flex: 2, height: 30, padding: '0 10px', borderRadius: 8, border: 'none', background: selectedKeys.length >= 2 ? 'var(--color-accent)' : 'var(--color-border)', color: selectedKeys.length >= 2 ? '#fff' : 'var(--color-text-disabled)', fontSize: '0.78rem', fontWeight: 700, cursor: selectedKeys.length >= 2 && !compareLoading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background 0.15s' }}
              >
                {compareLoading ? (
                  <><svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>불러오는 중…</>
                ) : `비교하기 (${selectedKeys.length}개 선택)`}
              </button>
            </div>
          </>
        );

        if (isMobile) {
          return (
            <div style={{
              position: 'absolute', top: 52, left: 0, right: 0, bottom: 0, zIndex: 100,
              background: 'var(--color-surface)', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
              display: 'flex', flexDirection: 'column',
              fontFamily: 'Pretendard, -apple-system, sans-serif',
            }}>
              {selectContent}
            </div>
          );
        }
        return ReactDOM.createPortal(
          <div onClick={() => setShowSelectModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface-2)', borderRadius: 14, width: '100%', maxWidth: 380, margin: '0 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', fontFamily: 'Pretendard, -apple-system, sans-serif', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
              {selectContent}
            </div>
          </div>,
          document.body
        );
      })()}

      {/* ── 상세비교 결과 모달 ── */}
      {compareData && (() => {
        const N = compareData.length;
        const allLabels = [...new Set(compareData.flatMap(d => d.pairs.map(([lbl]) => lbl)))];
        const maps = compareData.map(d => Object.fromEntries(d.pairs));

        const resultContent = (
          <>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: 7 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={17} height={17}>
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                단지 상세비교
              </span>
              <button onClick={() => setCompareData(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-disabled)', fontSize: '1.1rem', lineHeight: 1, padding: 4 }}>✕</button>
            </div>
            {/* 비교 테이블 */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `minmax(60px, max-content) repeat(${N}, minmax(0, 1fr))`, fontSize: '0.7rem' }}>
                <div style={{ padding: '12px 8px 10px', background: 'var(--color-surface-3)', position: 'sticky', top: 0, zIndex: 2 }} />
                {compareData.map((d, i) => (
                  <div key={i} style={{ padding: '12px 10px 10px', background: 'var(--color-surface-3)', borderBottom: '2px solid var(--color-accent)', borderLeft: '1px solid var(--color-border)', fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-text-main)', lineHeight: 1.35, textAlign: 'center', position: 'sticky', top: 0, zIndex: 2 }}>
                    {trimAptName(d.fav.kaptName)}
                  </div>
                ))}
                {allLabels.map((label, rowIdx) => {
                  const rowBg = rowIdx % 2 === 0 ? 'var(--color-surface-2)' : 'var(--color-surface-3)';
                  return (
                    <>
                      <div key={`lbl-${rowIdx}`} style={{ padding: '7px 8px', background: rowBg, color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.65rem', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{label}</div>
                      {compareData.map((_, colIdx) => (
                        <div key={`val-${rowIdx}-${colIdx}`} style={{ padding: '7px 10px', background: rowBg, color: maps[colIdx][label] ? 'var(--color-text-main)' : 'var(--color-text-disabled)', fontSize: '0.72rem', fontWeight: 500, borderTop: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', wordBreak: 'keep-all', overflowWrap: 'break-word', lineHeight: 1.4, textAlign: 'center' }}>
                          {maps[colIdx][label] || '–'}
                        </div>
                      ))}
                    </>
                  );
                })}
              </div>
            </div>
            {/* 하단 닫기 */}
            {!isMobile && (
              <div style={{ padding: '10px 20px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setCompareData(null)} style={{ height: 34, padding: '0 20px', borderRadius: 8, border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-sub)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>닫기</button>
              </div>
            )}
          </>
        );

        if (isMobile) {
          return (
            <div style={{
              position: 'absolute', top: 52, left: 0, right: 0, bottom: 0, zIndex: 100,
              background: 'var(--color-surface)', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
              display: 'flex', flexDirection: 'column',
              fontFamily: 'Pretendard, -apple-system, sans-serif',
            }}>
              {resultContent}
            </div>
          );
        }
        return ReactDOM.createPortal(
          <div onClick={() => setCompareData(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 12px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface-2)', borderRadius: 14, width: '100%', maxWidth: 960, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.22)', fontFamily: 'Pretendard, -apple-system, sans-serif', overflow: 'hidden' }}>
              {resultContent}
            </div>
          </div>,
          document.body
        );
      })()}

    </aside>
  );
}
