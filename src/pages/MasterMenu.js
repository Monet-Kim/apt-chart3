// pages/MasterMenu.js
import React from 'react';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';
import { THEMES, applyTheme } from '../styles/themes';

const THEME_META = {
  gold:  { label: '골드',  colors: ['#B8943F', '#C9A84C', '#F7F3EE'] },
  navy:  { label: '네이비', colors: ['#2C5282', '#3B82C4', '#EEF2F8'] },
  green: { label: '그린',  colors: ['#3D6B4F', '#52A073', '#EEF4F0'] },
  dark:  { label: '다크',  colors: ['#1A1A1A', '#C9A84C', '#121212'] },
};

function MasterMenu({ theme, setTheme }) {
  const handleSelect = (key) => {
    applyTheme(key);
    setTheme(key);
  };

  return (
    <div style={commonPanelStyle}>
      <div style={commonHeaderStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#fff', flex: 1 }}>
          <span style={{ color: 'rgba(255,255,255,0.8)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </span>
          마스터 설정
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* 테마 선택 */}
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 14 }}>
            컬러 테마
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {Object.entries(THEMES).map(([key]) => {
              const meta = THEME_META[key];
              if (!meta) return null;
              const isActive = theme === key;
              return (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                    padding: '16px 12px',
                    border: isActive ? `2px solid ${meta.colors[0]}` : '2px solid var(--color-border)',
                    borderRadius: 12,
                    background: isActive ? 'var(--color-surface-active)' : 'var(--color-surface)',
                    cursor: 'pointer',
                    transition: 'border 0.15s, background 0.15s',
                  }}
                >
                  {/* 컬러 스와치 */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {meta.colors.map((c, i) => (
                      <div key={i} style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: c,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
                        border: '1.5px solid rgba(0,0,0,0.08)',
                      }} />
                    ))}
                  </div>
                  {/* 테마명 */}
                  <span style={{
                    fontSize: '0.82rem', fontWeight: isActive ? 700 : 500,
                    color: isActive ? meta.colors[0] : 'var(--color-text-sub)',
                  }}>
                    {meta.label}
                    {isActive && <span style={{ marginLeft: 4, fontSize: '0.7rem' }}>✓</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 안내 */}
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-disabled)', lineHeight: 1.6 }}>
          선택한 테마는 기기에 저장되며 새로고침 후에도 유지됩니다.
        </div>
      </div>
    </div>
  );
}

export default MasterMenu;
