// src/pages/LeftPanel.js
import FinanceChart from './FinanceChart';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createChart, LineSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import { ymToDate, dateToISOYM } from '../utils/dateUtils';
import { trimAptName } from '../utils/aptNameUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import {
  buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu,
  aggregateTradesForArea, pickInitialArea, groupAreasToRep, normAptNm,
  kaptListUrlByCode5, fetchKaptListRows,
} from './services/aptData';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';

/* 면적 탭 스크롤바 스타일 (webkit) */
const areaScrollbarStyle = `
.area-tab-scroll::-webkit-scrollbar { height: 3px; }
.area-tab-scroll::-webkit-scrollbar-track { background: transparent; }
.area-tab-scroll::-webkit-scrollbar-thumb { background: #D3D1C7; border-radius: 2px; }
.area-tab-scroll::-webkit-scrollbar-thumb:hover { background: #B4B2A9; }
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
@keyframes favFloat {
  0%   { opacity: 1; transform: translateY(0px);   }
  100% { opacity: 0; transform: translateY(-80px); }
}
@keyframes favHighlightBg {
  0%   { background: #b35a00; }
  100% { background: transparent; }
}
@keyframes favHighlightText {
  0%   { color: #ffffff; }
  100% { color: inherit; }
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
function makeChartOptions(height) {
  return {
    height,
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

// ────────────────────────────────────────────
// 아파트 거래 차트 컴포넌트
// ────────────────────────────────────────────
function AptTradeChart({ x, vol, avg, realMask, ptsX, ptsY, pPtsX, pPtsY, yearWindow, isMobile }) {
  const containerRef    = useRef(null);
  const chartRef        = useRef(null);
  const volSeriesRef    = useRef(null);
  const avgSeriesRef    = useRef(null);  // 실선 (실데이터)
  const avgDashSeriesRef = useRef(null); // 점선 (보간)
  const svgRef          = useRef(null);

  const chartHeight = isMobile ? 200 : 240;

  // x: ["2020-01", ...] → "YYYY-MM-01" 형태로 변환
  function toTime(ym) {
    return ym.length === 7 ? `${ym}-01` : ym;
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
          circle.setAttribute('fill', 'rgba(196, 154, 42, 0.40)');
          circle.setAttribute('stroke', 'none');
          circle.setAttribute('stroke-width', '0');
          svg.appendChild(circle);
        } else if (shape === 'triangle') {
          const size = 4;
          const cx = xCoord, cy = yCoord;
          const points = `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly.setAttribute('points', points);
          poly.setAttribute('fill', 'rgba(196, 154, 42, 0.50)');
          poly.setAttribute('stroke', 'none');
          poly.setAttribute('stroke-width', '0');
          svg.appendChild(poly);
        }
      });
    };

    drawDots(ptsX, ptsY, 'circle');
    if (pPtsX?.length) drawDots(pPtsX, pPtsY, 'triangle');
  };

  // 차트 초기화
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

    // 거래량 히스토그램 (왼쪽 overlay, 별도 price scale)
    const volSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(196, 154, 42, 0.35)',
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 }, // 하단 25%만 사용
    });
    volSeriesRef.current = volSeries;

    // 평균가 실선 (실거래 데이터)
    const avgSeries = chart.addSeries(LineSeries, {
      color: 'rgba(196, 154, 42, 0.85)',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
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

    // 평균가 점선 (보간 구간)
    const avgDashSeries = chart.addSeries(LineSeries, {
      color: 'rgba(196, 154, 42, 0.4)',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: {
        type: 'custom',
        formatter: (v) => `${v.toFixed(1)}억`,
        minMove: 0.01,
      },
    });
    avgDashSeriesRef.current = avgDashSeries;

    // X/Y축 변경 모두 대응 — RAF 루프 (항상 최신 ref 호출)
    let rafId;
    const loop = () => {
      redrawDotsRef.current?.();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // ResizeObserver
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth });
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
      avgDashSeriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터 변경 시 시리즈 업데이트
  useEffect(() => {
    if (!chartRef.current || !x.length) return;

    // 거래량 데이터
    const volData = x.map((ym, i) => ({
      time: toTime(ym),
      value: vol[i] || 0,
      color: 'rgba(196, 154, 42, 0.35)',
    })).sort((a, b) => a.time > b.time ? 1 : -1);
    volSeriesRef.current?.setData(volData);

    // 평균가: 실선(실거래) / 점선(보간) 분리
    // lightweight-charts는 null로 끊어야 구간이 분리되므로
    // 실선: 보간 구간은 null, 점선: 실거래 구간은 null
    const solidData = [], dashData = [];
    x.forEach((ym, i) => {
      const t = toTime(ym);
      const v = avg[i] || null;
      const isReal = realMask?.[i] ?? true;
      solidData.push({ time: t, value: isReal ? v : null });
      dashData.push({ time: t, value: isReal ? null : v });
    });
    const sorted = (arr) => arr.filter(d => d.value !== null && d.value !== undefined).sort((a, b) => a.time > b.time ? 1 : -1);
    avgSeriesRef.current?.setData(sorted(solidData));
    avgDashSeriesRef.current?.setData(sorted(dashData));

    // X축 범위 설정
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
  }, [x, vol, avg, realMask, yearWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  // yearWindow 변경 시 X축 범위 업데이트
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
    <div style={{ position: 'relative', width: '100%', height: chartHeight }}>
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
    </div>
  );
}

// ────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────
function LeftPanel({ selectedApt, onPanTo, onSelectApt, favApts, addFavoriteApt, removeFavoriteApt, onOpenChartPanel, isMobile = false, isTablet = false }) {
  const aptKey = selectedApt
    ? `${selectedApt.kaptName}_${selectedApt.bjdCode || ''}`
    : null;

  const isFav = aptKey ? favApts.some(a => a.key === aptKey) : false;

  // 검색
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  // 전용면적 드래그 스크롤
  const { scrollRef: areaScrollRef, dragRef, onMouseDown: onAreaMouseDown, onMouseMove: onAreaMouseMove, onMouseUp: endAreaDrag, onTouchStart: onAreaTouchStart, onTouchMove: onAreaTouchMove, onTouchEnd: endAreaTouchDrag } = useAreaDragScroll();

  // 선택 아파트 관련 상태
  const [pnu, setPnu] = useState(null);
  const [pnuErr, setPnuErr] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [favToast, setFavToast] = useState(null); // { type: 'added'|'removed', x, y, key }
  const favBtnRef  = useRef(null);
  const [areas, setAreas] = useState([]);
  const [selArea, setSelArea] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingTrade, setLoadingTrade] = useState(false);
  const [tradeErr, setTradeErr] = useState(null);

  // 차트 데이터
  const [x, setX] = useState([]);
  const [vol, setVol] = useState([]);
  const [avg, setAvg] = useState([]);
  const [realMask, setRealMask] = useState([]);
  const [ptsX, setPtsX] = useState([]);
  const [ptsY, setPtsY] = useState([]);
  const [pPtsX, setPPtsX] = useState([]);
  const [pPtsY, setPPtsY] = useState([]);

  // workbook refs
  const pdWbRef     = useRef(null);
  const wbRef       = useRef(null);
  const pnuIdxRef   = useRef(null); // Rdata pnu 인덱스
  const nameIdxRef  = useRef(null); // Rdata aptNm 인덱스
  const pdNameIdxRef = useRef(null); // Pdata aptNm 인덱스

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

        const url = await kaptListUrlByCode5(s1, s2, code5);
        const rows = await fetchKaptListRows(url);

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
      setX([]); setVol([]); setAvg([]); setRealMask([]); setPtsX([]); setPtsY([]);
      setPPtsX([]); setPPtsY([]);
      pdWbRef.current    = null;
      wbRef.current      = null;
      pnuIdxRef.current  = null;
      nameIdxRef.current = null;
      pdNameIdxRef.current = null;
      setHotAreas([]);
      setTradeErr(null);
      if (!selectedApt) return;

      const { pnu: _pnu } = buildPNU(selectedApt);
      setPnu(_pnu);

      const bjdCode = String(selectedApt['bjdCode'] || '').trim();
      const code5 = bjdCode.slice(0, 5);
      const as1 = selectedApt['as1'] || '', as2 = selectedApt['as2'] || '';
      setLoadingInfo(true);
      try {
        const [rResult, pResult] = await Promise.allSettled([
          fetchWorkbook(as1, as2, code5),
          fetchPdata(as1, as2, code5),
        ]);
        if (cancelled) return;
        if (rResult.status === 'rejected') throw rResult.reason;

        const { wb, pnuIndex, nameIndex } = rResult.value;
        const _pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;
        const _pdNameIndex = pResult.status === 'fulfilled' ? pResult.value?.nameIndex ?? null : null;
        pdWbRef.current      = _pdWb;
        wbRef.current        = wb;
        pnuIdxRef.current    = pnuIndex ?? null;
        nameIdxRef.current   = nameIndex ?? null;
        pdNameIdxRef.current = _pdNameIndex;

        const rawList = listAreasForPnu(wb, _pnu, selectedApt['kaptName'] || null, _pdWb);
        if (!rawList.length) { setPnuErr('data가 없습니다_면적 후보 없음'); return; }

        const repAreas = groupAreasToRep(rawList);
        setAreas(repAreas);

        // Hot 면적 집계
        {
          const cutoff = (() => {
            const d = new Date();
            d.setFullYear(d.getFullYear() - 1);
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
        }

        const initArea = pickInitialArea(repAreas);
        setSelArea(initArea);

        setLoadingTrade(true);
        const agg = aggregateTradesForArea({
          wb, pdWb: _pdWb, pnu: _pnu,
          kaptName: selectedApt['kaptName'] || null,
          areaNorm: initArea, smoothWindow,
          pnuIndex, nameIndex, pdNameIndex: _pdNameIndex,
        });
        if (!cancelled) {
          setX(agg.x); setVol(agg.vol); setAvg(agg.avg); setRealMask(agg.realMask ?? []);
          setPtsX(agg.ptsX); setPtsY(agg.ptsY);
          setPPtsX(agg.pPtsX); setPPtsY(agg.pPtsY);
          setYearWindow(5);
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
        });
        if (!cancelled) {
          setX(agg.x); setVol(agg.vol); setAvg(agg.avg); setRealMask(agg.realMask ?? []);
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
      });
      setX(agg.x); setVol(agg.vol); setAvg(agg.avg); setRealMask(agg.realMask ?? []);
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
    const pick = (k) => {
      const v = selectedApt[k];
      return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
    };
    return [
      ['세대', pick('kaptdaCnt')],
      ['난방', pick('codeHeatNm')],
      ['구조', pick('codeHallNm')],
    ].filter(([, v]) => v);
  }, [selectedApt]);

  const areaRangeText = useMemo(() => {
    if (!areas.length) return '';
    return `${Math.min(...areas).toFixed(1)}~${Math.max(...areas).toFixed(1)}㎡`;
  }, [areas]);

  const padding = isMobile ? '14px 16px' : isTablet ? '16px 20px' : '20px 24px';

  return (
    <aside style={{ ...commonPanelStyle, borderRight: '1.5px solid #E6DED4' }}>
      {/* ── 상단 헤더: 아파트명 + 아이콘 버튼들 ── */}
      <div style={commonHeaderStyle}>

        {/* 아파트명 or placeholder */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedApt ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#1F1D1B' }}>
              <span style={{ color: '#6B625B', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
                  <path d="M3 11L12 3l9 8"/><path d="M5 9v11h5v-5h4v5h5V9"/>
                </svg>
              </span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {trimAptName(selectedApt.kaptName)}
              </span>
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#C9BFB4' }}>
              <span style={{ flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
                  <path d="M3 11L12 3l9 8"/><path d="M5 9v11h5v-5h4v5h5V9"/>
                </svg>
              </span>
              아파트를 선택하세요
            </span>
          )}
        </div>

        {/* 즐겨찾기 별 — 아파트 선택 시만 */}
        {selectedApt && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={favBtnRef}
              onClick={() => {
                const rect = favBtnRef.current?.getBoundingClientRect();
                const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
                const y = rect ? rect.top : 200;
                if (isFav) {
                  removeFavoriteApt(aptKey);
                  setFavToast({ type: 'removed', x, y, key: null });
                } else {
                  addFavoriteApt(selectedApt);
                  setFavToast({ type: 'added', x, y, key: aptKey });
                }
                setTimeout(() => setFavToast(null), 1400);
              }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <polygon
                  points="8,2 9.8,6.5 14.5,6.5 10.8,9.5 12.2,14 8,11 3.8,14 5.2,9.5 1.5,6.5 6.2,6.5"
                  fill={isFav ? '#f5c518' : 'none'}
                  stroke={isFav ? '#f5c518' : '#aaa'}
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {favToast && (
              <span style={{
                position: 'fixed',
                left: favToast.x -90,
                top: favToast.y -55,
                transform: 'translateX(-50%)',
                color: '#b35a00', fontSize: '0.8rem', fontWeight: 900,
                whiteSpace: 'nowrap', pointerEvents: 'none',
                zIndex: 9999,
                animation: 'favFloat 2s linear forwards',
              }}>
                {favToast.type === 'added' ? '즐겨찾기 추가' : '즐겨찾기 해제'}
              </span>
            )}
          </div>
        )}

        {/* 추가정보 버튼 — 아파트 선택 시만 */}
        {selectedApt && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowInfo(p => !p)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              title="추가정보"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7.5" stroke="#aaa" strokeWidth="1.3"/>
                <line x1="9" y1="8" x2="9" y2="13" stroke="#aaa" strokeWidth="1.4" strokeLinecap="round"/>
                <circle cx="9" cy="5.5" r="0.9" fill="#aaa"/>
              </svg>
            </button>
            {showInfo && (
              <div style={{
                position: 'absolute', top: '110%', right: 0, zIndex: 100,
                background: '#fff', border: '1px solid #E6DED4', borderRadius: 12,
                boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
                padding: '12px 14px', minWidth: 220,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#6B625B' }}>추가정보</span>
                  <span onClick={() => setShowInfo(false)} style={{ cursor: 'pointer', fontSize: '0.8rem', color: '#C9BFB4', fontWeight: 700 }}>✕</span>
                </div>
                {infoPairs.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {infoPairs.map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem' }}>
                        <span style={{ color: '#6B625B', fontWeight: 800 }}>{k}</span>
                        <span style={{ fontWeight: 700, color: '#1F1D1B' }}>{k === '세대' ? String(v).replace(/\.0+$/, '') : v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#C9BFB4', textAlign: 'center' }}>정보 없음</div>
                )}
              </div>
            )}
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
              <circle cx="7" cy="7" r="4.5" stroke="#aaa" strokeWidth="1.3"/>
              <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke="#aaa" strokeWidth="1.3" strokeLinecap="round"/>
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
                  border: '1.5px solid #E6DED4', borderRadius: 10,
                  fontSize: '0.9rem', outline: 'none', background: '#fff',
                }}
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: 'calc(110% + 38px)', right: 0, width: 240, background: '#fff', border: '1px solid #dbe5f5', borderRadius: 10, boxShadow: '0 4px 16px 0 #dbe5f533', zIndex: 99, listStyle: 'none', margin: 0, padding: 0 }}>
                  {suggestions.map((item) => (
                    <li key={item.id} onClick={() => { handleSuggestionClick(item); setShowSearch(false); setSearchInput(''); }} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid #E6DED4' }}>
                      {item.place_name} <span style={{ color: '#C9BFB4', fontSize: '0.82rem' }}>({item.address_name})</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

      </div>

      {/* ── 콘텐츠 영역 ── */}
      <div style={{
        flex: 1,
        overflowY: isMobile ? 'scroll' : 'auto',
        display: 'flex', flexDirection: 'column', gap: 14,
        padding,
        boxSizing: 'border-box',
      }}>

      {pnuErr && <div style={{ color: '#c33', fontSize: '0.88rem' }}>{pnuErr}</div>}

      {/* ── 면적선택 영역 ── */}
      {selectedApt && (
        <div style={{
          flexShrink: 0,
          marginLeft: isMobile ? -16 : isTablet ? -20 : -24,
          paddingLeft: isMobile ? 16 : isTablet ? 20 : 24,
        }}>
          <div style={{ fontSize: '0.72rem', color: '#888780', marginBottom: 4 }}>
            전용면적 선택 {areaRangeText && <span>{areaRangeText}</span>}
          </div>
          <div
            ref={areaScrollRef}
            className="area-tab-scroll"
            onMouseDown={onAreaMouseDown}
            onMouseMove={onAreaMouseMove}
            onMouseUp={endAreaDrag}
            onMouseLeave={endAreaDrag}
            onTouchStart={onAreaTouchStart}
            onTouchMove={onAreaTouchMove}
            onTouchEnd={endAreaTouchDrag}
            style={{
              display: 'flex', gap: 0,
              overflowX: 'auto', overflowY: 'visible',
              borderBottom: '1px solid #E6DED4',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'thin',
              scrollbarColor: '#D3D1C7 transparent',
              cursor: dragRef.current?.down ? 'grabbing' : 'grab',
              userSelect: 'none', touchAction: 'pan-x',
              paddingBottom: 4,
            }}
          >
            {areas.map((a) => {
              const active  = selArea === a;
              const hotRank = hotAreas.indexOf(a);
              const hotLabel = hotRank === 0 ? 'Hot1' : hotRank === 1 ? 'Hot2' : null;
              return (
                <div
                  key={a}
                  onClick={() => handleAreaClick(a)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  style={{
                    flex: '0 0 auto',
                    padding: '6px 10px',
                    fontSize: '0.78rem',
                    fontWeight: active ? 700 : 400,
                    color: active ? '#1F1D1B' : '#888780',
                    borderBottom: active ? '2px solid #1F1D1B' : '2px solid transparent',
                    marginBottom: -1,
                    cursor: 'pointer',
                    position: 'relative',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.1s',
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
      )}

      {/* ── 그래프 영역 — 항상 고정 높이로 공간 확보 (미선택 시 광고/공지 placeholder) ── */}
      <div style={{
        width: '100%',
        flexShrink: 0,
        background: '#fff',
        borderRadius: 8,
        border: '0px solid #E6DED4',
        marginTop: 4,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {selectedApt ? (
          <>
            {/* X축 기간 조정 — 데이터 있을 때만 */}
            {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
              <div style={{ flex: '0 0 auto', display: 'none', alignItems: 'center', gap: 6, padding: '6px 10px 4px', fontSize: '0.78rem', color: '#6B625B' }}>
                <span style={{ minWidth: 76, fontWeight: 700, color: '#1F1D1B' }}>X축 기간 조정</span>
                <button onClick={() => changeYearWindow(-1)} style={{ height: 28, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 6, background: '#F7F3EE', cursor: 'pointer', color: '#6B625B' }}>– 1년</button>
                <span style={{ minWidth: 44, textAlign: 'center' }}>최근 {yearWindow}년</span>
                <button onClick={() => changeYearWindow(+1)} style={{ height: 28, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 6, background: '#F7F3EE', cursor: 'pointer', color: '#6B625B' }}>+ 1년</button>
              </div>
            )}

            {/* 범례 — 데이터 있을 때만 */}
            {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
              <div style={{ display: 'flex', gap: 12, padding: '2px 10px 6px', flexWrap: 'wrap', fontSize: '0.78rem', fontWeight: 800, color: '#1F1D1B' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 12, background: 'rgba(196,154,42,0.35)', display: 'inline-block', borderRadius: 2 }} />
                  거래량
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 16, height: 2, background: 'rgba(196,154,42,0.7)', display: 'inline-block', borderRadius: 2 }} />
                  평균가
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <circle cx="5" cy="5" r="4" fill="rgba(196,154,42,0.55)" stroke="rgba(196,154,42,0.85)" strokeWidth="1" />
                  </svg>
                  실거래
                </span>
                {pPtsX.length > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <polygon points="5,1 0,9 10,9" fill="rgba(196,154,42,0.55)" stroke="rgba(196,154,42,0.85)" strokeWidth="1" />
                    </svg>
                    입주권
                  </span>
                )}
              </div>
            )}

            {/* 고정 높이 차트 영역 */}
            <div style={{ height: isMobile ? 200 : 240, position: 'relative' }}>
              {(loadingTrade || loadingInfo) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B625B', fontSize: '0.85rem' }}>
                  로딩 중…
                </div>
              )}
              {tradeErr && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c33', fontSize: '0.85rem' }}>
                  {tradeErr}
                </div>
              )}
              {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
                <AptTradeChart
                  x={x} vol={vol} avg={avg} realMask={realMask}
                  ptsX={ptsX} ptsY={ptsY}
                  pPtsX={pPtsX} pPtsY={pPtsY}
                  yearWindow={yearWindow}
                  isMobile={isMobile}
                />
              )}
            </div>
          </>
        ) : (
          /* TODO: 광고 또는 공지 컴포넌트로 교체 */
          <div style={{ height: isMobile ? 200 : 240, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: '#F7F3EE', color: '#C9BFB4', fontSize: '0.85rem' }}>
            지도에서 아파트를 클릭하면 거래 차트를 확인할 수 있어요
          </div>
        )}
      </div>

      {/* 즐겨찾기 단지 */}
      {favApts.length > 0 && (
        <div style={{ padding: '0 2px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            {/* 노란 세로 바 */}
            <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
            {/* 아파트 목록 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              {favApts.map(fav => {
                const isActive = fav.key === aptKey;
                const isNew = favToast?.type === 'added' && favToast?.key === fav.key;
                return (
                  <div
                    key={fav.key}
                    onClick={() => onSelectApt?.(fav)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 6px', cursor: 'pointer', borderRadius: 6,
                      animation: isNew ? 'favHighlightBg 2s linear forwards' : 'none',
                    }}
                  >
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: isActive ? '#6B625B' : '#C9BFB4',
                    }} />
                    <span style={{
                      fontSize: '0.72rem', fontWeight: isActive ? 700 : 400,
                      color: isActive ? '#1F1D1B' : '#888780',
                      whiteSpace: 'nowrap',
                      animation: isNew ? 'favHighlightText 2s linear forwards' : 'none',
                    }}>
                      {trimAptName(fav.kaptName)}
                    </span>
                    <span
                      onClick={(e) => { e.stopPropagation(); removeFavoriteApt(fav.key); }}
                      style={{ fontSize: '0.6rem', color: '#C9BFB4', cursor: 'pointer', lineHeight: 1 }}
                    >✕</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <FinanceChart
        isMobile={isMobile}
        aptX={x}
        aptAvg={avg}
        aptName={selectedApt ? `${trimAptName(selectedApt.kaptName)} ${selArea}㎡` : null}
        onOpenChartPanel={onOpenChartPanel}
      />

      </div>{/* ── 콘텐츠 영역 끝 ── */}

    </aside>
  );
}

export default LeftPanel;
