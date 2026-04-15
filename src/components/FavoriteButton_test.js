// src/components/FavoriteButton.js
import { useState, useEffect } from 'react';
import { ACCENT_ALPHA } from '../styles/themes';
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
      fav-pop  .2s  cubic-bezier(.34, 1.5, .64, 1) forwards,
      fav-ring .75s ease .2s forwards;
    will-change: transform, opacity;
  }
  .fav-chip-exit {
    animation:
      fav-out-clip   .36s cubic-bezier(.76, 0, .24, 1) forwards,
      fav-out-shrink .52s ease forwards;
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

   애니메이션 phase:
     'enter' → 마운트 시 팝업 + 골드 링 확산
     'idle'  → 일반 상태
     'exit'  → ✕ 클릭 시 왼쪽부터 언래블 후 onRemove 호출
──────────────────────────────────────────── */
export function FavChip({ fav, isActive, theme, onClick, onRemove }) {
  const [phase, setPhase] = useState('enter');

  // 마운트 → enter 애니메이션 종료 후 idle로 전환
  // fav-pop(.2s) + fav-ring(.2s delay + .75s) = 총 0.95s
  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 950);
    return () => clearTimeout(t);
  }, []);

  const handleRemove = (e) => {
    e.stopPropagation();
    if (phase === 'exit') return; // 중복 방지
    setPhase('exit');
    // fav-out-shrink 0.52s 종료 후 실제 삭제
    setTimeout(() => onRemove(fav.key), 540);
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
        background: isActive ? 'var(--color-surface-active)' : 'var(--color-surface-2)',
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
        style={{
          fontSize: '0.6rem', color: 'var(--color-text-disabled)',
          cursor: 'pointer', lineHeight: 1,
        }}
        title="즐겨찾기 삭제"
      >✕</span>
    </div>
  );
}
