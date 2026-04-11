// src/pages/LeftPanel.js
import FinanceChart from './FinanceChart';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts';
import { ymToDate, dateToISOYM } from '../utils/dateUtils';
import { trimAptName } from '../utils/aptNameUtils';
import {
  buildPNU, fetchWorkbook, fetchPdata, fetchKaptDetail, listAreasForPnu,
  aggregateTradesForArea, pickInitialArea, groupAreasToRep, normAptNm,
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
@keyframes favHighlightBg {
  0%   { background: #C9A84C40; }
  40%  { background: #C9A84C28; }
  100% { background: transparent; }
}
@keyframes favHighlightText {
  0%   { color: #8a6200; }
  40%  { color: #8a6200; }
  100% { color: #888780; }
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
    rightPriceScale: { borderColor: '#E6DED4' },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  };
}

// ────────────────────────────────────────────
// 아파트 거래 차트 컴포넌트
// ────────────────────────────────────────────
function AptTradeChart({ x, vol, avg, ptsX, ptsY, pPtsX, pPtsY, yearWindow, isMobile }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const volSeriesRef = useRef(null);
  const avgSeriesRef = useRef(null);
  const svgRef       = useRef(null);

  const [chartHeight, setChartHeight] = useState(isMobile ? 200 : 240);

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

  // chartHeight 변경 시 차트에 반영
  useEffect(() => {
    chartRef.current?.applyOptions({ height: chartHeight });
  }, [chartHeight]);

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

    // 평균가 라인
    const avgSeries = chart.addSeries(LineSeries, {
      color: 'rgba(196, 154, 42, 0.7)',
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
      chart.applyOptions({ width: w });
      setChartHeight(Math.max(160, Math.round(w * 0.5)));
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

    // 거래량 데이터
    const volData = x.map((ym, i) => ({
      time: toTime(ym),
      value: vol[i] || 0,
      color: 'rgba(196, 154, 42, 0.35)',
    })).sort((a, b) => a.time > b.time ? 1 : -1);
    volSeriesRef.current?.setData(volData);

    // 평균가 데이터 (0 제외)
    const avgData = x.map((ym, i) => ({
      time: toTime(ym),
      value: avg[i] || null,
    })).filter(d => d.value).sort((a, b) => a.time > b.time ? 1 : -1);
    avgSeriesRef.current?.setData(avgData);

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
  }, [x, vol, avg, yearWindow]); // eslint-disable-line react-hooks/exhaustive-deps

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


  // 선택 아파트 관련 상태
  const [pnu, setPnu] = useState(null);
  const [pnuErr, setPnuErr] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [kaptDetailRow, setKaptDetailRow] = useState(null);
  const [favToast, setFavToast] = useState(null); // { type: 'added'|'removed', x, y, key }
  const favBtnRef  = useRef(null);
  const chartHeaderRef = useRef(null); // AptTradeChart 범례 높이 감지용
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
        const { parseCSV } = await import('../utils/csvUtils');
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
      pdWbRef.current    = null;
      wbRef.current      = null;
      pnuIdxRef.current  = null;
      nameIdxRef.current = null;
      pdNameIdxRef.current = null;
      setHotAreas([]);
      setTradeErr(null);
      setKaptDetailRow(null);
      if (!selectedApt) return;

      const { pnu: _pnu } = buildPNU(selectedApt);
      setPnu(_pnu);

      const bjdCode = String(selectedApt['bjdCode'] || '').trim();
      const code5 = bjdCode.slice(0, 5);
      const as1 = selectedApt['as1'] || '', as2 = selectedApt['as2'] || '';

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
        });
        if (!cancelled) {
          setX(agg.x); setVol(agg.vol); setAvg(agg.avg);
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
      ['사용승인일',   fmtDate(pickList('kaptUsedate'))],
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
      ['단지면적',     fmtArea(pickList('kaptTarea'))],
      ['동 수',        pickList('kaptDongCnt') ? `${pickList('kaptDongCnt')}동` : null],
      ['최고층',       pickList('kaptTopFloor') ? `${pickList('kaptTopFloor')}층` : null],
      ['지하층',       pickList('kaptBaseFloor') ? `${pickList('kaptBaseFloor')}층` : null],
      ['관리직원수',   pickDetail('kaptMgrCnt') ? `${pickDetail('kaptMgrCnt')}명` : null],
      ['관리회사',     pickDetail('kaptCcompany')],
      ['경비원수',     pickDetail('kaptdScnt') ? `${pickDetail('kaptdScnt')}명` : null],
      ['경비용역사',   pickDetail('kaptdSecCom')],
      ['청소부수',     pickDetail('kaptdClcnt') ? `${pickDetail('kaptdClcnt')}명` : null],
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
  const padding = isCompact ? '16px 20px' : '20px 24px';

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
                  addFavoriteApt(selectedApt, areas, hotAreas);
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
          </div>
        )}

        {/* 추가정보 버튼 — 아파트 선택 시만 */}
        {selectedApt && (
          <div style={{ flexShrink: 0 }}>
            <button
              onClick={() => setShowInfo(p => !p)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              title="추가정보"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7.5" stroke={showInfo ? '#6B625B' : '#aaa'} strokeWidth="1.3"/>
                <line x1="9" y1="8" x2="9" y2="13" stroke={showInfo ? '#6B625B' : '#aaa'} strokeWidth="1.4" strokeLinecap="round"/>
                <circle cx="9" cy="5.5" r="0.9" fill={showInfo ? '#6B625B' : '#aaa'}/>
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

      {/* ── 단지 정보 팝업 (패널 전체 너비) ── */}
      {selectedApt && showInfo && (
        <div style={{
          position: 'absolute', top: 52, left: 0, right: 0, zIndex: 100,
          background: '#fff', borderBottom: '1.5px solid #E6DED4',
          boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          maxHeight: 'calc(100% - 52px)', overflowY: 'auto',
          padding: '14px 18px',
          fontFamily: 'Pretendard, -apple-system, sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="1" y="9" width="8" height="10" rx="0.8" fill="#C9BFB4"/>
                <rect x="11" y="5" width="8" height="14" rx="0.8" fill="#9E9589"/>
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
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#4A4540', letterSpacing: '0.02em' }}>단지 정보</span>
            </span>
            <span onClick={() => setShowInfo(false)} style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#C9BFB4', fontWeight: 700, lineHeight: 1 }}>✕</span>
          </div>
          {infoPairs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {infoPairs.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: '0.7rem', color: '#B4AFA8', fontWeight: 600, flexShrink: 0, minWidth: 72 }}>{k}</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1F1D1B', wordBreak: 'break-word', lineHeight: 1.4 }}>{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.75rem', color: '#C9BFB4', textAlign: 'center', padding: '12px 0' }}>정보 없음</div>
          )}
        </div>
      )}

      {/* ── 콘텐츠 영역 ── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 14,
        padding,
        boxSizing: 'border-box',
      }}>

      {pnuErr && <div style={{ color: '#c33', fontSize: '0.88rem' }}>{pnuErr}</div>}

      {/* ── 면적선택 영역 ── */}
      {selectedApt && (
        <div style={{ flexShrink: 0, padding: '0 2px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            {/* 노란 세로 바 */}
            <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.72rem', color: '#888780', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#C9BFB4' }} />
                전용면적 선택 {areaRangeText && <span>{areaRangeText}</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                {areas.map((a) => {
                  const active  = selArea === a;
                  const hotRank = hotAreas.indexOf(a);
                  const hotLabel = hotRank === 0 ? 'Hot1' : hotRank === 1 ? 'Hot2' : null;
                  return (
                    <div
                      key={a}
                      onClick={() => handleAreaClick(a)}
                      style={{
                        padding: '6px 10px',
                        fontSize: '0.78rem',
                        fontWeight: active ? 700 : 400,
                        color: active ? '#1F1D1B' : '#888780',
                        borderBottom: active ? '2px solid #1F1D1B' : '2px solid transparent',
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
              <div ref={chartHeaderRef} style={{ display: 'flex', gap: 12, padding: '2px 10px 6px', flexWrap: 'wrap', fontSize: '0.78rem', fontWeight: 800, color: '#1F1D1B' }}>
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

            {/* 차트 영역 — 높이는 AptTradeChart 내부에서 동적 관리 */}
            <div style={{ position: 'relative' }}>
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
                  x={x} vol={vol} avg={avg}
                  ptsX={ptsX} ptsY={ptsY}
                  pPtsX={pPtsX} pPtsY={pPtsY}
                  yearWindow={yearWindow}
                  isMobile={false}
                />
              )}
            </div>
          </>
        ) : (
          /* TODO: 광고 또는 공지 컴포넌트로 교체 */
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: '#F7F3EE', color: '#C9BFB4', fontSize: '0.85rem' }}>
            지도에서 아파트를 클릭하면 거래 차트를 확인할 수 있어요
          </div>
        )}

        {/* 즐겨찾기 단지 */}
        {favApts.length > 0 && (
          <div style={{ padding: '4px 2px 0' }}>
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
                        animation: isNew ? 'favHighlightBg 2s ease-out forwards' : 'none',
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
                        animation: isNew ? 'favHighlightText 2s ease-out forwards' : 'none',
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
      </div>

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
