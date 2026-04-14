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
import { applyTheme, ACCENT_ALPHA } from './styles/themes';

// 패널 컴포넌트
import Login from './pages/Login';
import BoardPanel from './pages/BoardPanel';
import ChartPanel from './pages/ChartPanel';
import MasterMenu from './pages/MasterMenu';

// 마스터 유저 ID — 카카오 로그인 후 console.log(user.id)로 확인 후 입력
const MASTER_USER_ID = null; // TODO: 본인 카카오 ID로 교체

// 공용 닫기 버튼 — 헤더 좌측 "← 닫기"
export function CloseButton({ onClose, label = '닫기' }) {
  return (
    <button
      onClick={onClose}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        border: 'none', background: 'none', cursor: 'pointer',
        color: 'var(--color-text-sub)', fontWeight: 600, fontSize: '0.92rem',
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
  // 모바일/태블릿 초기 구동: 정보탭 열린 상태로 시작
  const [openPanel, setOpenPanel] = useState(() => window.innerWidth < 850 ? 'info' : null);
  const [pendingPostContent, setPendingPostContent] = useState(null);
  const [pendingPostTitle, setPendingPostTitle] = useState('');
  const [pendingPostMeta, setPendingPostMeta] = useState(null);
  const [boardIsWriting, setBoardIsWriting]   = useState(false);
  const [chartRestoreKey, setChartRestoreKey] = useState(0);

  // 미니맵 모드: LeftPanel 상단 칩 + 카카오맵 동시 표시 (모바일/태블릿)
  // 모바일/태블릿 초기 구동: 미니맵(지도 아이콘 클릭) 상태로 시작
  const [showMinimap, setShowMinimap] = useState(() => window.innerWidth < 850);
  const [handleHint, setHandleHint] = useState(false);
  const hintTimerRef = useRef(null);
  const minimapPanelRef = useRef(null);
  const [minimapPanelHeight, setMinimapPanelHeight] = useState(0);
  const handleSwipeRef = useRef({ startY: 0 });
  const MINIMAP_ANIM_MS = 300;
  const [minimapAnimState, setMinimapAnimState] = useState(
    () => (window.innerWidth < 850 ? 'visible' : 'hidden')
  );
  const minimapAnimTimerRef = useRef(null);
  useEffect(() => {
    if (openPanel !== 'info') setShowMinimap(false);
  }, [openPanel]);
  useEffect(() => {
    if (!showMinimap || !minimapPanelRef.current) { setMinimapPanelHeight(0); return; }
    const el = minimapPanelRef.current;
    const obs = new ResizeObserver(() => setMinimapPanelHeight(el.getBoundingClientRect().height));
    obs.observe(el);
    return () => obs.disconnect();
  }, [showMinimap]);
  const openMinimap = useCallback(() => { setOpenPanel('info'); setShowMinimap(true); }, []);
  const closeMinimap = useCallback(() => { setShowMinimap(false); }, []);

  // 미니맵 지도 슬라이드 애니메이션 상태 머신
  useEffect(() => {
    clearTimeout(minimapAnimTimerRef.current);
    if (showMinimap) {
      setMinimapAnimState('entering');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setMinimapAnimState('visible'))
      );
    } else {
      setMinimapAnimState('leaving');
      minimapAnimTimerRef.current = setTimeout(
        () => setMinimapAnimState('hidden'),
        MINIMAP_ANIM_MS
      );
    }
  }, [showMinimap]); // eslint-disable-line react-hooks/exhaustive-deps

  // 미니맵 올라온 상태에서 2초 idle → 핸들 힌트 애니메이션
  useEffect(() => {
    if (!showMinimap) {
      clearTimeout(hintTimerRef.current);
      setHandleHint(false);
      return;
    }
    const onActivity = () => {
      setHandleHint(false);
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setHandleHint(true), 2000);
    };
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('click',      onActivity);
    return () => {
      clearTimeout(hintTimerRef.current);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('click',      onActivity);
    };
  }, [showMinimap]);

  // 모바일/태블릿 초기 구동: 가장 나중에 추가한 즐겨찾기 단지를 선택 + 지도 이동 + 줌레벨 5
  useEffect(() => {
    if (window.innerWidth >= 850) return;
    setMapLevel(5);
    if (!favApts || favApts.length === 0) return;
    const lastFav = favApts[favApts.length - 1];
    setSelectedApt(lastFav);
    if (lastFav['위도'] && lastFav['경도']) {
      setMapCenter({ lat: Number(lastFav['위도']), lng: Number(lastFav['경도']) });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePanel = (key) => setOpenPanel(prev => prev === key ? null : key);

  // 데스크탑 초기 상태: 정보 패널 열림
  useEffect(() => {
    if (isDesktop) setOpenPanel(p => p ?? 'info');
  }, [isDesktop]);

  // 뒤로가기 버튼 처리
  const openPanelRef = useRef(openPanel);
  useEffect(() => { openPanelRef.current = openPanel; }, [openPanel]);

  const boardBackHandlerRef = useRef(null);
  const openMinimapRef = useRef(null);
  useEffect(() => { openMinimapRef.current = openMinimap; }, [openMinimap]);

  useEffect(() => {
    history.pushState(null, '');
    const handlePopState = () => {
      if (openPanelRef.current === 'board') {
        const handled = boardBackHandlerRef.current?.();
        if (!handled) {
          openMinimapRef.current?.();   // 메인화면(지도+미니패널)으로
        }
        history.pushState(null, '');
        return;
      }
      if (openPanelRef.current) {
        openMinimapRef.current?.();   // 메인화면(지도+미니패널)으로
        history.pushState(null, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 테마
  const [theme, setTheme] = useLocalStorage('theme', 'rose_slate');
  useEffect(() => { applyTheme(theme); }, [theme]);

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
      위도: row['위도'], 경도: row['경도'],
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
  }, []);

  const handleOpenChart = useCallback((row) => {
    setSelectedApt(row || null);
    if (!row) return;
    setOpenPanel('info');
    if (!isDesktop) setShowMinimap(false);
  }, [isDesktop]);

  // 마스터 유저 여부
  const isMaster = MASTER_USER_ID !== null && user?.id === MASTER_USER_ID;

  // 네비바 아이콘
  const SVG_ATTRS = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round', width: 24, height: 24 };
  const NAV_ICONS = {
    info: <svg {...SVG_ATTRS} stroke="currentColor"><path d="M3 11L12 3l9 8"/><path d="M5 9v11h5v-5h4v5h5V9"/></svg>,
    chart: <svg {...SVG_ATTRS} stroke="currentColor"><polyline points="3,17 8,10 12,13 16,7 21,9"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="21" x2="3" y2="4"/></svg>,
    board: <svg {...SVG_ATTRS} stroke="currentColor"><path d="M4 3h16a1 1 0 011 1v11a1 1 0 01-1 1H8l-5 4V4a1 1 0 011-1z"/></svg>,
    login: <svg {...SVG_ATTRS} stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>,
    master: <svg {...SVG_ATTRS} stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  };

  const panelButtons = [
    { icon: NAV_ICONS.info,  label: '정보',    key: 'info'  },
    { icon: NAV_ICONS.chart, label: '단지비교', key: 'chart' },
    { icon: NAV_ICONS.board, label: '게시판',   key: 'board' },
    {
      icon: user?.profileImage
        ? <img src={user.profileImage} alt="프로필" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
        : NAV_ICONS.login,
      label: user ? user.nickname : '로그인',
      key: 'login',
    },
    ...(isMaster ? [{ icon: NAV_ICONS.master, label: '마스터', key: 'master' }] : []),
  ];

  // 패널 너비: 모바일 전체, 태블릿 420px, 데스크탑 440px
  const panelWidth = isMobile ? '100vw' : isTablet ? '420px' : 'max(640px, 42vw)';

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
          background: 'var(--color-surface)',
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
                onClose={() => setOpenPanel(null)}
                isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop}
                theme={theme}
              />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column' }}>
              <ChartPanel isOpen={openPanel === 'chart'} favApts={favApts} removeFavoriteApt={removeFavoriteApt} isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop} user={user} boardIsWriting={boardIsWriting} restoreKey={chartRestoreKey} theme={theme} onWritePost={(html, title, meta) => { setPendingPostContent(html); setPendingPostTitle(title || ''); setPendingPostMeta(meta || null); setOpenPanel('board'); }} onOpenMinimap={openMinimap} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'board' ? 'flex' : 'none', flexDirection: 'column' }}>
              <BoardPanel backHandlerRef={boardBackHandlerRef} user={user} pendingPostContent={pendingPostContent} pendingPostTitle={pendingPostTitle} pendingPostMeta={pendingPostMeta} onWritingStateChange={setBoardIsWriting} onOpenChart={(meta) => { setFavApts(prev => { const restoreKeys = new Set((meta.apts || []).map(a => a.key)); const filtered = prev.filter(f => !restoreKeys.has(f.key)); return [...(meta.apts || []), ...filtered]; }); setChartRestoreKey(k => k + 1); setOpenPanel('chart'); }} onPendingPostConsumed={() => { setPendingPostContent(null); setPendingPostTitle(''); setPendingPostMeta(null); }} onOpenMinimap={openMinimap} isMobile={isMobile} isTablet={isTablet} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'login' ? 'flex' : 'none', flexDirection: 'column' }}>
              <Login user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} theme={theme} setTheme={setTheme} onOpenMinimap={openMinimap} isMobile={isMobile} isTablet={isTablet} />
            </div>
            {isMaster && (
              <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'master' ? 'flex' : 'none', flexDirection: 'column' }}>
                <MasterMenu theme={theme} setTheme={setTheme} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 지도 영역 ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={
          (!isDesktop && minimapAnimState !== 'hidden')
            ? {
                position: 'absolute',
                top: minimapPanelHeight + 12,
                left: 0, right: 0, bottom: 0,
                borderRadius: '14px 14px 0 0',
                border: '1.5px solid rgba(190,155,70,0.45)',
                borderBottom: 'none',
                overflow: 'hidden',
                transform: (minimapAnimState === 'entering' || minimapAnimState === 'leaving')
                  ? 'translateY(110%)'
                  : 'translateY(0)',
                transition: minimapAnimState === 'entering'
                  ? 'none'
                  : `transform ${MINIMAP_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
              }
            : {
                position: 'absolute', inset: 0,
                display: (!isDesktop && openPanel) ? 'none' : 'contents',
              }
        }>
          <Mainmap
            mapCenter={mapCenter}
            setMapCenter={setMapCenter}
            mapLevel={mapLevel}
            setMapLevel={setMapLevel}
            onSelectApt={handleSelectApt}
            onOpenChart={handleOpenChart}
            selectedApt={selectedApt}
            favApts={favApts}
            addFavoriteApt={addFavoriteApt}
            removeFavoriteApt={removeFavoriteApt}
            isHidden={!isDesktop && !!openPanel && !showMinimap}
            relayoutKey={showMinimap ? 1 : 0}
            theme={theme}
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
                    border: '1px solid var(--color-border-strong)', borderLeft: 'none',
                    borderRadius: '0 10px 10px 0',
                    marginBottom: i < panelButtons.length - 1 ? 2 : 0,
                    background: active ? 'var(--color-surface)' : 'rgba(240,236,232,0.88)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 5,
                    color: active ? 'var(--color-accent)' : 'var(--color-text-sub)',
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

      </div>

      {/* 모바일·태블릿: 풀스크린 패널 — 지도 영역 밖, App 루트 직계 자식 */}
      {!isDesktop && openPanel && (
        <div
          ref={minimapPanelRef}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0,
            bottom: showMinimap ? undefined : 'calc(56px + env(safe-area-inset-bottom, 0px))',
            background: showMinimap ? 'transparent' : 'var(--color-surface)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
          }}
        >
          <div style={{ flex: showMinimap ? undefined : 1, overflow: 'hidden', display: openPanel === 'info' ? 'flex' : 'none', flexDirection: 'column' }}>
            <LeftPanel
              selectedApt={selectedApt}
              onPanTo={(lat, lng) => setMapCenter({ lat, lng })}
              onSelectApt={handleSelectApt}
              favApts={favApts}
              addFavoriteApt={addFavoriteApt}
              removeFavoriteApt={removeFavoriteApt}
              onOpenChartPanel={() => togglePanel('chart')}
              onClose={() => setOpenPanel(null)}
              isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop}
              showMinimap={showMinimap}
              onToggleMinimap={() => setShowMinimap(v => !v)}
              theme={theme}
            />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'login' ? 'flex' : 'none', flexDirection: 'column' }}>
            <Login user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} theme={theme} setTheme={setTheme} onOpenMinimap={openMinimap} isMobile={isMobile} isTablet={isTablet} />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'board' ? 'flex' : 'none', flexDirection: 'column' }}>
            <BoardPanel backHandlerRef={boardBackHandlerRef} user={user} pendingPostContent={pendingPostContent} pendingPostTitle={pendingPostTitle} pendingPostMeta={pendingPostMeta} onWritingStateChange={setBoardIsWriting} onOpenChart={(meta) => { setFavApts(prev => { const restoreKeys = new Set((meta.apts || []).map(a => a.key)); const filtered = prev.filter(f => !restoreKeys.has(f.key)); return [...(meta.apts || []), ...filtered]; }); setChartRestoreKey(k => k + 1); setOpenPanel('chart'); }} onPendingPostConsumed={() => { setPendingPostContent(null); setPendingPostTitle(''); setPendingPostMeta(null); }} onOpenMinimap={openMinimap} isMobile={isMobile} isTablet={isTablet} />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column' }}>
            <ChartPanel isOpen={openPanel === 'chart'} favApts={favApts} removeFavoriteApt={removeFavoriteApt} isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop} user={user} boardIsWriting={boardIsWriting} restoreKey={chartRestoreKey} theme={theme} onWritePost={(html, title, meta) => { setPendingPostContent(html); setPendingPostTitle(title || ''); setPendingPostMeta(meta || null); setOpenPanel('board'); }} onOpenMinimap={openMinimap} />
          </div>
          {isMaster && (
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'master' ? 'flex' : 'none', flexDirection: 'column' }}>
              <MasterMenu theme={theme} setTheme={setTheme} />
            </div>
          )}
        </div>
      )}

      {/* 미니맵 스와이프 핸들 바 */}
      {!isDesktop && openPanel && (
        <div
          style={{
            position: 'fixed',
            ...(showMinimap
              ? { top: minimapPanelHeight, left: 0, right: 0 }
              : { bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))', left: 0, right: 0 }
            ),
            height: 20,
            zIndex: 1010,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'none',
            background: showMinimap ? 'rgba(253,251,248,0.85)' : 'rgba(253,251,248,0.95)',
          }}
          onTouchStart={(e) => { handleSwipeRef.current.startY = e.touches[0].clientY; }}
          onTouchMove={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            const dy = e.changedTouches[0].clientY - handleSwipeRef.current.startY;
            if (showMinimap && dy > 40) closeMinimap();
            if (!showMinimap && dy < -40) openMinimap();
          }}
          onClick={() => showMinimap ? closeMinimap() : openMinimap()}
        >
          <div
            className={showMinimap && handleHint ? 'handle-hint-anim' : ''}
            onAnimationEnd={() => {
              setHandleHint(false);
              hintTimerRef.current = setTimeout(() => setHandleHint(true), 2000);
            }}
            style={{
              width: 36, height: 4, borderRadius: 2,
              background: showMinimap ? ACCENT_ALPHA[theme].a55 : 'var(--color-border-strong)',
            }}
          />
        </div>
      )}

      {/* 모바일·태블릿 하단 네비게이션 바 */}
      {!isDesktop && (
        <div style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
          background: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'flex-start',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          zIndex: 1020,
          boxShadow: '0 -1px 0 rgba(0,0,0,0.06)',
        }}>
          {panelButtons.map(btn => {
            const active = openPanel === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => {
                  if (btn.key === 'info' && showMinimap) { setShowMinimap(false); }
                  else if (!active) { togglePanel(btn.key); }
                }}
                style={{
                  flex: 1, border: 'none', background: 'none', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4, height: 56, padding: 0,
                  color: active ? 'var(--color-accent)' : 'var(--color-text-disabled)',
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
