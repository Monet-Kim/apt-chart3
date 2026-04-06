// src/pages/LeftPanel.js
import React, { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { ymToDate, dateToISOYM } from '../utils/dateUtils';
import { trimAptName } from '../utils/aptNameUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import {
  buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu,
  aggregateTradesForArea, pickInitialArea, groupAreasToRep, normAptNm,
} from './services/aptData';

/* Hot 레이블 흔들림 애니메이션 */
const hotKeyframes = `
@keyframes hotWiggle {
  0%   { transform: rotate(-12deg) scale(1);   }
  25%  { transform: rotate(-16deg) scale(1.08); }
  50%  { transform: rotate(-12deg) scale(1);   }
  75%  { transform: rotate(-8deg)  scale(1.08); }
  100% { transform: rotate(-12deg) scale(1);   }
}
`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('hot-wiggle-style');
  if (!s) { s = document.createElement('style'); s.id = 'hot-wiggle-style'; document.head.appendChild(s); }
  s.textContent = hotKeyframes;
}

function LeftPanel({ selectedApt, onPanTo, favApts, addFavoriteApt, removeFavoriteApt, onClose, onOpenChartPanel, isMobile = false, isTablet = false }) {
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
  const [pPtsX, setPPtsX] = useState([]); // Pdata 산점
  const [pPtsY, setPPtsY] = useState([]);

  // workbook refs (handleAreaClick 재사용을 위해 보관)
  const pdWbRef = React.useRef(null);
  const wbRef   = React.useRef(null);
  // 프로그래밍 방식 xRange 변경 시 onRelayout 피드백 루프 차단
  const skipRelayoutRef = React.useRef(false);

  // Hot 면적 (최근 1년 거래량 순위 1·2위)
  const [hotAreas, setHotAreas] = useState([]); // [1위면적, 2위면적]

  // 스무딩 윈도우
  const [smoothWindow, setSmoothWindow] = useState(3);

  // X/Y축 범위
  const [xRange, setXRange] = useState(null);
  const [yearWindow, setYearWindow] = useState(5);
  const [yRange, setYRange] = useState(null);

  const janLines = useMemo(() => {
    if (!x.length) return [];
    return Array.from(new Set(x.map(ym => ym.slice(0, 4)))).map(y => ({
      type: 'line', xref: 'x', yref: 'paper',
      x0: `${y}-01-01`, x1: `${y}-01-01`, y0: 0, y1: 1,
      line: { width: 1, color: 'rgba(0,0,0,0.10)' },
    }));
  }, [x]);

  // X축 범위: 현재 달 기준 최근 N년
  useEffect(() => {
    if (!x.length) return;
    const earliestDate = ymToDate(x[0]);
    const today = new Date();
    const anchor = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = new Date(anchor.getFullYear() - yearWindow, anchor.getMonth(), 1);
    skipRelayoutRef.current = true; // Plotly 피드백 루프 차단
    setXRange([dateToISOYM(start < earliestDate ? earliestDate : start), dateToISOYM(anchor)]);
  }, [x, yearWindow]);

  // Y축 초기 범위
  useEffect(() => {
    if (!x.length) return;
    const maxVol = Math.max(...vol, 0);
    setYRange([0, maxVol > 0 ? maxVol * 4 : 10]);
  }, [x, vol]);

  // Kakao Places 준비
  const placesRef = React.useRef(null);
  useEffect(() => {
    if (window.kakao?.maps?.services && !placesRef.current) {
      placesRef.current = new window.kakao.maps.services.Places();
    }
  }, []);

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

  const handleSuggestionClick = (item) => {
    const lat = parseFloat(item.y), lng = parseFloat(item.x);
    if (Number.isFinite(lat) && Number.isFinite(lng)) onPanTo?.(lat, lng);
    setSuggestions([]);
  };

  // 선택 아파트 변경 시: pnu → 면적 → 차트
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPnu(null); setPnuErr(null);
      setAreas([]); setSelArea(null);
      setX([]); setVol([]); setAvg([]); setPtsX([]); setPtsY([]);
      setPPtsX([]); setPPtsY([]);
      pdWbRef.current = null;
      wbRef.current   = null;
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
        // Rdata + Pdata 병렬 로드 (Pdata 없어도 계속 진행)
        const [rResult, pResult] = await Promise.allSettled([
          fetchWorkbook(as1, as2, code5),
          fetchPdata(as1, as2, code5),
        ]);
        if (cancelled) return;
        if (rResult.status === 'rejected') throw rResult.reason;

        const { wb } = rResult.value;
        const _pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;
        pdWbRef.current = _pdWb;
        wbRef.current   = wb;

        const rawList = listAreasForPnu(wb, _pnu, selectedApt['kaptName'] || null, _pdWb);
        if (!rawList.length) { setPnuErr('data가 없습니다_면적 후보 없음'); return; }

        const repAreas = groupAreasToRep(rawList, 0.5);
        setAreas(repAreas);

        // ── 최근 1년 면적별 거래량 집계 → Hot 순위
        {
          const cutoff = (() => {
            const d = new Date();
            d.setFullYear(d.getFullYear() - 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          })();
          const pnuStr = _pnu ? String(_pnu) : null;
          const normName = selectedApt['kaptName'] ? normAptNm(selectedApt['kaptName']) : null;
          const volMap = new Map(); // areaNorm -> count
          for (const obj of (wb || [])) {
            const match =
              (pnuStr && String(obj.pnu).trim() === pnuStr) ||
              (normName && normAptNm(obj.aptNm) === normName);
            if (!match) continue;
            const yy = String(obj.dealYear || '').padStart(4, '0');
            const mm = String(obj.dealMonth || '').padStart(2, '0');
            const ym = `${yy}-${mm}`;
            if (ym < cutoff) continue;
            const ar = parseFloat(obj.excluUseAr);
            if (!Number.isFinite(ar)) continue;
            // 대표 면적에 매핑
            const rep = repAreas.find(r => Math.abs(r - ar) <= 0.5);
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
          areaNorm: initArea, areaTol: 0.5, smoothWindow,
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

  // smoothWindow 변경 시 현재 면적으로 재집계
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
          areaNorm: selArea, areaTol: 0.5, smoothWindow,
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
        areaNorm: area, areaTol: 0.5, smoothWindow,
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

  const handleRelayout = (e) => {
    if (skipRelayoutRef.current) { skipRelayoutRef.current = false; return; }
    if (e['xaxis.range[0]'] && e['xaxis.range[1]']) {
      setXRange([e['xaxis.range[0]'], e['xaxis.range[1]']]);
    }
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
    <aside
      style={{
        width: '100%',
        background: '#fff', borderRight: '1.5px solid #E6DED4',
        padding, overflowY: isMobile ? 'scroll' : 'auto',
        display: 'flex', flexDirection: 'column', gap: 14,
        boxSizing: 'border-box', position: 'relative',
        height: '100%',
      }}
    >
      {/* 닫기 버튼 — 항상 우상단 고정, 44px 터치 타겟 */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 8, right: 8,
          width: 44, height: 44, border: 'none', background: 'none',
          cursor: 'pointer', fontSize: '1.2rem', color: '#6B625B',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8, zIndex: 2,
        }}
        title="닫기"
      >✕</button>

      {/* 검색창 — 닫기 버튼 공간(44px을 30으로 줄임) 확보를 위해 오른쪽 패딩 */}
      <form onSubmit={handleSearch} style={{ marginTop: 4, marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center', position: 'relative', paddingRight: 40 }}>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="아파트, 주소, 역, 학교 검색"
          style={{ flex: 1, height: 30, padding: '0 14px', border: '1.5px solid #E6DED4', borderRadius: 10, fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }}
          autoComplete="off"
        />
        <button
          type="submit"
          style={{ height: 30, background: '#6B625B', color: '#fff', fontWeight: 700, border: 'none', borderRadius: 10, padding: '0 18px', fontSize: '1rem', cursor: 'pointer', flexShrink: 0 }}
        >
          검색
        </button>
        {suggestions.length > 0 && (
          <ul style={{ position: 'absolute', top: '110%', left: 0, right: 40, background: '#fff', border: '1px solid #dbe5f5', borderRadius: 10, boxShadow: '0 4px 16px 0 #dbe5f533', zIndex: 99, listStyle: 'none', margin: 0, padding: 0 }}>
            {suggestions.map((item) => (
              <li key={item.id} onClick={() => handleSuggestionClick(item)} style={{ padding: '14px 14px', cursor: 'pointer', fontSize: '0.97rem', borderBottom: '1px solid #E6DED4' }}>
                {item.place_name} <span style={{ color: '#C9BFB4', fontSize: '0.88rem' }}>({item.address_name})</span>
              </li>
            ))}
          </ul>
        )}
      </form>

      {!selectedApt && <div style={{ flex: 1, background: '#fff' }} />}

      {selectedApt && (
        <>
          {/* 아파트명 + 즐겨찾기 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: '1.45rem', fontWeight: 800 }}>{trimAptName(selectedApt.kaptName)}</div>
            <button
              onClick={() => isFav ? removeFavoriteApt(aptKey) : addFavoriteApt(selectedApt)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0, padding: '4px 6px', position: 'relative', overflow: 'visible' }}
              title="단지 즐겨찾기"
            >
              <span style={{ fontSize: '1.35rem', color: isFav ? '#f5c518' : '#C9BFB4', lineHeight: 1, display: 'block' }}>{isFav ? '★' : '☆'}</span>
              <span style={{
                position: 'absolute',
                top: 3,
                right: -55,
                color: '#c0392b',
                fontSize: '0.9rem',
                fontWeight: 1000,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                transformOrigin: 'center center',
                transform: 'rotate(-12deg)',
                lineHeight: 1,
              }}>
                {isFav ? '추가완료' : '관심추가'}
              </span>
            </button>
          </div>

          {/* 기본정보 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.88rem', lineHeight: 1.4, color: '#1F1D1B', padding: '6px 10px', borderRadius: 10 }}>
            {infoPairs.map(([k, v]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ color: '#6B625B', fontWeight: 800 }}>{k}</span>
                <span style={{ color: '#1F1D1B', fontWeight: 700 }}>
                  {k === '세대' ? String(v).replace(/\.0+$/, '') : v}
                </span>
              </span>
            ))}
            <button style={{ marginLeft: 'auto', flexShrink: 0, height: 26, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 8, background: '#F7F3EE', color: '#6B625B', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>
              추가정보
            </button>
          </div>
          {pnuErr && <div style={{ color: '#c33', marginTop: 6, fontSize: '0.92rem' }}>{pnuErr}</div>}

          {/* 전용면적 선택 */}
          <div style={{ marginTop: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, justifyContent: 'center', fontWeight: 900, fontSize: '1.05rem', color: '#1F1D1B', marginBottom: 4 }}>
              <span>전용면적 선택</span>
              {areaRangeText && <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#6B625B' }}>{areaRangeText}</span>}
            </div>
            <div
              ref={areaScrollRef}
              onMouseDown={onAreaMouseDown}
              onMouseMove={onAreaMouseMove}
              onMouseUp={endAreaDrag}
              onMouseLeave={endAreaDrag}
              onTouchStart={onAreaTouchStart}
              onTouchMove={onAreaTouchMove}
              onTouchEnd={endAreaTouchDrag}
              style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'visible', padding: '14px 4px 6px', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin', cursor: dragRef.current?.down ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'pan-x', borderRadius: 10 }}
            >
              {areas.map((a) => {
                const active   = selArea === a;
                const hotRank  = hotAreas.indexOf(a); // 0=1위, 1=2위, -1=없음
                const hotLabel = hotRank === 0 ? 'Hot1' : hotRank === 1 ? 'Hot2' : null;
                const hotColor = hotRank === 0 ? '#c0392b' : '#b35a00';
                return (
                  <button
                    key={a}
                    onClick={() => handleAreaClick(a)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    style={{
                      flex: '0 0 auto',
                      minWidth: isMobile ? 45 : 55,
                      height: isMobile ? 28 : 30,
                      padding: isMobile ? '0 6px' : '0 8px',
                      borderRadius: 10,
                      fontWeight: 900,
                      fontSize: isMobile ? '0.75rem' : '0.88rem',
                      cursor: 'pointer',
                      border: active ? '2px solid #6B625B' : '1px solid #E6DED4',
                      background: active ? '#6B625B' : '#F7F3EE',
                      color: active ? '#fff' : '#1F1D1B',
                      boxShadow: active ? '0 6px 16px rgba(107,98,91,0.22)' : 'none',
                      transition: 'transform 0.08s ease',
                      position: 'relative',
                      overflow: 'visible',
                      boxSizing: 'content-box',
                    }}
                  >
                    {a.toFixed(1)}㎡
                    {hotLabel && (
                      <span style={{
                        position: 'absolute',
                        top: -5,
                        right: 30,
                        color: hotColor,
                        fontSize: '0.7rem',
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        transformOrigin: 'center center',
                        transform: 'rotate(-12deg)',
                        lineHeight: 1,
                      }}>
                        {hotLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: '0.85rem', color: '#6B625B' }}>좌우로 스와이프(드래그)해서 면적을 선택해.</div>
          </div>

          {/* 그래프 */}
          <div style={{ width: '100%', height: isMobile ? 448 : isTablet ? 300 : 500, minHeight: isMobile ? 448 : 300, flexShrink: 0, background: '#fff', borderRadius: 8, marginTop: 4, display: 'flex', flexDirection: 'column' }}>
            {(loadingTrade || loadingInfo) && <div style={{ padding: 12, color: '#6B625B' }}>로딩 중…</div>}
            {tradeErr && <div style={{ padding: 12, color: '#c33' }}>{tradeErr}</div>}

            {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
              <>
                {/* 컨트롤: X축 기간 조정 */}
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 4px', fontSize: '0.78rem', color: '#6B625B' }}>
                  <span style={{ minWidth: 76, fontWeight: 700, color: '#1F1D1B' }}>X축 기간 조정</span>
                  <button onClick={() => changeYearWindow(-1)} style={{ height: 36, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 6, background: '#F7F3EE', cursor: 'pointer' }}>– 1년</button>
                  <span style={{ minWidth: 44, textAlign: 'center' }}>최근 {yearWindow}년</span>
                  <button onClick={() => changeYearWindow(+1)} style={{ height: 36, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 6, background: '#F7F3EE', cursor: 'pointer' }}>+ 1년</button>
                </div>

                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  <div style={{ position: 'absolute', top: 4, left: 10, zIndex: 6, display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.80rem', fontWeight: 800, color: '#1F1D1B', pointerEvents: 'none', background: 'rgba(247,243,238,0.85)', padding: '2px 6px', borderRadius: 6 }}>
                    <span style={{ color: '#1f77b4' }}>■ 거래량</span>
                    <span style={{ color: '#ff7f0e' }}>━ 평균가</span>
                    <span style={{ color: '#ff7f0e' }}>● 실거래</span>
                    {pPtsX.length > 0 && <span style={{ color: '#ff7f0e' }}>▲ 입주권</span>}
                  </div>

                  <Plot
                    data={[
                      { type: 'bar', x, y: vol, name: '거래량', marker: { opacity: 0.4, color: '#1f77b4' }, yaxis: 'y1', hovertemplate: '거래량 %{y}건<extra></extra>' },
                      { type: 'scatter', mode: 'lines', x, y: avg, name: '평균가', yaxis: 'y2', line: { width: 2, color: '#ff7f0e' }, hovertemplate: '평균가 %{y:.2f}억<extra></extra>' },
                      { type: 'scatter', mode: 'markers', x: ptsX, y: ptsY, name: '실거래', yaxis: 'y2', opacity: 0.6, marker: { size: 5, color: '#ff7f0e', symbol: 'circle' }, hovertemplate: '실거래 %{y:.2f}억<extra></extra>' },
                      ...(pPtsX.length > 0 ? [{
                        type: 'scatter', mode: 'markers',
                        x: pPtsX, y: pPtsY, name: '입주권', yaxis: 'y2',
                        opacity: 0.6, marker: { size: 6, color: '#ff7f0e', symbol: 'triangle-up' },
                        hovertemplate: '입주권 %{y:.2f}억<extra></extra>',
                      }] : []),
                    ]}
                    layout={{
                      shapes: janLines,
                      margin: { t: 24, b: 70, l: 5, r: 70 },
                      dragmode: 'pan',
                      showlegend: false,
                      hovermode: 'x unified',
                      hoverlabel: { bgcolor: '#1F1D1B', bordercolor: '#6B625B', font: { color: '#fff', size: 12 }, namelength: -1 },
                      xaxis: { type: 'date', tickformat: '%Y.%m', hoverformat: '%Y년 %m월', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: '#6B625B', spikedash: 'solid', spikethickness: 1 },
                      yaxis: { ticksuffix: '건', tickfont: { size: 9 }, showgrid: false, rangemode: 'tozero', autorange: false, range: yRange || undefined, showticklabels: false, fixedrange: true, showspikes: false },
                      yaxis2: { overlaying: 'y', side: 'right', ticksuffix: '억', tickfont: { size: 9 }, rangemode: 'tozero', autorange: true, fixedrange: true, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: 'rgba(150,150,150,0.5)', spikedash: 'dot', spikethickness: 1 },
                    }}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                    config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
                    onRelayout={handleRelayout}
                  />
                </div>

              </>
            )}
          </div>
        </>
      )}

      {/* 즐겨찾기 단지 칩 — 항상 패널 하단에 표시 */}
      {favApts.length > 0 && (
        <div style={{ marginTop: 10, padding: '6px 4px' }}>
          <div
            onClick={onOpenChartPanel}
            style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 6, color: '#6B625B', cursor: 'pointer', display: 'inline-block' }}
          >⭐ 즐겨찾기 단지 차트비교</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {favApts.map(fav => (
              <div key={fav.key} style={{ padding: '4px 9px', borderRadius: 14, background: '#E6DED4', fontSize: '0.85rem', fontWeight: 600, color: '#1F1D1B' }}>
                {trimAptName(fav.kaptName)}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

export default LeftPanel;
