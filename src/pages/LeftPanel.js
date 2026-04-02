// src/pages/LeftPanel.js
import React, { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { ymToDate, dateToISOYM } from '../utils/dateUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import {
  buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu,
  aggregateTradesForArea, pickInitialArea, groupAreasToRep,
} from './services/aptData';

function LeftPanel({ selectedApt, onPanTo, favApts, addFavoriteApt, removeFavoriteApt }) {
  const aptKey = selectedApt
    ? `${selectedApt.kaptName}_${selectedApt.bjdCode || ''}`
    : null;

  const isFav = aptKey ? favApts.some(a => a.key === aptKey) : false;

  // 검색
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  // 전용면적 드래그 스크롤
  const { scrollRef: areaScrollRef, dragRef, onMouseDown: onAreaMouseDown, onMouseMove: onAreaMouseMove, onMouseUp: endAreaDrag } = useAreaDragScroll();

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

        const rawList = listAreasForPnu(wb, _pnu, selectedApt['kaptName'] || null);
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

  return (
    <aside
      style={{
        width: 380, minWidth: 330, maxWidth: 420,
        background: '#fff', borderRight: '1.5px solid #e0e0e0',
        padding: '18px 16px 18px 20px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 12,
        boxSizing: 'border-box', zIndex: 1,
      }}
    >
      {/* 검색창 */}
      <form onSubmit={handleSearch} style={{ marginBottom: 8, display: 'flex', gap: 9, alignItems: 'center', position: 'relative' }}>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="아파트, 주소, 역, 학교 검색 (Kakao)"
          style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #e0e0e0', borderRadius: 8, fontSize: '1.06rem', outline: 'none' }}
          autoComplete="off"
        />
        <button
          type="submit"
          style={{ background: '#6476FF', color: '#fff', fontWeight: 700, border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: '1.06rem', cursor: 'pointer' }}
        >
          검색
        </button>
        {suggestions.length > 0 && (
          <ul style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: '#fff', border: '1px solid #dbe5f5', borderRadius: 8, boxShadow: '0 4px 16px 0 #dbe5f533', zIndex: 99, listStyle: 'none', margin: 0, padding: 0 }}>
            {suggestions.map((item) => (
              <li key={item.id} onClick={() => handleSuggestionClick(item)} style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '1.0rem' }}>
                {item.place_name} <span style={{ color: '#888' }}>({item.address_name})</span>
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
            <div style={{ fontSize: '1.45rem', fontWeight: 800 }}>{selectedApt.kaptName}</div>
            <button
              onClick={() => isFav ? removeFavoriteApt(aptKey) : addFavoriteApt(selectedApt)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.35rem', color: isFav ? '#f5c518' : '#bbb', padding: 0 }}
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
          <div style={{ marginTop: 8 }}>
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
              style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', padding: '6px 4px', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin', cursor: dragRef.current?.down ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'pan-x', borderRadius: 10 }}
            >
              {areas.map((a) => {
                const active = selArea === a;
                return (
                  <button
                    key={a}
                    onClick={() => handleAreaClick(a)}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ flex: '0 0 auto', minWidth: 70, padding: '3px 3px', borderRadius: 12, fontWeight: 900, fontSize: '1.0rem', cursor: 'pointer', border: active ? '2px solid #6476FF' : '1px solid #dbe5f5', background: active ? '#6476FF' : '#f7faff', color: active ? '#fff' : '#1f2b49', boxShadow: active ? '0 6px 16px rgba(100,118,255,0.22)' : 'none', transition: 'transform 0.08s ease' }}
                  >
                    {a.toFixed(1)}㎡
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: '0.85rem', color: '#6a7692' }}>좌우로 스와이프(드래그)해서 면적을 선택해.</div>
          </div>

          {/* 그래프 */}
          <div style={{ width: '100%', height: 360, background: '#fff', borderRadius: 8, marginTop: 8 }}>
            {(loadingTrade || loadingInfo) && <div style={{ padding: 12, color: '#6476FF' }}>로딩 중…</div>}
            {tradeErr && <div style={{ padding: 12, color: '#c33' }}>{tradeErr}</div>}

            {!loadingInfo && !loadingTrade && !tradeErr && x.length > 0 && (
              <>
                {/* 표시 기간 + 스무딩 조절 */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px', padding: '6px 10px 0', fontSize: '0.8rem', color: '#444' }}>
                  <span>실거래 기간 조절</span>
                  <button onClick={() => changeYearWindow(-1)} style={{ border: '1px solid #d0d7e2', borderRadius: 4, padding: '2px 6px', background: '#f7f9fc', cursor: 'pointer' }}>– 1년</button>
                  <span style={{ minWidth: 10, textAlign: 'center' }}>최근 {yearWindow}년</span>
                  <button onClick={() => changeYearWindow(+1)} style={{ border: '1px solid #d0d7e2', borderRadius: 4, padding: '2px 6px', background: '#f7f9fc', cursor: 'pointer' }}>+ 1년</button>
                  <span style={{ marginLeft: 6 }}>스무딩</span>
                  {[1, 3, 6].map(w => (
                    <button key={w} onClick={() => setSmoothWindow(w)}
                      style={{ border: '1px solid #d0d7e2', borderRadius: 4, padding: '2px 6px', background: smoothWindow === w ? '#6476FF' : '#f7f9fc', color: smoothWindow === w ? '#fff' : '#444', cursor: 'pointer' }}>
                      {w === 1 ? '없음' : `${w}M`}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative', width: '100%', height: 'calc(100% - 40px)' }}>
                  <div style={{ position: 'absolute', top: 4, left: 10, zIndex: 6, display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.80rem', fontWeight: 800, color: '#1f2b49', pointerEvents: 'none', background: 'rgba(255,255,255,0.75)', padding: '2px 6px', borderRadius: 6 }}>
                    <span style={{ color: '#1f77b4' }}>■ 거래량</span>
                    <span style={{ color: '#ff7f0e' }}>━ 평균가</span>
                    <span style={{ color: '#2ca02c' }}>● 실거래</span>
                    {pPtsX.length > 0 && <span style={{ color: '#9467bd' }}>● 분양권</span>}
                  </div>

                  <Plot
                    data={[
                      { type: 'bar', x, y: vol, name: '거래량(건)', marker: { opacity: 0.4, color: '#1f77b4' }, yaxis: 'y1' },
                      { type: 'scatter', mode: 'lines', x, y: avg, name: '평균(억)', yaxis: 'y2', line: { width: 2, color: '#ff7f0e' } },
                      { type: 'scatter', mode: 'markers', x: ptsX, y: ptsY, name: '실거래(억)', yaxis: 'y2', opacity: 0.4, marker: { size: 6, color: '#2ca02c' } },
                      ...(pPtsX.length > 0 ? [{
                        type: 'scatter', mode: 'markers',
                        x: pPtsX, y: pPtsY, name: '분양권(억)', yaxis: 'y2',
                        opacity: 0.55, marker: { size: 7, color: '#9467bd', symbol: 'diamond' },
                      }] : []),
                    ]}
                    layout={{
                      shapes: janLines,
                      margin: { t: 24, b: 70, l: 5, r: 70 },
                      dragmode: 'pan',
                      showlegend: false,
                      xaxis: { type: 'date', tickformat: '%Y.%m', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined },
                      yaxis: { ticksuffix: '건', tickfont: { size: 9 }, showgrid: false, rangemode: 'tozero', autorange: false, range: yRange || undefined, showticklabels: false, fixedrange: true },
                      yaxis2: { overlaying: 'y', side: 'right', ticksuffix: '억', tickfont: { size: 9 }, rangemode: 'tozero', autorange: false, range: y2Range || undefined, fixedrange: true },
                    }}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                    config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
                    onRelayout={handleRelayout}
                  />

                  {/* Y축 조절 버튼 */}
                  <div style={{ position: 'absolute', top: '50%', right: 6, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.7rem' }}>
                    <button onClick={() => changeY2Max(-1)} style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #d0d7e2', background: '#f7f9fc', cursor: 'pointer' }}>-1억</button>
                    <button onClick={() => changeY2Max(+1)} style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #d0d7e2', background: '#f7f9fc', cursor: 'pointer' }}>+1억</button>
                  </div>
                </div>

                {/* 즐겨찾기 단지 칩 */}
                {favApts.length > 0 && (
                  <div style={{ marginTop: 10, padding: '6px 4px' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 6, color: '#384056' }}>⭐ 즐겨찾기 단지</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {favApts.map(fav => (
                        <div key={fav.key} style={{ padding: '4px 9px', borderRadius: 14, background: '#f0f4ff', fontSize: '0.85rem', fontWeight: 600, color: '#1f2b49' }}>
                          {fav.kaptName}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

export default LeftPanel;
