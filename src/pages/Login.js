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
      {/* 닫기버튼 - 패널 오른쪽 상단 */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 18,
          right: 22,
          color: '#6476FF',
          background: 'none',
          border: 'none',
          fontWeight: 900,
          cursor: 'pointer',
          fontSize: '1.15rem',
          width: 28,
          height: 28,
          borderRadius: 7,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.13s',
          zIndex: 100
        }}
        title="닫기"
        aria-label="닫기"
        onMouseOver={e => e.currentTarget.style.background = "#e8eefa"}
        onMouseOut={e => e.currentTarget.style.background = "none"}
      >✕</button>

        <div style={{
            flex: 1, display:'flex',alignItems:'center',justifyContent:'center'
        }}>    
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
