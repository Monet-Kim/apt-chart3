// src/pages/Mainmap.js
import React, { useMemo, useRef, useState } from 'react';
import { Map as KakaoMap, CustomOverlayMap, MarkerClusterer, MapMarker } from 'react-kakao-maps-sdk';
import { parseCSV } from '../utils/csvUtils';

const fileCache = new Map();

const R2_BASE = process.env.NODE_ENV === 'production'
  ? "https://pub-8c65c427a291446c9384665be9201bea.r2.dev"
  : "";
// 3x3 격자 샘플 포인트
const makeGridPoints = (bbox) => {
  const lats = [bbox.south, (bbox.south + bbox.north) / 2, bbox.north];
  const lngs = [bbox.west,  (bbox.west  + bbox.east ) / 2, bbox.east ];
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

// 1x1 투명 PNG (cluster 계산용 마커를 안 보이게)
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/UkGfuQAAAAASUVORK5CYII=';

function Mainmap({ mapCenter, setMapCenter, onSelectApt }) {
  const mapRef = useRef(null);
  const [level, setLevel] = useState(5);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(false);

  const lastBBoxRef = useRef(null);
  const idleTimerRef = useRef(null);

  const showLabels = level >= 3 && level <= 5;

  const labelStyle = useMemo(() => ({
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: 8,
    background: 'rgba(252, 230, 210, 0.91)',
    border: '1px solid rgba(0, 123, 255, 0.5)',
    backdropFilter: 'blur(2px)',
    boxShadow: '0 2px 10px rgba(100,118,255,0.12)',
    fontWeight: 800,
    fontSize: '13px',
    color: '#1f2b49',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  }), []);

  const onIdle = (map) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(async () => {
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
        const pts = makeGridPoints(bbox);
        const files = Array.from(new Set(await Promise.all(pts.map(pointToFile))));
        const all = (await Promise.all(files.map(loadFile))).flat();
        const dedup = [];
        const seen = new Set();
        for (const row of all) {
          const key = `${row['위도']}|${row['경도']}|${row['kaptName']}`;
          if (!seen.has(key)) { seen.add(key); dedup.push(row); }
        }
        setMarkers(dedup);
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
            <div style={{ ...labelStyle, background: '#f9fbff', borderStyle: 'dashed', fontWeight: 700 }}>
              로딩 중…
            </div>
          </CustomOverlayMap>
        )}

        <MarkerClusterer averageCenter minLevel={6} disableClickZoom={false}>
          {markers.map((row, i) => (
            <MapMarker
              key={`mk-${i}`}
              position={{ lat: row['위도'], lng: row['경도'] }}
              image={{ src: TRANSPARENT_PNG, size: { width: 1, height: 1 } }}
              onClick={() => selectRow(row)}
            />
          ))}
        </MarkerClusterer>

        {showLabels && markers.map((row, i) => (
          <CustomOverlayMap
            key={`lbl-${i}`}
            position={{ lat: row['위도'], lng: row['경도'] }}
            yAnchor={1}
            xAnchor={0.5}
          >
            <div style={labelStyle} onClick={() => selectRow(row)}>
              {row['kaptName']}
            </div>
          </CustomOverlayMap>
        ))}
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
