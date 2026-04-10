// src/pages/Mainmap.js
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import { parseCSV } from '../utils/csvUtils';
import { trimAptName } from '../utils/aptNameUtils';
import {
  buildPNU, fetchWorkbook, fetchPdata,
  listAreasForPnu, aggregateTradesForArea,
  pickInitialArea, groupAreasToRep,
} from './services/aptData';

const fileCache    = new Map();
const geocodeCache = new Map(); // "lat2,lng2" → filename (역지오코딩 결과 캐시)
let code5MapCache = null;
const loadCode5Map = async () => {
  if (code5MapCache) return code5MapCache;
  try {
    const r = await fetch(`${R2_BASE}/KaptList/code5_map.json`, { cache: 'no-store' });
    if (r.ok) code5MapCache = await r.json();
  } catch { /* 로드 실패 시 null 유지 */ }
  return code5MapCache;
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
const pointToFile = (pt) => {
  const cacheKey = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)}`;
  if (geocodeCache.has(cacheKey)) return Promise.resolve(geocodeCache.get(cacheKey));

  return new Promise((resolve) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2RegionCode(pt.lng, pt.lat, async (res, status) => {
      const fallback = `${R2_BASE}/KaptList/서울특별시_송파구_11710_list_coord.csv`;
      if (status !== window.kakao.maps.services.Status.OK || !res?.length) {
        geocodeCache.set(cacheKey, fallback);
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
    const rows = parseCSV(await res.text()).map(row => ({
      ...row,
      위도: parseFloat(row['위도']),
      경도: parseFloat(row['경도']),
    }));
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
  background: '#fff',
  border: '1.5px solid #e0e8ff',
  borderRadius: 20,
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 700,
  color: '#1f2b49',
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
  background: '#fff',
  border: '1px solid #e0e8ff',
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
  color: '#888',
  marginBottom: 6,
  letterSpacing: '0.04em',
};

const TOGGLE_CHIP = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: 12,
  border: `1.5px solid ${active ? '#4a7fff' : '#dde3f0'}`,
  background: active ? '#eef3ff' : '#f7f9fc',
  color: active ? '#1f2b49' : '#aab',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'all 0.15s',
});

const DEFAULT_SALE_NM = ['분양', '임대', '혼합'];

function FilterPanel({ filters, onChange, aptTypeOptions, onClose }) {
  const { saleNm, minHoCnt, minUsedate, aptNm } = filters;

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
            min={0} max={3000} step={50}
            value={minHoCnt}
            onChange={e => onChange({ ...filters, minHoCnt: Number(e.target.value) })}
            style={{ flex: 1, accentColor: '#4a7fff' }}
          />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#1f2b49', minWidth: 50 }}>
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
            style={{ flex: 1, accentColor: '#4a7fff' }}
          />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#1f2b49', minWidth: 50 }}>
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

      {/* 초기화 */}
      <div
        style={{ textAlign: 'center', fontSize: '12px', color: '#4a7fff', cursor: 'pointer', fontWeight: 600 }}
        onClick={() => onChange({
          saleNm: [...DEFAULT_SALE_NM],
          minHoCnt: 0,
          minUsedate: 1980,
          aptNm: [...aptTypeOptions],
        })}
      >
        필터 초기화
      </div>
    </div>
  );
}

function Mainmap({ mapCenter, setMapCenter, mapLevel, setMapLevel, onSelectApt }) {
  const mapRef = useRef(null);
  const [level, setLevel] = useState(mapLevel ?? 5);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(false);
  // kaptKey → { area, price } 마커 가격 캐시
  const [markerPrices, setMarkerPrices] = useState(new Map());

  // 필터 상태
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({
    saleNm: [...DEFAULT_SALE_NM],
    minHoCnt: 0,
    minUsedate: 1980,
    aptNm: [], // 빈 배열 = 아직 옵션 미수집 (= 전체 허용)
  });
  const [aptTypeOptions, setAptTypeOptions] = useState([]);

  const lastBBoxRef = useRef(null);
  const idleTimerRef = useRef(null);
  const priceLoadIdRef = useRef(0);
  const priceDoneRef = useRef(new Set()); // 이미 계산 완료된 kaptKey

  // 스타일 B — 네이버 부동산 스타일 pill
  const labelStyle = useMemo(() => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 10px',
    borderRadius: 20,
    background: '#fff',
    boxShadow: '0 2px 10px rgba(0,0,0,0.20)',
    fontWeight: 700,
    fontSize: '12px',
    color: '#1f2b49',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    gap: 5,
    border: '1.5px solid #e0e8ff',
  }), []);

  // 마커 배열에 대해 code5 단위로 워크북 로드 후 면적·가격 계산
  const loadMarkerPrices = async (newMarkers, loadId, zoomLevel) => {
    // 줌 레벨 4 이상은 이름만 표시 → 가격 로드 불필요
    if (zoomLevel > 3) return;

    // 이미 완료된 마커 제외 후 최대 20개만
    const uncached = newMarkers
      .filter(row => !priceDoneRef.current.has(`${row['kaptName']}_${row['bjdCode'] || ''}`))
      .slice(0, 20);
    if (!uncached.length) return;

    const byCode5 = new Map();
    for (const row of uncached) {
      const code5 = String(row['bjdCode'] || '').slice(0, 5);
      if (!code5) continue;
      if (!byCode5.has(code5)) byCode5.set(code5, []);
      byCode5.get(code5).push(row);
    }

    for (const [code5, rows] of byCode5) {
      if (priceLoadIdRef.current !== loadId) return; // 지도 이동으로 취소
      try {
        const as1 = rows[0]['as1'] || '', as2 = rows[0]['as2'] || '';
        const [rResult, pResult] = await Promise.allSettled([
          fetchWorkbook(as1, as2, code5),
          fetchPdata(as1, as2, code5),
        ]);
        if (priceLoadIdRef.current !== loadId) return;
        if (rResult.status === 'rejected') continue;

        const { wb } = rResult.value;
        const pdWb = pResult.status === 'fulfilled' ? pResult.value?.wb ?? null : null;

        const updates = new Map();
        for (const row of rows) {
          const key = `${row['kaptName']}_${row['bjdCode'] || ''}`;
          const { pnu } = buildPNU(row);
          if (!pnu) continue;

          const rawAreas = listAreasForPnu(wb, pnu, row['kaptName'] || null);
          const repAreas = groupAreasToRep(rawAreas);
          const area = pickInitialArea(repAreas); // 84㎡에 가장 가까운 면적
          if (!area) continue;

          const agg = aggregateTradesForArea({
            wb, pdWb, pnu,
            kaptName: row['kaptName'] || null,
            areaNorm: area, smoothWindow: 3,
          });

          // 가장 최근 유효 평균가
          const lastPrice = [...agg.avg].reverse().find(v => Number.isFinite(v));
          if (!Number.isFinite(lastPrice)) continue;

          updates.set(key, { area, price: Math.round(lastPrice * 10) / 10 });
        }

        if (priceLoadIdRef.current !== loadId) return;
        // 완료 키 등록
        for (const row of rows) {
          priceDoneRef.current.add(`${row['kaptName']}_${row['bjdCode'] || ''}`);
        }
        if (updates.size > 0) {
          setMarkerPrices(prev => new Map([...prev, ...updates]));
        }
      } catch { /* 해당 code5 워크북 없으면 무시 */ }
    }
  };

  const onIdle = (map) => {
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

      if (lastBBoxRef.current) {
        const movedEnough =
          Math.abs(bbox.south - lastBBoxRef.current.south) > 0.002 ||
          Math.abs(bbox.west  - lastBBoxRef.current.west ) > 0.002 ||
          Math.abs(bbox.north - lastBBoxRef.current.north) > 0.002 ||
          Math.abs(bbox.east  - lastBBoxRef.current.east ) > 0.002;
        if (!movedEnough) return;
      }
      lastBBoxRef.current = bbox;

      setLoading(true);
      try {
        // 줌 레벨이 높을수록(광역) 그리드를 촘촘하게
        const currentLevel = map.getLevel();
        const gridN = currentLevel >= 7 ? 7 : currentLevel >= 5 ? 5 : 3;
        const pts = makeGridPoints(bbox, gridN);
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
          // 새로운 타입이 생기면 필터에도 추가
          setFilters(f => {
            const newTypes = types.filter(t => !prev.includes(t));
            if (newTypes.length === 0) return f;
            return { ...f, aptNm: [...new Set([...f.aptNm, ...newTypes])] };
          });
          return merged;
        });

        // 가격 정보 백그라운드 로드 (현재 줌 레벨 전달)
        const loadId = ++priceLoadIdRef.current;
        loadMarkerPrices(dedup, loadId, map.getLevel());
      } finally {
        setLoading(false);
      }
    }, 200);
  };

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
    return cnt;
  }, [filters, aptTypeOptions]);

  const selectRow = (row) => {
    if (typeof onSelectApt === 'function') onSelectApt(row);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <KakaoMap
        ref={mapRef}
        center={mapCenter}
        style={{ width: '100%', height: '100%' }}
        level={level}
        onCenterChanged={(map) => {
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
        onCreate={(map) => { onIdle(map); }}
        onIdle={onIdle}
      >
        {loading && (
          <CustomOverlayMap position={mapCenter} yAnchor={1}>
            <div style={{ ...labelStyle, background: '#f9fbff', borderStyle: 'dashed', fontWeight: 700, borderRadius: 8 }}>
              로딩 중…
            </div>
          </CustomOverlayMap>
        )}

        {/* 줌 레벨별 마커 렌더링 */}
        {filteredMarkers.map((row, i) => {
          const pos = { lat: row['위도'], lng: row['경도'] };

          // 레벨 6~7: 주황색 점만
          if (level >= 6) {
            return (
              <CustomOverlayMap key={`dot-${i}`} position={pos} yAnchor={0.5} xAnchor={0.5} clickable>
                <div
                  onClick={() => selectRow(row)}
                  style={{
                    width: 10, height: 10,
                    borderRadius: '50%',
                    background: '#FF6B35',
                    border: '2px solid #fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.30)',
                    cursor: 'pointer',
                  }}
                />
              </CustomOverlayMap>
            );
          }

          // 레벨 4~5: 이름만
          if (level >= 4) {
            return (
              <CustomOverlayMap key={`lbl-${i}`} position={pos} yAnchor={1} xAnchor={0.5} clickable>
                <div style={labelStyle} onClick={() => selectRow(row)}>
                  <span>{trimAptName(row['kaptName'])}</span>
                </div>
              </CustomOverlayMap>
            );
          }

          // 레벨 1~3: 이름 + 면적 + 가격
          const priceKey = `${row['kaptName']}_${row['bjdCode'] || ''}`;
          const info = markerPrices.get(priceKey);
          return (
            <CustomOverlayMap key={`lbl-${i}`} position={pos} yAnchor={1} xAnchor={0.5} clickable>
              <div style={labelStyle} onClick={() => selectRow(row)}>
                <span>{trimAptName(row['kaptName'])}</span>
                {info && (
                  <span style={{ color: '#e03131', fontWeight: 900, fontSize: '11px' }}>
                    {info.area}㎡ {info.price}억
                  </span>
                )}
              </div>
            </CustomOverlayMap>
          );
        })}
      </KakaoMap>

      {/* 필터 버튼 */}
      <div style={FILTER_BTN_STYLE} onClick={() => setFilterOpen(o => !o)}>
        <span>필터</span>
        {activeFilterCount > 0 && (
          <span style={{
            background: '#4a7fff',
            color: '#fff',
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
