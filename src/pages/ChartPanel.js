// src/pages/ChartPanel.js
import React, { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { commonPanelStyle } from '../styles/panelStyles';
import { ymToDate, dateToISOYM, dateToYM, addMonths } from '../utils/dateUtils';
import { useAreaDragScroll } from '../hooks/useAreaDragScroll';
import { buildPNU, fetchWorkbook, fetchPdata, listAreasForPnu, aggregateTradesForArea, groupAreasToRep } from './services/aptData';

const SERIES_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

export default function ChartPanel({ isOpen = false, favApts = [], removeFavoriteApt, onClose }) {
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
        if (reason === '과거 데이터 범위 부족') excluded.push(`${s.kaptName} ${s.area}㎡`);
        return null;
      }
      return {
        type: 'scatter', mode: 'lines',
        x: s.x,
        y: (s.y || []).map(v => (Number.isFinite(v) ? (v / base) * 100 : NaN)),
        name: `${s.kaptName} ${s.area}㎡`,
        line: { width: 2, color: SERIES_COLORS[idx % SERIES_COLORS.length] },
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
      const { wb } = await fetchWorkbook(fav.as1, fav.as2, String(fav.bjdCode || '').slice(0, 5));
      const rawList = listAreasForPnu(wb, pnu, fav.kaptName || null);
      const list = groupAreasToRep(rawList, 0.5); // LeftPanel과 동일한 그룹핑 적용
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
      // 평균가 라인
      traces.push({
        type: 'scatter', mode: 'lines',
        x: s.x, y: s.y,
        name: `${s.kaptName} ${s.area}㎡`,
        line: { width: 2, color },
      });
      // 분양권 산점 (Pdata)
      if (s.pPtsX?.length) {
        traces.push({
          type: 'scatter', mode: 'markers',
          x: s.pPtsX, y: s.pPtsY,
          name: `${s.kaptName} ${s.area}㎡ 분양권`,
          opacity: 0.55,
          marker: { size: 7, color: '#9467bd', symbol: 'diamond' },
          showlegend: false,
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

  return (
    <aside style={{ ...commonPanelStyle, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      {/* 상단: 즐겨찾기 단지 + 면적 선택 */}
      <div style={{ borderBottom: '1.5px solid #e7eaf3', background: '#f9faff', fontWeight: 700, fontSize: '1.12rem', padding: '18px 22px 10px', maxHeight: 260, overflowY: 'auto', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 34 }}>
          <span>즐겨찾기 단지 비교</span>
          <button
            onClick={onClose}
            style={{ color: '#6476FF', background: 'none', border: 'none', fontWeight: 900, cursor: 'pointer', fontSize: '1.15rem', width: 28, height: 28, borderRadius: 7 }}
            title="닫기"
            onMouseOver={e => e.currentTarget.style.background = '#e8eefa'}
            onMouseOut={e => e.currentTarget.style.background = 'none'}
          >✕</button>
        </div>

        {/* 즐겨찾기 단지 칩 */}
        <div style={{ marginTop: 10, padding: '10px 10px', background: '#fff', border: '1px solid #e7eaf3', borderRadius: 12, minHeight: 54, maxHeight: 120, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '8px 9px', alignItems: 'flex-start' }}>
          {favApts.length === 0 ? (
            <span style={{ color: '#aaa', fontWeight: 600, fontSize: '0.98rem' }}>추가된 아파트가 없습니다.</span>
          ) : (
            favApts.map((fav) => {
              const active = fav.key === activeKey;
              return (
                <button
                  key={fav.key}
                  onClick={async () => { setActiveKey(fav.key); await loadAreas(fav); }}
                  style={{ background: active ? '#eaf0ff' : '#f7faff', border: active ? '1px solid #6476FF' : '1px solid #d6def2', borderRadius: 10, padding: '6px 10px', fontWeight: 900, cursor: 'pointer', fontSize: '0.95rem', color: '#1f2b49', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  title="클릭해서 면적 선택"
                >
                  {fav.kaptName}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavoriteApt?.(fav.key);
                      if (activeKey === fav.key) setActiveKey(null);
                      setSeries(prev => prev.filter(s => s.key !== fav.key));
                    }}
                    style={{ color: '#6476FF', fontWeight: 900, cursor: 'pointer' }}
                    title="즐겨찾기 삭제"
                  >✕</span>
                </button>
              );
            })
          )}
        </div>

        {/* 면적 선택 */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.90rem', fontWeight: 900, color: '#1f2b49', marginBottom: 0 }}>
            전용면적 선택 {activeFav && <span style={{ color: '#6a7692' }}>{activeFav.kaptName}</span>}
          </div>
          <div
            ref={areaScrollRef}
            onMouseDown={onAreaMouseDown}
            onMouseMove={onAreaMouseMove}
            onMouseUp={onAreaMouseUp}
            onMouseLeave={onAreaMouseUp}
            style={{ width: '100%', overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: 0, cursor: dragRef.current.down ? 'grabbing' : 'grab', userSelect: 'none' }}
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
                  style={{ display: 'inline-block', marginRight: 7, padding: '6px 10px', borderRadius: 12, border: '1px solid #d6def2', background: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: '0.9rem', color: '#1f2b49' }}
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
              <span>{s.kaptName} {s.area}㎡</span>
              <button
                onClick={() => setSeries(prev => prev.filter(x => x.id !== s.id))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 900, color: '#6476FF', lineHeight: 1, padding: 0 }}
                title="그래프에서 제거"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 그래프 영역 */}
      <div style={{ flex: 1, minHeight: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
        {/* 표시 기간 + 스무딩 조절 */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', padding: '6px 10px 0', fontSize: '0.82rem', color: '#444' }}>
          <span style={{ fontWeight: 900 }}>기간 조절</span>
          <button onClick={() => changeYearWindow(-1)} style={{ border: '1px solid #d0d7e2', borderRadius: 4, padding: '2px 6px', background: '#f7f9fc', cursor: 'pointer' }}>– 1년</button>
          <span style={{ minWidth: 70, textAlign: 'center' }}>최근 {yearWindow}년</span>
          <button onClick={() => changeYearWindow(+1)} style={{ border: '1px solid #d0d7e2', borderRadius: 4, padding: '2px 6px', background: '#f7f9fc', cursor: 'pointer' }}>+ 1년</button>
          <span style={{ marginLeft: 6, fontWeight: 900 }}>스무딩</span>
          {[1, 3, 6].map(w => (
            <button key={w} onClick={() => changeSmoothWindow(w)}
              style={{ border: '1px solid #d0d7e2', borderRadius: 4, padding: '2px 6px', background: smoothWindow === w ? '#6476FF' : '#f7f9fc', color: smoothWindow === w ? '#fff' : '#444', cursor: 'pointer' }}>
              {w === 1 ? '없음' : `${w}M`}
            </button>
          ))}
        </div>

        {/* 원본(억) 그래프 */}
        <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}>
          {isOpen ? (
            <Plot
              data={plotData}
              layout={{
                margin: { t: 26, b: 75, l: 80, r: 40 },
                dragmode: 'pan',
                xaxis: { type: 'date', tickformat: '%Y.%m', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined },
                yaxis: { side: 'right', ticksuffix: '억', tickfont: { size: 9 }, rangemode: 'tozero', autorange: false, range: y2Range || undefined, fixedrange: true },
                showlegend: false,
                shapes: [...monthLines, ...janLines],
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
              onRelayout={handleRelayout}
            />
          ) : (
            <div style={{ width: '100%', height: '100%' }} />
          )}

          {/* Y축 조절 버튼 — 원본 그래프 div 안에 위치 */}
          <div style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.7rem' }}>
            <button onClick={() => changeY2Max(-1)} style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #d0d7e2', background: '#f7f9fc', cursor: 'pointer' }}>-1억</button>
            <button onClick={() => changeY2Max(+1)} style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #d0d7e2', background: '#f7f9fc', cursor: 'pointer' }}>+1억</button>
          </div>
        </div>

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
        <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}>
          {isOpen ? (
            <Plot
              data={plotDataNormPack.traces}
              layout={{
                margin: { t: 26, b: 75, l: 80, r: 40 },
                dragmode: 'pan',
                xaxis: { type: 'date', tickformat: '%Y.%m', tickangle: -45, automargin: true, tickfont: { size: 9 }, range: xRange || undefined },
                yaxis: { side: 'right', ticksuffix: '%', tickfont: { size: 9 }, rangemode: 'tozero', autorange: true, fixedrange: true },
                showlegend: false,
                shapes: [...monthLines, ...janLines],
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ responsive: true, scrollZoom: true, displayModeBar: false }}
              onRelayout={handleRelayout}
            />
          ) : (
            <div style={{ width: '100%', height: '100%' }} />
          )}
        </div>
      </div>
    </aside>
  );
}
