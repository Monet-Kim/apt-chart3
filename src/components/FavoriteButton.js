// src/components/FavoriteButton.js
import { useState, useEffect, useRef, useMemo } from 'react';
import { ACCENT_ALPHA, COMPLEMENT_ALPHA } from '../styles/themes';
import { trimAptName } from '../styles/aptNameUtils';

/* ────────────────────────────────────────────
   @keyframes 인라인 주입 — FavChip 애니메이션
   - 모듈 로드 시 딱 한 번만 <head>에 삽입
   - id 중복 체크로 이중 주입 방지
──────────────────────────────────────────── */
const FAV_CHIP_STYLE = `
  @keyframes fav-pop {
    0%   { opacity: 0; transform: scale(0.86); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes fav-ring {
    0%   { border-color: #f5c518; box-shadow: 0 0 0 0px rgba(245,197,24,.65); }
    45%  { border-color: #f5c518; box-shadow: 0 0 0 5px rgba(245,197,24,.13); }
    100% { box-shadow: 0 0 0 0px rgba(245,197,24,0); }
  }
  @keyframes fav-out-clip {
    0%   { clip-path: inset(0 0 0 0%   round 20px); opacity: 1; }
    100% { clip-path: inset(0 0 0 100% round 20px); opacity: .2; }
  }
  @keyframes fav-out-shrink {
    0%, 50% { max-width: 300px; padding: 4px 8px; border-width: 2px; }
    100%    { max-width: 0; padding: 0; border-width: 0; opacity: 0; }
  }
  .fav-chip-enter {
    animation:
      fav-pop  .12s cubic-bezier(.34, 1.5, .64, 1) forwards,
      fav-ring .18s ease .12s forwards;
    will-change: transform, opacity;
  }
  .fav-chip-exit {
    animation:
      fav-out-clip   .18s cubic-bezier(.76, 0, .24, 1) forwards,
      fav-out-shrink .3s ease forwards;
    overflow: hidden;
    will-change: clip-path, opacity;
    pointer-events: none;
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('fav-chip-style')) {
  const el = document.createElement('style');
  el.id = 'fav-chip-style';
  el.textContent = FAV_CHIP_STYLE;
  document.head.appendChild(el);
}

/* ────────────────────────────────────────────
   PickButton — LeftPanel 헤더의 별+Pick 토글 버튼
   props: isFav(bool), onClick(fn)
──────────────────────────────────────────── */
export function PickButton({ isFav, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 2,
        border: `1.5px solid ${isFav ? '#f5c518' : 'rgba(255,255,255,0.55)'}`,
        borderRadius: 20, background: 'none', cursor: 'pointer',
        padding: '2px 7px', height: 24,
        fontSize: '0.65rem', fontWeight: 700,
        color: '#fff', letterSpacing: '0.01em',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <polygon
          points="8,2 9.8,6.5 14.5,6.5 10.8,9.5 12.2,14 8,11 3.8,14 5.2,9.5 1.5,6.5 6.2,6.5"
          fill={isFav ? '#f5c518' : 'rgba(255,255,255,0.75)'}
          stroke={isFav ? '#f5c518' : 'rgba(255,255,255,0.75)'}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span>Pick</span>
    </button>
  );
}

/* ────────────────────────────────────────────
   FavChip — pill 형태의 즐겨찾기 칩 + ✕ 버튼
   props:
     fav      — { key, kaptName, ... }
     isActive — 활성화 여부 (테두리/배경색 결정)
     theme    — ACCENT_ALPHA[theme] 계산용
     onClick  — 칩 클릭 핸들러 (부모가 로직 소유)
     onRemove — ✕ 클릭 시 호출, key를 인자로 전달
                (stopPropagation은 내부 처리)
──────────────────────────────────────────── */
/* ────────────────────────────────────────────
   FavChipGrid — 즐겨찾기 칩 2줄 페이지네이션 그리드
   props:
     favApts    — 즐겨찾기 배열
     selectedApt — 현재 선택 아파트
     theme      — 테마 키
     onSelect   — 칩 클릭 시 (fav) => void
     onRemove   — ✕ 클릭 시 (key) => void
──────────────────────────────────────────── */
export function FavChipGrid({ favApts, selectedApt, theme, onSelect, onRemove }) {
  const [page, setPage] = useState(0);
  const [containerW, setContainerW] = useState(
    () => Math.max((typeof window !== 'undefined' ? window.innerWidth : 390) - 20, 200)
  );
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // favApts 변경 시 첫 페이지로 리셋
  useEffect(() => { setPage(0); }, [favApts.length]);

  const GAP = 6;
  const NAV_W = 34; // "★N" 버튼: 6+6px padding + 2+2px border + ★+숫자 ≈ 34px

  // 칩 너비 추정: 8+8px padding + 2+2px border + 5px gap + ~8px ✕ + 글자(11px/char)
  function chipW(fav) {
    return trimAptName(fav.kaptName).length * 11 + 33;
  }

  // startIdx부터 2줄에 들어가는 칩 개수 계산
  // hasNavBefore: 앞에 ★+N 버튼이 있으면 그 너비 선점
  function calcFit(startIdx, hasNavBefore) {
    let x = hasNavBefore ? NAV_W + GAP : 0;
    let row = 1;
    let count = 0;
    for (let i = startIdx; i < favApts.length; i++) {
      const w = chipW(favApts[i]);
      const gapBefore = x > 0 ? GAP : 0;
      if (x + gapBefore + w > containerW) {
        if (row >= 2) break;
        row++; x = 0;
      }
      x += (x > 0 ? GAP : 0) + w;
      count++;
    }
    // 다음 페이지가 있으면 맨 끝에 ★+N이 들어갈 공간을 1회만 확인
    const hasMore = startIdx + count < favApts.length;
    if (hasMore && x + GAP + NAV_W > containerW) {
      count = Math.max(count - 1, 1);
    }
    return Math.max(count, 1);
  }

  // 전체 페이지 경계 계산
  const pages = useMemo(() => {
    const result = [];
    let idx = 0;
    while (idx < favApts.length) {
      const count = calcFit(idx, result.length > 0);
      result.push({ start: idx, count });
      idx += count;
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favApts, containerW]);

  const safePage = Math.min(page, pages.length - 1);
  const { start, count } = pages[safePage] ?? { start: 0, count: favApts.length };
  const visibleFavs = favApts.slice(start, start + count);
  const hiddenBefore = start;
  const hiddenAfter = favApts.length - (start + count);

  const navStyle = {
    display: 'flex', alignItems: 'center',
    padding: '4px 6px', borderRadius: 20, cursor: 'pointer',
    background: 'var(--color-surface-2)',
    border: `2px solid ${ACCENT_ALPHA[theme]?.a35 ?? 'rgba(0,0,0,0.2)'}`,
    fontSize: '0.7rem', fontWeight: 700,
    color: 'var(--color-text-faint)', whiteSpace: 'nowrap', flexShrink: 0,
  };

  return (
    <div ref={wrapRef} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: GAP, flexWrap: 'wrap' }}>
      {hiddenBefore > 0 && (
        <div style={navStyle} onClick={() => setPage(safePage - 1)}>★{hiddenBefore}</div>
      )}
      {visibleFavs.map(fav => (
        <FavChip
          key={fav.key}
          fav={fav}
          isActive={selectedApt?.kaptCode === fav.kaptCode}
          theme={theme}
          onClick={() => onSelect(fav)}
          onRemove={onRemove}
        />
      ))}
      {hiddenAfter > 0 && (
        <div style={navStyle} onClick={() => setPage(safePage + 1)}>★{hiddenAfter}</div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   FavChip — pill 형태의 즐겨찾기 칩 + ✕ 버튼
   애니메이션 phase:
     'enter' → 마운트 시 팝업 + 골드 링 확산
     'idle'  → 일반 상태
     'exit'  → ✕ 클릭 시 왼쪽부터 언래블 후 onRemove 호출
──────────────────────────────────────────── */
export function FavChip({ fav, isActive, theme, onClick, onRemove }) {
  const [phase, setPhase] = useState('enter');
  const prevIsActiveRef = useRef(isActive);

  // 마운트 → enter 애니메이션 종료 후 idle로 전환
  // fav-pop(.12s) + fav-ring(.12s delay + .18s) = 총 0.3s
  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 310);
    return () => clearTimeout(t);
  }, []);

  // 선택(isActive: false→true) 시 enter 애니메이션 재생
  useEffect(() => {
    const prev = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;
    if (!isActive || prev) return; // 새로 active된 경우만
    setPhase(p => p === 'exit' ? p : 'enter');
    const t = setTimeout(() => setPhase(p => p === 'exit' ? p : 'idle'), 310);
    return () => clearTimeout(t);
  }, [isActive]);

  const handleRemove = (e) => {
    e.stopPropagation();
    if (phase === 'exit') return; // 중복 방지
    setPhase('exit');
    // fav-out-shrink 0.3s 종료 후 실제 삭제
    setTimeout(() => onRemove(fav.key), 310);
  };

  const animClass =
    phase === 'enter' ? 'fav-chip-enter' :
    phase === 'exit'  ? 'fav-chip-exit'  : '';

  return (
    <div
      key={fav.key}
      onClick={phase === 'exit' ? undefined : onClick}
      className={animClass}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 8px', cursor: phase === 'exit' ? 'default' : 'pointer',
        borderRadius: 20,
        background: isActive ? 'var(--color-surface-2)' : COMPLEMENT_ALPHA[theme].a20,
        border: isActive ? '3px solid #f5c518' : `2px solid ${ACCENT_ALPHA[theme].a35}`,
      }}
    >
      <span style={{
        fontSize: '0.7rem', fontWeight: 800,
        color: isActive ? 'var(--color-text-main)' : 'var(--color-text-faint)',
        whiteSpace: 'nowrap',
      }}>
        {trimAptName(fav.kaptName)}
      </span>
      <span
        onClick={handleRemove}
        style={{ fontSize: '0.6rem', color: 'var(--color-text-disabled)', cursor: 'pointer', lineHeight: 1 }}
        title="즐겨찾기 삭제"
      >✕</span>
    </div>
  );
}
