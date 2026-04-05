// src/pages/LeftPanel.js
import React, { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { ymToDate, dateToISOYM } from '../utils/dateUtils';
import { trimAptName } from '../utils/aptNameUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import {
  buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu,
  aggregateTradesForArea, pickInitialArea, groupAreasToRep,
} from './services/aptData';

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

  // Pdata workbook (handleAreaClick 재사용을 위해 보관)
  const pdWbRef = React.useRef(null);
  // 프로그래밍 방식 xRange 변경 시 onRelayout 피드백 루프 차단
  const skipRelayoutRef = React.useRef(false);

  // 스무딩 윈도우
  const [smoothWindow, setSmoothWindow] = useState(3);

  // X/Y축 범위
  const [xRange, setXRange] = useState(null);
  const [yearWindow, setYearWindow] = useState(5);
  const [yRange, setYRange] = useState(null);
  const [y2Range, setY2Range] = useState(null);

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
    const maxPrice = Math.max(...avg, ...ptsY, 0);
    setYRange([0, maxVol > 0 ? maxVol * 4 : 10]);
    setY2Range([0, maxPrice > 0 ? maxPrice * 1.3 : 10]);
  }, [x, vol, avg, ptsX, ptsY]);

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
      setTradeErr(null);
      if (!selectedApt) return;

      const { pnu: _pnu, reason } = buildPNU(selectedApt);
      if (!_pnu) { setPnuErr(`data가 없습니다_${reason || 'pnu 생성 실패'}`); return; }
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

        const rawList = listAreasForPnu(wb, _pnu, selectedApt['kaptName'] || null, _pdWb);
        if (!rawList.length) { setPnuErr('data가 없습니다_면적 후보 없음'); return; }

        const repAreas = groupAreasToRep(rawList, 0.5);
        setAreas(repAreas);

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
    if (!pnu || !selectedApt || selArea === null) return;
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
    if (!pnu || !selectedApt) return;
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

  const changeY2Max = (delta) => {
    setY2Range(prev => {
      if (!prev) return prev;
      const [min, max] = prev;
      return [min, Math.max(min + 1, max + delta)];
    });
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
      ['주소', pick('kaptAddr')],
      ['도로', pick('doroJuso')],
      ['세대', pick('kaptdaCnt')],
      ['난방', pick('codeHeatNm')],
      ['구조', pick('codeHallNm')],
      ['시행', pick('kaptAcompany')],
      ['시공', pick('kaptBcompany')],
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
        background: '#fff', borderRight: '1.5px solid #e0e0e0',
        padding, overflowY: 'auto',
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
          cursor: 'pointer', fontSize: '1.2rem', color: '#6476FF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8, zIndex: 2,
        }}
        title="닫기"
      >✕</button>

      {/* 검색창 — 닫기 버튼 공간(44px) 확보를 위해 오른쪽 패딩 */}
      <form onSubmit={handleSearch} style={{ marginTop: 4, marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center', position: 'relative', paddingRight: 40 }}>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="아파트, 주소, 역, 학교 검색"
          style={{ flex: 1, height: 48, padding: '0 14px', border: '1.5px solid #e0e0e0', borderRadius: 10, fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }}
          autoComplete="off"
        />
        <button
          type="submit"
          style={{ height: 48, background: '#6476FF', color: '#fff', fontWeight: 700, border: 'none', borderRadius: 10, padding: '0 18px', fontSize: '1rem', cursor: 'pointer', flexShrink: 0 }}
        >
          검색
        </button>
        {suggestions.length > 0 && (
          <ul style={{ position: 'absolute', top: '110%', left: 0, right: 40, background: '#fff', border: '1px solid #dbe5f5', borderRadius: 10, boxShadow: '0 4px 16px 0 #dbe5f533', zIndex: 99, listStyle: 'none', margin: 0, padding: 0 }}>
            {suggestions.map((item) => (
              <li key={item.id} onClick={() => handleSuggestionClick(item)} style={{ padding: '14px 14px', cursor: 'pointer', fontSize: '0.97rem', borderBottom: '1px solid #f0f4ff' }}>
                {item.place_name} <span style={{ color: '#888', fontSize: '0.88rem' }}>({item.address_name})</span>
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
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.35rem', color: isFav ? '#f5c518' : '#bbb', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              title="단지 즐겨찾기"
            >
              {isFav ? '★' : '☆'}
            </button>
          </div>

          {/* 기본정보 */}
          <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', columnGap: 8, rowGap: 6, fontSize: '0.93rem', lineHeight: 1.35, color: '#1f2b49', padding: '10px 10px', borderRadius: 10, maxHeight: 150, overflowY: 'auto' }}>
            {infoPairs.map(([k, v]) => (
              <React.Fragment key={k}>
                <div style={{ color: '#6a7692', fontWeight: 800, textAlign: 'left' }}>{k}</div>
                <div style={{ color: '#1f2b49', fontWeight: 700, textAlign: 'left', wordBreak: 'keep-all' }}>
                  {k === '세대' ? String(v).replace(/\.0+$/, '') : v}
                </div>
              </React.Fragment>
            ))}
          </div>
          {pnuErr && <div style={{ color: '#c33', marginTop: 6, fontSize: '0.92rem' }}>{pnuErr}</div>}

          {/* 전용면적 선택 */}
          <div style={{ marginTop: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, justifyContent: 'center', fontWeight: 900, fontSize: '1.05rem', color: '#1f2b49', marginBottom: 4 }}>
              <span>전용면적 선택</span>
              {areaRangeText && <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#6a7692' }}>{areaRangeText}</span>}
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
              style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', padding: '6px 4px', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin', cursor: dragRef.current?.down ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'pan-x', borderRadius: 10 }}
            >
              {areas.map((a) => {
                const active = selArea === a;
                return (
                  <button
                    key={a}
                    onClick={() => handleAreaClick(a)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    style={{ flex: '0 0 auto', minWidth: isMobile ? 56 : 72, height: isMobile ? 32 : 44, padding: isMobile ? '0 6px' : '0 8px', borderRadius: 10, fontWeight: 900, fontSize: isMobile ? '0.80rem' : '0.95rem', cursor: 'pointer', border: active ? '2px solid #6476FF' : '1px solid #dbe5f5', background: active ? '#6476FF' : '#f7faff', color: active ? '#fff' : '#1f2b49', boxShadow: active ? '0 6px 16px rgba(100,118,255,0.22)' : 'none', transition: 'transform 0.08s ease' }}
                  >
                    {a.toFixed(1)}㎡
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: '0.85rem', color: '#6a7692' }}>좌우로 스와이프(드래그)해서 면적을 선택해.</div>
          </div>

          {/* 그래프 */}
          <div style={{ width: '100%', height: isMobile ? 320 : isTablet ? 300 : 360, minHeight: isMobile ? 320 : 200, flexShrink: 0, background: '#fff', borderRadius: 8, marginTop: 4, display: 'flex', flexDirection: 'column' }}>
            {(loadingTrade || loadingInfo) && <div style={{ padding: 12, color: '#6476FF' }}>로딩 중…</div>}
            {tradeErr && <div style={{ padding: 12, color: '#c33' }}>{tradeErr}</div>}

            {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
              <>
                {/* 컨트롤 3줄 */}
                <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 10px 4px', fontSize: '0.78rem', color: '#444' }}>
                  {/* 공통 버튼 스타일 */}
                  {/* 1줄: X축 기간 조정 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ minWidth: 76, fontWeight: 700, color: '#1f2b49' }}>X축 기간 조정</span>
                    <button onClick={() => changeYearWindow(-1)} style={{ height: 36, padding: '0 10px', border: '1px solid #d0d7e2', borderRadius: 6, background: '#f7f9fc', cursor: 'pointer' }}>– 1년</button>
                    <span style={{ minWidth: 44, textAlign: 'center' }}>최근 {yearWindow}년</span>
                    <button onClick={() => changeYearWindow(+1)} style={{ height: 36, padding: '0 10px', border: '1px solid #d0d7e2', borderRadius: 6, background: '#f7f9fc', cursor: 'pointer' }}>+ 1년</button>
                  </div>
                  {/* 2줄: 평균가 스무딩 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ minWidth: 76, fontWeight: 700, color: '#1f2b49' }}>평균가 스무딩</span>
                    {[1, 3, 6].map(w => (
                      <button key={w} onClick={() => setSmoothWindow(w)}
                        style={{ height: 36, padding: '0 10px', border: '1px solid #d0d7e2', borderRadius: 6, background: smoothWindow === w ? '#6476FF' : '#f7f9fc', color: smoothWindow === w ? '#fff' : '#444', cursor: 'pointer' }}>
                        {w === 1 ? '없음' : `${w}M`}
                      </button>
                    ))}
                  </div>
                  {/* 3줄: Max값 조정 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ minWidth: 76, fontWeight: 700, color: '#1f2b49' }}>Max값 조정</span>
                    <button onClick={() => changeY2Max(-1)} style={{ height: 36, padding: '0 10px', border: '1px solid #d0d7e2', borderRadius: 6, background: '#f7f9fc', cursor: 'pointer' }}>-1억</button>
                    <button onClick={() => changeY2Max(+1)} style={{ height: 36, padding: '0 10px', border: '1px solid #d0d7e2', borderRadius: 6, background: '#f7f9fc', cursor: 'pointer' }}>+1억</button>
                  </div>
                </div>

                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  <div style={{ position: 'absolute', top: 4, left: 10, zIndex: 6, display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.80rem', fontWeight: 800, color: '#1f2b49', pointerEvents: 'none', background: 'rgba(255,255,255,0.75)', padding: '2px 6px', borderRadius: 6 }}>
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
                      hoverlabel: { bgcolor: '#1f2b49', bordercolor: '#6476FF', font: { color: '#fff', size: 12 }, namelength: -1 },
                      xaxis: { type: 'date', tickformat: '%Y.%m', hoverformat: '%Y년 %m월', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: '#6476FF', spikedash: 'solid', spikethickness: 1 },
                      yaxis: { ticksuffix: '건', tickfont: { size: 9 }, showgrid: false, rangemode: 'tozero', autorange: false, range: yRange || undefined, showticklabels: false, fixedrange: true, showspikes: false },
                      yaxis2: { overlaying: 'y', side: 'right', ticksuffix: '억', tickfont: { size: 9 }, rangemode: 'tozero', autorange: false, range: y2Range || undefined, fixedrange: true, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: 'rgba(150,150,150,0.5)', spikedash: 'dot', spikethickness: 1 },
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
            style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 6, color: '#384056', cursor: 'pointer', display: 'inline-block' }}
          >⭐ 즐겨찾기 단지 차트비교</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {favApts.map(fav => (
              <div key={fav.key} style={{ padding: '4px 9px', borderRadius: 14, background: '#f0f4ff', fontSize: '0.85rem', fontWeight: 600, color: '#1f2b49' }}>
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
