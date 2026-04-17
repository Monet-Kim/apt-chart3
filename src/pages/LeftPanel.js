// src/pages/LeftPanel.js
import FinanceChart from './FinanceChart';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts';
import { ymToDate, dateToISOYM } from '../styles/dateUtils';
import { getChartHeight, CHART_WIDTH_RATIO, OVERLAY_LEFT_W, OVERLAY_RIGHT_W } from '../styles/chartHeight';
import { trimAptName } from '../styles/aptNameUtils';
import {
  buildPNU, fetchWorkbook, fetchPdata, fetchKaptDetail, listAreasForPnu,
  aggregateTradesForArea, pickInitialArea, groupAreasToRep, normAptNm,
  clearTradeCacheForPnu, parseDoroKey,
} from './services/aptData';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';
import { cssVar } from '../styles/themes';
import { PickButton, FavChip } from '../components/FavoriteButton';


/* 면적 탭 스크롤바 스타일 (webkit) */
const areaScrollbarStyle = `
.area-tab-scroll::-webkit-scrollbar { height: 3px; }
.area-tab-scroll::-webkit-scrollbar-track { background: transparent; }
.area-tab-scroll::-webkit-scrollbar-thumb { background: var(--color-scrollbar); border-radius: 2px; }
.area-tab-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-scrollbar-hover); }
`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('area-scroll-style');
  if (!s) { s = document.createElement('style'); s.id = 'area-scroll-style'; document.head.appendChild(s); }
  s.textContent = areaScrollbarStyle;
}

/* Hot 레이블 흔들림 애니메이션 */
const hotKeyframes = `
@keyframes hotWiggle {
  0%   { transform:  scale(1);   }
  25%  { transform:  scale(1); }
  50%  { transform:  scale(1);   }
  75%  { transform:  scale(1); }
  100% { transform:  scale(1);   }
}
@keyframes favHighlightBg {
  0%   { background: rgba(140,88,96,0.40); }
  40%  { background: rgba(140,88,96,0.35); }
  100% { background: transparent; }
}
@keyframes favHighlightText {
  0%   { color: #8a6200; }
  40%  { color: #8a6200; }
  100% { color: var(--color-text-muted); }
}
`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('hot-wiggle-style');
  if (!s) { s = document.createElement('style'); s.id = 'hot-wiggle-style'; document.head.appendChild(s); }
  s.textContent = hotKeyframes;
}

// ────────────────────────────────────────────
// 공통 차트 옵션 (FinanceChart와 동일한 스타일)
// ────────────────────────────────────────────
function makeChartOptions(height, width = 800) {
  return {
    height,
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
      minBarSpacing: 1,
      tickMarkFormatter: (time, tickMarkType) => {
        const d = typeof time === 'object'
          ? new Date(time.year, time.month - 1, time.day)
          : new Date(time);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        if (tickMarkType >= 2) return `${yyyy}/${mm}/${dd}`;
        return `${yyyy}/${mm}`;
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

// ────────────────────────────────────────────
// L1: 아파트 실거래 평균가 + 거래량 + dot 차트
// ────────────────────────────────────────────
export function AptTradeChart({ x, vol, avg, ptsX, ptsY, pPtsX, pPtsY, yearWindow, isMobile, aptName, selArea, compact = false, theme = '' }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const volSeriesRef = useRef(null);
  const avgSeriesRef = useRef(null);
  const svgRef       = useRef(null);

  const COMPACT_H = 130;
  const [chartHeight, setChartHeight] = useState(compact ? COMPACT_H : getChartHeight(isMobile, window.innerWidth));

  // x: ["2020-01", ...] → "YYYY-MM-01" 형태로 변환
  function toTime(ym) {
    return ym.length === 7 ? `${ym}-01` : ym;
  }

  // "YYYY-MM" → 밀리초 (Y축 범위 계산용)
  const ymToMs = (ym) => new Date(ym + '-01').getTime();

  // 현재 visible range 기준으로 dots + avg Y범위 동적 계산
  const dataRef = useRef({ x: [], avg: [], ptsX: [], ptsY: [], pPtsX: [], pPtsY: [] });
  dataRef.current = { x, avg, ptsX, ptsY, pPtsX, pPtsY };

  // autoscaleInfoProvider: 호출 시마다 현재 visible range에서 Y범위 계산
  const yProviderRef = useRef(null);
  if (!yProviderRef.current) {
    yProviderRef.current = () => {
      const chart = chartRef.current;
      if (!chart) return null;
      const vr = chart.timeScale().getVisibleRange();
      if (!vr) return null;
      const fromMs = new Date(vr.from).getTime();
      const toMs   = new Date(vr.to  ).getTime();
      const { x: dx, avg: da, ptsX: dpx, ptsY: dpy, pPtsX: dppx, pPtsY: dppy } = dataRef.current;
      const ys = [];
      for (let i = 0; i < dx.length; i++) {
        const ms = ymToMs(dx[i]);
        if (ms >= fromMs && ms <= toMs && Number.isFinite(da[i])) ys.push(da[i]);
      }
      for (let i = 0; i < dpx.length; i++) {
        if (ymToMs(dpx[i]) >= fromMs && ymToMs(dpx[i]) <= toMs) ys.push(dpy[i]);
      }
      for (let i = 0; i < dppx.length; i++) {
        if (ymToMs(dppx[i]) >= fromMs && ymToMs(dppx[i]) <= toMs) ys.push(dppy[i]);
      }
      if (!ys.length) return null;
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      const pad = (hi - lo) * 0.10 || hi * 0.10;
      return { priceRange: { minValue: lo - pad, maxValue: hi + pad }, margins: { above: 0, below: 0 } };
    };
  }

  // 항상 최신 props를 참조하도록 ref로 관리
  const redrawDotsRef = useRef(null);
  redrawDotsRef.current = () => {
    const svg = svgRef.current;
    const chart = chartRef.current;
    if (!svg || !chart) return;

    // 데이터 없으면 SVG만 비우고 조기 종료
    if (!ptsX?.length && !pPtsX?.length) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      return;
    }

    const visibleRange = chart.timeScale().getVisibleRange();
    if (!visibleRange) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', chartHeight);

    const drawDots = (xs, ys, shape) => {
      xs.forEach((xVal, i) => {
        const timeStr = toTime(xVal);
        if (visibleRange && (timeStr < visibleRange.from || timeStr > visibleRange.to)) return;

        const xCoord = chart.timeScale().timeToCoordinate(timeStr);
        const yCoord = avgSeriesRef.current
          ? avgSeriesRef.current.priceToCoordinate(ys[i])
          : null;
        if (xCoord == null || yCoord == null) return;

        if (shape === 'circle') {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', xCoord);
          circle.setAttribute('cy', yCoord);
          circle.setAttribute('r', 3);
          circle.setAttribute('fill', cssVar('--color-accent') + 'AA');
          circle.setAttribute('stroke', 'none');
          circle.setAttribute('stroke-width', '0');
          svg.appendChild(circle);
        } else if (shape === 'triangle') {
          const size = 4;
          const cx = xCoord, cy = yCoord;
          const points = `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly.setAttribute('points', points);
          poly.setAttribute('fill', cssVar('--color-accent') + 'AA');
          poly.setAttribute('stroke', 'none');
          poly.setAttribute('stroke-width', '0');
          svg.appendChild(poly);
        }
      });
    };

    drawDots(ptsX, ptsY, 'circle');
    if (pPtsX?.length) drawDots(pPtsX, pPtsY, 'triangle');
  };

  // chartHeight 변경 시 차트에 반영
  useEffect(() => {
    chartRef.current?.applyOptions({ height: chartHeight });
  }, [chartHeight]);

  // 테마 변경 시 색상 재적용 — applyTheme 이후 CSS 변수 읽도록 RAF 사용
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      avgSeriesRef.current?.applyOptions({ color: cssVar('--color-accent') });
      volSeriesRef.current?.applyOptions({ color: cssVar('--color-accent') + 'AA' });
      redrawDotsRef.current?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // 차트 초기화
  useEffect(() => {
    if (!containerRef.current) return;
    const initW = containerRef.current.clientWidth;
    const chart = createChart(containerRef.current, {
      ...makeChartOptions(chartHeight, initW),
      leftPriceScale: { visible: false },
      rightPriceScale: {
        visible: true,
        borderColor: cssVar('--color-border'),
        scaleMargins: { top: 0, bottom: 0 },
      },
      ...(compact && {
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        crosshair: {
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
        handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: { time: false, price: false } },
      }),
    });
    chartRef.current = chart;

    // 거래량 히스토그램 — compact 모드에서는 생략
    if (!compact) {
      const volSeries = chart.addSeries(HistogramSeries, {
        color: cssVar('--color-accent') + 'AA',
        priceScaleId: 'vol',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.75, bottom: 0 },
      });
      volSeriesRef.current = volSeries;
    }

    // 평균가 라인
    const avgSeries = chart.addSeries(LineSeries, {
      color: cssVar('--color-accent'),
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
    avgSeriesRef.current = avgSeries;

    // Y축 자동 스케일: 동적 provider 설정
    avgSeries.applyOptions({ autoscaleInfoProvider: yProviderRef.current });

    // X축 변경(팬/줌) 시 Y축 재계산 트리거
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (avgSeriesRef.current) {
        avgSeriesRef.current.applyOptions({ autoscaleInfoProvider: yProviderRef.current });
      }
    });

    // X/Y축 변경 모두 대응 — RAF 루프 (항상 최신 ref 호출)
    let rafId;
    const loop = () => {
      redrawDotsRef.current?.();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // ResizeObserver
    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.clientWidth || 0;
      const fontSize = w < 400 ? 9 : w < 600 ? 10 : 11;
      chart.applyOptions({ width: w, layout: { fontSize } });
      if (!compact) setChartHeight(getChartHeight(isMobile, w));
      redrawDotsRef.current?.();
    });
    ro.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      volSeriesRef.current = null;
      avgSeriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터 변경 시 시리즈 업데이트
  useEffect(() => {
    if (!chartRef.current || !x.length) return;

    // 거래량 데이터 — compact 모드에서는 생략
    if (!compact && volSeriesRef.current) {
      const volData = x.map((ym, i) => ({
        time: toTime(ym),
        value: vol[i] || 0,
        color: cssVar('--color-accent') + 'AA',
      })).sort((a, b) => a.time > b.time ? 1 : -1);
      volSeriesRef.current.setData(volData);
    }

    // 평균가 데이터 (0 제외)
    const avgData = x.map((ym, i) => ({
      time: toTime(ym),
      value: avg[i] || null,
    })).filter(d => d.value).sort((a, b) => a.time > b.time ? 1 : -1);
    avgSeriesRef.current?.setData(avgData);

    // X축 범위 + Y축 범위 설정
    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date();
      start.setFullYear(start.getFullYear() - yearWindow);
      const startStr = start.toISOString().slice(0, 10);
      try {
        chartRef.current.timeScale().setVisibleRange({ from: startStr, to: today });
      } catch {
        chartRef.current.timeScale().fitContent();
      }
      redrawDotsRef.current?.();
    });
  }, [x, vol, avg, yearWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  // yearWindow 변경 시 X축 범위 업데이트 (Y축은 subscribeVisibleTimeRangeChange가 자동 처리)
  useEffect(() => {
    if (!chartRef.current || !x.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date();
    start.setFullYear(start.getFullYear() - yearWindow);
    const startStr = start.toISOString().slice(0, 10);
    try {
      chartRef.current.timeScale().setVisibleRange({ from: startStr, to: today });
    } catch {
      chartRef.current.timeScale().fitContent();
    }
    requestAnimationFrame(() => redrawDotsRef.current?.());
  }, [yearWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ width: compact ? '100%' : `${CHART_WIDTH_RATIO * 100}%`, margin: '0 auto' }}>
    {aptName && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: compact ? 'flex-start' : 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: '0.92rem', fontWeight: 500, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trimAptName(aptName)}</span>
        {selArea && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{selArea.toFixed(1)}㎡</span>}
      </div>
    )}
    <div style={{ position: 'relative', width: '100%', height: chartHeight, border: compact ? 'none' : '1px solid var(--color-border)', borderRadius: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: chartHeight }} />
      {/* SVG overlay — dot 렌더링 */}
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />
      {/* 스크롤 양보 오버레이: canvas 위에 올려 wheel/touch를 부모로 버블업 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: OVERLAY_LEFT_W, height: '100%', zIndex: 10 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: OVERLAY_RIGHT_W, height: '100%', zIndex: 10 }} />
    </div>
    {/* 범례 — compact 모드에서는 생략 */}
    {!compact && x.length > 0 && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '4px 0 0' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
          <span style={{ width: 12, height: 12, background: 'var(--color-accent)', opacity: 0.67, display: 'inline-block', borderRadius: 2 }} />
          거래량
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
          <span style={{ width: 16, height: 2, background: 'var(--color-accent)', display: 'inline-block', borderRadius: 2 }} />
          평균가
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill="var(--color-accent)" opacity="0.67" />
          </svg>
          실거래
        </span>
        {pPtsX?.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-main)' }}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polygon points="5,1 0,9 10,9" fill="var(--color-accent)" opacity="0.67" />
            </svg>
            입주권
          </span>
        )}
      </div>
    )}
    </div>
  );
}

// ────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────
function LeftPanel({ selectedApt, onPanTo, onSelectApt, favApts, addFavoriteApt, removeFavoriteApt, onOpenChartPanel, onClose, isMobile = false, isTablet = false, onOpenMap, onChartData, isVisible = false, theme = 'rose_slate' }) {
  const aptKey = selectedApt
    ? `${selectedApt.kaptName}_${selectedApt.bjdCode || ''}`
    : null;

  const isFav = aptKey ? favApts.some(a => a.key === aptKey) : false;

  const scrollRef = useRef(null);
  useEffect(() => {
    if (selectedApt && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [aptKey]);

  // 검색
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);


  // 선택 아파트 관련 상태
  const [pnu, setPnu] = useState(null);
  const [pnuErr, setPnuErr] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [kaptDetailRow, setKaptDetailRow] = useState(null);
  const [areas, setAreas] = useState([]);
  const [selArea, setSelArea] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingTrade, setLoadingTrade] = useState(false);
  const [tradeErr, setTradeErr] = useState(null);

  // 차트 데이터
  const [x, setX] = useState([]);
  const [vol, setVol] = useState([]);
  const [avg, setAvg] = useState([]);
  const [ptsX, setPtsX] = useState([]);
  const [ptsY, setPtsY] = useState([]);
  const [pPtsX, setPPtsX] = useState([]);
  const [pPtsY, setPPtsY] = useState([]);

  // 차트 데이터 리프팅 — 지도탭 compact 차트에서 재사용
  useEffect(() => {
    onChartData?.({ x, vol, avg, ptsX, ptsY, pPtsX, pPtsY, selArea, aptName: selectedApt?.kaptName ?? null });
  }, [x, vol, avg, ptsX, ptsY, pPtsX, pPtsY, selArea, selectedApt?.kaptName]); // eslint-disable-line react-hooks/exhaustive-deps

  // workbook refs
  const pdWbRef      = useRef(null);
  const wbRef        = useRef(null);
  const pnuIdxRef    = useRef(null); // Rdata pnu 인덱스
  const nameIdxRef   = useRef(null); // Rdata aptNm 인덱스
  const pdNameIdxRef = useRef(null); // Pdata aptNm 인덱스
  const roadIdxRef   = useRef(null); // Rdata road 인덱스
  const pdRoadIdxRef = useRef(null); // Pdata road 인덱스
  const roadKeyRef   = useRef(null); // 현재 아파트 road 키

  // Hot 면적
  const [hotAreas, setHotAreas] = useState([]);

  // 스무딩 윈도우
  const [smoothWindow, setSmoothWindow] = useState(3);

  // X축 기간
  const [yearWindow, setYearWindow] = useState(5);

  // Kakao Places 준비
  const placesRef = useRef(null);
  useEffect(() => {
    if (window.kakao?.maps?.services && !placesRef.current) {
      placesRef.current = new window.kakao.maps.services.Places();
    }
  }, []);

  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef(null);

  // 검색
  const handleSearch = (e) => {
    e?.preventDefault?.();
    const q = searchInput.trim();
    if (!q || !placesRef.current) return;
    placesRef.current.keywordSearch(q, (data, status) => {
      if (status !== window.kakao.maps.services.Status.OK) { setSuggestions([]); return; }
      setSuggestions(data.slice(0, 8));
    });
  };

  const handleSuggestionClick = async (item) => {
    const lat = parseFloat(item.y), lng = parseFloat(item.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // 1) 지도 이동
    onPanTo?.(lat, lng);
    setSuggestions([]);
    setShowSearch(false);
    setSearchInput('');

    // 2) 카카오 역지오코딩으로 code5 추출 → CSV 로드 → 좌표 매칭
    try {
      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.coord2RegionCode(lng, lat, async (res, status) => {
        if (status !== window.kakao.maps.services.Status.OK || !res?.length) return;
        const b = res.find(r => r.region_type === 'B') || res[0];
        const code5 = (b.code || '').slice(0, 5);
        const s1 = b.region_1depth_name || '';
        const s2 = b.region_2depth_name || '';
        if (!code5 || !s1 || !s2) return;

        const R2_BASE = process.env.NODE_ENV === 'production'
          ? 'https://pub-8c65c427a291446c9384665be9201bea.r2.dev'
          : '';

        // code5_map.json으로 정확한 파일명 조회
        let fileName = `${R2_BASE}/KaptList/${s1}_${s2}_${code5}_list_coord.csv`;
        try {
          const mapRes = await fetch(`${R2_BASE}/KaptList/code5_map.json`, { cache: 'no-store' });
          if (mapRes.ok) {
            const mapJson = await mapRes.json();
            if (mapJson?.[code5]) fileName = `${R2_BASE}/KaptList/${mapJson[code5]}`;
          }
        } catch { /* 폴백 파일명 사용 */ }

        const csvRes = await fetch(fileName, { cache: 'no-store' });
        if (!csvRes.ok) return;
        const { parseCSV } = await import('../styles/csvUtils');
        const rows = parseCSV(await csvRes.text()).map(row => ({
          ...row,
          위도: parseFloat(row['위도']),
          경도: parseFloat(row['경도']),
        }));

        // 검색 좌표와 가장 가까운 아파트 찾기 (300m 이내)
        let best = null, bestDist = Infinity;
        for (const row of rows) {
          if (!Number.isFinite(row['위도']) || !Number.isFinite(row['경도'])) continue;
          const dLat = row['위도'] - lat;
          const dLng = row['경도'] - lng;
          const dist = Math.sqrt(dLat * dLat + dLng * dLng);
          if (dist < bestDist) { bestDist = dist; best = row; }
        }

        // 약 300m 이내 (위경도 0.003 ≈ 300m)
        if (best && bestDist < 0.003) {
          onSelectApt?.(best);
        }
      });
    } catch { /* 매칭 실패 시 지도 이동만 */ }
  };

  // 선택 아파트 변경 시
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPnu(null); setPnuErr(null);
      setAreas([]); setSelArea(null);
      setX([]); setVol([]); setAvg([]); setPtsX([]); setPtsY([]);
      setPPtsX([]); setPPtsY([]);
      pdWbRef.current      = null;
      wbRef.current        = null;
      pnuIdxRef.current    = null;
      nameIdxRef.current   = null;
      pdNameIdxRef.current = null;
      roadIdxRef.current   = null;
      pdRoadIdxRef.current = null;
      roadKeyRef.current   = null;
      setHotAreas([]);
      setTradeErr(null);
      setKaptDetailRow(null);
      if (!selectedApt) return;

      const { pnu: _pnu } = buildPNU(selectedApt);
      setPnu(_pnu);

      const bjdCode = String(selectedApt['bjdCode'] || '').trim();
      const code5 = bjdCode.slice(0, 5);
      const as1 = selectedApt['as1'] || '', as2 = selectedApt['as2'] || '';
      const as3 = selectedApt['as3'] || '', as4 = selectedApt['as4'] || '';
      const _roadKey = parseDoroKey(selectedApt['doroJuso'] || '', as1, as2, as3, as4);
      roadKeyRef.current = _roadKey;

      // KaptDetail 비동기 로드 (실패해도 무시)
      fetchKaptDetail(as1, as2, code5)
        .then(map => {
          if (cancelled) return;
          const kaptCode = String(selectedApt['kaptCode'] || '').trim();
          setKaptDetailRow(map.get(kaptCode) ?? null);
        })
        .catch(() => {});

      setLoadingInfo(true);
      try {
        const [rResult, pResult] = await Promise.allSettled([
          fetchWorkbook(as1, as2, code5),
          fetchPdata(as1, as2, code5),
        ]);
        if (cancelled) return;
        if (rResult.status === 'rejected') throw rResult.reason;

        const { wb, pnuIndex, nameIndex, roadIndex } = rResult.value;
        const _pdWb        = pResult.status === 'fulfilled' ? pResult.value?.wb        ?? null : null;
        const _pdNameIndex = pResult.status === 'fulfilled' ? pResult.value?.nameIndex ?? null : null;
        const _pdRoadIndex = pResult.status === 'fulfilled' ? pResult.value?.roadIndex ?? null : null;
        pdWbRef.current      = _pdWb;
        wbRef.current        = wb;
        pnuIdxRef.current    = pnuIndex    ?? null;
        nameIdxRef.current   = nameIndex   ?? null;
        pdNameIdxRef.current = _pdNameIndex;
        roadIdxRef.current   = roadIndex   ?? null;
        pdRoadIdxRef.current = _pdRoadIndex;

        const rawList = listAreasForPnu(wb, _pnu, selectedApt['kaptName'] || null, _pdWb,
          _roadKey, roadIndex, nameIndex, pnuIndex);
        if (!rawList.length) { setPnuErr('data가 없습니다_면적 후보 없음'); return; }

        const repAreas = groupAreasToRep(rawList);
        setAreas(repAreas);

        // Hot 면적 집계
        let hot1Area = null;
        {
          const cutoff = (() => {
            const d = new Date();
            d.setFullYear(d.getFullYear() - 3);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          })();
          const pnuStr = _pnu ? String(_pnu) : null;
          const normName = selectedApt['kaptName'] ? normAptNm(selectedApt['kaptName']) : null;
          const volMap = new Map();

          for (const obj of (wb || [])) {
            const match =
              (pnuStr && String(obj.pnu).trim() === pnuStr) ||
              (normName && normAptNm(obj.aptNm) === normName);
            if (!match) continue;
            const yy = String(obj.dealYear || '').padStart(4, '0');
            const mm = String(obj.dealMonth || '').padStart(2, '0');
            if (`${yy}-${mm}` < cutoff) continue;
            const ar = parseFloat(obj.excluUseAr);
            if (!Number.isFinite(ar)) continue;
            const rep = repAreas.find(r => Math.abs(r - ar) <= (r <= 85 ? 0.9 : r * 0.01));
            if (rep == null) continue;
            volMap.set(rep, (volMap.get(rep) || 0) + 1);
          }

          for (const obj of (_pdWb || [])) {
            if (parseFloat(obj.isCanceled) === 1) continue;
            if (normName && normAptNm(obj.aptNm) !== normName) continue;
            const yy = String(obj.dealYear || '').padStart(4, '0');
            const mm = String(obj.dealMonth || '').padStart(2, '0');
            if (`${yy}-${mm}` < cutoff) continue;
            const ar = parseFloat(obj.excluUseAr);
            if (!Number.isFinite(ar)) continue;
            const rep = repAreas.find(r => Math.abs(r - ar) <= (r <= 85 ? 0.9 : r * 0.01));
            if (rep == null) continue;
            volMap.set(rep, (volMap.get(rep) || 0) + 1);
          }

          const sorted = [...volMap.entries()].sort((a, b) => b[1] - a[1]);
          setHotAreas(sorted.slice(0, 2).map(([area]) => area));
          hot1Area = sorted[0]?.[0] ?? null;
        }

        const initArea = hot1Area ?? pickInitialArea(repAreas);
        setSelArea(initArea);

        setLoadingTrade(true);
        const agg = aggregateTradesForArea({
          wb, pdWb: _pdWb, pnu: _pnu,
          kaptName: selectedApt['kaptName'] || null,
          areaNorm: initArea, smoothWindow,
          pnuIndex, nameIndex, pdNameIndex: _pdNameIndex,
          roadKey: _roadKey, roadIndex, pdRoadIndex: _pdRoadIndex,
        });
        if (!cancelled) {
          setX(agg.x); setVol(agg.vol); setAvg(agg.avg);
          setPtsX(agg.ptsX); setPtsY(agg.ptsY);
          setPPtsX(agg.pPtsX); setPPtsY(agg.pPtsY);
          setYearWindow(5);
        }

        // 백그라운드: 구형 연도 로드 완료 후 차트 조용히 갱신
        const rVal = rResult.value;
        if (!cancelled && rVal.isPartial && rVal.fullPromise) {
          rVal.fullPromise.then((fullWb) => {
            if (cancelled || !fullWb) return;
            wbRef.current      = fullWb.wb;
            pnuIdxRef.current  = fullWb.pnuIndex;
            nameIdxRef.current = fullWb.nameIndex;
            clearTradeCacheForPnu(_pnu);
            const aggFull = aggregateTradesForArea({
              wb: fullWb.wb, pdWb: pdWbRef.current,
              pnu: _pnu,
              kaptName: selectedApt['kaptName'] || null,
              areaNorm: initArea, smoothWindow,
              pnuIndex: fullWb.pnuIndex,
              nameIndex: fullWb.nameIndex,
              pdNameIndex: pdNameIdxRef.current,
              roadKey: roadKeyRef.current,
              roadIndex: fullWb.roadIndex,
              pdRoadIndex: pdRoadIdxRef.current,
            });
            setX(aggFull.x); setVol(aggFull.vol); setAvg(aggFull.avg);
            setPtsX(aggFull.ptsX); setPtsY(aggFull.ptsY);
            setPPtsX(aggFull.pPtsX); setPPtsY(aggFull.pPtsY);
          }).catch(() => {});
        }
      } catch {
        if (!cancelled) setPnuErr('data가 없습니다_엑셀파일 미존재');
      } finally {
        if (!cancelled) { setLoadingInfo(false); setLoadingTrade(false); }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [selectedApt]);

  // smoothWindow 변경 시 재집계
  useEffect(() => {
    if (!selectedApt || selArea === null) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingTrade(true);
        const bjdCode = String(selectedApt['bjdCode'] || '').trim();
        const { wb } = await fetchWorkbook(selectedApt['as1'] || '', selectedApt['as2'] || '', bjdCode.slice(0, 5));
        const agg = aggregateTradesForArea({
          wb, pdWb: pdWbRef.current, pnu,
          kaptName: selectedApt['kaptName'] || null,
          areaNorm: selArea, smoothWindow,
          pnuIndex: pnuIdxRef.current, nameIndex: nameIdxRef.current, pdNameIndex: pdNameIdxRef.current,
          roadKey: roadKeyRef.current, roadIndex: roadIdxRef.current, pdRoadIndex: pdRoadIdxRef.current,
        });
        if (!cancelled) {
          setX(agg.x); setVol(agg.vol); setAvg(agg.avg);
          setPtsX(agg.ptsX); setPtsY(agg.ptsY);
          setPPtsX(agg.pPtsX); setPPtsY(agg.pPtsY);
        }
      } finally {
        if (!cancelled) setLoadingTrade(false);
      }
    })();
    return () => { cancelled = true; };
  }, [smoothWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  // 면적 클릭 시 재집계
  const handleAreaClick = async (area) => {
    setSelArea(area);
    setTradeErr(null);
    if (!selectedApt) return;
    try {
      setLoadingTrade(true);
      const bjdCode = String(selectedApt['bjdCode'] || '').trim();
      const { wb } = await fetchWorkbook(selectedApt['as1'] || '', selectedApt['as2'] || '', bjdCode.slice(0, 5));
      const agg = aggregateTradesForArea({
        wb, pdWb: pdWbRef.current, pnu,
        kaptName: selectedApt['kaptName'] || null,
        areaNorm: area, smoothWindow,
        pnuIndex: pnuIdxRef.current, nameIndex: nameIdxRef.current, pdNameIndex: pdNameIdxRef.current,
        roadKey: roadKeyRef.current, roadIndex: roadIdxRef.current, pdRoadIndex: pdRoadIdxRef.current,
      });
      setX(agg.x); setVol(agg.vol); setAvg(agg.avg);
      setPtsX(agg.ptsX); setPtsY(agg.ptsY);
      setPPtsX(agg.pPtsX); setPPtsY(agg.pPtsY);
      setYearWindow(5);
    } catch {
      setTradeErr('data가 없습니다_해당 pnu 거래 없음');
    } finally {
      setLoadingTrade(false);
    }
  };

  const changeYearWindow = (delta) => {
    if (!x.length) return;
    setYearWindow(prev => Math.max(1, prev + delta));
  };

  const infoPairs = useMemo(() => {
    if (!selectedApt) return [];
    const pickList = (k) => {
      const v = selectedApt[k];
      return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
    };
    const pickDetail = (k) => {
      if (!kaptDetailRow) return null;
      const v = kaptDetailRow[k];
      return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
    };
    const fmtDate = (v) => {
      if (!v || v.length !== 8) return v;
      return `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6, 8)}`;
    };
    const ageStr = (v) => {
      if (!v || v.length !== 8) return '';
      const y = parseInt(v.slice(0, 4), 10);
      const m = parseInt(v.slice(4, 6), 10);
      if (isNaN(y) || isNaN(m)) return '';
      const now = new Date();
      const total = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
      if (total <= 0) return '';
      const yrs = Math.floor(total / 12);
      const mos = total % 12;
      if (yrs === 0) return ` (${mos}개월)`;
      if (mos === 0) return ` (${yrs}년)`;
      return ` (${yrs}년${mos}개월)`;
    };
    const fmtArea = (v) => {
      if (!v) return null;
      const n = parseFloat(v);
      return Number.isFinite(n) ? `${n.toLocaleString()}㎡` : v;
    };
    const 총주차대수 = (() => {
      const a = parseFloat(pickDetail('kaptdPcnt') || '');
      const b = parseFloat(pickDetail('kaptdPcntu') || '');
      if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
      const total = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
      const units = parseFloat(pickList('kaptdaCnt') || '');
      const perUnit = (Number.isFinite(units) && units > 0) ? (total / units).toFixed(1) : null;
      return perUnit ? `${total} (세대당 ${perUnit})` : String(total);
    })();
    const 승강기수 = (() => {
      const cnt = parseFloat(pickDetail('kaptdEcnt') || '');
      if (!Number.isFinite(cnt)) return null;
      const dong = parseFloat(pickList('kaptDongCnt') || '');
      const perDong = (Number.isFinite(dong) && dong > 0) ? (cnt / dong).toFixed(1) : null;
      return perDong ? `${cnt}대 (${perDong}/동)` : `${cnt}대`;
    })();
    const CCTV수 = (() => {
      const cnt = parseFloat(pickDetail('kaptdCccnt') || '');
      if (!Number.isFinite(cnt)) return null;
      const area = parseFloat(pickList('kaptTarea') || '');
      const per = (Number.isFinite(area) && area > 0) ? (cnt / area * 10000).toFixed(1) : null;
      return per ? `${cnt} (1만㎡당 ${per}대)` : String(cnt);
    })();
    const 전기차충전기 = (() => {
      const a = parseFloat(pickDetail('groundElChargerCnt') || '');
      const b = parseFloat(pickDetail('undergroundElChargerCnt') || '');
      if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
      return `${(Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0)}대`;
    })();
    const 전기용량 = (() => {
      const cap = parseFloat(pickDetail('kaptdEcapa') || '');
      if (!Number.isFinite(cap)) return null;
      const units = parseFloat(pickList('kaptdaCnt') || '');
      const perUnit = (Number.isFinite(units) && units > 0) ? (cap / units).toFixed(1) : null;
      return perUnit ? `${cap.toLocaleString()} (세대당 ${perUnit}kW)` : cap.toLocaleString();
    })();
    return [
      ['사용승인일',   fmtDate(pickList('kaptUsedate')) ? fmtDate(pickList('kaptUsedate')) + ageStr(pickList('kaptUsedate')) : null],
      ['건물유형',     pickList('codeAptNm')],
      ['세대수',       pickList('kaptdaCnt') ? `${String(pickList('kaptdaCnt')).replace(/\.0+$/, '')}세대` : null],
      ['총주차대수',   총주차대수],
      ['분양유형',     pickList('codeSaleNm')],
      ['난방',         pickList('codeHeatNm')],
      ['시행사',       pickList('kaptAcompany')],
      ['시공사',       pickList('kaptBcompany')],
      ['승강기수',     승강기수],
      ['구조',         pickList('codeHallNm')],
      ['CCTV수',       CCTV수],
      ['전기차충전기', 전기차충전기],
      ['주소(지번)',   (() => { const v = pickList('kaptAddr'); const n = pickList('kaptName'); return (v && n) ? v.replace(new RegExp('\\s*' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim() : v; })()],
      ['주소(도로명)', (() => { const v = pickList('doroJuso'); const n = pickList('kaptName'); return (v && n) ? v.replace(new RegExp('\\s*' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim() : v; })()],
      ['우편번호',     pickList('zipcode')],
      ['연면적',       fmtArea(pickList('kaptTarea'))],
      ['동 수',        pickList('kaptDongCnt') ? `${pickList('kaptDongCnt')}동` : null],
      ['최고층',       pickList('kaptTopFloor') ? `${pickList('kaptTopFloor')}층` : null],
      ['지하층',       pickList('kaptBaseFloor') ? `${pickList('kaptBaseFloor')}층` : null],
      ['관리직원수',   (() => { const cnt = parseFloat(pickDetail('kaptMgrCnt') || ''); if (!Number.isFinite(cnt)) return null; const units = parseFloat(pickList('kaptdaCnt') || ''); const per = (Number.isFinite(units) && units > 0) ? (cnt / units).toFixed(2).replace(/\.?0+$/, '') : null; return per ? `${cnt}명 (세대당 ${per}명)` : `${cnt}명`; })()],
      ['관리회사',     pickDetail('kaptCcompany')],
      ['경비원수',     (() => { const cnt = parseFloat(pickDetail('kaptdScnt') || ''); if (!Number.isFinite(cnt)) return null; const units = parseFloat(pickList('kaptdaCnt') || ''); const per = (Number.isFinite(units) && units > 0) ? (cnt / units).toFixed(2).replace(/\.?0+$/, '') : null; return per ? `${cnt}명 (세대당 ${per}명)` : `${cnt}명`; })()],
      ['경비용역사',   pickDetail('kaptdSecCom')],
      ['청소부수',     (() => { const cnt = parseFloat(pickDetail('kaptdClcnt') || ''); if (!Number.isFinite(cnt)) return null; const units = parseFloat(pickList('kaptdaCnt') || ''); const per = (Number.isFinite(units) && units > 0) ? (cnt / units).toFixed(2).replace(/\.?0+$/, '') : null; return per ? `${cnt}명 (세대당 ${per}명)` : `${cnt}명`; })()],
      ['전기용량(kW)', 전기용량],
      ['화재경보기',   pickDetail('codeFalarm')],
      ['복지시설',     pickDetail('welfareFacility')],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  }, [selectedApt, kaptDetailRow]);

  const areaRangeText = useMemo(() => {
    if (!areas.length) return '';
    return `${Math.min(...areas).toFixed(1)}~${Math.max(...areas).toFixed(1)}㎡`;
  }, [areas]);

  const isCompact = isMobile || isTablet;
  const padding = isMobile ? '14px 16px' : isTablet ? '16px 20px' : '20px 24px';

  return (
    <aside style={{
      ...commonPanelStyle,
      borderRight: '1.5px solid var(--color-border)',
      borderRadius: 0,
      boxShadow: 'none',
    }}>
      {/* ── 상단 헤더: 아파트명 + 아이콘 버튼들 ── */}
      <div style={commonHeaderStyle}>

        {/* 지도 아이콘 */}
        <span
          style={{
            color: 'rgba(255,255,255,0.9)',
            flexShrink: 0,
            cursor: (isMobile || isTablet) ? 'pointer' : 'default',
            borderRadius: 6,
            padding: 2,
            display: 'flex', alignItems: 'center',
          }}
          onClick={(isMobile || isTablet) ? onOpenMap : undefined}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="6" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
            <line x1="2" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
            <line x1="10" y1="6" x2="10" y2="22" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
            <path d="M16 0C13.2 0 11 2.2 11 5c0 3.5 5 9 5 9s5-5.5 5-9c0-2.8-2.2-5-5-5z" fill="currentColor"/>
            <circle cx="16" cy="5" r="1.8" fill="white"/>
          </svg>
        </span>

        {/* 아파트명 or placeholder */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedApt ? (
            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 800, fontSize: '1.25rem', color: '#fff' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {trimAptName(selectedApt.kaptName)}
              </span>
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 800, fontSize: '1.25rem', color: 'rgba(255,255,255,0.45)' }}>
              아파트를 선택하세요
            </span>
          )}
        </div>

        {/* 추가정보 버튼 — 아파트 선택 시만 */}
        {selectedApt && (
          <div style={{ flexShrink: 0 }}>
            <button
              onClick={() => setShowInfo(p => !p)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              title="추가정보"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7.5" stroke={showInfo ? '#fff' : 'rgba(255,255,255,0.75)'} strokeWidth="1.3"/>
                <line x1="9" y1="8" x2="9" y2="13" stroke={showInfo ? '#fff' : 'rgba(255,255,255,0.75)'} strokeWidth="1.4" strokeLinecap="round"/>
                <circle cx="9" cy="5.5" r="0.9" fill={showInfo ? '#fff' : 'rgba(255,255,255,0.75)'}/>
              </svg>
            </button>
          </div>
        )}

        {/* 검색 아이콘 */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => {
              setShowSearch(v => {
                const next = !v;
                if (next) setTimeout(() => searchInputRef.current?.focus(), 50);
                else { setSearchInput(''); setSuggestions([]); }
                return next;
              });
            }}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            title="검색"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3"/>
              <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          {showSearch && (
            <>
              <input
                ref={searchInputRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') { setShowSearch(false); setSearchInput(''); setSuggestions([]); } }}
                placeholder="아파트, 주소, 역, 학교 검색"
                style={{
                  position: 'absolute', top: '110%', right: 0, zIndex: 99,
                  width: 220, height: 34, padding: '0 12px',
                  border: '1.5px solid var(--color-border)', borderRadius: 10,
                  fontSize: '0.9rem', outline: 'none', background: 'var(--color-surface)',
                }}
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: 'calc(110% + 38px)', right: 0, width: 240, background: 'var(--color-surface)', border: '1px solid #dbe5f5', borderRadius: 10, boxShadow: '0 4px 16px 0 #dbe5f533', zIndex: 99, listStyle: 'none', margin: 0, padding: 0 }}>
                  {suggestions.map((item) => (
                    <li key={item.id} onClick={() => { handleSuggestionClick(item); setShowSearch(false); setSearchInput(''); }} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid var(--color-border)', color: '#222' }}>
                      {item.place_name} <span style={{ color: 'var(--color-text-disabled)', fontSize: '0.82rem' }}>({item.address_name})</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

      </div>


      {/* ── 단지 정보 팝업 (패널 전체 너비) ── */}
      {selectedApt && showInfo && (
        <div style={{
          position: 'absolute', top: 52, left: 0, right: 0, zIndex: 100,
          background: 'var(--color-surface)', borderBottom: '1.5px solid var(--color-border)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          maxHeight: 'calc(100% - 52px)', overflowY: 'auto',
          padding: '14px 18px',
          fontFamily: 'Pretendard, -apple-system, sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="1" y="9" width="8" height="10" rx="0.8" fill="var(--color-text-disabled)"/>
                <rect x="11" y="5" width="8" height="14" rx="0.8" fill="var(--color-text-faint)"/>
                <rect x="3" y="11" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="6" y="11" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="3" y="14" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="6" y="14" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="13" y="7" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="16" y="7" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="13" y="10" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="16" y="10" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="13" y="13" width="2" height="2" rx="0.3" fill="#fff"/>
                <rect x="16" y="13" width="2" height="2" rx="0.3" fill="#fff"/>
              </svg>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--color-text-main)', letterSpacing: '0.02em' }}>단지 정보</span>
            </span>
            <span onClick={() => setShowInfo(false)} style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-disabled)', fontWeight: 700, lineHeight: 1 }}>✕</span>
          </div>
          {infoPairs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--color-border)', marginTop: 6 }}>
              {infoPairs.map(([k, v], i) => {
                const rowBg = i % 2 === 0 ? 'var(--color-surface-2)' : 'var(--color-surface-3)';
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', background: rowBg, borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600, flexShrink: 0, width: 80, padding: '7px 8px', lineHeight: 1.35 }}>{k}</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--color-text-main)', wordBreak: 'keep-all', overflowWrap: 'break-word', lineHeight: 1.4, padding: '7px 8px', borderLeft: '1px solid var(--color-border)', flex: 1 }}>{v}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-disabled)', textAlign: 'center', padding: '12px 0' }}>정보 없음</div>
          )}
        </div>
      )}

      {/* ── 콘텐츠 영역 ── */}
      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        scrollbarGutter: 'stable',
        display: 'flex',
        flexDirection: 'column', gap: 14,
        padding,
        boxSizing: 'border-box',
      }}>

      {pnuErr && <div style={{ color: '#c33', fontSize: '0.88rem' }}>{pnuErr}</div>}

      {/* ── 면적선택 영역 ── */}
      {selectedApt && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          {/* 노란 세로 바 */}
          <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 즐겨찾기 버튼 array */}
            {favApts.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {favApts.map(fav => {
                  const isActive = fav.key === aptKey;
                  return (
                    <FavChip
                      key={fav.key}
                      fav={fav}
                      isActive={isActive}
                      theme={theme}
                      onClick={() => { onSelectApt?.(fav); if (fav.위도 && fav.경도) onPanTo?.(fav.위도, fav.경도); }}
                      onRemove={(key) => removeFavoriteApt(key)}
                    />
                  );
                })}
              </div>
            )}
            {/* 전용면적 선택 */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--color-text-disabled)' }} />
                전용면적 선택 {areaRangeText && <span>{areaRangeText}</span>}
              </div>
              <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
                {areas.map((a) => {
                  const active  = selArea === a;
                  const hotRank = hotAreas.indexOf(a);
                  const hotLabel = hotRank === 0 ? 'Hot1' : hotRank === 1 ? 'Hot2' : null;
                  return (
                    <div
                      key={a}
                      onClick={() => handleAreaClick(a)}
                      style={{
                        flex: '0 0 auto', padding: '6px 10px',
                        fontSize: '0.78rem',
                        fontWeight: active ? 700 : 400,
                        color: active ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                        borderBottom: active ? '2px solid var(--color-text-main)' : '2px solid transparent',
                        marginBottom: -1, cursor: 'pointer',
                        position: 'relative', whiteSpace: 'nowrap', transition: 'color 0.1s',
                      }}
                    >
                      {a.toFixed(1)}㎡
                      {hotLabel && (
                        <span style={{
                          position: 'absolute', top: 0, right: 2,
                          color: '#b35a00', fontSize: '0.62rem', fontWeight: 900,
                          pointerEvents: 'none', transform: 'rotate(-12deg)',
                          transformOrigin: 'center center', lineHeight: 1,
                        }}>
                          {hotLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 그래프 영역 — 항상 고정 높이로 공간 확보 (미선택 시 광고/공지 placeholder) ── */}
      <div style={{
        width: '100%',
        flexShrink: 0,
        background: 'var(--color-surface)',
        borderRadius: 8,
        border: '0px solid var(--color-border)',
        marginTop: 4,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {selectedApt ? (
          <>
            {/* X축 기간 조정 — 데이터 있을 때만 */}
            {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
              <div style={{ flex: '0 0 auto', display: 'none', alignItems: 'center', gap: 6, padding: '6px 10px 4px', fontSize: '0.78rem', color: 'var(--color-text-sub)' }}>
                <span style={{ minWidth: 76, fontWeight: 700, color: 'var(--color-text-main)' }}>X축 기간 조정</span>
                <button onClick={() => changeYearWindow(-1)} style={{ height: 28, padding: '0 10px', border: '1px solid var(--color-text-disabled)', borderRadius: 6, background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text-sub)' }}>– 1년</button>
                <span style={{ minWidth: 44, textAlign: 'center' }}>최근 {yearWindow}년</span>
                <button onClick={() => changeYearWindow(+1)} style={{ height: 28, padding: '0 10px', border: '1px solid var(--color-text-disabled)', borderRadius: 6, background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text-sub)' }}>+ 1년</button>
              </div>
            )}

            {/* ── L1: 아파트 실거래 평균가 ── */}
            <div style={{ position: 'relative' }}>
              {(loadingTrade || loadingInfo) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-sub)', fontSize: '0.85rem' }}>
                  로딩 중…
                </div>
              )}
              {tradeErr && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c33', fontSize: '0.85rem' }}>
                  {tradeErr}
                </div>
              )}
              {!tradeErr && (
                <AptTradeChart
                  x={x} vol={vol} avg={avg}
                  ptsX={ptsX} ptsY={ptsY}
                  pPtsX={pPtsX} pPtsY={pPtsY}
                  yearWindow={yearWindow}
                  isMobile={false}
                  aptName={selectedApt?.kaptName}
                  selArea={selArea}
                />
              )}
            </div>
          </>
        ) : (
          /* TODO: 광고 또는 공지 컴포넌트로 교체 */
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'var(--color-bg)', color: 'var(--color-text-disabled)', fontSize: '0.85rem' }}>
            지도에서 아파트를 클릭하면 거래 차트를 확인할 수 있어요
          </div>
        )}

      </div>

      {isVisible && (
        <FinanceChart
          isMobile={isMobile}
          aptX={x}
          aptAvg={avg}
          aptName={selectedApt ? `${trimAptName(selectedApt.kaptName)} ${selArea}㎡` : null}
          onOpenChartPanel={onOpenChartPanel}
          theme={theme}
        />
      )}

      </div>{/* ── 콘텐츠 영역 끝 ── */}

    </aside>
  );
}

export default LeftPanel;
