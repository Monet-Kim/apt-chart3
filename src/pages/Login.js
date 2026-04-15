// pages/Login.js
import React, { useState } from 'react';
import KakaoLogin from 'react-kakao-login';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';
import { THEMES, applyTheme } from '../styles/themes';

function Login({ user, onLoginSuccess, onLogout, onClose, onUpdateUser, theme = 'rose_slate', setTheme, onOpenMinimap, isMobile = false, isTablet = false }) {
  const [editingNick, setEditingNick] = useState(false);
  const [nickInput, setNickInput] = useState('');
  const handleSuccess = (data) => {
const properties = data?.profile?.properties || {};
    const kakaoProfile = data?.profile?.kakao_account?.profile || {};
    onLoginSuccess({
      id: data?.profile?.id ?? null,
      nickname:
        properties.nickname ||
        kakaoProfile.nickname ||
        data?.profile?.id ||
        '사용자',
      profileImage:
        properties.profile_image ||
        kakaoProfile.profile_image_url ||
        properties.thumbnail_image ||
        kakaoProfile.thumbnail_image_url ||
        null,
    });
  };

  const handleFail = (err) => {
    console.error('카카오 로그인 실패:', err);
    alert('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.');
  };

  return (
    <div style={commonPanelStyle}>
      {/* 헤더 */}
      <div style={commonHeaderStyle}>
        {(isMobile || isTablet) ? (
          <span onClick={onOpenMinimap} style={{ color: 'rgba(255,255,255,0.9)', flexShrink: 0, cursor: 'pointer', borderRadius: 6, padding: 2, display: 'flex', alignItems: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="6" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
              <line x1="2" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
              <line x1="10" y1="6" x2="10" y2="22" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
              <path d="M16 0C13.2 0 11 2.2 11 5c0 3.5 5 9 5 9s5-5.5 5-9c0-2.8-2.2-5-5-5z" fill="currentColor"/>
              <circle cx="16" cy="5" r="1.8" fill="white"/>
            </svg>
          </span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
            </svg>
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#fff', flex: 1 }}>
          {user ? '내 계정' : '로그인'}
        </span>
      </div>

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
        {user ? (
          <>
            {/* 프로필 */}
            {user.profileImage
              ? <img src={user.profileImage} alt="프로필" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--color-border)' }} />
              : (
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-sub)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={36} height={36}>
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
                  </svg>
                </div>
              )
            }
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>{user.nickname}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-faint)', marginTop: 4 }}>카카오 계정으로 로그인됨</div>
            </div>
            <button
              onClick={() => { onLogout(); onClose?.(); }}
              style={{
                marginTop: 8,
                padding: '10px 32px',
                border: '1.5px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-surface)',
                color: 'var(--color-text-sub)',
                fontWeight: 600,
                fontSize: '0.92rem',
                cursor: 'pointer',
              }}
            >
              로그아웃
            </button>

            {/* 게시판 닉네임 설정 */}
            <div style={{
              width: '100%', maxWidth: 280,
              border: `1.5px solid ${user.boardNickname ? 'var(--color-border)' : 'var(--color-accent)'}`,
              borderRadius: 10, padding: '14px 16px',
              background: user.boardNickname ? 'var(--color-surface)' : 'var(--color-surface)',
            }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', marginBottom: 8, letterSpacing: '0.04em' }}>
                게시판 닉네임
              </div>
              {!user.boardNickname && !editingNick && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-faint)', marginBottom: 10 }}>
                  글 작성에 사용할 닉네임을 설정하세요
                </div>
              )}
              {(editingNick || !user.boardNickname) ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    autoFocus
                    value={nickInput}
                    onChange={e => setNickInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { const t = nickInput.trim(); if (t) { onUpdateUser?.({ ...user, boardNickname: t }); setEditingNick(false); } } }}
                    maxLength={10}
                    placeholder="최대 10자"
                    style={{
                      flex: 1, border: '1.5px solid var(--color-border)', borderRadius: 6,
                      padding: '6px 10px', fontSize: '0.88rem', outline: 'none',
                      background: 'var(--color-bg)', color: 'var(--color-text-main)',
                    }}
                  />
                  <button
                    onClick={() => { const t = nickInput.trim(); if (t) { onUpdateUser?.({ ...user, boardNickname: t }); setEditingNick(false); } }}
                    style={{ padding: '6px 12px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
                  >
                    저장
                  </button>
                  {user.boardNickname && (
                    <button
                      onClick={() => setEditingNick(false)}
                      style={{ padding: '6px 10px', background: 'none', color: 'var(--color-text-faint)', border: '1.5px solid var(--color-border)', borderRadius: 6, fontSize: '0.82rem', cursor: 'pointer' }}
                    >
                      취소
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>{user.boardNickname}</span>
                  <button
                    onClick={() => { setNickInput(user.boardNickname); setEditingNick(true); }}
                    style={{ padding: '4px 10px', background: 'none', color: 'var(--color-text-faint)', border: '1.5px solid var(--color-border)', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    수정
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <KakaoLogin
            token="f1025a0cbda23e99081d3fdbc8f1344d"
            onSuccess={handleSuccess}
            onFail={handleFail}
            render={({ onClick }) => (
              <button
                onClick={onClick}
                style={{
                  width: 220,
                  height: 48,
                  background: '#FEE500',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: '#3B1E1E',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 9,
                }}
              >
                <img src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_medium.png" alt="kakao" style={{ width: 24, height: 24 }} />
                카카오로 로그인
              </button>
            )}
          />
        )}
        {/* 테마 스와치 */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {Object.keys(THEMES).map(key => {
            const primary = THEMES[key]['--color-primary'];
            const accent  = THEMES[key]['--color-accent'];
            const isActive = key === theme;
            return (
              <button
                key={key}
                onClick={() => { applyTheme(key); setTheme?.(key); }}
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  border: 'none', cursor: 'pointer', padding: 0,
                  background: `linear-gradient(135deg, ${primary} 50%, ${accent} 50%)`,
                  boxShadow: isActive
                    ? `0 0 0 2px #fff, 0 0 0 4px ${accent}`
                    : '0 0 0 1px rgba(0,0,0,0.10)',
                  transform: 'scale(1)', transition: 'transform 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.12)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Login;
