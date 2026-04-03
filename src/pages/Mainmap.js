// src/pages/Mainmap.js
import React, { useMemo, useRef, useState } from 'react';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import { parseCSV } from '../utils/csvUtils';
import { trimAptName } from '../utils/aptNameUtils';
import {
  buildPNU, fetchWorkbook, fetchPdata,
  listAreasForPnu, aggregateTradesForArea,
  pickInitialArea, groupAreasToRep,
} from './services/aptData';

const fileCache = new Map();

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

// 포인트 → CSV 파일명 (카카오 역지오코딩)
const pointToFile = (pt) => new Promise((resolve) => {
  const geocoder = new window.kakao.maps.services.Geocoder();
  geocoder.coord2RegionCode(pt.lng, pt.lat, (res, status) => {
    if (status !== window.kakao.maps.services.Status.OK || !res?.length) {
      resolve(`${R2_BASE}/coordinput/서울특별시_송파구_11710_list_coord.csv`);
      return;
    }
    const b = res.find(r => r.region_type === 'B') || res[0];
    const s1 = b.region_1depth_name || '서울특별시';
    const s2 = b.region_2depth_name || '송파구';
    const code5 = (b.code || '').slice(0, 5) || '11710';
    resolve(`${R2_BASE}/coordinput/${s1}_${s2}_${code5}_list_coord.csv`);
  });
});

// CSV 로드(캐시 우선) + 위도/경도 숫자화
const loadFile = async (file) => {
  if (fileCache.has(file)) return fileCache.get(file);
  try {
    const res = await fetch(file, { cache: 'no-store' });
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


function Mainmap({ mapCenter, setMapCenter, onSelectApt }) {
  const mapRef = useRef(null);
  const [level, setLevel] = useState(5);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(false);
  // kaptKey → { area, price } 마커 가격 캐시
  const [markerPrices, setMarkerPrices] = useState(new Map());

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
    // 줌 레벨 5 이상은 마커가 너무 많아 스킵
    if (zoomLevel > 4) return;

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
          const repAreas = groupAreasToRep(rawAreas, 0.5);
          const area = pickInitialArea(repAreas); // 84㎡에 가장 가까운 면적
          if (!area) continue;

          const agg = aggregateTradesForArea({
            wb, pdWb, pnu,
            kaptName: row['kaptName'] || null,
            areaNorm: area, areaTol: 0.5, smoothWindow: 3,
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
        const dedup = [];
        const seen = new Set();
        for (const row of all) {
          const key = `${row['위도']}|${row['경도']}|${row['kaptName']}`;
          if (!seen.has(key)) { seen.add(key); dedup.push(row); }
        }
        setMarkers(dedup);

        // 가격 정보 백그라운드 로드 (현재 줌 레벨 전달)
        const loadId = ++priceLoadIdRef.current;
        loadMarkerPrices(dedup, loadId, map.getLevel());
      } finally {
        setLoading(false);
      }
    }, 200);
  };

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
          setLevel(map.getLevel());
        }}
        onZoomChanged={(map) => setLevel(map.getLevel())}
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
        {markers.map((row, i) => {
          const pos = { lat: row['위도'], lng: row['경도'] };

          // 레벨 6~7: 주황색 점만
          if (level >= 6) {
            return (
              <CustomOverlayMap key={`dot-${i}`} position={pos} yAnchor={0.5} xAnchor={0.5}>
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

          // 레벨 5: 이름만
          if (level === 5) {
            return (
              <CustomOverlayMap key={`lbl-${i}`} position={pos} yAnchor={1} xAnchor={0.5}>
                <div style={labelStyle} onClick={() => selectRow(row)}>
                  <span>{trimAptName(row['kaptName'])}</span>
                </div>
              </CustomOverlayMap>
            );
          }

          // 레벨 1~4: 이름 + 면적 + 가격
          const key = `${row['kaptName']}_${row['bjdCode'] || ''}`;
          const info = markerPrices.get(key);
          return (
            <CustomOverlayMap key={`lbl-${i}`} position={pos} yAnchor={1} xAnchor={0.5}>
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
