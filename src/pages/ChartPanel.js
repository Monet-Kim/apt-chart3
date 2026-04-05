// src/pages/ChartPanel.js
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { commonPanelStyle } from '../styles/panelStyles';
import { ymToDate, dateToISOYM, dateToYM, addMonths } from '../utils/dateUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import { buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu, aggregateTradesForArea, groupAreasToRep } from './services/aptData';
import { trimAptName } from '../utils/aptNameUtils';

const SERIES_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

export default function ChartPanel({ isOpen = false, favApts = [], removeFavoriteApt, onClose, isMobile = false, isTablet = false }) {
  const [activeKey, setActiveKey] = useState(null);
  const [xRange, setXRange] = useState(null);
  const [yearWindow, setYearWindow] = useState(5);
  const [y2Range, setY2Range] = useState(null);
  const [normBaseMode, setNormBaseMode] = useState('1y');

  const [smoothWindow, setSmoothWindow] = useState(3);
  const changeSmoothWindow = (w) => { setSmoothWindow(w); setSeries([]); };

  const [areasByKey, setAreasByKey] = useState({});
  const [loadingKey, setLoadingKey] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  // 누적 플롯: [{ id, key, kaptName, area, x, y }]
  const [series, setSeries] = useState([]);

  const { scrollRef: areaScrollRef, dragRef, onMouseDown: onAreaMouseDown, onMouseMove: onAreaMouseMove, onMouseUp: onAreaMouseUp } = useAreaDragScroll();

  const activeFav = useMemo(() => favApts.find((a) => a.key === activeKey), [favApts, activeKey]);

  // 정규화(%) 데이터
  const plotDataNormPack = useMemo(() => {
    const excluded = [];
    const modeToCenterMonths = (mode) => ({ '1y': 12, '3y': 36, '5y': 60, '10y': 120 }[mode] ?? 12);

    const getBase = (s) => {
      const xs = s.x || [], ys = s.y || [];
      if (!xs.length || !ys.length) return { base: NaN, reason: '시리즈 데이터 없음' };

      const anchor = ymToDate(xs[xs.length - 1]);
      const center = modeToCenterMonths(normBaseMode);
      const startYM = dateToYM(addMonths(anchor, -(center + 2)));
      const endYM   = dateToYM(addMonths(anchor, -(center - 2)));

      if (startYM < xs[0]) return { base: NaN, reason: '과거 데이터 범위 부족' };

      const baseVals = xs.reduce((acc, ym, i) => {
        if (ym >= startYM && ym <= endYM && Number.isFinite(ys[i])) acc.push(ys[i]);
        return acc;
      }, []);
      if (!baseVals.length) return { base: NaN, reason: '기준구간 값 없음' };
      return { base: baseVals.reduce((a, b) => a + b, 0) / baseVals.length, reason: null };
    };

    const traces = series.map((s, idx) => {
      const { base, reason } = getBase(s);
      if (!Number.isFinite(base) || base <= 0) {
        if (reason === '과거 데이터 범위 부족') excluded.push(`${trimAptName(s.kaptName)} ${s.area}㎡`);
        return null;
      }
      const label = `${trimAptName(s.kaptName)} ${s.area}㎡`;
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      return {
        type: 'scatter', mode: 'lines',
        x: s.x,
        y: (s.y || []).map(v => (Number.isFinite(v) ? (v / base) * 100 : NaN)),
        name: label,
        line: { width: 2, color },
        hoverinfo: 'none',
      };
    }).filter(Boolean);

    return { traces, excluded };
  }, [series, normBaseMode]);

  const loadAreas = async (fav) => {
    if (!fav || areasByKey[fav.key]?.length) return;
    setErrMsg('');
    setLoadingKey(fav.key);
    try {
      const { pnu, reason } = buildPNU(fav);
      if (!pnu) throw new Error(reason || 'PNU 생성 실패');
      const code5 = String(fav.bjdCode || '').slice(0, 5);
      const [rResult, pResult] = await Promise.allSettled([
        fetchWorkbook(fav.as1, fav.as2, code5),
        fetchPdata(fav.as1, fav.as2, code5),
      ]);
      if (rResult.status === 'rejected') throw rResult.reason;
      const { wb } = rResult.value;
      const pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;
      const rawList = listAreasForPnu(wb, pnu, fav.kaptName || null, pdWb);
      const list = groupAreasToRep(rawList, 0.5);
      setAreasByKey(prev => ({ ...prev, [fav.key]: list }));
      if (!list.length) setErrMsg('면적 목록이 없습니다.');
    } catch {
      setErrMsg('면적 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingKey(null);
    }
  };

  const addSeries = async (fav, areaNorm) => {
    if (!fav || !areaNorm) return;
    setErrMsg('');
    try {
      const { pnu, reason } = buildPNU(fav);
      if (!pnu) throw new Error(reason || 'PNU 생성 실패');
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
        areaNorm, areaTol: 0.5, smoothWindow,
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

  useEffect(() => {
    const maxPrice = Math.max(0, ...series.flatMap(s => (s.y || []).filter(v => Number.isFinite(v))));
    setY2Range([0, maxPrice > 0 ? maxPrice * 1.3 : 10]);
  }, [series]);

  const changeYearWindow = (delta) => {
    if (!commonX.length) return;
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

  // TradingView 스타일 Y축 라벨
  const priceChartDiv = useRef(null);
  const normChartDiv  = useRef(null);
  const [priceLabels, setPriceLabels] = useState([]);
  const [normLabels,  setNormLabels]  = useState([]);

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
    <aside style={{ ...commonPanelStyle, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      {/* 상단: 즐겨찾기 단지 + 면적 선택 */}
      <div style={{ borderBottom: '1.5px solid #e7eaf3', background: '#f9faff', fontWeight: 700, fontSize: '1.05rem', padding: headerPad, flex: '0 0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 }}>
          <span>즐겨찾기 단지 비교</span>
          <button
            onClick={onClose}
            style={{ color: '#6476FF', background: 'none', border: 'none', fontWeight: 900, cursor: 'pointer', fontSize: '1.15rem', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="닫기"
          >✕</button>
        </div>

        {/* 즐겨찾기 단지 칩 */}
        <div style={{ marginTop: 10, padding: '10px', background: '#fff', border: '1px solid #e7eaf3', borderRadius: 12, minHeight: 54, display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start' }}>
          {favApts.length === 0 ? (
            <span style={{ color: '#aaa', fontWeight: 600, fontSize: '0.95rem' }}>추가된 아파트가 없습니다.</span>
          ) : (
            favApts.map((fav) => {
              const active = fav.key === activeKey;
              return (
                <button
                  key={fav.key}
                  onClick={async () => { setActiveKey(fav.key); await loadAreas(fav); }}
                  style={{ background: active ? '#eaf0ff' : '#f7faff', border: active ? '1px solid #6476FF' : '1px solid #d6def2', borderRadius: 10, height: btnH, padding: '0 12px', fontWeight: 900, cursor: 'pointer', fontSize: '0.95rem', color: '#1f2b49', display: 'inline-flex', alignItems: 'center', gap: 10 }}
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
                    style={{ color: '#6476FF', fontWeight: 900, cursor: 'pointer', fontSize: '1rem' }}
                    title="즐겨찾기 삭제"
                  >✕</span>
                </button>
              );
            })
          )}
        </div>

        {/* 면적 선택 */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.90rem', fontWeight: 900, color: '#1f2b49', marginBottom: 6 }}>
            전용면적 선택 {activeFav && <span style={{ color: '#6a7692' }}>{trimAptName(activeFav.kaptName)}</span>}
          </div>
          <div
            ref={areaScrollRef}
            onMouseDown={onAreaMouseDown}
            onMouseMove={onAreaMouseMove}
            onMouseUp={onAreaMouseUp}
            onMouseLeave={onAreaMouseUp}
            style={{ width: '100%', overflowX: 'auto', whiteSpace: 'nowrap', cursor: dragRef.current.down ? 'grabbing' : 'grab', userSelect: 'none', paddingBottom: 4 }}
          >
            {!activeFav ? (
              <span style={{ color: '#9aa6c3', fontWeight: 700, fontSize: '0.92rem' }}>위에서 단지를 클릭하면 면적을 선택할 수 있습니다.</span>
            ) : loadingKey === activeKey ? (
              <span style={{ color: '#6476FF', fontWeight: 800, fontSize: '0.92rem' }}>로딩…</span>
            ) : !(areasByKey[activeKey] || []).length ? (
              <span style={{ color: '#c33', fontWeight: 800, fontSize: '0.92rem' }}>면적 목록이 없습니다.</span>
            ) : (
              (areasByKey[activeKey] || []).map((ar) => (
                <button
                  key={ar}
                  onClick={() => addSeries(activeFav, ar)}
                  style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, height: btnH, padding: '0 14px', borderRadius: 12, border: '1px solid #d6def2', background: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.92rem', color: '#1f2b49' }}
                  title="클릭하면 그래프에 누적 추가"
                >
                  {ar}㎡
                </button>
              ))
            )}
          </div>
          {errMsg && <div style={{ marginTop: 6, color: '#c33', fontWeight: 900, fontSize: '0.92rem' }}>{errMsg}</div>}
        </div>
      </div>

      {/* 범례 */}
      {series.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', padding: '6px 10px', borderTop: '1px solid #eef1f7', borderBottom: '1px solid #eef1f7' }}>
          {series.map((s, idx) => (
            <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: '0.9rem', color: '#1f2b49', background: '#f7faff', border: '1px solid #e7eaf3', padding: '4px 8px', borderRadius: 999 }}>
              <span style={{ width: 10, height: 3, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 3 }} />
              <span>{trimAptName(s.kaptName)} {s.area}㎡</span>
              <button
                onClick={() => setSeries(prev => prev.filter(x => x.id !== s.id))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 900, color: '#6476FF', lineHeight: 1, padding: 0 }}
                title="그래프에서 제거"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 그래프 영역 — 스크롤로 안정적인 크기 보장 */}
      <div style={{ flex: '0 0 auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 표시 기간 + 스무딩 조절 */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', padding: '6px 10px 0', fontSize: '0.82rem', color: '#444' }}>
          <span style={{ fontWeight: 900 }}>기간 조절</span>
          <button onClick={() => changeYearWindow(-1)} style={{ border: '1px solid #d0d7e2', borderRadius: 6, padding: '0 10px', height: 36, background: '#f7f9fc', cursor: 'pointer' }}>– 1년</button>
          <span style={{ minWidth: 70, textAlign: 'center' }}>최근 {yearWindow}년</span>
          <button onClick={() => changeYearWindow(+1)} style={{ border: '1px solid #d0d7e2', borderRadius: 6, padding: '0 10px', height: 36, background: '#f7f9fc', cursor: 'pointer' }}>+ 1년</button>
          <span style={{ marginLeft: 6, fontWeight: 900 }}>스무딩</span>
          {[1, 3, 6].map(w => (
            <button key={w} onClick={() => changeSmoothWindow(w)}
              style={{ border: '1px solid #d0d7e2', borderRadius: 6, padding: '0 10px', height: 36, background: smoothWindow === w ? '#6476FF' : '#f7f9fc', color: smoothWindow === w ? '#fff' : '#444', cursor: 'pointer' }}>
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
                margin: { t: 26, b: 75, l: 80, r: 56 },
                dragmode: 'pan',
                hovermode: 'x',
                xaxis: { type: 'date', tickformat: '%Y.%m', hoverformat: '%Y년 %m월', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: '#6476FF', spikedash: 'solid', spikethickness: 1 },
                yaxis: { side: 'right', ticksuffix: '억', tickfont: { size: 9 }, rangemode: 'tozero', autorange: false, range: y2Range || undefined, fixedrange: true, showspikes: false, showticklabels: false },
                showlegend: false,
                shapes: [...monthLines, ...janLines],
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
              onRelayout={handleRelayout}
              onInitialized={(_, gd) => { priceChartDiv.current = gd; }}
              onUpdate={(_, gd)      => { priceChartDiv.current = gd; }}
              onHover={(data)  => setPriceLabels(calcYLabels(data, priceChartDiv.current, '억'))}
              onUnhover={()    => setPriceLabels([])}
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
          {/* Y축 조절 버튼 */}
          <div style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.7rem' }}>
            <button onClick={() => changeY2Max(-1)} style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #d0d7e2', background: '#f7f9fc', cursor: 'pointer' }}>-1억</button>
            <button onClick={() => changeY2Max(+1)} style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #d0d7e2', background: '#f7f9fc', cursor: 'pointer' }}>+1억</button>
          </div>
        </div>
        {/* 원본 그래프 범례 */}
        {series.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '4px 10px 0' }}>
            {series.map((s, idx) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, color: '#1f2b49' }}>
                <span style={{ width: 16, height: 3, background: SERIES_COLORS[idx % SERIES_COLORS.length], display: 'inline-block', borderRadius: 2, flexShrink: 0 }} />
                {trimAptName(s.kaptName)} {s.area}㎡
              </span>
            ))}
          </div>
        )}

        {/* 정규화 기준 선택 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', position: 'sticky', top: 0, zIndex: 20, background: '#fff', padding: '8px 0', borderTop: '1px solid #eef1f7', borderBottom: '1px solid #eef1f7' }}>
          <span style={{ fontWeight: 900, color: '#1f2b49', fontSize: '0.9rem' }}>정규화 기준</span>
          <select
            value={normBaseMode}
            onChange={(e) => setNormBaseMode(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #d6def2', fontWeight: 900, color: '#1f2b49', background: '#fff', cursor: 'pointer' }}
          >
            <option value="1y">1년 전 (5개월 평균) = 100%</option>
            <option value="3y">3년 전 (5개월 평균) = 100%</option>
            <option value="5y">5년 전 (5개월 평균) = 100%</option>
            <option value="10y">10년 전 (5개월 평균) = 100%</option>
          </select>
        </div>

        {plotDataNormPack.excluded.length > 0 && (
          <div style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e7eaf3', background: '#fbfcff', color: '#1f2b49', fontWeight: 900, fontSize: '0.88rem' }}>
            {{ '1y': '1년 전', '3y': '3년 전', '5y': '5년 전', '10y': '10년 전' }[normBaseMode]} 기준 과거 데이터 범위 부족으로 제외됨:{' '}
            <span style={{ fontWeight: 800, color: '#6476FF' }}>{plotDataNormPack.excluded.join(', ')}</span>
          </div>
        )}

        {/* 정규화(%) 그래프 */}
        <div style={{ position: 'relative', width: '100%', height: chartHeight }}>
          {isOpen ? (
            <Plot
              data={plotDataNormPack.traces}
              layout={{
                margin: { t: 26, b: 75, l: 80, r: 56 },
                dragmode: 'pan',
                hovermode: 'x',
                xaxis: { type: 'date', tickformat: '%Y.%m', hoverformat: '%Y년 %m월', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined, showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikecolor: '#6476FF', spikedash: 'solid', spikethickness: 1 },
                yaxis: { side: 'right', ticksuffix: '%', tickfont: { size: 9 }, rangemode: 'tozero', autorange: true, fixedrange: true, showspikes: false, showticklabels: false },
                showlegend: false,
                shapes: [...monthLines, ...janLines],
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
              onRelayout={handleRelayout}
              onInitialized={(_, gd) => { normChartDiv.current = gd; }}
              onUpdate={(_, gd)      => { normChartDiv.current = gd; }}
              onHover={(data)  => setNormLabels(calcYLabels(data, normChartDiv.current, '%'))}
              onUnhover={()    => setNormLabels([])}
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
        </div>
        {/* 정규화 그래프 범례 */}
        {plotDataNormPack.traces.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '4px 10px 0' }}>
            {plotDataNormPack.traces.map((t, idx) => (
              <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, color: '#1f2b49' }}>
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
