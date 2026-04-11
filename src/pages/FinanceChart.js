// src/pages/FinanceChart.js
// Lightweight Charts 기반 금융 자산 차트 (주간 종가)
// 그래프1: 자산 1~2개 선택, Y1/Y2 이중축
// 그래프2: 정규화(%) 비교

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { getChartHeight } from '../styles/chartHeight';
import { createChart, LineSeries } from 'lightweight-charts';

const aptNameKeyframes = `
@keyframes aptNameHighlightBg {
  0%   { background: #C9A84C40; }
  40%  { background: #C9A84C28; }
  100% { background: transparent; }
}
@keyframes aptNameHighlightText {
  0%   { color: #8a6200; }
  40%  { color: #8a6200; }
  100% { color: #1F1D1B; }
}
`;
if (typeof document !== 'undefined') {
  let s = document.getElementById('apt-name-highlight-style');
  if (!s) { s = document.createElement('style'); s.id = 'apt-name-highlight-style'; document.head.appendChild(s); }
  s.textContent = aptNameKeyframes;
}

// ────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────
const R2_BASE = process.env.NODE_ENV === 'production'
  ? 'https://pub-8c65c427a291446c9384665be9201bea.r2.dev'
  : '';

const ASSETS = [
  { key: 'SP500',  label: 'S&P500',  color: '#C1614E',
    tooltip: '미국 대형주 500개 종합지수.\n글로벌 위험자산 심리를 보는 대표 지표.' },
  { key: 'NASDAQ', label: 'NASDAQ',  color: '#5B7FA8',
    tooltip: '미국 기술주 중심 지수.\nS&P500보다 변동성이 크고 금리 변화에 민감.' },
  { key: 'DOW',    label: 'DOW',     color: '#8B7AB8',
    tooltip: '미국 30대 우량주 지수.\n미국 경기·소비 흐름을 가늠하는 전통 지표.' },
  { key: 'GOLD',   label: 'Gold',    color: '#B8872A',
    tooltip: '대표적 안전자산.\n달러·금리와 반대 방향으로 움직이는 경향.' },
  { key: 'KOSPI',  label: 'KOSPI',   color: '#5E8F6B',
    tooltip: '한국 주식시장 종합지수.\n외국인 수급과 환율의 영향을 크게 받음.' },
  { key: 'KTB5Y',  label: '국채5년', color: '#6B75C0', isRate: true,
    tooltip: '한국국채5년물은 주담대 변동금리의\n2~4개월 선행지표\n\n금융채 5년물 금리 변동\n→ COFIX 산정 (매월 15일, 약 1개월 시차)\n→ 주담대 변동금리 갱신 (3·6개월 단위)' },
  { key: 'KR_RATE', label: '한국금리', color: '#4A8A75', isRate: true,
    tooltip: '한국은행 기준금리.\n주담대 금리 산정의 직접적 기준.' },
  { key: 'US_RATE', label: '미국금리', color: '#C8A84B', isRate: true,
    tooltip: '미 연준(Fed) 기준금리.\n글로벌 유동성과 한국 기준금리에 간접 영향.' },
  { key: 'BTC',    label: 'BTC',     color: '#B06880',
    tooltip: '비트코인. 대표적 가상자산.\n나스닥 등 위험자산과 동조화 경향.' },
  { key: 'ETH',    label: 'ETH',     color: '#7890C0',
    tooltip: '이더리움. BTC보다 변동성이 크고 투기성 높음.\n블록체인 생태계 활성도를 반영.' },
  { key: 'USDKRW', label: '원/달러', color: '#4A8FA0',
    tooltip: '원화 대비 달러 환율.\n외국인 자금 유출입·수입 물가·금리 정책과 연동.' },
];

const ASSET_MAP = Object.fromEntries(ASSETS.map(a => [a.key, a]));

// 2단계 캐시: index + 연도별 CSV
const indexCache    = new Map(); // assetKey → { years: number[], latest_date }
const yearDataCache = new Map(); // `${assetKey}|${year}` → rows[]


// ────────────────────────────────────────────
// R2에서 index.json + 연도별 CSV 로드
// ────────────────────────────────────────────
async function fetchFinanceIndex(assetKey) {
  if (indexCache.has(assetKey)) return indexCache.get(assetKey);
  const url = `${R2_BASE}/finance_data/finance_${assetKey}_index.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`index.json 없음: ${assetKey}`);
  const idx = await res.json();
  const entry = {
    years: Array.isArray(idx.years) ? idx.years.map(Number).sort((a, b) => a - b) : [],
    latest_date: idx.latest_date,
  };
  indexCache.set(assetKey, entry);
  return entry;
}

async function fetchYearCSV(assetKey, year) {
  const k = `${assetKey}|${year}`;
  if (yearDataCache.has(k)) return yearDataCache.get(k);
  const url = `${R2_BASE}/finance_data/${encodeURIComponent(`finance_${assetKey}_${year}.csv`)}`;
  const r = await fetch(url, { cache: 'no-store' });
  const rows = r.ok ? parseCSV(await r.text()) : [];
  yearDataCache.set(k, rows);
  return rows;
}

// fromYear: 해당 연도 이상만 로드. null이면 전체 로드.
async function fetchFinanceData(assetKey, fromYear = null) {
  const { years, latest_date } = await fetchFinanceIndex(assetKey);
  const targetYears = fromYear != null ? years.filter(y => y >= fromYear) : years;
  if (!targetYears.length) throw new Error(`years 비어있음: ${assetKey}`);
  const rows = (await Promise.all(targetYears.map(y => fetchYearCSV(assetKey, y)))).flat();
  rows.sort((a, b) => (a.date > b.date ? 1 : -1));
  return { weekly: rows, latest_date, allYears: years, loadedMinYear: targetYears[0] };
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map(s => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    if (cols.length !== header.length) continue;
    const obj = {};
    header.forEach((h, j) => { obj[h] = cols[j]; });
    rows.push(obj);
  }
  return rows;
}

function toChartTime(dateStr) {
  return dateStr?.slice(0, 10) || '';
}

function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function filterByDate(rows, startDate, currency) {
  return rows
    .filter(r => r.date >= startDate)
    .map(r => ({
      time: toChartTime(r.date),
      value: parseFloat(currency === 'KRW' ? r.close_krw : r.close_usd) || 0,
    }))
    .filter(r => r.time && r.value != null && !isNaN(r.value));
}

// ────────────────────────────────────────────
// Lightweight Charts 공통 옵션
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
    localization: {
      timeFormatter: (time) => {
        let d;
        if (typeof time === 'object') d = new Date(time.year, time.month - 1, time.day);
        else if (typeof time === 'string') d = new Date(time);
        else d = new Date(time * 1000);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}/${mm}/${dd}`;
      },
    },
    timeScale: {
      borderColor: '#E6DED4',
      timeVisible: true,
      secondsVisible: false,
      minBarSpacing: 0.1,
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
    rightPriceScale: { borderColor: '#E6DED4' },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  };
}

// ────────────────────────────────────────────
// 그래프1: 이중축 가격 차트 (최대 3개 자산)
// ────────────────────────────────────────────
const PriceChart = memo(function PriceChart({ selected, currency, yearWindow, isMobile }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const series1Ref        = useRef(null);
  const series2Ref        = useRef(null);
  const series3Ref        = useRef(null);
  const selectedRef       = useRef(selected);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg]   = useState('');
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const [chartHeight, setChartHeight] = useState(getChartHeight(isMobile, window.innerWidth));

  // chartHeight 변경 시 차트에 반영
  useEffect(() => {
    chartRef.current?.applyOptions({ height: chartHeight });
  }, [chartHeight]);

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

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      const vals = {};
      [[series1Ref, 0], [series2Ref, 1], [series3Ref, 2]].forEach(([ref, i]) => {
        if (!ref.current) return;
        const d = param.seriesData.get(ref.current);
        if (d) vals[selectedRef.current[i]] = d.value;
      });
      setTooltip({ time: param.time, vals, x: param.point.x, y: param.point.y });
    });

    return () => { chart.remove(); chartRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chartRef.current || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      chartRef.current?.applyOptions({ width: w });
      setChartHeight(getChartHeight(isMobile, w));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isMobile]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    if (series1Ref.current) { try { chart.removeSeries(series1Ref.current); } catch {} series1Ref.current = null; }
    if (series2Ref.current) { try { chart.removeSeries(series2Ref.current); } catch {} series2Ref.current = null; }
    if (series3Ref.current) { try { chart.removeSeries(series3Ref.current); } catch {} series3Ref.current = null; }
    setTooltip(null);

    if (!selected.length) return;

    setLoading(true);
    setErrMsg('');

    const startDate = yearsAgo(yearWindow);

    const keys = selected.slice(0, 3);
    const hasRate  = keys.some(k => ASSET_MAP[k]?.isRate);
    const hasPrice = keys.some(k => !ASSET_MAP[k]?.isRate);
    const mixedTypes = hasRate && hasPrice;

    chart.applyOptions({
      leftPriceScale: { visible: mixedTypes, borderColor: '#E6DED4', scaleMargins: { top: 0.08, bottom: 0.08 } },
    });

    let cancelled = false;
    Promise.allSettled(keys.map(k => fetchFinanceData(k, 1980)))
      .then((results) => {
        if (cancelled) return;
        const priceFormatter = (v) => {
          if (v >= 1_000_000_000) return Math.round(v / 1_000_000_000) + 'B';
          if (v >= 1_000_000)     return Math.round(v / 1_000_000) + 'M';
          if (v >= 1_000)         return Math.round(v / 1_000) + 'K';
          return Math.round(v).toString();
        };
        const rateFormatter = (v) => Number(v).toFixed(2) + '%';

        const seriesRefArr = [series1Ref, series2Ref, series3Ref];
        results.forEach((result, idx) => {
          if (result.status === 'rejected') return;
          const { weekly } = result.value;
          const points = filterByDate(weekly, '1980-01-01', currency);
          if (!points.length) return;

          const assetInfo = ASSET_MAP[keys[idx]];
          const isRate = !!assetInfo.isRate;
          const scaleId = mixedTypes ? (isRate ? 'right' : 'left') : 'right';

          const series = chart.addSeries(LineSeries, {
            color: assetInfo.color + 'B3',
            lineWidth: 2,
            priceScaleId: scaleId,
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            priceFormat: { type: 'custom', formatter: isRate ? rateFormatter : priceFormatter, minMove: isRate ? 0.01 : 1 },
          });
          series.setData(points);
          seriesRefArr[idx].current = series;
        });

        const today = new Date().toISOString().slice(0, 10);
        requestAnimationFrame(() => {
          if (chartRef.current && series1Ref.current) {
            // 1. 전체 데이터 기준으로 줌 레벨 확정 (줌아웃 한계 = 전체 데이터)
            chartRef.current.timeScale().fitContent();

            // 2. 그 상태에서 yearWindow 범위만큼만 오른쪽 끝에서 보여주기
            requestAnimationFrame(() => {
              if (!chartRef.current) return;
              try {
                chartRef.current.timeScale().setVisibleRange({ from: startDate, to: today });
              } catch {}
            });
          }
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, currency, yearWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  const sym = currency === 'KRW' ? '₩' : '$';

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', color: '#6B625B' }}>
          로딩 중…
        </div>
      )}
      {errMsg && <div style={{ padding: '8px 10px', color: '#c33', fontSize: '0.82rem' }}>{errMsg}</div>}

      <div ref={containerRef} style={{ width: '100%', height: chartHeight, background: '#F5F2EE', borderRadius: 8 }} />
      {/* 스크롤 양보 오버레이 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 52, height: '100%', zIndex: 10 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 16, height: '100%', zIndex: 10 }} />

      {tooltip && (
        <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(31,29,27,0.88)', color: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: '0.78rem', fontWeight: 700, pointerEvents: 'none', zIndex: 20, lineHeight: 1.8 }}>
          <div style={{ color: '#C9BFB4', marginBottom: 2 }}>{tooltip.time}</div>
          {Object.entries(tooltip.vals).map(([k, v]) => {
            const asset = ASSET_MAP[k];
            return (
              <div key={k}>
                <span style={{ color: asset?.color }}>{asset?.label}</span>
                {' '}
                {asset?.isRate
                  ? Number(v).toFixed(2) + '%'
                  : sym + Number(v).toLocaleString(undefined, { maximumFractionDigits: currency === 'KRW' ? 0 : 2 })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ────────────────────────────────────────────
// 그래프2: 정규화 비교 차트 (다중 자산)
// normMonthsAgo: 오늘로부터 N개월 전을 100% 기준으로
// ────────────────────────────────────────────
const NormChart = memo(function NormChart({ selected, currency, yearWindow, normMonthsAgo = 36, isMobile, aptX = [], aptAvg = [], aptName = null, showApt = true }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRefs     = useRef([]);
  const aptSeriesRef   = useRef(null); // 아파트 시리즈
  const aptMonthMapRef = useRef({});   // "YYYY-MM" → 정규화 값 (O(1) 조회)
  const showAptRef     = useRef(showApt);
  const baseTimeRef    = useRef(null);
  const selectedRef    = useRef(selected);
  const normParamsRef  = useRef({});    // assetKey → { baseValue, isRate, maxValue }
  const rawDataRef        = useRef({});  // assetKey → rawPoints[] (캐시)
  const normMonthsAgoRef  = useRef(normMonthsAgo);
  const yearWindowRef     = useRef(yearWindow);
  const [baseLineX, setBaseLineX] = useState(null);
  const [timeScaleHeight, setTimeScaleHeight] = useState(38);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg]   = useState('');
  const [tooltip, setTooltip] = useState(null);

  const [dynChartHeight, setDynChartHeight] = useState(getChartHeight(isMobile, window.innerWidth));
  const headerRef  = useRef(null);

  useEffect(() => { selectedRef.current    = selected;      }, [selected]);
  useEffect(() => { normMonthsAgoRef.current = normMonthsAgo; }, [normMonthsAgo]);
  useEffect(() => { yearWindowRef.current    = yearWindow;    }, [yearWindow]);
  useEffect(() => { showAptRef.current       = showApt;       }, [showApt]);

  const updateBaseX = useCallback(() => {
    if (!baseTimeRef.current || !chartRef.current) return;
    const x = chartRef.current.timeScale().timeToCoordinate(baseTimeRef.current);
    setBaseLineX(x != null ? x : null);
  }, []);

  // 정규화만 재계산 (raw 데이터는 rawDataRef에서 읽음 — fetch 없음)
  const applyNorm = useCallback(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const _normMonthsAgo = normMonthsAgoRef.current;
    const baseDateStr = monthsAgo(_normMonthsAgo);
    const baseTs = new Date(baseDateStr).getTime();

    seriesRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    seriesRefs.current = [];
    baseTimeRef.current = null;
    setBaseLineX(null);
    normParamsRef.current = {};

    const newSeries = [];
    selectedRef.current.forEach((key, idx) => {
      const raw = rawDataRef.current[key];
      if (!raw) return;
      const a = ASSET_MAP[key];

      let points;
      if (a?.isRate) {
        points = raw.map(p => ({ ...p, value: Math.round(p.value * 30 * 100) / 100 }));
        normParamsRef.current[key] = { isRate: true };
        if (idx === 0 && !baseTimeRef.current) {
          const bp = raw.reduce((prev, curr) =>
            Math.abs(new Date(curr.time).getTime() - baseTs) <
            Math.abs(new Date(prev.time).getTime() - baseTs) ? curr : prev
          );
          baseTimeRef.current = bp.time;
        }
      } else {
        const bp = raw.reduce((prev, curr) =>
          Math.abs(new Date(curr.time).getTime() - baseTs) <
          Math.abs(new Date(prev.time).getTime() - baseTs) ? curr : prev
        );
        if (idx === 0) baseTimeRef.current = bp.time;
        const baseValue = bp.value;
        if (!baseValue) return;
        points = raw.map(p => ({ ...p, value: Math.round((p.value / baseValue) * 10000) / 100 }));
        normParamsRef.current[key] = { isRate: false, baseValue };
      }

      const series = chart.addSeries(LineSeries, {
        color: a.color + 'B3',
        lineWidth: 2,
        priceScaleId: 'right',
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        priceFormat: { type: 'custom', formatter: v => Math.round(v) + '%', minMove: 1 },
      });
      series.setData(points);
      newSeries.push(series);
    });
    seriesRefs.current = newSeries;
  }, []); // refs만 사용 — 의존성 없음

  // 보이는 X축 범위만 갱신
  const applyVisibleRange = useCallback(() => {
    if (!chartRef.current || !seriesRefs.current.length) return;
    const _normMonthsAgo = normMonthsAgoRef.current;
    const _yearWindow    = yearWindowRef.current;
    const normYears = _normMonthsAgo / 12;
    const visibleStartDate = yearsAgo(Math.max(_yearWindow, normYears + 1));
    const today = new Date().toISOString().slice(0, 10);

    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      try {
        chartRef.current.timeScale().setVisibleRange({ from: visibleStartDate, to: today });
      } catch {
        chartRef.current.timeScale().fitContent();
      }
      if (baseTimeRef.current) {
        const x = chartRef.current.timeScale().timeToCoordinate(baseTimeRef.current);
        setBaseLineX(x != null ? x : null);
      }
    });
  }, []); // refs만 사용 — 의존성 없음

  // 차트 초기화
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      ...makeChartOptions(dynChartHeight),
      rightPriceScale: { visible: true, borderColor: '#E6DED4', scaleMargins: { top: 0.05, bottom: 0.05 } },
    });
    chartRef.current = chart;
    requestAnimationFrame(() => {
      setTimeScaleHeight(chart.timeScale().height() || 38);
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      const vals = {};
      seriesRefs.current.forEach((s, i) => {
        if (!s) return;
        const d = param.seriesData.get(s);
        if (d) vals[selectedRef.current[i]] = d.value;
      });
      if (aptSeriesRef.current && showAptRef.current) {
        const t = typeof param.time === 'object'
          ? `${param.time.year}-${String(param.time.month).padStart(2,'0')}`
          : String(param.time).slice(0, 7);
        const val = aptMonthMapRef.current[t];
        if (val != null) vals['APT'] = val;
      }
      setTooltip({ time: param.time, vals });
    });

    // 타임스케일 이동/줌 시 수직선 X 갱신
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (baseTimeRef.current && chartRef.current) {
        const x = chartRef.current.timeScale().timeToCoordinate(baseTimeRef.current);
        setBaseLineX(x != null ? x : null);
      }
    });

    return () => { chart.remove(); chartRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // dynChartHeight 변경 시 차트 높이 업데이트
  useEffect(() => {
    chartRef.current?.applyOptions({ height: dynChartHeight });
  }, [dynChartHeight]);

  // 컨테이너 크기 변경 대응
  useEffect(() => {
    if (!chartRef.current || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      chartRef.current?.applyOptions({ width: w });
      setDynChartHeight(getChartHeight(isMobile, w));
      updateBaseX();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateBaseX]);

  // 데이터 로드 (selected / currency 변경 시만 — fetch)
  useEffect(() => {
    if (!chartRef.current) return;

    seriesRefs.current.forEach(s => { try { chartRef.current.removeSeries(s); } catch {} });
    seriesRefs.current = [];
    rawDataRef.current = {};
    baseTimeRef.current = null;
    setBaseLineX(null);
    setTooltip(null);

    if (!selected.length) return;

    setLoading(true);
    setErrMsg('');

    let cancelled = false;
    Promise.allSettled(selected.map(k => fetchFinanceData(k, 1980)))
      .then((results) => {
        if (cancelled) return;
        const newRaw = {};
        results.forEach((result, idx) => {
          if (result.status === 'rejected') return;
          const { weekly } = result.value;
          const raw = filterByDate(weekly, '1980-01-01', currency);
          if (raw.length) newRaw[selected[idx]] = raw;
        });
        rawDataRef.current = newRaw;
        applyNorm();
        applyVisibleRange();
      })
      .catch(() => { if (!cancelled) setErrMsg('데이터 로드 실패'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  // normMonthsAgo 변경 시 — fetch 없이 재정규화만
  useEffect(() => {
    if (!Object.keys(rawDataRef.current).length) return;
    applyNorm();
    applyVisibleRange();
  }, [normMonthsAgo]); // eslint-disable-line react-hooks/exhaustive-deps

  // yearWindow 변경 시 — 보이는 범위만 갱신
  useEffect(() => {
    applyVisibleRange();
  }, [yearWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  // 아파트 시리즈 갱신 (aptX/aptAvg/normMonthsAgo 변경 시)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    // 기존 아파트 시리즈 제거
    if (aptSeriesRef.current) {
      try { chart.removeSeries(aptSeriesRef.current); } catch {}
      aptSeriesRef.current = null;
    }

    if (!aptX.length || !aptAvg.length) return;

    const baseDateStr = monthsAgo(normMonthsAgo);
    const baseTs = new Date(baseDateStr).getTime();

    // 아파트 월 데이터를 Finance 주간 포맷으로 변환 (전체 기간, 필터 없음)
    const aptPoints = [];
    for (let i = 0; i < aptX.length; i++) {
      const ym = aptX[i]; // "YYYY-MM"
      const val = aptAvg[i];
      if (!ym || !Number.isFinite(val)) continue;
      // 해당 월의 첫째 날을 time으로 사용 (Finance 첫 주와 근사)
      aptPoints.push({ time: `${ym}-01`, value: val });
    }
    if (!aptPoints.length) return;

    // normYearsAgo 기준점에 가장 가까운 포인트로 정규화
    const basePoint = aptPoints.reduce((prev, curr) =>
      Math.abs(new Date(curr.time).getTime() - baseTs) <
      Math.abs(new Date(prev.time).getTime() - baseTs) ? curr : prev
    );
    const baseValue = basePoint.value;
    if (!baseValue) return;

    const normalized = aptPoints.map(p => ({
      time: p.time,
      value: Math.round((p.value / baseValue) * 10000) / 100,
    }));

    const series = chart.addSeries(LineSeries, {
      color: 'rgba(196, 154, 42, 0.7)', //아파트 aptNm 실선 투명도 양식
      lineWidth: 2,
      lineStyle: 0, // dashed
      priceScaleId: 'right',
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: { type: 'custom', formatter: v => Math.round(v) + '%', minMove: 1 },
    });
    series.setData(normalized);
    aptSeriesRef.current = series;
    const monthMap = {};
    normalized.forEach(p => { monthMap[p.time.slice(0, 7)] = p.value; });
    aptMonthMapRef.current = monthMap;
  }, [aptX, aptAvg, yearWindow, normMonthsAgo]); // eslint-disable-line react-hooks/exhaustive-deps

  // 아파트 시리즈 표시/숨김
  useEffect(() => {
    if (!aptSeriesRef.current) return;
    aptSeriesRef.current.applyOptions({ visible: showApt });
  }, [showApt]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', color: '#6B625B' }}>
          로딩 중…
        </div>
      )}
      {errMsg && <div style={{ padding: '8px 10px', color: '#c33', fontSize: '0.82rem' }}>{errMsg}</div>}

      {/* 범례 */}
      <div ref={headerRef} style={{ display: 'flex', gap: 10, padding: '4px 4px 6px', flexWrap: 'wrap' }}>
        {selected.map(k => {
          const a = ASSET_MAP[k];
          return (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, color: '#1F1D1B' }}>
              <span style={{ width: 16, height: 2, background: a.color, display: 'inline-block', borderRadius: 2 }} />
              {a.label}
            </span>
          );
        })}
        {aptName && aptAvg.length > 0 && showApt && (
          <span key={aptName} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, borderRadius: 4, padding: '1px 4px', animation: 'aptNameHighlightBg 2s ease-out forwards' }}>
            <span style={{ width: 16, height: 3, background: 'rgba(196, 154, 42, 0.7)', display: 'inline-block', borderRadius: 2 }} />
            <span style={{ animation: 'aptNameHighlightText 2s ease-out forwards' }}>{aptName}</span>
          </span>
        )}
      </div>

      {/* 차트 + 수직 기준선 overlay */}
      <div style={{ position: 'relative', width: '100%' }}>
        <div ref={containerRef} style={{ width: '100%', height: dynChartHeight, background: '#F5F2EE', borderRadius: 8 }} />
        {/* 스크롤 양보 오버레이 */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 52, height: '100%', zIndex: 10 }} />
        <div style={{ position: 'absolute', top: 0, right: 0, width: 16, height: '100%', zIndex: 10 }} />

        {/* 수직 점선 — 기준점(100%) 표시 */}
        {baseLineX != null && (
          <div style={{
            position: 'absolute',
            top: 0,
            bottom: timeScaleHeight,
            left: baseLineX,
            width: 0,
            borderLeft: '1.5px dashed #6B625B',
            pointerEvents: 'none',
            zIndex: 5,
          }}>
            <div style={{
              position: 'absolute',
              top: 7,
              left: 0,
              transform: 'translateX(-50%)',
              background: 'rgba(107,98,91,0.75)',
              color: '#fff',
              fontSize: '0.68rem',
              fontWeight: 700,
              borderRadius: 4,
              padding: '2px 6px',
              textAlign: 'center',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
            }}>
              100%<br />
              {baseTimeRef.current
                ? (() => { const d = new Date(baseTimeRef.current); return `${d.getFullYear()}/${d.getMonth() + 1}`; })()
                : ''}
            </div>
          </div>
        )}
      </div>

      {/* 툴팁 */}
      {tooltip && Object.keys(tooltip.vals).length > 0 && (
        <div style={{ position: 'absolute', top: 36, left: 8, background: 'rgba(31,29,27,0.88)', color: '#fff', borderRadius: 6, padding: '3px 7px', fontSize: '0.68rem', fontWeight: 600, pointerEvents: 'none', zIndex: 20, lineHeight: 1.6 }}>
          <div style={{ color: '#C9BFB4', marginBottom: 2 }}>{tooltip.time}</div>
          {Object.entries(tooltip.vals).map(([k, v]) => {
            const color = k === 'APT' ? 'rgba(196,154,42,0.9)' : ASSET_MAP[k]?.color;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: color, flexShrink: 0,
                }} />
                <span style={{ color }}>
                  {Math.round(Number(v))}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────
export default function FinanceChart({ isMobile = false, aptX = [], aptAvg = [], aptName = null, onOpenChartPanel }) {
  const [slots, setSlots] = useState(['SP500', null, null]); // 3칸 고정, null = 빈 슬롯
  const selected = useMemo(() => slots.filter(Boolean), [slots]);
  const rateKeys  = useMemo(() => selected.filter(k => ASSET_MAP[k]?.isRate), [selected]);
  const priceKeys = useMemo(() => selected.filter(k => !ASSET_MAP[k]?.isRate), [selected]);
  const priceKeyArrays = useMemo(() => priceKeys.map(k => [k]), [priceKeys]);
  const [currency, setCurrency] = useState('KRW');
  const [yearWindow, setYearWindow] = useState(5);
  const [normMonthsAgo, setNormMonthsAgo] = useState(36); // 기본: 36개월(3년) 전 = 100%
  const [pressedNorm, setPressedNorm] = useState(null); // 'back' | 'forward' | null
  const [showApt, setShowApt] = useState(true);
  const [tooltipInfo, setTooltipInfo] = useState(null); // { key, align: 'left'|'right' }


  const toggleAsset = useCallback((key) => {
    setSlots(prev => {
      const idx = prev.indexOf(key);
      if (idx !== -1) {
        // 선택 해제: 해당 슬롯만 null로, 나머지 슬롯 유지
        const next = [...prev];
        next[idx] = null;
        return next;
      }
      // 추가: 첫 번째 빈 슬롯에 배치
      const emptyIdx = prev.indexOf(null);
      if (emptyIdx !== -1) {
        const next = [...prev];
        next[emptyIdx] = key;
        return next;
      }
      // 3개 모두 찬 경우: 마지막 슬롯 교체
      return [prev[0], prev[1], key];
    });
  }, []);

  // 기준 연월 표시
  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() - normMonthsAgo);
  const baseLabel = normMonthsAgo === 0
    ? `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`
    : `${baseDate.getFullYear()}년 ${baseDate.getMonth() + 1}월`;

  // [-3M] 비활성화: 선택 자산 중 가장 늦은 데이터 시작일보다 더 이전이면 막기
  const dataEarliestDate = selected
    .map(k => {
      const idx = indexCache.get(k);
      if (!idx) return null;
      const minYear = Math.min(...idx.years.filter(y => yearDataCache.has(`${k}|${y}`)));
      return isFinite(minYear) ? `${minYear}-01-01` : null;
    })
    .filter(Boolean)
    .sort()
    .at(-1);
  const nextBaseDate = monthsAgo(normMonthsAgo + 3);
  const canGoBack = !dataEarliestDate || nextBaseDate >= dataEarliestDate;
  const canGoForward = normMonthsAgo > 0;

  return (
    <div style={{ marginTop: 0, padding: '0 0 4px' }}>

      {/* 섹션 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1F1D1B' }}>📊 글로벌 자산 비교</span>
          <span
            onClick={onOpenChartPanel}
            style={{
              fontSize: '0.75rem', color: '#888780', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 2,
            }}
          >
            상세보기
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 2l4 3-4 3" stroke="#888780" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['KRW', 'USD'].map(cur => (
            <button
              key={cur}
              onClick={() => setCurrency(cur)}
              style={{
                height: 22, width: 22, padding: 0, borderRadius: 6,
                border: currency === cur ? '1.5px solid #6B625B' : '1px solid #C9BFB4',
                background: currency === cur ? '#6B625B' : '#F7F3EE',
                color: currency === cur ? '#fff' : '#6B625B',
                fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {cur === 'KRW' ? '₩' : '$'}
            </button>
          ))}
        </div>
      </div>

      {/* 자산 선택 — 3열 컴팩트 그리드 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ padding: '0 2px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 3 }}>
            <div style={{ width: 2.5, borderRadius: 2, background: '#f5c518', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {ASSETS.map((a) => {
            const selIdx = slots.indexOf(a.key);
            const active = selIdx !== -1;
            return (
              <div
                key={a.key}
                onClick={() => toggleAsset(a.key)}
                onMouseEnter={(e) => {
                  if (!a.tooltip) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const parentRect = e.currentTarget.parentElement.getBoundingClientRect();
                  const align = rect.left > parentRect.left + parentRect.width / 2 ? 'right' : 'left';
                  setTooltipInfo({ key: a.key, align });
                }}
                onMouseLeave={() => setTooltipInfo(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 4px', borderRadius: 5, cursor: 'pointer',
                  position: 'relative',
                }}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: active ? a.color : '#C9BFB4',
                }} />
                <span style={{
                  fontSize: '0.72rem', fontWeight: active ? 700 : 400,
                  color: active ? a.color : '#888780',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {a.label}
                </span>
                {active && (
                  <span style={{
                    fontSize: '0.62rem', fontWeight: 900,
                    color: a.color, lineHeight: 1, flexShrink: 0,
                  }}>
                    {selIdx + 1}
                  </span>
                )}
                {tooltipInfo?.key === a.key && a.tooltip && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)',
                    ...(tooltipInfo.align === 'right' ? { right: 0 } : { left: 0 }),
                    background: '#1F1D1B', color: '#fff',
                    padding: '6px 10px', borderRadius: 8,
                    fontSize: '0.67rem', lineHeight: 1.6,
                    whiteSpace: 'pre', zIndex: 100,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
                    pointerEvents: 'none', textAlign: 'left', fontWeight: 500,
                  }}>
                    {a.tooltip.split('\n').map((line, i) => <div key={i}>{line || <>&nbsp;</>}</div>)}
                    <div style={{
                      position: 'absolute', top: '100%',
                      ...(tooltipInfo.align === 'right' ? { right: 10 } : { left: 10 }),
                      borderWidth: '5px 5px 0', borderStyle: 'solid',
                      borderColor: '#1F1D1B transparent transparent',
                    }} />
                  </div>
                )}
              </div>
            );
          })}
              </div>
              {/* 아파트 — 단독 행 */}
              {aptName && aptAvg.length > 0 && (
                <div
                  key={aptName}
                  onClick={() => setShowApt(p => !p)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 4px', borderRadius: 5, cursor: 'pointer',
                    animation: 'aptNameHighlightBg 2s ease-out forwards',
                  }}
                >
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: showApt ? 'rgba(196,154,42,0.9)' : '#C9BFB4',
                  }} />
                  <span style={{
                    fontSize: '0.72rem', fontWeight: showApt ? 700 : 400,
                    animation: showApt ? 'aptNameHighlightText 2s ease-out forwards' : 'none',
                  }}>
                    {aptName}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* X축 기간 조절 */}
      <div style={{ display: 'none', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.78rem', color: '#6B625B' }}>
        <span style={{ fontWeight: 700, color: '#1F1D1B', minWidth: 68 }}>X축 기간 조정</span>
        <button onClick={() => setYearWindow(p => Math.max(1, p - 1))} style={{ height: 28, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 6, background: '#F7F3EE', cursor: 'pointer', color: '#6B625B' }}>– 1년</button>
        <span style={{ minWidth: 44, textAlign: 'center' }}>최근 {yearWindow}년</span>
        <button onClick={() => setYearWindow(p => p + 1)} style={{ height: 28, padding: '0 10px', border: '1px solid #C9BFB4', borderRadius: 6, background: '#F7F3EE', cursor: 'pointer', color: '#6B625B' }}>+ 1년</button>
      </div>

      {/* 그래프1: 정규화 비교 */}
      <div style={{ borderTop: '1px solid #E6DED4', paddingTop: 8, marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1F1D1B' }}>
            자산 정규화 비교 : 시점 <span style={{ color: '#6B625B' }}>{baseLabel}</span>
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              onClick={() => {
                if (!canGoBack) return;
                const newMonths = normMonthsAgo + 3;
                setNormMonthsAgo(newMonths);
                if (newMonths / 12 >= yearWindow) setYearWindow(Math.ceil(newMonths / 12) + 1);
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
        <NormChart selected={selected} currency={currency} yearWindow={yearWindow} normMonthsAgo={normMonthsAgo} isMobile={isMobile} aptX={aptX} aptAvg={aptAvg} aptName={aptName} showApt={showApt} />
      </div>

      {/* 그래프2,3,4: 금리 자산 합산 + 일반 자산 개별 차트 */}
      <>
            {rateKeys.length > 0 && (
              <div style={{ borderTop: '1px solid #E6DED4', paddingTop: 8, marginBottom: 4 }}>
                <div style={{ fontSize: '0.92rem', fontWeight: 800, paddingBottom: 4 }}>
                  {rateKeys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span style={{ color: '#C9BFB4' }}> · </span>}
                      <span style={{ color: ASSET_MAP[k]?.color }}>{ASSET_MAP[k]?.label}</span>
                    </span>
                  ))}
                  <span style={{ color: '#6B625B', fontWeight: 600 }}> 주간 금리 차트</span>
                </div>
                <PriceChart selected={rateKeys} currency={currency} yearWindow={yearWindow} isMobile={isMobile} />
              </div>
            )}
            {priceKeys.map((k, idx) => {
              const a = ASSET_MAP[k];
              return (
                <div key={k} style={{ borderTop: '1px solid #E6DED4', paddingTop: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, paddingBottom: 4 }}>
                    <span style={{ color: a?.color }}>{a?.label}</span>
                    <span style={{ color: '#6B625B', fontWeight: 600 }}> 주간 종가 차트</span>
                  </div>
                  <PriceChart selected={priceKeyArrays[idx]} currency={currency} yearWindow={yearWindow} isMobile={isMobile} />
                </div>
              );
            })}
      </>

    </div>
  );
}