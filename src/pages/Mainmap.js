// src/pages/Mainmap.js
import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import { parseCSV } from '../styles/csvUtils';
import { trimAptName } from '../styles/aptNameUtils';
import { MAP_ALPHA } from '../styles/themes';
import {
  buildPNU, fetchWorkbook, fetchPdata,
  listAreasForPnu, aggregateTradesForArea,
  pickInitialArea, groupAreasToRep, normAptNm,
} from './services/aptData';

const fileCache    = new Map();
const geocodeCache = new Map(); // "lat2,lng2" → filename (역지오코딩 결과 캐시)
let code5MapCache = null;
let code5MapPromise = null;
const loadCode5Map = () => {
  if (code5MapCache) return Promise.resolve(code5MapCache);
  if (!code5MapPromise) {
    code5MapPromise = fetch(`${R2_BASE}/KaptList/code5_map.json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { code5MapCache = data; return data; })
      .catch(() => null);
  }
  return code5MapPromise;
};

const R2_BASE = process.env.NODE_ENV === 'production'
  ? "https://pub-8c65c427a291446c9384665be9201bea.r2.dev"
  : "";
// n×n 격자 샘플 포인트 (줌 레벨이 높을수록 뷰포트가 넓어 더 많이 필요)
const makeGridPoints = (bbox, n = 3) => {
  const lats = Array.from({ length: n }, (_, i) =>
    bbox.south + (bbox.north - bbox.south) * i / (n - 1));
  const lngs = Array.from({ length: n }, (_, i) =>
    bbox.west + (bbox.east - bbox.west) * i / (n - 1));
  const pts = [];
  for (const la of lats) for (const ln of lngs) pts.push({ lat: la, lng: ln });
  return pts;
};

// 포인트 → CSV 파일명 (역지오코딩 결과 캐시 우선)
// 실패 결과는 캐시하지 않음 — 일시적 API 오류로 잘못된 파일이 영구 캐시되는 버그 방지
const pointToFile = (pt) => {
  const cacheKey = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)}`;
  if (geocodeCache.has(cacheKey)) return Promise.resolve(geocodeCache.get(cacheKey));

  return new Promise((resolve) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2RegionCode(pt.lng, pt.lat, async (res, status) => {
      const fallback = `${R2_BASE}/KaptList/서울특별시_송파구_11710_list_coord.csv`;
      if (status !== window.kakao.maps.services.Status.OK || !res?.length) {
        // 실패 시 캐시 없이 fallback 반환 → 다음 onIdle에서 재시도
        resolve(fallback);
        return;
      }
      const b = res.find(r => r.region_type === 'B') || res[0];
      const code5 = (b.code || '').slice(0, 5) || '11710';

      const map = await loadCode5Map();
      const filename = map?.[code5]
        ? `${R2_BASE}/KaptList/${map[code5]}`
        : `${R2_BASE}/KaptList/${b.region_1depth_name || '서울특별시'}_${b.region_2depth_name || '송파구'}_${code5}_list_coord.csv`;

      geocodeCache.set(cacheKey, filename);
      resolve(filename);
    });
  });
};

// CSV 로드(캐시 우선) + 위도/경도 숫자화
const loadFile = async (file) => {
  if (fileCache.has(file)) return fileCache.get(file);
  try {
    const res = await fetch(file, { cache: 'force-cache' });
    if (!res.ok) return [];
    const rows = parseCSV(await res.text()).map(row => {
      const kakaoLat = parseFloat(row['위도']);
      const kakaoLng = parseFloat(row['경도']);
      const shpLat   = parseFloat(row['shp_lat']);
      const shpLng   = parseFloat(row['shp_lng']);
      const hasShp   = !isNaN(shpLat) && !isNaN(shpLng);
      return {
        ...row,
        위도: hasShp ? shpLat : kakaoLat,
        경도: hasShp ? shpLng : kakaoLng,
        kakao_lat: kakaoLat,
        kakao_lng: kakaoLng,
      };
    });
    fileCache.set(file, rows);
    return rows;
  } catch {
    return [];
  }
};

// 필터 패널 스타일
const FILTER_BTN_STYLE = {
  position: 'absolute',
  top: 12, right: 12,
  background: 'var(--color-surface)',
  border: '1.5px solid var(--map-border)',
  borderRadius: 20,
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--map-text)',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  userSelect: 'none',
  zIndex: 10,
};

const PANEL_STYLE = {
  position: 'absolute',
  top: 50, right: 12,
  background: 'var(--color-surface)',
  border: '1px solid var(--map-border)',
  borderRadius: 12,
  padding: '14px 16px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
  zIndex: 10,
  minWidth: 220,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const SECTION_TITLE = {
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--color-text-muted)',
  marginBottom: 6,
  letterSpacing: '0.04em',
};

const TOGGLE_CHIP = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: 12,
  border: `1.5px solid ${active ? 'var(--map-accent)' : 'var(--map-border)'}`,
  background: active ? 'var(--map-accent-bg)' : 'var(--map-surface)',
  color: active ? 'var(--map-text)' : 'var(--map-text-muted)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'all 0.15s',
});

const DEFAULT_SALE_NM = ['분양', '임대', '혼합'];

// "(숫자+동)" 으로 끝나는 유령 단지 패턴
const GHOST_APT_RE = /\(\d+동\)$/;

const TOGGLE_SWITCH = (active) => ({
  position: 'relative',
  display: 'inline-block',
  width: 36,
  height: 20,
  flexShrink: 0,
});

const SWITCH_TRACK = (active) => ({
  position: 'absolute',
  inset: 0,
  borderRadius: 10,
  background: active ? 'var(--map-accent)' : '#d0d7e8',
  transition: 'background 0.2s',
  cursor: 'pointer',
});

const SWITCH_THUMB = (active) => ({
  position: 'absolute',
  top: 3,
  left: active ? 19 : 3,
  width: 14,
  height: 14,
  borderRadius: '50%',
  background: 'var(--color-surface)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
  transition: 'left 0.2s',
  pointerEvents: 'none',
});

function PriceDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: '1em' }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 4, height: 4,
            borderRadius: '50%',
            background: 'var(--map-accent)',
            display: 'inline-block',
            animation: 'priceDotBounce 1s ease-in-out infinite',
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes priceDotBounce {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </span>
  );
}

function FilterPanel({ filters, onChange, aptTypeOptions, onClose }) {
  const { saleNm, minHoCnt, minUsedate, aptNm, removeGhostApt } = filters;

  const toggleSale = (v) => {
    const next = saleNm.includes(v) ? saleNm.filter(x => x !== v) : [...saleNm, v];
    if (next.length === 0) return; // 최소 1개 선택 유지
    onChange({ ...filters, saleNm: next });
  };

  const toggleApt = (v) => {
    const next = aptNm.includes(v) ? aptNm.filter(x => x !== v) : [...aptNm, v];
    if (next.length === 0) return;
    onChange({ ...filters, aptNm: next });
  };

  return (
    <div style={PANEL_STYLE}>
      {/* 분양구분 */}
      <div>
        <div style={SECTION_TITLE}>분양구분</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DEFAULT_SALE_NM.map(v => (
            <div key={v} style={TOGGLE_CHIP(saleNm.includes(v))} onClick={() => toggleSale(v)}>{v}</div>
          ))}
        </div>
      </div>

      {/* 세대수 */}
      <div>
        <div style={SECTION_TITLE}>세대수 (최소)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0} max={3000} step={10}
            value={minHoCnt}
            onChange={e => onChange({ ...filters, minHoCnt: Number(e.target.value) })}
            style={{ flex: 1, accentColor: 'var(--map-accent)' }}
          />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--map-text)', minWidth: 50 }}>
            {minHoCnt === 0 ? '전체' : `${minHoCnt}세대+`}
          </span>
        </div>
      </div>

      {/* 사용승인일 */}
      <div>
        <div style={SECTION_TITLE}>사용승인일 (최소)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={1980} max={2025} step={1}
            value={minUsedate}
            onChange={e => onChange({ ...filters, minUsedate: Number(e.target.value) })}
            style={{ flex: 1, accentColor: 'var(--map-accent)' }}
          />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--map-text)', minWidth: 50 }}>
            {minUsedate === 1980 ? '전체' : `${minUsedate}년+`}
          </span>
        </div>
      </div>

      {/* 건물구분 */}
      {aptTypeOptions.length > 0 && (
        <div>
          <div style={SECTION_TITLE}>건물구분</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {aptTypeOptions.map(v => (
              <div key={v} style={TOGGLE_CHIP(aptNm.includes(v))} onClick={() => toggleApt(v)}>{v}</div>
            ))}
          </div>
        </div>
      )}

      {/* 유령 단지 제거 */}
      <div>
        <div style={SECTION_TITLE}>유령 단지 제거</div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={() => onChange({ ...filters, removeGhostApt: !removeGhostApt })}
        >
          <div style={TOGGLE_SWITCH(removeGhostApt)}>
            <div style={SWITCH_TRACK(removeGhostApt)} />
            <div style={SWITCH_THUMB(removeGhostApt)} />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 600, color: removeGhostApt ? 'var(--map-text)' : 'var(--map-text-muted)' }}>
            단일 동 제거
          </span>
        </div>
      </div>

      {/* 초기화 */}
      <div
        style={{ textAlign: 'center', fontSize: '12px', color: 'var(--map-accent)', cursor: 'pointer', fontWeight: 600 }}
        onClick={() => onChange({
          saleNm: ['분양', '혼합'],
          minHoCnt: 10,
          minUsedate: 1980,
          aptNm: aptTypeOptions.filter(t => ['아파트', '주상복합'].includes(t)),
          removeGhostApt: true,
        })}
      >
        필터 초기화
      </div>
    </div>
  );
}

// 별 아이콘: filled=true → 노란 채움, false → 테두리만
function StarIcon({ size = 12, filled = false, strokeColor = '#b0bac8' }) {
  const sw = (12 / size) * 1.1;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: 'block', flexShrink: 0 }}>
      <polygon
        points="6,0.5 7.35,4.14 11.23,4.3 8.19,6.71 9.23,10.45 6,8.3 2.77,10.45 3.81,6.71 0.77,4.3 4.65,4.14"
        fill={filled ? '#FFD700' : 'none'}
        stroke={filled ? '#e6a800' : strokeColor}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Mainmap({ mapCenter, setMapCenter, mapLevel, setMapLevel, onSelectApt, onOpenChart, selectedApt = null, favApts = [], addFavoriteApt, removeFavoriteApt, isHidden, relayoutKey, mapPaddingTop = 0, theme = 'rose_slate' }) {
  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const [popupVisible, setPopupVisible] = useState(false);

  // 칩 영역 높이만큼 지도 상단 패딩 적용 — 팝업이 칩 아래에 표시되도록
  useEffect(() => {
    if (kakaoMapRef.current?.setPadding) {
      kakaoMapRef.current.setPadding(mapPaddingTop, 0, 0, 0);
    }
  }, [mapPaddingTop]);

  // 패널이 닫히거나 미니맵 모드가 바뀔 때 relayout
  // 슬라이드 애니메이션(300ms) 완료 후 호출해야 지도 크기가 정확히 계산됨
  const relayoutTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(relayoutTimerRef.current);
    if (!isHidden && mapRef.current) {
      relayoutTimerRef.current = setTimeout(() => {
        mapRef.current?.relayout();
      }, 320);
    }
  }, [isHidden, relayoutKey]);
  const [level, setLevel] = useState(mapLevel ?? 5);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(false);
  // kaptKey → { area, price } 마커 가격 캐시
  const [markerPrices, setMarkerPrices] = useState(new Map());
  // 가격 로딩 중인 kaptKey Set
  const [loadingPriceKeys, setLoadingPriceKeys] = useState(new Set());
  // 로드 완료했으나 6년 내 거래 없는 kaptKey Set
  const [noPriceKeys, setNoPriceKeys] = useState(new Set());
  const noPriceRef = useRef(new Set()); // 재시도 방지용 동기 참조

  // 필터 상태
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({
    saleNm: ['분양', '혼합'],
    minHoCnt: 10,
    minUsedate: 1980,
    aptNm: [], // 빈 배열 = 아직 옵션 미수집 (= 전체 허용)
    removeGhostApt: true,
  });
  const [aptTypeOptions, setAptTypeOptions] = useState([]);

  const lastBBoxRef = useRef(null);
  const idleTimerRef = useRef(null);
  const priceDoneRef = useRef(new Set()); // 이미 계산 완료된 kaptKey

  // 필지 경계 폴리곤
  const SHPpolygonListRef   = useRef([]);   // kakao.maps.Polygon[]
  const KaptPolygonCacheRef = useRef({});   // bjdCode → KaptPolygon JSON

  useEffect(() => {
    const clearAll = () => {
      SHPpolygonListRef.current.forEach(p => p.setMap(null));
      SHPpolygonListRef.current = [];
    };
    clearAll();

    if (!selectedApt?.bjdCode || !mapRef.current) return;

    const kakao = window.kakao;
    if (!kakao?.maps?.Polygon) return;

    const bjdCode  = String(selectedApt.bjdCode).padStart(10, '0');
    const kaptCode = selectedApt.kaptCode;

    const draw = (kaptData) => {
      const entry = kaptData?.[kaptCode];
      if (!entry) return;
      // polygons: 새 포맷 (배열의 배열), polygon: 구 포맷 (단일 배열) 모두 대응
      const polyList = entry.polygons ?? (entry.polygon ? [entry.polygon] : null);
      if (!polyList?.length) return;
      polyList.forEach(coords => {
        if (!coords || coords.length < 3) return;
        const path = coords.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
        const poly = new kakao.maps.Polygon({
          map: mapRef.current,
          path,
          strokeWeight: 2,
          strokeColor: '#C9A84C',
          strokeOpacity: 0.9,
          fillColor: '#C9A84C',
          fillOpacity: 0.10,
        });
        SHPpolygonListRef.current.push(poly);
      });
    };

    const cached = KaptPolygonCacheRef.current[bjdCode];
    if (cached !== undefined) {
      draw(cached);
    } else {
      fetch(`${R2_BASE}/KaptPolygon/${bjdCode}.json`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          KaptPolygonCacheRef.current[bjdCode] = d;
          if (SHPpolygonListRef.current.length === 0) draw(d);
        })
        .catch(() => { KaptPolygonCacheRef.current[bjdCode] = null; });
    }

    return clearAll;
  }, [selectedApt]);

  // 스타일 B — 네이버 부동산 스타일 pill
  const labelStyle = useMemo(() => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 10px',
    borderRadius: 20,
    background: 'var(--color-surface)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.20)',
    fontWeight: 700,
    fontSize: '12px',
    color: 'var(--map-text)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    gap: 5,
    border: '1.5px solid var(--map-border)',
  }), []);


  // 즐겨찾기 Set — O(1) 조회용
  const favSet = useMemo(() => new Set((favApts || []).map(a => a.key)), [favApts]);

  // 좌표가 저장된 즐겨찾기 Set — 독립 섹션에서 렌더링하므로 filteredMarkers에서 skip
  const favWithCoordsSet = useMemo(
    () => new Set((favApts || []).filter(f => f['위도'] != null).map(f => f.key)),
    [favApts]
  );

  // 클릭한 마커 1개의 가격·면적을 온디맨드로 로드 (L1과 동일한 면적 선택 알고리즘)
  const loadSinglePrice = async (row) => {
    const key = `${row['kaptName']}_${row['bjdCode'] || ''}`;
    if (priceDoneRef.current.has(key) || noPriceRef.current.has(key)) return;
    const code5 = String(row['bjdCode'] || '').slice(0, 5);
    if (!code5) return;
    setLoadingPriceKeys(prev => { const s = new Set(prev); s.add(key); return s; });

    try {
      const as1 = row['as1'] || '', as2 = row['as2'] || '';
      const [rResult, pResult] = await Promise.allSettled([
        fetchWorkbook(as1, as2, code5),
        fetchPdata(as1, as2, code5),
      ]);
      if (rResult.status === 'rejected') return;
      const { wb } = rResult.value;
      const pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;
      const { pnu } = buildPNU(row);
      if (!pnu) return;

      const rawAreas = listAreasForPnu(wb, pnu, row['kaptName'] || null, pdWb);
      const repAreas = groupAreasToRep(rawAreas);
      if (!repAreas.length) return;

      const cutoff = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 3);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();
      const pnuStr = String(pnu);
      const normName = row['kaptName'] ? normAptNm(row['kaptName']) : null;
      const volMap = new Map();

      for (const obj of (wb || [])) {
        const match = (String(obj.pnu).trim() === pnuStr) ||
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

      for (const obj of (pdWb || [])) {
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

      const hot1Area = [...volMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const area = hot1Area ?? pickInitialArea(repAreas);
      if (!area) return;

      const agg = aggregateTradesForArea({
        wb, pdWb, pnu, kaptName: row['kaptName'] || null,
        areaNorm: area, smoothWindow: 3,
      });
      const lastPrice = [...agg.avg].reverse().find(v => Number.isFinite(v));
      if (!Number.isFinite(lastPrice)) return;
      priceDoneRef.current.add(key);
      setMarkerPrices(prev => new Map([...prev, [key, { area, price: Math.round(lastPrice * 10) / 10 }]]));
    } catch { /* 워크북 없으면 무시 */ }
    finally {
      setLoadingPriceKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
      if (!priceDoneRef.current.has(key)) {
        noPriceRef.current.add(key);
        setNoPriceKeys(prev => { const s = new Set(prev); s.add(key); return s; });
      }
    }
  };

  const onIdle = useCallback((map) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(async () => {
      // 줌 레벨 8 이상은 마커 사용 안 함
      if (map.getLevel() >= 8) {
        setMarkers([]);
        return;
      }

      const b = map.getBounds();
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      const bbox = { south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() };

      const currentLevel = map.getLevel();
      if (lastBBoxRef.current) {
        const levelChanged = lastBBoxRef.current.level !== currentLevel;
        const movedEnough =
          Math.abs(bbox.south - lastBBoxRef.current.south) > 0.002 ||
          Math.abs(bbox.west  - lastBBoxRef.current.west ) > 0.002 ||
          Math.abs(bbox.north - lastBBoxRef.current.north) > 0.002 ||
          Math.abs(bbox.east  - lastBBoxRef.current.east ) > 0.002;
        if (!levelChanged && !movedEnough) return;
      }
      lastBBoxRef.current = { ...bbox, level: currentLevel };

      setLoading(true);
      try {
        // 줌 레벨이 높을수록(광역) 그리드를 촘촘하게 + 중심점 항상 포함
        const gridN = currentLevel >= 7 ? 4 : currentLevel >= 5 ? 3 : 2;
        const centerPt = { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 };
        const pts = [centerPt, ...makeGridPoints(bbox, gridN)];
        const files = Array.from(new Set(await Promise.all(pts.map(pointToFile))));
        const all = (await Promise.all(files.map(loadFile))).flat();
        // 뷰포트 밖 마커 제거 (약간의 여유를 두어 가장자리 마커 보존)
        const pad = (bbox.north - bbox.south) * 0.05;
        const inView = all.filter(row =>
          row['위도'] >= bbox.south - pad && row['위도'] <= bbox.north + pad &&
          row['경도'] >= bbox.west  - pad && row['경도'] <= bbox.east  + pad
        );
        const dedup = [];
        const seen = new Set();
        for (const row of inView) {
          const key = `${row['위도']}|${row['경도']}|${row['kaptName']}`;
          if (!seen.has(key)) { seen.add(key); dedup.push(row); }
        }
        setMarkers(dedup);

        // 건물구분 옵션 동적 수집
        const types = [...new Set(dedup.map(r => r['codeAptNm']).filter(Boolean))].sort();
        setAptTypeOptions(prev => {
          const merged = [...new Set([...prev, ...types])].sort();
          // 새로운 타입이 생겨도 아파트·주상복합만 자동 선택
          setFilters(f => {
            const newTypes = types.filter(t => !prev.includes(t));
            if (newTypes.length === 0) return f;
            const DEFAULT_SELECTED = ['아파트', '주상복합'];
            const toAdd = newTypes.filter(t => DEFAULT_SELECTED.includes(t));
            if (toAdd.length === 0) return f;
            return { ...f, aptNm: [...new Set([...f.aptNm, ...toAdd])] };
          });
          return merged;
        });

      } finally {
        setLoading(false);
      }
    }, 200);
  }, []); // 필터 상태는 filtersRef/aptTypeOptionsRef를 통해 최신값 유지

  // 필터 적용
  const filteredMarkers = useMemo(() => {
    return markers.filter(row => {
      // 분양구분
      const sale = row['codeSaleNm'] || '';
      if (filters.saleNm.length > 0 && !filters.saleNm.includes(sale)) {
        // 알 수 없는 값은 통과
        if (DEFAULT_SALE_NM.includes(sale)) return false;
      }
      // 세대수
      if (filters.minHoCnt > 0) {
        const cnt = parseFloat(row['kaptdaCnt']) || 0;
        if (cnt < filters.minHoCnt) return false;
      }
      // 사용승인일
      if (filters.minUsedate > 1980) {
        const dateStr = String(row['kaptUsedate'] || '');
        const year = parseInt(dateStr.slice(0, 4), 10);
        if (!isNaN(year) && year < filters.minUsedate) return false;
      }
      // 건물구분
      if (filters.aptNm.length > 0 && aptTypeOptions.length > 0) {
        const apt = row['codeAptNm'] || '';
        if (aptTypeOptions.includes(apt) && !filters.aptNm.includes(apt)) return false;
      }
      // 유령 단지 제거 — "(숫자+동)"으로 끝나는 단지 제거
      if (filters.removeGhostApt && GHOST_APT_RE.test(row['kaptName'] || '')) return false;
      return true;
    });
  }, [markers, filters, aptTypeOptions]);

  // 활성 필터 개수 (배지용)
  const activeFilterCount = useMemo(() => {
    let cnt = 0;
    if (filters.saleNm.length < DEFAULT_SALE_NM.length) cnt++;
    if (filters.minHoCnt > 0) cnt++;
    if (filters.minUsedate > 1980) cnt++;
    if (aptTypeOptions.length > 0 && filters.aptNm.length < aptTypeOptions.length) cnt++;
    if (filters.removeGhostApt) cnt++;
    return cnt;
  }, [filters, aptTypeOptions]);

  const selectRow = (row) => {
    const isAlreadySelected =
      selectedApt != null &&
      row['kaptName'] === selectedApt['kaptName'] &&
      row['bjdCode'] === selectedApt['bjdCode'];
    if (isAlreadySelected) {
      if (typeof onOpenChart === 'function') onOpenChart(row);
    } else {
      if (typeof onSelectApt === 'function') onSelectApt(row);
      setPopupVisible(true);
      loadSinglePrice(row); // 마커 확장 시 가격 온디맨드 로드
    }
  };

  // 지도 배경 클릭/터치 시 팝업만 닫기 — selectedApt(LeftPanel 정보)는 유지
  // KakaoMap onClick은 clickable 오버레이(마커)를 누를 때 발생하지 않으므로 마커 클릭과 충돌 없음
  const handleMapClick = useCallback(() => {
    setPopupVisible(false);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <KakaoMap
        ref={mapRef}
        center={mapCenter}
        style={{ width: '100%', height: '100%' }}
        level={level}
        onCreate={(map) => { kakaoMapRef.current = map; }}
        onClick={handleMapClick}
        onCenterChanged={(map) => {
          kakaoMapRef.current = map;
          setMapCenter({ lat: map.getCenter().getLat(), lng: map.getCenter().getLng() });
          const lv = map.getLevel();
          setLevel(lv);
          setMapLevel(lv);
        }}
        onZoomChanged={(map) => {
          const lv = map.getLevel();
          setLevel(lv);
          setMapLevel(lv);
        }}
        onIdle={onIdle}
      >
        {loading && (
          <CustomOverlayMap position={mapCenter} yAnchor={1}>
            <div style={{ ...labelStyle, background: 'var(--map-surface)', borderStyle: 'dashed', fontWeight: 700, borderRadius: 8 }}>
              로딩 중…
            </div>
          </CustomOverlayMap>
        )}

        {/* 줌 레벨별 마커 렌더링 */}
        {filteredMarkers.map((row) => {
          const pos = { lat: row['위도'], lng: row['경도'] };
          const aptKey = `${row['kaptName']}_${row['bjdCode'] || ''}`;
          // 좌표 저장된 즐겨찾기는 전용 섹션에서 렌더링 (중복 방지)
          if (favWithCoordsSet.has(aptKey)) return null;
          const sel = selectedApt != null &&
            row['kaptName'] === selectedApt['kaptName'] &&
            row['bjdCode'] === selectedApt['bjdCode'];
          // 팝업이 열려있을 때만 전용 팝업 섹션에서 렌더링 (위치 재계산 방지)
          if (sel && popupVisible) return null;
          const fav = favSet.has(aptKey);

          // 레벨 5+: 즐겨찾기→별 / 기본→주황 점
          if (level >= 5) {
            if (fav) {
              return (
                <CustomOverlayMap key={`dot-${aptKey}`} position={pos} yAnchor={0.5} xAnchor={0.5} clickable>
                  <div onClick={() => selectRow(row)} style={{ cursor: 'pointer', lineHeight: 0 }}>
                    <StarIcon size={level >= 7 ? 22 : 29} filled />
                  </div>
                </CustomOverlayMap>
              );
            }
            const dotSize = level >= 7 ? 7 : 10;
            return (
              <CustomOverlayMap key={`dot-${aptKey}`} position={pos} yAnchor={0.5} xAnchor={0.5} clickable>
                <div
                  onClick={() => selectRow(row)}
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: '50%',
                    background: 'var(--marker-normal)',
                    border: '2px solid #fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.30)',
                    cursor: 'pointer',
                  }}
                />
              </CustomOverlayMap>
            );
          }

          // 레벨 1~4: collapsed 라벨
          return (
            <CustomOverlayMap key={`lbl-${aptKey}`} position={pos} yAnchor={1} xAnchor={0.5} clickable>
              <div
                onClick={() => selectRow(row)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  borderRadius: 6, background: 'var(--map-accent)',
                  padding: '5px 10px',
                  boxShadow: `0 2px 8px ${MAP_ALPHA[theme].a25}`,
                  whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                  fontSize: '12px', fontWeight: 500,
                  color: 'var(--color-surface)', letterSpacing: '-0.3px',
                }}
              >
                {fav && <StarIcon size={20} filled strokeColor="rgba(255,255,255,0.7)" />}
                <span>{trimAptName(row['kaptName'])}</span>
              </div>
            </CustomOverlayMap>
          );
        })}

        {/* 즐겨찾기 전용 마커 — 줌 레벨·필터 무관, 항상 최상위(zIndex=20) */}
        {(favApts || []).filter(f => f['위도'] != null).map((fav) => {
          const pos = { lat: fav['위도'], lng: fav['경도'] };
          const sel = selectedApt != null &&
            fav.kaptName === selectedApt['kaptName'] &&
            fav.bjdCode === selectedApt['bjdCode'];
          // 팝업이 열려있을 때만 전용 팝업 섹션에서 렌더링 (위치 재계산 방지)
          if (sel && popupVisible) return null;

          if (level >= 5) {
            return (
              <CustomOverlayMap key={`fav-star-${fav.key}`} position={pos} yAnchor={0.5} xAnchor={0.5} clickable zIndex={20}>
                <div onClick={() => selectRow(fav)} style={{ cursor: 'pointer', lineHeight: 0 }}>
                  <StarIcon size={level >= 7 ? 22 : 29} filled />
                </div>
              </CustomOverlayMap>
            );
          }

          return (
            <CustomOverlayMap key={`fav-star-${fav.key}`} position={pos} yAnchor={1} xAnchor={0.5} clickable zIndex={20}>
              <div
                onClick={() => selectRow(fav)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  borderRadius: 6, background: 'var(--map-accent)',
                  padding: '5px 10px',
                  boxShadow: `0 2px 8px ${MAP_ALPHA[theme].a25}`,
                  whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                  fontSize: '12px', fontWeight: 500,
                  color: 'var(--color-surface)', letterSpacing: '-0.3px',
                }}
              >
                <StarIcon size={20} filled strokeColor="rgba(255,255,255,0.7)" />
                <span>{trimAptName(fav.kaptName)}</span>
              </div>
            </CustomOverlayMap>
          );
        })}
        {/* 선택 아파트 전용 팝업 — key 고정으로 재마운트/위치 재계산 방지 */}
        {selectedApt && popupVisible && (() => {
          const aptKey = `${selectedApt['kaptName']}_${selectedApt['bjdCode'] || ''}`;
          const pos = { lat: selectedApt['위도'], lng: selectedApt['경도'] };
          const isFav = favSet.has(aptKey);
          const info = markerPrices.get(aptKey);
          const isPriceLoading = loadingPriceKeys.has(aptKey);
          const isNoPrice = noPriceKeys.has(aptKey);
          const year = String(selectedApt['kaptUsedate'] || '').slice(0, 4);
          return (
            <CustomOverlayMap key="selected-popup" position={pos} yAnchor={1} xAnchor={0.5} clickable zIndex={25}>
              <div
                onClick={() => selectRow(selectedApt)}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                style={{
                  borderRadius: 6, background: 'var(--color-surface)',
                  border: '1.5px solid var(--map-accent-border)',
                  boxShadow: `0 2px 8px ${MAP_ALPHA[theme].a25}`,
                  overflow: 'hidden',
                  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                }}
              >
                <div style={{ padding: '6px 10px 7px' }}>
                  <div style={{ fontSize: 13, color: 'var(--map-text)', marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span>{trimAptName(selectedApt['kaptName'])}</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); isFav ? removeFavoriteApt?.(aptKey) : addFavoriteApt?.(selectedApt); }}
                      style={{ cursor: 'pointer', lineHeight: 0, flexShrink: 0 }}
                    >
                      <StarIcon size={25} filled={isFav} />
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--map-accent)', lineHeight: 1.2 }}>
                    {info ? `${info.price}억` : isPriceLoading ? <PriceDots /> : isNoPrice ? '6년 거래X' : '–'}
                  </div>
                  {(info || year) && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, borderTop: '0.5px solid var(--map-accent-bg)', paddingTop: 6 }}>
                      {year && <span style={{ fontSize: 10, background: 'var(--map-accent-bg)', color: 'var(--map-accent)', borderRadius: 4, padding: '2px 6px' }}>{year}년</span>}
                      {selectedApt['kaptdaCnt'] && <span style={{ fontSize: 10, background: 'var(--map-accent-bg)', color: 'var(--map-accent)', borderRadius: 4, padding: '2px 6px' }}>{Math.floor(selectedApt['kaptdaCnt'])}세대</span>}
                      {info && <span style={{ fontSize: 10, background: 'var(--map-accent-bg)', color: 'var(--map-accent)', borderRadius: 4, padding: '2px 6px' }}>{info.area}㎡</span>}
                    </div>
                  )}
                </div>
              </div>
            </CustomOverlayMap>
          );
        })()}
      </KakaoMap>

      {/* 필터 버튼 */}
      <div style={FILTER_BTN_STYLE} onClick={() => setFilterOpen(o => !o)}>
        <span>필터</span>
        {activeFilterCount > 0 && (
          <span style={{
            background: 'var(--map-accent)',
            color: 'var(--color-surface)',
            borderRadius: '50%',
            width: 18, height: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 700,
          }}>{activeFilterCount}</span>
        )}
      </div>

      {/* 필터 패널 */}
      {filterOpen && (
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          aptTypeOptions={aptTypeOptions}
          onClose={() => setFilterOpen(false)}
        />
      )}

      <div style={{
        position: 'absolute',
        right: 12, bottom: 12,
        background: 'rgba(255,255,255,0.78)',
        border: '1px solid #e6ebf5',
        borderRadius: 8, padding: '6px 10px',
        fontSize: '12px', color: '#334', fontWeight: 600, pointerEvents: 'none',
      }}>
        Zoom Level: {level}
      </div>
    </div>
  );
}

export default Mainmap;
