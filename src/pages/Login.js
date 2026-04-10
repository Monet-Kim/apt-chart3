// pages/Login.js
import React from 'react';
import KakaoLogin from 'react-kakao-login';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';

function Login({ user, onLoginSuccess, onLogout, onClose }) {
  const handleSuccess = (data) => {
const properties = data?.profile?.properties || {};
    const kakaoProfile = data?.profile?.kakao_account?.profile || {};
    onLoginSuccess({
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#1F1D1B', flex: 1 }}>
          <span style={{ color: '#6B625B' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
            </svg>
          </span>
          {user ? '내 계정' : '로그인'}
        </span>
      </div>

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
        {user ? (
          <>
            {/* 프로필 */}
            {user.profileImage
              ? <img src={user.profileImage} alt="프로필" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid #E6DED4' }} />
              : (
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#F0EBE4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#6B625B" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width={36} height={36}>
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
                  </svg>
                </div>
              )
            }
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1F1D1B' }}>{user.nickname}</div>
              <div style={{ fontSize: '0.82rem', color: '#9E9590', marginTop: 4 }}>카카오 계정으로 로그인됨</div>
            </div>
            <button
              onClick={() => { onLogout(); onClose?.(); }}
              style={{
                marginTop: 8,
                padding: '10px 32px',
                border: '1.5px solid #E6DED4',
                borderRadius: 8,
                background: '#fff',
                color: '#6B625B',
                fontWeight: 600,
                fontSize: '0.92rem',
                cursor: 'pointer',
              }}
            >
              로그아웃
            </button>
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
      </div>
    </div>
  );
}

export default Login;
