// src/App.js
import React, { useState, useCallback, useEffect, useRef } from 'react';
import './App.css';
import Mainmap from './pages/Mainmap';
import LeftPanel from './pages/LeftPanel';
import { useBreakpoint } from './hooks/useBreakpoint';

// 패널 컴포넌트
import Login from './pages/Login';
import BoardPanel from './pages/BoardPanel';
import ChartPanel from './pages/ChartPanel';

function App() {
  const { isMobile, isTablet, isDesktop } = useBreakpoint();

  const [mapCenter, setMapCenter] = useState({ lat: 37.5665, lng: 126.9780 });
  const [selectedApt, setSelectedApt] = useState(null);

  // 왼쪽 패널: 데스크탑 기본 열림, 모바일/태블릿 기본 닫힘
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(() => window.innerWidth >= 1200);

  useEffect(() => {
    if (isMobile || isTablet) setIsLeftPanelOpen(false);
    if (isDesktop) setIsLeftPanelOpen(true);
  }, [isMobile, isTablet, isDesktop]);

  // 오른쪽 오버레이 패널: 'login' | 'chart' | 'board' | null
  const [openPanel, setOpenPanel] = useState(null);
  const togglePanel = (key) => {
    setOpenPanel(prev => (prev === key ? null : key));
    if (!isDesktop) setIsLeftPanelOpen(false);
  };
  const closePanel = () => setOpenPanel(null);

  // 뒤로가기 버튼 처리 — 열린 패널 닫기
  const openPanelRef = useRef(openPanel);
  const isLeftPanelOpenRef = useRef(isLeftPanelOpen);
  useEffect(() => { openPanelRef.current = openPanel; }, [openPanel]);
  useEffect(() => { isLeftPanelOpenRef.current = isLeftPanelOpen; }, [isLeftPanelOpen]);

  useEffect(() => {
    history.pushState(null, '');
    const handlePopState = () => {
      const hadPanel = openPanelRef.current || isLeftPanelOpenRef.current;
      if (openPanelRef.current) {
        setOpenPanel(null);
      } else if (isLeftPanelOpenRef.current) {
        setIsLeftPanelOpen(false);
      }
      // 패널을 닫은 경우 다음 뒤로가기를 위해 더미 상태 재적립
      if (hadPanel) history.pushState(null, '');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 즐겨찾기
  const [favApts, setFavApts] = useState([]);
  const addFavoriteApt = (row) => {
    if (!row) return;
    const aptKey = `${row.kaptName}_${row.bjdCode || ''}`;
    const newFav = {
      key: aptKey, kaptName: row.kaptName, kaptAddr: row.kaptAddr,
      bjdCode: row.bjdCode, as1: row.as1, as2: row.as2, as3: row.as3, as4: row.as4,
    };
    setFavApts(prev => (prev.some(a => a.key === aptKey) ? prev : [...prev, newFav]));
  };
  const removeFavoriteApt = (aptKey) => setFavApts(prev => prev.filter(a => a.key !== aptKey));

  const handleSelectApt = useCallback((row) => {
    setSelectedApt(row || null);
    // 모바일/태블릿: 아파트 선택 시 LeftPanel 자동 열기, 다른 패널 닫기
    if (row && !isDesktop) {
      setIsLeftPanelOpen(true);
      setOpenPanel(null);
    }
  }, [isDesktop]);

  const panelButtons = [
    { icon: '👤', label: '로그인', key: 'login' },
    { icon: '📈', label: '차트비교', key: 'chart' },
    { icon: '💬', label: '게시판', key: 'board' },
  ];

  // LeftPanel 너비: 모바일 전체, 태블릿 420px, 데스크탑 440px
  const leftPanelWidth = isMobile ? '100vw' : isTablet ? '420px' : '440px';

  // 오버레이 패널: 모바일·태블릿 바텀시트 / 데스크탑 센터 오버레이
  const isBottomSheet = !isDesktop;

  return (
    <div className="App" style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* LeftPanel 백드롭 (모바일·태블릿) */}
      {!isDesktop && isLeftPanelOpen && (
        <div
          onClick={() => setIsLeftPanelOpen(false)}
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9 }}
          aria-hidden
        />
      )}

      {/* LeftPanel 드로어 — 모든 해상도에서 절대위치 오버레이 */}
      <div style={{
        position: 'absolute', top: 0, bottom: isMobile ? 64 : 0, left: 0,
        width: leftPanelWidth,
        transform: isLeftPanelOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        zIndex: 10,
        boxShadow: isLeftPanelOpen ? '4px 0 24px rgba(0,0,0,0.12)' : 'none',
      }}>
        <LeftPanel
          selectedApt={selectedApt}
          onPanTo={(lat, lng) => setMapCenter({ lat, lng })}
          favApts={favApts}
          addFavoriteApt={addFavoriteApt}
          removeFavoriteApt={removeFavoriteApt}
          onClose={() => setIsLeftPanelOpen(false)}
          onOpenChartPanel={() => togglePanel('chart')}
          isMobile={isMobile}
          isTablet={isTablet}
          isDesktop={isDesktop}
        />
      </div>

      {/* 지도 영역 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Mainmap
          mapCenter={mapCenter}
          setMapCenter={setMapCenter}
          onSelectApt={handleSelectApt}
        />

        {/* 데스크탑: 사이드 토글 탭 */}
        {isDesktop && (
          <button
            onClick={() => setIsLeftPanelOpen(p => !p)}
            style={{
              position: 'absolute', top: '50%', left: 0,
              transform: 'translateY(-50%)',
              zIndex: 7, width: 22, height: 56,
              border: '1px solid #d6def2', borderLeft: 'none',
              borderRadius: '0 8px 8px 0',
              background: '#fff', cursor: 'pointer',
              fontSize: '0.75rem', color: '#6476FF', fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '2px 0 8px rgba(0,0,0,0.08)', padding: 0,
            }}
            title={isLeftPanelOpen ? '패널 닫기' : '패널 열기'}
          >
            {isLeftPanelOpen ? '◀' : '▶'}
          </button>
        )}

        {/* 데스크탑·태블릿: 오른쪽 플로팅 버튼 */}
        {!isMobile && (
          <div style={{
            position: 'absolute', top: '50%', right: 10,
            transform: 'translateY(-50%)',
            display: 'flex', flexDirection: 'column', gap: 8, zIndex: 6,
          }}>
            {panelButtons.map(btn => {
              const active = openPanel === btn.key;
              return (
                <button
                  key={btn.key}
                  onClick={() => togglePanel(btn.key)}
                  style={{
                    width: 56, height: 56, borderRadius: '50%',
                    backgroundColor: active ? '#f0f4ff' : '#fff',
                    border: active ? '2px solid #6476FF' : '1px solid #ccc',
                    fontSize: '1.4rem', cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
                  }}
                  title={btn.label}
                  aria-pressed={active}
                >
                  {btn.icon}
                </button>
              );
            })}
          </div>
        )}

        {/* 오버레이 백드롭 */}
        {openPanel && (
          <div
            onClick={closePanel}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 4 }}
            aria-hidden
          />
        )}

        {/* 오버레이 패널 컨테이너 — 모바일·태블릿: 바텀시트 / 데스크탑: 센터 오버레이 */}
        <div
          style={isBottomSheet ? {
            position: 'absolute',
            bottom: isMobile ? 64 : 0,
            left: 0, right: 0,
            height: isMobile ? 'calc(85vh - 64px)' : '88vh',
            borderRadius: '20px 20px 0 0',
            transform: openPanel ? 'translateY(0)' : 'translateY(110%)',
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
            background: '#fff',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
            overflow: 'hidden',
            zIndex: 5,
          } : {
            position: 'absolute',
            top: 0, bottom: 0,
            left: '50%',
            transform: openPanel ? 'translateX(-50%)' : 'translateX(200%)',
            width: 'min(740px, 88vw)',
            transition: 'transform 0.25s ease',
            background: '#fff',
            boxShadow: openPanel ? '0 0 24px rgba(0,0,0,0.10)' : 'none',
            overflow: 'hidden',
            zIndex: 5,
            borderRadius: 14,
          }}
          aria-hidden={!openPanel}
        >
          {/* 바텀시트 핸들 (모바일·태블릿) */}
          {isBottomSheet && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 99, background: '#d6def2' }} />
            </div>
          )}

          {openPanel === 'login' && <Login onClose={closePanel} />}
          {openPanel === 'board' && <BoardPanel onClose={closePanel} />}
          <div style={{ display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column', height: isBottomSheet ? 'calc(100% - 18px)' : '100%' }}>
            <ChartPanel
              isOpen={openPanel === 'chart'}
              favApts={favApts}
              removeFavoriteApt={removeFavoriteApt}
              onClose={closePanel}
              isMobile={isMobile}
              isTablet={isTablet}
              isDesktop={isDesktop}
            />
          </div>
        </div>
      </div>

      {/* 모바일 하단 네비게이션 바 */}
      {isMobile && (
        <div style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: 64,
          background: '#fff',
          borderTop: '1.5px solid #e6ebf5',
          display: 'flex',
          alignItems: 'stretch',
          zIndex: 11,
          boxShadow: '0 -2px 12px rgba(0,0,0,0.07)',
        }}>
          {/* 패널 열기 버튼 */}
          <button
            onClick={() => setIsLeftPanelOpen(p => !p)}
            style={{
              flex: 1, border: 'none', background: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3, fontSize: '0.65rem', fontWeight: 700,
              color: isLeftPanelOpen ? '#6476FF' : '#6a7692',
            }}
          >
            <span style={{ fontSize: '1.3rem' }}>🏠</span>
            <span>정보</span>
          </button>

          {panelButtons.map(btn => {
            const active = openPanel === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => togglePanel(btn.key)}
                style={{
                  flex: 1, border: 'none', background: 'none', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 3, fontSize: '0.65rem', fontWeight: 700,
                  color: active ? '#6476FF' : '#6a7692',
                  borderTop: active ? '2px solid #6476FF' : '2px solid transparent',
                }}
                aria-pressed={active}
              >
                <span style={{ fontSize: '1.3rem' }}>{btn.icon}</span>
                <span>{btn.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
