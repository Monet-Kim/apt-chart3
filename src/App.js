// src/App.js
// 데이터 구조 변경 시 APP_VERSION을 올리면 구버전 localStorage 자동 초기화
const APP_VERSION = '2';
if (localStorage.getItem('app_version') !== APP_VERSION) {
  localStorage.clear();
  localStorage.setItem('app_version', APP_VERSION);
}

import React, { useState, useCallback, useEffect, useRef } from 'react';
import './App.css';
import Mainmap from './pages/Mainmap';
import LeftPanel from './pages/LeftPanel';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useBreakpoint } from './hooks/useBreakpoint';

// 패널 컴포넌트
import Login from './pages/Login';
import BoardPanel from './pages/BoardPanel';
import ChartPanel from './pages/ChartPanel';

// 공용 닫기 버튼 — 헤더 좌측 "← 닫기"
export function CloseButton({ onClose, label = '닫기' }) {
  return (
    <button
      onClick={onClose}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        border: 'none', background: 'none', cursor: 'pointer',
        color: '#6B625B', fontWeight: 600, fontSize: '0.92rem',
        padding: '4px 8px 4px 2px', borderRadius: 8, flexShrink: 0,
      }}
      aria-label="닫기"
    >
      <svg viewBox="0 0 16 16" fill="none" width={20} height={20}>
        <line x1="13" y1="8" x2="3" y2="8" stroke="#aaa" strokeWidth="1.3" strokeLinecap="round"/>
        <polyline points="7,4 3,8 7,12" stroke="#aaa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
      {label}
    </button>
  );
}

function App() {
  const { isMobile, isTablet, isDesktop } = useBreakpoint();

  const [mapCenter, setMapCenter] = useLocalStorage('map_center', { lat: 37.5665, lng: 126.9780 });
  const [mapLevel, setMapLevel] = useLocalStorage('map_level', 5);
  const [selectedApt, setSelectedApt] = useLocalStorage('selected_apt', null);

  // 통합 패널 상태: 'info' | 'login' | 'chart' | 'board' | null
  const [openPanel, setOpenPanel] = useState(null);
  const [pendingPostContent, setPendingPostContent] = useState(null);

  const togglePanel = (key) => setOpenPanel(prev => prev === key ? null : key);

  // 데스크탑 초기 상태: 정보 패널 열림
  useEffect(() => {
    if (isDesktop) setOpenPanel(p => p ?? 'info');
  }, [isDesktop]);

  // 뒤로가기 버튼 처리
  const openPanelRef = useRef(openPanel);
  useEffect(() => { openPanelRef.current = openPanel; }, [openPanel]);

  const boardBackHandlerRef = useRef(null);


  useEffect(() => {
    history.pushState(null, '');
    const handlePopState = () => {
      if (openPanelRef.current === 'board') {
        boardBackHandlerRef.current?.();
        history.pushState(null, '');
        return;
      }
      if (openPanelRef.current) {
        setOpenPanel(null);
        history.pushState(null, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 로그인 유저 상태
  const [user, setUser] = useLocalStorage('kakao_user', null);
  const handleLoginSuccess = (data) => {
    setUser(data);
  };
  const handleLogout = () => setUser(null);

  // 즐겨찾기
  const [favApts, setFavApts] = useLocalStorage('fav_apts', []);
  const addFavoriteApt = (row, areas = [], hotAreas = []) => {
    if (!row) return;
    const aptKey = `${row.kaptName}_${row.bjdCode || ''}`;
    const newFav = {
      key: aptKey, kaptName: row.kaptName, kaptAddr: row.kaptAddr,
      kaptCode: row.kaptCode, bjdCode: row.bjdCode, code5: String(row.bjdCode || '').slice(0, 5),
      as1: row.as1, as2: row.as2, as3: row.as3, as4: row.as4,
      kaptUsedate: row.kaptUsedate,
      codeAptNm:   row.codeAptNm,
      kaptdaCnt:   row.kaptdaCnt,
      codeSaleNm:  row.codeSaleNm,
      codeHeatNm:  row.codeHeatNm,
      kaptAcompany: row.kaptAcompany,
      kaptBcompany: row.kaptBcompany,
      codeHallNm:  row.codeHallNm,
      doroJuso:    row.doroJuso,
      zipcode:     row.zipcode,
      kaptTarea:   row.kaptTarea,
      kaptDongCnt: row.kaptDongCnt,
      kaptTopFloor:  row.kaptTopFloor,
      kaptBaseFloor: row.kaptBaseFloor,
      areas,
      hotAreas,
    };
    setFavApts(prev => prev.some(a => a.key === aptKey) ? prev : [...prev, newFav]);
  };
  const removeFavoriteApt = (aptKey) => setFavApts(prev => prev.filter(a => a.key !== aptKey));

  const handleSelectApt = useCallback((row) => {
    setSelectedApt(row || null);
    if (row) setOpenPanel('info');
  }, []);

  // 네비바 아이콘
  const SVG_ATTRS = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round', width: 24, height: 24 };
  const NAV_ICONS = {
    info: <svg {...SVG_ATTRS} stroke="currentColor"><path d="M3 11L12 3l9 8"/><path d="M5 9v11h5v-5h4v5h5V9"/></svg>,
    chart: <svg {...SVG_ATTRS} stroke="currentColor"><polyline points="3,17 8,10 12,13 16,7 21,9"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="21" x2="3" y2="4"/></svg>,
    board: <svg {...SVG_ATTRS} stroke="currentColor"><path d="M4 3h16a1 1 0 011 1v11a1 1 0 01-1 1H8l-5 4V4a1 1 0 011-1z"/></svg>,
    login: <svg {...SVG_ATTRS} stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>,
  };

  const panelButtons = [
    { icon: NAV_ICONS.info,  label: '정보',    key: 'info'  },
    { icon: NAV_ICONS.chart, label: '차트비교', key: 'chart' },
    { icon: NAV_ICONS.board, label: '게시판',   key: 'board' },
    {
      icon: user?.profileImage
        ? <img src={user.profileImage} alt="프로필" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
        : NAV_ICONS.login,
      label: user ? user.nickname : '로그인',
      key: 'login',
    },
  ];

  // 패널 너비: 모바일 전체, 태블릿 420px, 데스크탑 440px
  const panelWidth = isMobile ? '100vw' : isTablet ? '420px' : 'max(440px, min(520px, 42vw))';

  // 데스크탑: 사이드바가 열리면 지도 영역을 밀어냄
  const sidebarOpen = isDesktop && openPanel !== null;

  return (
    <div className="App" style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ── 데스크탑: 좌측 고정 사이드바 ── */}
      {isDesktop && (
        <div style={{
          width: sidebarOpen ? panelWidth : 0,
          minWidth: sidebarOpen ? panelWidth : 0,
          transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1), min-width 0.28s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 4,
          boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,0.08)' : 'none',
          background: '#fff',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ width: panelWidth, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'info'  ? 'flex' : 'none', flexDirection: 'column' }}>
              <LeftPanel
                selectedApt={selectedApt}
                onPanTo={(lat, lng) => setMapCenter({ lat, lng })}
                onSelectApt={handleSelectApt}
                favApts={favApts}
                addFavoriteApt={addFavoriteApt}
                removeFavoriteApt={removeFavoriteApt}
                onOpenChartPanel={() => togglePanel('chart')}
                isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop}
              />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column' }}>
              <ChartPanel isOpen={openPanel === 'chart'} favApts={favApts} removeFavoriteApt={removeFavoriteApt} isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop} user={user} onWritePost={(html) => { setPendingPostContent(html); setOpenPanel('board'); }} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'board' ? 'flex' : 'none', flexDirection: 'column' }}>
              <BoardPanel backHandlerRef={boardBackHandlerRef} user={user} pendingPostContent={pendingPostContent} onPendingPostConsumed={() => setPendingPostContent(null)} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'login' ? 'flex' : 'none', flexDirection: 'column' }}>
              <Login user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} />
            </div>
          </div>
        </div>
      )}

      {/* ── 지도 영역 ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: (!isDesktop && openPanel) ? 'none' : 'contents' }}>
          <Mainmap
            mapCenter={mapCenter}
            setMapCenter={setMapCenter}
            mapLevel={mapLevel}
            setMapLevel={setMapLevel}
            onSelectApt={handleSelectApt}
            isHidden={!isDesktop && !!openPanel}
          />
        </div>

        {/* 데스크탑: 책갈피 탭 (사이드바 우측 벽에 부착) */}
        {isDesktop && (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            display: 'flex', flexDirection: 'column',
            zIndex: 7,
          }}>
            {panelButtons.map((btn, i) => {
              const active = openPanel === btn.key;
              return (
                <button
                  key={btn.key}
                  onClick={() => togglePanel(btn.key)}
                  style={{
                    width: 48, height: 80,
                    border: '1px solid #D5CCC4', borderLeft: 'none',
                    borderRadius: '0 10px 10px 0',
                    marginBottom: i < panelButtons.length - 1 ? 2 : 0,
                    background: active ? '#fff' : 'rgba(240,236,232,0.88)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 5,
                    color: active ? '#C9A84C' : '#7A726D',
                    fontWeight: active ? 600 : 400,
                    boxShadow: '2px 0 8px rgba(0,0,0,0.10)',
                    transition: 'background 0.15s',
                    padding: 0,
                  }}
                  aria-pressed={active}
                  title={btn.label}
                >
                  {btn.icon}
                  <span style={{ fontSize: '10px', letterSpacing: '-0.01em' }}>{btn.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 모바일·태블릿: 풀스크린 패널 */}
        {!isDesktop && openPanel && (
          <div
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
              background: '#fff',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 5,
            }}
          >
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'info'  ? 'flex' : 'none', flexDirection: 'column' }}>
              <LeftPanel
                selectedApt={selectedApt}
                onPanTo={(lat, lng) => setMapCenter({ lat, lng })}
                onSelectApt={handleSelectApt}
                favApts={favApts}
                addFavoriteApt={addFavoriteApt}
                removeFavoriteApt={removeFavoriteApt}
                onOpenChartPanel={() => togglePanel('chart')}
                isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop}
              />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'login' ? 'flex' : 'none', flexDirection: 'column' }}>
              <Login user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'board' ? 'flex' : 'none', flexDirection: 'column' }}>
              <BoardPanel backHandlerRef={boardBackHandlerRef} user={user} pendingPostContent={pendingPostContent} onPendingPostConsumed={() => setPendingPostContent(null)} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column' }}>
              <ChartPanel isOpen={openPanel === 'chart'} favApts={favApts} removeFavoriteApt={removeFavoriteApt} isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop} user={user} onWritePost={(html) => { setPendingPostContent(html); setOpenPanel('board'); }} />
            </div>
          </div>
        )}
      </div>

      {/* 모바일·태블릿 하단 네비게이션 바 */}
      {!isDesktop && (
        <div style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
          background: '#fff',
          borderTop: '1px solid #EBEBEB',
          display: 'flex', alignItems: 'flex-start',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          zIndex: 11,
          boxShadow: '0 -1px 0 rgba(0,0,0,0.06)',
        }}>
          {panelButtons.map(btn => {
            const active = openPanel === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => togglePanel(btn.key)}
                style={{
                  flex: 1, border: 'none', background: 'none', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4, height: 56, padding: 0,
                  color: active ? '#C9A84C' : '#BBBBBB',
                  fontWeight: active ? 500 : 400,
                  fontSize: '10px',
                }}
                aria-pressed={active}
              >
                {btn.icon}
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
