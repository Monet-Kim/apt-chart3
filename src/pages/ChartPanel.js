// src/pages/ChartPanel.js
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';
import { createChart, LineSeries } from 'lightweight-charts';
import { ymToDate } from '../utils/dateUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import {
  buildPNU, fetchWorkbook, fetchPdata,
  listAreasForPnu, aggregateTradesForArea, groupAreasToRep, normAptNm,
} from './services/aptData';
import { trimAptName } from '../utils/aptNameUtils';

// ────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────
const SERIES_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];
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
.chart-area-tab-scroll::-webkit-scrollbar-thumb { background: #D3D1C7; border-radius: 2px; }
.chart-area-tab-scroll::-webkit-scrollbar-thumb:hover { background: #B4B2A9; }`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('chart-area-scroll-style');
  if (!s) { s = document.createElement('style'); s.id = 'chart-area-scroll-style'; document.head.appendChild(s); }
  s.textContent = areaScrollbarStyle;
}

// ────────────────────────────────────────────
// 공통 LWC 옵션 (LeftPanel / FinanceChart 동일)
// ────────────────────────────────────────────
function makeChartOptions(height) {
  return {
    height,
    width: 0, // ResizeObserver가 실제 width를 세팅 — 초기 0으로 overflow 방지
    watermark: { visible: false },
    layout: {
      background: { color: '#ffffff' },
      textColor: '#6B625B',
      fontSize: 11,
      fontFamily: 'Pretendard, -apple-system, sans-serif',
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: 'rgba(0,0,0,0.12)' },
      horzLines: { color: 'rgba(0,0,0,0.08)' },
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#6B625B', width: 1, style: 0, labelBackgroundColor: '#6B625B' },
      horzLine: { color: '#6B625B', width: 1, style: 0, labelBackgroundColor: '#6B625B' },
    },
    timeScale: {
      borderColor: '#E6DED4',
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
    rightPriceScale: { borderColor: '#E6DED4' },
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

  const chartHeight = isMobile ? Math.round(window.innerWidth * (2 / 3)) : 280;

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
      ...makeChartOptions(chartHeight),
      leftPriceScale: { visible: false },
      rightPriceScale: {
        visible: true,
        borderColor: '#E6DED4',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
    });
    chartRef.current = chart;

    // RAF 루프 — dot 항상 최신 상태 유지
    let rafId;
    const loop = () => { redrawDotsRef.current?.(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);

    // ResizeObserver — 마운트 직후 width 즉시 반영
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth });
    });
    ro.observe(containerRef.current);
    // 초기 width 강제 세팅
    chart.applyOptions({ width: containerRef.current.clientWidth });

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
    <div style={{ position: 'relative', width: '100%', height: chartHeight, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: chartHeight }} />
      <svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }} />
    </div>
  );
}

// ────────────────────────────────────────────
// G2: 다중 시리즈 정규화(%) 비교 차트
// FinanceChart NormChart 방식 — 공통 단일 기준 날짜
// normSeries: [{ id, kaptName, area, color, x (YM[]), y (억[]) }]
// normMonthsAgo: 오늘로부터 N개월 전을 100% 기준
// ────────────────────────────────────────────
function NormCompareChart({ series, normMonthsAgo, isMobile }) {
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const seriesRefsMap = useRef({}); // id -> lwc series
  const baseTimeRef   = useRef(null);
  const seriesDataRef = useRef(series);
  seriesDataRef.current = series;

  const [baseLineX, setBaseLineX]         = useState(null);
  const [timeScaleHeight, setTimeScaleHeight] = useState(38);
  const [tooltip, setTooltip]             = useState(null);

  const chartHeight = isMobile ? Math.round(window.innerWidth * (2 / 3)) : 280;

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
      ...makeChartOptions(chartHeight),
      rightPriceScale: { visible: true, borderColor: '#E6DED4', scaleMargins: { top: 0.05, bottom: 0.05 } },
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
      chart.applyOptions({ width: containerRef.current?.clientWidth });
      updateBaseLineX();
    });
    ro.observe(containerRef.current);
    chart.applyOptions({ width: containerRef.current.clientWidth });

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

      // 첫 번째 시리즈의 기준점을 공통 수직선으로 사용
      if (idx === 0) baseTimeRef.current = basePoint.time;

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
    <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: chartHeight }} />

      {/* 공통 기준점 수직 점선 (FinanceChart 동일 스타일) */}
      {baseLineX != null && (
        <div style={{
          position: 'absolute', top: 0, bottom: timeScaleHeight,
          left: baseLineX, width: 0,
          borderLeft: '1.5px dashed #6B625B',
          pointerEvents: 'none', zIndex: 5,
        }}>
          <div style={{
            position: 'absolute', top: 7, right: 6,
            background: 'rgba(107,98,91,0.75)', color: '#fff',
            fontSize: '0.50rem', fontWeight: 700,
            borderRadius: 4, padding: '1px 5px',
            textAlign: 'center', lineHeight: 1.4, whiteSpace: 'nowrap',
          }}>
            100%<br />
            {baseTimeRef.current
              ? (() => { const d = new Date(baseTimeRef.current); return `${d.getFullYear()}/${d.getMonth() + 1}`; })()
              : ''}
          </div>
        </div>
      )}

      {/* 툴팁 */}
      {tooltip && Object.keys(tooltip.vals).length > 0 && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          background: 'rgba(31,29,27,0.88)', color: '#fff',
          borderRadius: 8, padding: '5px 10px',
          fontSize: '0.78rem', fontWeight: 700,
          pointerEvents: 'none', zIndex: 20, lineHeight: 1.8,
        }}>
          <div style={{ color: '#C9BFB4', marginBottom: 2 }}>
            {typeof tooltip.time === 'object'
              ? `${tooltip.time.year}/${String(tooltip.time.month).padStart(2, '0')}`
              : String(tooltip.time).slice(0, 7).replace('-', '/')}
          </div>
          {series.map((s, idx) => {
            const v = tooltip.vals[s.id];
            if (v == null) return null;
            return (
              <div key={s.id}>
                <span style={{ color: SERIES_COLORS[idx % SERIES_COLORS.length] }}>
                  {trimAptName(s.kaptName)} {s.area}㎡
                </span>
                {' '}{Math.round(v)}%
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────
export default function ChartPanel({ isOpen = false, favApts = [], removeFavoriteApt, isMobile = false, isTablet = false }) {
  const [activeKey, setActiveKey]   = useState(null);
  const [normMonthsAgo, setNormMonthsAgo] = useState(12); // 기본: 12개월(1년) 전 = 100%
  const [pressedNorm, setPressedNorm]     = useState(null); // 'back' | 'forward' | null

  const [areasByKey, setAreasByKey]     = useState({});
  const [hotAreasByKey, setHotAreasByKey] = useState({});
  const [loadingKey, setLoadingKey]     = useState(null);
  const [errMsg, setErrMsg]             = useState('');

  // 누적 시리즈: [{ id, key, kaptName, area, x, y, ptsX, ptsY, pPtsX, pPtsY }]
  const [series, setSeries] = useState([]);

  const { scrollRef: areaScrollRef, dragRef, onMouseDown: onAreaMouseDown, onMouseMove: onAreaMouseMove, onMouseUp: onAreaMouseUp } = useAreaDragScroll();

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

      // Hot 순위 계산 (거래량 집계 — 면적 탭 표시용, 그래프와 무관)
      const cutoff = (() => {
        const d = new Date(); d.setFullYear(d.getFullYear() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();
      const pnuStr  = pnu ? String(pnu) : null;
      const normName = fav.kaptName ? normAptNm(fav.kaptName) : null;
      const volMap  = new Map();

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
    } catch {
      setErrMsg('실거래 데이터를 불러오지 못했습니다.');
    }
  };

  const padding = isMobile ? '14px 16px' : isTablet ? '16px 20px' : '20px 24px';

  return (
    <aside style={{ ...commonPanelStyle, boxSizing: 'border-box' }}>

      {/* ── 헤더 ── */}
      <div style={commonHeaderStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#1F1D1B', flex: 1 }}>
          <span style={{ color: '#6B625B' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
              <polyline points="3,17 8,10 12,13 16,7 21,9"/>
              <line x1="3" y1="21" x2="21" y2="21"/>
              <line x1="3" y1="21" x2="3" y2="4"/>
            </svg>
          </span>
          즐겨찾기 단지 비교
        </span>
        <button
          onClick={() => {/* 차후 구현 */}}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: '1.5px solid #E6DED4', borderRadius: 8,
            padding: '0 12px', height: 34, cursor: 'pointer',
            fontSize: '0.82rem', fontWeight: 600, color: '#6B625B', flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
            <path d="M22 2L11 13"/>
            <path d="M22 2L15 22 11 13 2 9l20-7z"/>
          </svg>
          게시판 글로 보내기
        </button>
      </div>

      {/* ── 콘텐츠 영역 ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding, boxSizing: 'border-box' }}>

      {/* ── 즐겨찾기 단지 목록 ── */}
      {favApts.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', padding: '0 2px' }}>
          <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {favApts.map(fav => {
              const isActive = fav.key === activeKey;
              return (
                <div key={fav.key} onClick={async () => { setActiveKey(fav.key); await loadAreas(fav); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 4px', cursor: 'pointer' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: isActive ? '#6B625B' : '#C9BFB4', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.78rem', fontWeight: isActive ? 700 : 400, color: isActive ? '#1F1D1B' : '#888780', whiteSpace: 'nowrap' }}>
                    {trimAptName(fav.kaptName)}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavoriteApt?.(fav.key);
                      if (activeKey === fav.key) setActiveKey(null);
                      setSeries(prev => prev.filter(s => s.key !== fav.key));
                    }}
                    style={{ fontSize: '0.6rem', color: '#C9BFB4', cursor: 'pointer', lineHeight: 1 }}
                    title="즐겨찾기 삭제"
                  >✕</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ color: '#C9BFB4', fontSize: '0.9rem', padding: '4px 0' }}>추가된 아파트가 없습니다.</div>
      )}

      {/* ── 면적 선택 탭 ── */}
      {activeFav && (
        <div style={{
          flexShrink: 0,
          marginLeft: isMobile ? -16 : isTablet ? -20 : -24,
          paddingLeft: isMobile ? 16 : isTablet ? 20 : 24,
        }}>
          <div style={{ fontSize: '0.72rem', color: '#888780', marginBottom: 4 }}>
            전용면적 선택 <span style={{ color: '#6B625B', fontWeight: 600 }}>{trimAptName(activeFav.kaptName)}</span>
          </div>
          <div
            ref={areaScrollRef}
            className="chart-area-tab-scroll"
            onMouseDown={onAreaMouseDown}
            onMouseMove={onAreaMouseMove}
            onMouseUp={onAreaMouseUp}
            onMouseLeave={onAreaMouseUp}
            style={{
              display: 'flex', gap: 0,
              overflowX: 'auto', overflowY: 'visible',
              borderBottom: '1px solid #E6DED4',
              cursor: dragRef.current?.down ? 'grabbing' : 'grab',
              userSelect: 'none', touchAction: 'pan-x',
              paddingBottom: 4,
            }}
          >
            {loadingKey === activeKey ? (
              <span style={{ padding: '6px 10px', color: '#6B625B', fontSize: '0.82rem' }}>로딩…</span>
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
                      color: inSeries ? '#1F1D1B' : '#888780',
                      borderBottom: inSeries ? '2px solid #1F1D1B' : '2px solid transparent',
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
      )}

      {!activeFav && favApts.length > 0 && (
        <div style={{ fontSize: '0.78rem', color: '#C9BFB4' }}>위에서 단지를 클릭하면 면적을 선택할 수 있습니다.</div>
      )}

      {/* ── 활성 시리즈 범례 ── */}
      {series.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', flex: 1 }}>
            {series.map((s, idx) => (
              <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 600, color: '#1F1D1B' }}>
                <span style={{ width: 12, height: 2, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2, flexShrink: 0 }} />
                <span>{trimAptName(s.kaptName)} {s.area}㎡</span>
                <button onClick={() => setSeries(prev => prev.filter(x => x.id !== s.id))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#C9BFB4', lineHeight: 1, padding: 0, fontSize: '0.6rem' }}
                  title="그래프에서 제거">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── G1: 실거래 평균가 ── */}
      <div style={{ borderTop: '1px solid #E6DED4', paddingTop: 8 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1F1D1B', marginBottom: 4 }}>
          실거래 평균가 <span style={{ color: '#6B625B', fontWeight: 600 }}>단위: 억원</span>
        </div>
        {series.length > 0 ? (
          <MultiSeriesTradeChart series={series} isMobile={isMobile} />
        ) : (
          <div style={{ height: isMobile ? Math.round(window.innerWidth * (2 / 3)) : 280, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F3EE', borderRadius: 8, color: '#C9BFB4', fontSize: '0.85rem' }}>
            면적을 선택하면 차트가 표시됩니다
          </div>
        )}
        {/* G1 범례 */}
        {series.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '4px 0 0' }}>
            {series.map((s, idx) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 700, color: '#1F1D1B' }}>
                <span style={{ width: 16, height: 2, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2 }} />
                {trimAptName(s.kaptName)} {s.area}㎡
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── G2: 정규화 비교 ── */}
      <div style={{ borderTop: '1px solid #E6DED4', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1F1D1B' }}>
            정규화 비교 : 시점 <span style={{ color: '#6B625B' }}>{baseLabel}</span>
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
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
                border: pressedNorm === 'back' ? '1.5px solid #6B625B' : '1px solid #C9BFB4',
                background: pressedNorm === 'back' ? '#6B625B' : '#F7F3EE',
                color: pressedNorm === 'back' ? '#fff' : canGoBack ? '#6B625B' : '#C9BFB4',
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
                border: pressedNorm === 'forward' ? '1.5px solid #6B625B' : '1px solid #C9BFB4',
                background: pressedNorm === 'forward' ? '#6B625B' : '#F7F3EE',
                color: pressedNorm === 'forward' ? '#fff' : canGoForward ? '#6B625B' : '#C9BFB4',
                fontWeight: 700, fontSize: '0.72rem', cursor: canGoForward ? 'pointer' : 'default',
              }}
            >+3월</button>
          </div>
        </div>

        {series.length > 0 ? (
          <NormCompareChart series={series} normMonthsAgo={normMonthsAgo} isMobile={isMobile} />
        ) : (
          <div style={{ height: isMobile ? Math.round(window.innerWidth * (2 / 3)) : 280, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F3EE', borderRadius: 8, color: '#C9BFB4', fontSize: '0.85rem' }}>
            면적을 선택하면 차트가 표시됩니다
          </div>
        )}
        {/* G2 범례 */}
        {series.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '4px 0 0' }}>
            {series.map((s, idx) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 700, color: '#1F1D1B' }}>
                <span style={{ width: 16, height: 2, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2 }} />
                {trimAptName(s.kaptName)} {s.area}㎡
              </span>
            ))}
          </div>
        )}
      </div>

      </div>{/* ── 콘텐츠 영역 끝 ── */}
    </aside>
  );
}
