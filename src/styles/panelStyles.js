// src/styles/panelStyles.js
export const commonPanelStyle = {
  width: '100%',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-surface)',
  position: 'relative',
  overflow: 'hidden',
};

export const commonHeaderStyle = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  height: 52,
  background: 'var(--color-primary)',
  color: '#fff',
  borderBottom: '1.5px solid var(--color-primary-border)',
};
