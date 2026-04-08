// src/pages/ChartPanel.js
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { commonPanelStyle } from '../styles/panelStyles';
import { ymToDate, dateToISOYM, dateToYM, addMonths } from '../utils/dateUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import { buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu, aggregateTradesForArea, groupAreasToRep, normAptNm } from './services/aptData';
import { trimAptName } from '../utils/aptNameUtils';

const SERIES_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

export default function ChartPanel({ isOpen = false, favApts = [], removeFavoriteApt, onClose, isMobile = false, isTablet = false }) {
  const [activeKey, setActiveKey] = useState(null);
  const [xRange, setXRange] = useState(null);
  const [yearWindow, setYearWindow] = useState(5);
  const [normBaseMode, setNormBaseMode] = useState('1y');

  const [smoothWindow, setSmoothWindow] = useState(3);
  const changeSmoothWindow = (w) => { setSmoothWindow(w); setSeries([]); };

  const [areasByKey, setAreasByKey] = useState({});
  const [hotAreasByKey, setHotAreasByKey] = useState({}); // key -> [hot1area, hot2area]
  const [loadingKey, setLoadingKey] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  // 누적 플롯: [{ id, key, kaptName, area, x, y }]
  const [series, setSeries] = useState([]);

  const uiRev = useMemo(() => series.map(s => s.id).join(','), [series]);

  const { scrollRef: areaScrollRef, dragRef, onMouseDown: onAreaMouseDown, onMouseMove: onAreaMouseMove, onMouseUp: onAreaMouseUp } = useAreaDragScroll();

  const activeFav = useMemo(() => favApts.find((a) => a.key === activeKey), [favApts, activeKey]);

  const modeToCenterMonths = (mode) => ({ '1y': 12, '3y': 36, '5y': 60, '10y': 120 }[mode] ?? 12);

  // 정규화(%) 데이터
  const plotDataNormPack = useMemo(() => {
    const excluded = [];

    const getBase = (s) => {
      const xs = s.x || [], ys = s.y || [];
      if (!xs.length || !ys.length) return { base: NaN, centerYM: null, reason: '시리즈 데이터 없음' };

      const anchor = ymToDate(xs[xs.length - 1]);
      const center = modeToCenterMonths(normBaseMode);
      const startYM = dateToYM(addMonths(anchor, -(center + 2)));
      const endYM   = dateToYM(addMonths(anchor, -(center - 2)));
      const centerYM = dateToYM(addMonths(anchor, -center));

      if (startYM < xs[0]) return { base: NaN, centerYM: null, reason: '과거 데이터 범위 부족' };

      const baseVals = xs.reduce((acc, ym, i) => {
        if (ym >= startYM && ym <= endYM && Number.isFinite(ys[i])) acc.push(ys[i]);
        return acc;
      }, []);
      if (!baseVals.length) return { base: NaN, centerYM: null, reason: '기준구간 값 없음' };
      return { base: baseVals.reduce((a, b) => a + b, 0) / baseVals.length, centerYM, reason: null };
    };

    const traces = [];
    const normShapes = [];

    series.forEach((s, idx) => {
      const { base, centerYM, reason } = getBase(s);
      if (!Number.isFinite(base) || base <= 0) {
        if (reason === '과거 데이터 범위 부족') excluded.push(`${trimAptName(s.kaptName)} ${s.area}㎡`);
        return;
      }
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const label = `${trimAptName(s.kaptName)} ${s.area}㎡`;
      traces.push({
        type: 'scatter', mode: 'lines',
        x: s.x,
        y: (s.y || []).map(v => (Number.isFinite(v) ? (v / base) * 100 : NaN)),
        name: label,
        line: { width: 2, color },
        hoverinfo: 'none',
      });
      // 기준점 강조 수직선
      if (centerYM) {
        const x0 = `${centerYM}-01`;
        normShapes.push({
          type: 'line', xref: 'x', yref: 'paper',
          x0, x1: x0, y0: 0, y1: 1,
          line: { width: 2, color, dash: 'dot' },
        });
      }
    });

    // 기준점 날짜 레이블 — Plotly annotations
    const normAnnotations = series.map((s, idx) => {
      const { centerYM } = getBase(s);
      if (!centerYM) return null;
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      return {
        xref: 'x', yref: 'paper',
        x: `${centerYM}-01`, y: 1,
        text: `<b>100%</b><br>${centerYM.replace('-', '.')}`,
        showarrow: false,
        font: { size: 9, color },
        xanchor: 'left',
        yanchor: 'top',
        bgcolor: 'rgba(255,255,255,0.75)',
      };
    }).filter(Boolean);

    return { traces, normShapes, normAnnotations, excluded };
  }, [series, normBaseMode]);

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

      // 최근 1년 면적별 거래량 → Hot 순위 계산 (Rdata + Pdata 통합)
      const cutoff = (() => {
        const d = new Date(); d.setFullYear(d.getFullYear() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();
      const pnuStr = pnu ? String(pnu) : null;
      const normName = fav.kaptName ? normAptNm(fav.kaptName) : null;
      const volMap = new Map();

      // Rdata 집계
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

      // Pdata 집계 (취소 거래 제외)
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

  const addSeries = async (fav, areaNorm) => {
    if (!fav || !areaNorm) return;
    // 이미 추가된 경우 → 제거(토글)
    const id = `${fav.key}#${areaNorm}`;
    if (series.some(s => s.id === id)) {
      setSeries(prev => prev.filter(s => s.id !== id));
      return;
    }
    setErrMsg('');
    try {
      const { pnu } = buildPNU(fav);
      const code5 = String(fav.bjdCode || '').slice(0, 5);

      // Rdata + Pdata 병렬 로드 (Pdata 없어도 계속)
      const [rResult, pResult] = await Promise.allSettled([
        fetchWorkbook(fav.as1, fav.as2, code5),
        fetchPdata(fav.as1, fav.as2, code5),
      ]);
      if (rResult.status === 'rejected') throw rResult.reason;

      const { wb } = rResult.value;
      const _pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;

      const pack = aggregateTradesForArea({
        wb, pdWb: _pdWb, pnu,
        kaptName: fav.kaptName || null,
        areaNorm, smoothWindow,
      });
      const id = `${fav.key}#${areaNorm}`;
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

  const plotData = useMemo(() => {
    const traces = [];
    series.forEach((s, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const label = `${trimAptName(s.kaptName)} ${s.area}㎡`;
      // 평균가 라인
      traces.push({
        type: 'scatter', mode: 'lines',
        x: s.x, y: s.y,
        name: label,
        line: { width: 2, color },
        hoverinfo: 'none',
      });
      // 실거래 산점 (circle) — 팝업 제외
      if (s.ptsX?.length) {
        traces.push({
          type: 'scatter', mode: 'markers',
          x: s.ptsX, y: s.ptsY,
          name: `${label} 실거래`,
          opacity: 0.6,
          marker: { size: 5, color, symbol: 'circle' },
          showlegend: false,
          hoverinfo: 'skip',
        });
      }
      // 입주권 산점 (triangle-up) — 팝업 제외
      if (s.pPtsX?.length) {
        traces.push({
          type: 'scatter', mode: 'markers',
          x: s.pPtsX, y: s.pPtsY,
          name: `${label} 입주권`,
          opacity: 0.6,
          marker: { size: 6, color, symbol: 'triangle-up' },
          showlegend: false,
          hoverinfo: 'skip',
        });
      }
    });
    return traces;
  }, [series]);

  const commonX = useMemo(() => {
    const set = new Set();
    series.forEach(s => (s.x || []).forEach(ym => set.add(ym)));
    return Array.from(set).sort();
  }, [series]);

  const janLines = useMemo(() => {
    if (!commonX.length) return [];
    return Array.from(new Set(commonX.map(ym => ym.slice(0, 4)))).map(y => ({
      type: 'line', xref: 'x', yref: 'paper',
      x0: `${y}-01-01`, x1: `${y}-01-01`, y0: 0, y1: 1,
      line: { width: 1, color: 'rgba(0,0,0,0.10)' },
    }));
  }, [commonX]);

  const monthLines = useMemo(() => {
    if (!commonX.length) return [];
    return commonX.map(ym => ({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: `${ym}-01`,
      x1: `${ym}-01`,
      y0: 0,
      y1: 1,
      line: {
        width: 1,
        color: 'rgba(0,0,0,0.05)'  // 🔹 연보다 연하게
      },
    }));
  }, [commonX]);

  useEffect(() => {
    if (!commonX.length) return;
    const earliestDate = ymToDate(commonX[0]);
    const today = new Date();
    const anchor = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = new Date(anchor.getFullYear() - yearWindow, anchor.getMonth(), 1);
    setXRange([dateToISOYM(start < earliestDate ? earliestDate : start), dateToISOYM(anchor)]);
  }, [commonX, yearWindow]);

  const changeYearWindow = (delta) => {
    if (!commonX.length) return;
    setYearWindow(prev => Math.max(1, prev + delta));
  };

  // 정규화 모드 변경 시 X축 범위 자동 조정
  useEffect(() => {
    const baseYears = modeToCenterMonths(normBaseMode) / 12;
    setYearWindow(baseYears + 5);
  }, [normBaseMode]);

  const handleRelayout = (e) => {
    if (e['xaxis.range[0]'] && e['xaxis.range[1]']) {
      setXRange([e['xaxis.range[0]'], e['xaxis.range[1]']]);
    }
  };

  // 현재 xRange에 보이는 데이터 기준 Y 범위 동적 계산
  const priceYRange = useMemo(() => {
    if (!xRange) return undefined;
    const [x0, x1] = [xRange[0].slice(0, 7), xRange[1].slice(0, 7)];
    const vals = [];
    series.forEach(s => {
      (['x', 'ptsX', 'pPtsX']).forEach((xk, ki) => {
        const yk = ['y', 'ptsY', 'pPtsY'][ki];
        (s[xk] || []).forEach((xv, i) => {
          if (xv >= x0 && xv <= x1 && Number.isFinite(s[yk]?.[i])) vals.push(s[yk][i]);
        });
      });
    });
    if (!vals.length) return undefined;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pad = (mx - mn) * 0.15 || 1;
    return [Math.max(0, mn - pad), mx + pad];
  }, [xRange, series]);

  const normYRange = useMemo(() => {
    if (!xRange) return undefined;
    const [x0, x1] = [xRange[0].slice(0, 7), xRange[1].slice(0, 7)];
    const vals = [];
    plotDataNormPack.traces.forEach(t => {
      (t.x || []).forEach((xv, i) => {
        if (xv >= x0 && xv <= x1 && Number.isFinite(t.y?.[i])) vals.push(t.y[i]);
      });
    });
    if (!vals.length) return undefined;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pad = (mx - mn) * 0.15 || 5;
    return [mn - pad, mx + pad];
  }, [xRange, plotDataNormPack.traces]);

  // 겹치는 라벨을 위아래로 밀어내는 함수 (labelHeight 단위로 gap 보장)
  const spreadLabels = (labels, labelHeight = 20) => {
    if (labels.length <= 1) return labels;
    const sorted = [...labels].sort((a, b) => a.yPx - b.yPx);
    // 아래 방향 패스: 이전 라벨과 겹치면 밀어내기
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].yPx - sorted[i - 1].yPx < labelHeight) {
        sorted[i] = { ...sorted[i], yPx: sorted[i - 1].yPx + labelHeight };
      }
    }
    // 위 방향 패스: 밀려서 위로 겹친 경우 보정
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i + 1].yPx - sorted[i].yPx < labelHeight) {
        sorted[i] = { ...sorted[i], yPx: sorted[i + 1].yPx - labelHeight };
      }
    }
    return sorted;
  };

  // TradingView 스타일 Y축 라벨
  const priceChartDiv = useRef(null);
  const normChartDiv  = useRef(null);
  const [priceLabels, setPriceLabels] = useState([]);
  const [normLabels,  setNormLabels]  = useState([]);
  const [priceXLabel, setPriceXLabel] = useState(null);
  const [normXLabel,  setNormXLabel]  = useState(null);

  const calcXLabel = useCallback((eventData, graphDiv) => {
    if (!graphDiv?._fullLayout?.xaxis || !eventData.points?.length) return null;
    const xa = graphDiv._fullLayout.xaxis;
    if (!Number.isFinite(xa._length) || !xa.range) return null;
    const pt = eventData.points[0];
    if (!pt.x) return null;
    const [x0ms, x1ms] = xa.range.map(d => new Date(d).getTime());
    const ptMs = new Date(pt.x).getTime();
    const xPx = xa._offset + xa._length * ((ptMs - x0ms) / (x1ms - x0ms));
    const d = new Date(pt.x);
    const text = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { xPx, text };
  }, []);

  const calcYLabels = useCallback((eventData, graphDiv, suffix) => {
    if (!graphDiv?._fullLayout?.yaxis) return [];
    const ya = graphDiv._fullLayout.yaxis;
    if (!Number.isFinite(ya._length) || !ya.range) return [];
    const [y0, y1] = ya.range;
    const range = y1 - y0;
    if (!range) return [];
    return eventData.points
      .filter(pt => pt.data?.line?.color && Number.isFinite(pt.y))
      .map(pt => {
        const pct  = (pt.y - y0) / range;
        const yPx  = ya._offset + ya._length * (1 - pct);
        const text = suffix === '억' ? `${pt.y.toFixed(2)}억` : `${pt.y.toFixed(1)}%`;
        return { yPx, text, color: pt.data.line.color };
      });
  }, []);

  const chartHeight = isMobile
    ? Math.round(window.innerWidth * (2 / 3))
    : isTablet ? 300 : 320;
  const headerPad = isMobile ? '12px 16px 10px' : isTablet ? '14px 20px 10px' : '18px 24px 12px';
  const btnH = isMobile ? 44 : 40; // 터치 타겟

  return (
    <aside style={{ ...commonPanelStyle, overflowY: 'auto', overflowX: 'hidden' }}>
      {/* 상단: 즐겨찾기 단지 + 면적 선택 */}
      <div style={{ borderBottom: '1.5px solid #E6DED4', background: '#F7F3EE', fontWeight: 700, fontSize: '1.05rem', padding: headerPad, flex: '0 0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 }}>
          <span>즐겨찾기 단지 비교</span>
          <button
            onClick={onClose}
            style={{ color: '#6B625B', background: 'none', border: 'none', fontWeight: 900, cursor: 'pointer', fontSize: '1.15rem', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="닫기"
          >✕</button>
        </div>

        {/* 즐겨찾기 단지 칩 */}
        <div style={{ marginTop: 10, padding: '10px', background: '#fff', border: '1px solid #E6DED4', borderRadius: 12, minHeight: 54, display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start' }}>
          {favApts.length === 0 ? (
            <span style={{ color: '#C9BFB4', fontWeight: 600, fontSize: '0.95rem' }}>추가된 아파트가 없습니다.</span>
          ) : (
            favApts.map((fav) => {
              const active = fav.key === activeKey;
              return (
                <button
                  key={fav.key}
                  onClick={async () => { setActiveKey(fav.key); await loadAreas(fav); }}
                  style={{ background: active ? '#E6DED4' : '#F7F3EE', border: active ? '1px solid #6B625B' : '1px solid #E6DED4', borderRadius: 10, height: btnH, padding: '0 12px', fontWeight: 900, cursor: 'pointer', fontSize: '0.95rem', color: '#1F1D1B', display: 'inline-flex', alignItems: 'center', gap: 10 }}
                  title="클릭해서 면적 선택"
                >
                  {trimAptName(fav.kaptName)}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavoriteApt?.(fav.key);
                      if (activeKey === fav.key) setActiveKey(null);
                      setSeries(prev => prev.filter(s => s.key !== fav.key));
                    }}
                    style={{ color: '#6B625B', fontWeight: 900, cursor: 'pointer', fontSize: '1rem' }}
                    title="즐겨찾기 삭제"
                  >✕</span>
                </button>
              );
            })
          )}
        </div>

        {/* 면적 선택 */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.90rem', fontWeight: 900, color: '#1F1D1B', marginBottom: 6 }}>
            전용면적 선택 {activeFav && <span style={{ color: '#6B625B' }}>{trimAptName(activeFav.kaptName)}</span>}
          </div>
          <div
            ref={areaScrollRef}
            onMouseDown={onAreaMouseDown}
            onMouseMove={onAreaMouseMove}
            onMouseUp={onAreaMouseUp}
            onMouseLeave={onAreaMouseUp}
            style={{ width: '100%', overflowX: 'auto', overflowY: 'visible', whiteSpace: 'nowrap', cursor: dragRef.current.down ? 'grabbing' : 'grab', userSelect: 'none', padding: '14px 4px 6px' }}
          >
            {!activeFav ? (
              <span style={{ color: '#C9BFB4', fontWeight: 700, fontSize: '0.92rem' }}>위에서 단지를 클릭하면 면적을 선택할 수 있습니다.</span>
            ) : loadingKey === activeKey ? (
              <span style={{ color: '#6B625B', fontWeight: 800, fontSize: '0.92rem' }}>로딩…</span>
            ) : !(areasByKey[activeKey] || []).length ? (
              <span style={{ color: '#c33', fontWeight: 800, fontSize: '0.92rem' }}>면적 목록이 없습니다.</span>
            ) : (
              (areasByKey[activeKey] || []).map((ar) => {
                const hotList  = hotAreasByKey[activeKey] || [];
                const hotRank  = hotList.indexOf(ar);
                const hotLabel = hotRank === 0 ? 'Hot1' : hotRank === 1 ? 'Hot2' : null;
                const hotColor = '#b35a00';
                const inSeries = series.some(s => s.key === activeKey && s.area === ar);
                return (
                  <button
                    key={ar}
                    onClick={() => addSeries(activeFav, ar)}
                    style={{
                      display: 'inline-flex', alignItems: 'center',
                      marginRight: 8,
                      minWidth: isMobile ? 45 : 55,
                      height: isMobile ? 28 : 30,
                      padding: isMobile ? '0 6px' : '0 8px',
                      borderRadius: 10,
                      border: inSeries ? '2px solid #6B625B' : '1px solid #E6DED4',
                      background: inSeries ? '#6B625B' : '#F7F3EE',
                      fontWeight: 900,
                      cursor: 'pointer',
                      fontSize: isMobile ? '0.75rem' : '0.88rem',
                      color: inSeries ? '#fff' : '#1F1D1B',
                      boxShadow: inSeries ? '0 6px 16px rgba(107,98,91,0.18)' : 'none',
                      position: 'relative',
                      overflow: 'visible',
                      boxSizing: 'content-box',
                    }}
                    title="클릭하면 그래프에 누적 추가"
                  >
                    {ar.toFixed(1)}㎡
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
              })
            )}
          </div>
          {errMsg && <div style={{ marginTop: 6, color: '#c33', fontWeight: 900, fontSize: '0.92rem' }}>{errMsg}</div>}
        </div>
      </div>

      {/* 범례 */}
      {series.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', padding: '6px 10px', borderTop: '1px solid #E6DED4', borderBottom: '1px solid #E6DED4' }}>
          {series.map((s, idx) => (
            <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: '0.9rem', color: '#1F1D1B', background: '#F7F3EE', border: '1px solid #E6DED4', padding: '4px 8px', borderRadius: 999 }}>
              <span style={{ width: 10, height: 3, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 3 }} />
              <span>{trimAptName(s.kaptName)} {s.area}㎡</span>
              <button
                onClick={() => setSeries(prev => prev.filter(x => x.id !== s.id))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 900, color: '#6B625B', lineHeight: 1, padding: 0 }}
                title="그래프에서 제거"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 그래프 영역 — 스크롤로 안정적인 크기 보장 */}
      <div style={{ flex: '0 0 auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 표시 기간 + 스무딩 조절 */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', padding: '6px 10px 0', fontSize: '0.82rem', color: '#6B625B' }}>
          <span style={{ fontWeight: 900 }}>기간 조절</span>
          <button onClick={() => changeYearWindow(-1)} style={{ border: '1px solid #C9BFB4', borderRadius: 6, padding: '0 10px', height: 36, background: '#F7F3EE', cursor: 'pointer' }}>– 1년</button>
          <span style={{ minWidth: 70, textAlign: 'center' }}>최근 {yearWindow}년</span>
          <button onClick={() => changeYearWindow(+1)} style={{ border: '1px solid #C9BFB4', borderRadius: 6, padding: '0 10px', height: 36, background: '#F7F3EE', cursor: 'pointer' }}>+ 1년</button>
          <span style={{ marginLeft: 6, fontWeight: 900 }}>스무딩</span>
          {[1, 3, 6].map(w => (
            <button key={w} onClick={() => changeSmoothWindow(w)}
              style={{ border: '1px solid #C9BFB4', borderRadius: 6, padding: '0 10px', height: 36, background: smoothWindow === w ? '#6B625B' : '#F7F3EE', color: smoothWindow === w ? '#fff' : '#6B625B', cursor: 'pointer' }}>
              {w === 1 ? '없음' : `${w}M`}
            </button>
          ))}
        </div>

        {/* 원본(억) 그래프 */}
        <div style={{ position: 'relative', width: '100%', height: chartHeight }}>
          {isOpen ? (
            <Plot
              data={plotData}
              layout={{
                uirevision: uiRev,
                margin: { t: 10, b: 60, l: 10, r: 65 },
                dragmode: 'pan',
                hovermode: 'x',
                xaxis: { type: 'date', tickformat: '%Y.%m', tickangle: -45, tickfont: { size: 9 }, range: xRange || undefined, showticklabels: true, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: '#6B625B', spikedash: 'solid', spikethickness: 1 },
                yaxis: { side: 'right', ticksuffix: '억', tickfont: { size: 9 }, autorange: !priceYRange, range: priceYRange, fixedrange: true, showticklabels: true },
                showlegend: false,
                shapes: [...monthLines, ...janLines],
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
              onRelayout={handleRelayout}
              onInitialized={(_, gd) => { priceChartDiv.current = gd; }}
              onUpdate={(_, gd)      => { priceChartDiv.current = gd; }}
              onHover={(data)  => { setPriceLabels(spreadLabels(calcYLabels(data, priceChartDiv.current, '억'))); setPriceXLabel(calcXLabel(data, priceChartDiv.current)); }}
              onUnhover={()    => { setPriceLabels([]); setPriceXLabel(null); }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%' }} />
          )}
          {/* TradingView 스타일 Y축 라벨 */}
          {priceLabels.map((lbl, i) => (
            <div key={i} style={{
              position: 'absolute', right: 2,
              top: lbl.yPx, transform: 'translateY(-50%)',
              background: lbl.color, color: '#fff',
              fontSize: '11px', fontWeight: 700,
              padding: '2px 5px', borderRadius: 3,
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            }}>
              {lbl.text}
            </div>
          ))}
          {/* X축 날짜 라벨 */}
          {priceXLabel && (
            <div style={{
              position: 'absolute', bottom: 36,
              left: priceXLabel.xPx, transform: 'translateX(-50%)',
              background: '#6B625B', color: '#fff',
              fontSize: '11px', fontWeight: 700,
              padding: '2px 5px', borderRadius: 3,
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            }}>
              {priceXLabel.text}
            </div>
          )}
        </div>
        {/* 원본 그래프 범례 */}
        {series.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '4px 10px 0' }}>
            {series.map((s, idx) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, color: '#1F1D1B' }}>
                <span style={{ width: 16, height: 3, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2, flexShrink: 0 }} />
                {trimAptName(s.kaptName)} {s.area}㎡
              </span>
            ))}
          </div>
        )}

        {/* 정규화 기준 선택 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', position: 'sticky', top: 0, zIndex: 20, background: '#fff', padding: '8px 0', borderTop: '1px solid #E6DED4', borderBottom: '1px solid #E6DED4' }}>
          <span style={{ fontWeight: 900, color: '#1F1D1B', fontSize: '0.9rem' }}>정규화 기준</span>
          <select
            value={normBaseMode}
            onChange={(e) => setNormBaseMode(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #E6DED4', fontWeight: 900, color: '#1F1D1B', background: '#fff', cursor: 'pointer' }}
          >
            <option value="1y">1년 전 (5개월 평균) = 100%</option>
            <option value="3y">3년 전 (5개월 평균) = 100%</option>
            <option value="5y">5년 전 (5개월 평균) = 100%</option>
            <option value="10y">10년 전 (5개월 평균) = 100%</option>
          </select>
        </div>

        {plotDataNormPack.excluded.length > 0 && (
          <div style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #E6DED4', background: '#F7F3EE', color: '#1F1D1B', fontWeight: 900, fontSize: '0.88rem' }}>
            {{ '1y': '1년 전', '3y': '3년 전', '5y': '5년 전', '10y': '10년 전' }[normBaseMode]} 기준 과거 데이터 범위 부족으로 제외됨:{' '}
            <span style={{ fontWeight: 800, color: '#6B625B' }}>{plotDataNormPack.excluded.join(', ')}</span>
          </div>
        )}

        {/* 정규화(%) 그래프 */}
        <div style={{ position: 'relative', width: '100%', height: chartHeight }}>
          {isOpen ? (
            <Plot
              data={plotDataNormPack.traces}
              layout={{
                uirevision: uiRev,
                margin: { t: 10, b: 60, l: 10, r: 65 },
                dragmode: 'pan',
                hovermode: 'x',
                xaxis: { type: 'date', tickformat: '%Y.%m', tickangle: -45, tickfont: { size: 9 }, range: xRange || undefined, showticklabels: true, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: '#6B625B', spikedash: 'solid', spikethickness: 1 },
                yaxis: { side: 'right', ticksuffix: '%', tickfont: { size: 9 }, autorange: !normYRange, range: normYRange, fixedrange: true, showticklabels: true },
                showlegend: false,
                shapes: [...monthLines, ...janLines, ...plotDataNormPack.normShapes],
                annotations: plotDataNormPack.normAnnotations,
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
              onRelayout={handleRelayout}
              onInitialized={(_, gd) => { normChartDiv.current = gd; }}
              onUpdate={(_, gd)      => { normChartDiv.current = gd; }}
              onHover={(data)  => { setNormLabels(spreadLabels(calcYLabels(data, normChartDiv.current, '%'))); setNormXLabel(calcXLabel(data, normChartDiv.current)); }}
              onUnhover={()    => { setNormLabels([]); setNormXLabel(null); }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%' }} />
          )}
          {/* TradingView 스타일 Y축 라벨 */}
          {normLabels.map((lbl, i) => (
            <div key={i} style={{
              position: 'absolute', right: 2,
              top: lbl.yPx, transform: 'translateY(-50%)',
              background: lbl.color, color: '#fff',
              fontSize: '11px', fontWeight: 700,
              padding: '2px 5px', borderRadius: 3,
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            }}>
              {lbl.text}
            </div>
          ))}
          {/* X축 날짜 라벨 */}
          {normXLabel && (
            <div style={{
              position: 'absolute', bottom: 36,
              left: normXLabel.xPx, transform: 'translateX(-50%)',
              background: '#6B625B', color: '#fff',
              fontSize: '11px', fontWeight: 700,
              padding: '2px 5px', borderRadius: 3,
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            }}>
              {normXLabel.text}
            </div>
          )}
        </div>
        {/* 정규화 그래프 범례 */}
        {plotDataNormPack.traces.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '4px 10px 0' }}>
            {plotDataNormPack.traces.map((t, idx) => (
              <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, color: '#1F1D1B' }}>
                <span style={{ width: 16, height: 3, background: t.line.color, display: 'inline-block', borderRadius: 2, flexShrink: 0 }} />
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
