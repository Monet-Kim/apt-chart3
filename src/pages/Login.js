// pages/Login.js
import React from 'react';
import KakaoLogin from 'react-kakao-login';
import { commonPanelStyle } from '../styles/panelStyles';

function Login({ onClose }) {
  // 로그인 성공 시 콜백
    const handleSuccess = (data) => {
    // 실제 데이터 구조 확인
    console.log('카카오 로그인 데이터:', data);
    // nickname 안전하게 읽기
    const nickname =
        data?.profile?.properties?.nickname ||
        data?.profile?.kakao_account?.profile?.nickname ||
        data?.kakao_account?.profile?.nickname ||
        data?.nickname ||
        "알 수 없음";
    alert(`${nickname}님 환영합니다!`);
    };

  // 실패 시
  const handleFail = (err) => {
    alert('로그인 실패: ' + JSON.stringify(err));
  };

  return (
    <div style={commonPanelStyle}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', height: 52, borderBottom: '1.5px solid #E6DED4' }}>
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1F1D1B', flex: 1 }}>👤 로그인</span>
        <button
          onClick={onClose}
          style={{ width: 34, height: 34, border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#6B625B', borderRadius: 8 }}
          title="닫기" aria-label="닫기"
        >✕</button>
      </div>

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <KakaoLogin
        token={'f1025a0cbda23e99081d3fdbc8f1344d'} // ← 실제 앱키로 변경
        onSuccess={handleSuccess}
        onFail={handleFail}
        render={({ onClick }) => (
          <button
            onClick={onClick}
            style={{
              width: 200,
              height: 48,
              background: '#FEE500',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: '1.08rem',
              color: '#3B1E1E',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '9px'
            }}>
            <img src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_medium.png" alt="kakao" style={{ width: 24, height: 24 }} />
            카카오로 로그인
          </button>
          
        )}
      />
      </div>
    </div>
  );
}

export default Login;
