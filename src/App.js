// src/App.js
// 데이터 구조 변경 시 APP_VERSION을 올리면 구버전 localStorage 자동 초기화
const APP_VERSION = '2';
if (localStorage.getItem('app_version') !== APP_VERSION) {
  localStorage.clear();
  localStorage.setItem('app_version', APP_VERSION);
}

import { useState, useCallback, useEffect, useRef } from 'react';
import './App.css';
import Mainmap from './pages/Mainmap';
import LeftPanel, { AptTradeChart } from './pages/LeftPanel';
import { FavChipGrid, PickButton } from './components/FavoriteButton';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useBreakpoint } from './hooks/useBreakpoint';
import { applyTheme } from './styles/themes';

// 패널 컴포넌트
import Login from './pages/Login';
import BoardPanel from './pages/BoardPanel';
import ChartPanel from './pages/ChartPanel';
import MasterMenu from './pages/MasterMenu';

// 마스터 유저 ID — 카카오 로그인 후 console.log(user.id)로 확인 후 입력
const MASTER_USER_ID = null; // TODO: 본인 카카오 ID로 교체

const API_BASE = 'https://apt-chart-api.kyungminkor.workers.dev';

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
  const [openPanel, setOpenPanel] = useState(null);
  const [pendingPostContent, setPendingPostContent] = useState(null);
  const [pendingPostTitle, setPendingPostTitle] = useState('');
  const [pendingPostMeta, setPendingPostMeta] = useState(null);
  const [boardIsWriting, setBoardIsWriting]   = useState(false);
  const [chartRestoreKey, setChartRestoreKey] = useState(0);

  // 지도탭 오버레이 state
  const [mapChartData, setMapChartData] = useState(null);
  const [showMapChart, setShowMapChart] = useState(true);
  const [chartPos, setChartPos] = useState({ x: 0, y: 0 });
  const [chartDragging, setChartDragging] = useState(false);
  const chartPosRef = useRef({ x: 0, y: 0 });

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

  // 지도탭 진입 시 칩 일괄 flash
  const [chipFlash, setChipFlash] = useState(false);
  const prevOpenPanelRef2 = useRef(openPanel);
  useEffect(() => {
    if (prevOpenPanelRef2.current !== null && openPanel === null) {
      setChipFlash(true);
      const t = setTimeout(() => setChipFlash(false), 400);
      return () => clearTimeout(t);
    }
    prevOpenPanelRef2.current = openPanel;
  }, [openPanel]);

  // 뒤로가기 버튼 처리
  const openPanelRef = useRef(openPanel);
  useEffect(() => { openPanelRef.current = openPanel; }, [openPanel]);

  const boardBackHandlerRef = useRef(null);
  const chipAreaRef = useRef(null);

  // selectedApt 해제 시에만 compact 차트 초기화 (리로드 중 깜박임 방지)
  useEffect(() => {
    if (!selectedApt) setMapChartData(null);
  }, [selectedApt]);

  // 컴팩트 차트 홀드-드래그 — 차트 닫을 때 위치 리셋
  useEffect(() => {
    if (!showMapChart) {
      setChartPos({ x: 0, y: 0 });
      chartPosRef.current = { x: 0, y: 0 };
    }
  }, [showMapChart]);

  const handleChartDown = (e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const baseX = chartPosRef.current.x, baseY = chartPosRef.current.y;
    let dragging = false, moved = false;

    const holdTimer = setTimeout(() => {
      dragging = true;
      setChartDragging(true);
    }, 300);

    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.hypot(dx, dy) > 8) moved = true;
      if (moved && !dragging) { clearTimeout(holdTimer); return; }
      if (!dragging) return;
      const nx = baseX + dx, ny = baseY + dy;
      chartPosRef.current = { x: nx, y: ny };
      setChartPos({ x: nx, y: ny });
    };

    const onUp = () => {
      clearTimeout(holdTimer);
      if (!dragging && !moved) setOpenPanel('info');
      dragging = false;
      setChartDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const [chipAreaHeight, setChipAreaHeight] = useState(0);
  useEffect(() => {
    if (!chipAreaRef.current) return;
    const ro = new ResizeObserver(([e]) => setChipAreaHeight(e.contentRect.height));
    ro.observe(chipAreaRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    history.pushState(null, '');
    const handlePopState = () => {
      if (openPanelRef.current === 'board') {
        const handled = boardBackHandlerRef.current?.();
        if (!handled) {
          setOpenPanel(null);   // 지도탭으로
        }
        history.pushState(null, '');
        return;
      }
      if (openPanelRef.current) {
        setOpenPanel(null);   // 지도탭으로
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

  const saveUserToServer = async (userId, favorites, boardNickname, savedTheme) => {
    if (!userId) return;
    try {
      await fetch(`${API_BASE}/api/user/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorites, boardNickname: boardNickname ?? null, theme: savedTheme ?? null }),
      });
    } catch {}
  };

  // 디바운스 저장: 마지막 변경 후 3초 뒤 최신 데이터로 1회만 저장
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(null);
  const scheduleSave = (userId, favorites, boardNickname, savedTheme) => {
    if (!userId) return;
    pendingSaveRef.current = { userId, favorites, boardNickname, savedTheme };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const d = pendingSaveRef.current;
      if (d) saveUserToServer(d.userId, d.favorites, d.boardNickname, d.savedTheme);
    }, 3000);
  };

  const handleLoginSuccess = async (data) => {
    setUser(data);
    try {
      const res = await fetch(`${API_BASE}/api/user/${data.id}`);
      const serverData = await res.json();
      const mergedUser = { ...data };
      if (serverData.boardNickname) mergedUser.boardNickname = serverData.boardNickname;
      setUser(mergedUser);
      if (serverData.theme) {
        applyTheme(serverData.theme);
        setTheme(serverData.theme);
      }
      if (serverData.favorites?.length > 0) {
        const existing = new Set(favApts.map(f => f.key));
        const merged = [...favApts, ...serverData.favorites.filter(f => !existing.has(f.key))];
        setFavApts(merged);
      }
    } catch {}
  };

  const handleUpdateUser = (updatedUser) => {
    setUser(updatedUser);
    scheduleSave(updatedUser.id, favApts, updatedUser.boardNickname, theme);
  };

  const handleSetTheme = (newTheme) => {
    applyTheme(newTheme);
    setTheme(newTheme);
    if (user?.id) scheduleSave(user.id, favApts, user.boardNickname, newTheme);
  };

  const handleLogout = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (user?.id) await saveUserToServer(user.id, favApts, user.boardNickname, theme);
    setUser(null);
  };

  // 즐겨찾기
  const [favApts, setFavApts] = useLocalStorage('fav_apts', []);
  const addFavoriteApt = (row, areas = [], hotAreas = []) => {
    if (!row) return;
    const aptKey = `${row.kaptName}_${row.bjdCode || ''}`;
    if (favApts.some(a => a.key === aptKey)) return;
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
    const next = [newFav, ...favApts];
    setFavApts(next);
    scheduleSave(user?.id, next, user?.boardNickname, theme);
  };
  const removeFavoriteApt = (aptKey) => {
    const next = favApts.filter(a => a.key !== aptKey);
    setFavApts(next);
    scheduleSave(user?.id, next, user?.boardNickname, theme);
  };

  const handleSelectApt = useCallback((row) => {
    setSelectedApt(row || null);
  }, []);

  const handleOpenChart = useCallback((row) => {
    setSelectedApt(row || null);
    if (!row) return;
    setOpenPanel('info');
  }, [isDesktop]);

  // 마스터 유저 여부
  const isMaster = MASTER_USER_ID !== null && user?.id === MASTER_USER_ID;

  // 네비바 아이콘
  const SVG_ATTRS = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round', width: 24, height: 24 };
  const NAV_ICONS = {
    map: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="6" width="20" height="16" rx="2" strokeWidth="1.8"/><line x1="2" y1="13" x2="22" y2="13" strokeWidth="1.2" opacity="0.6"/><line x1="10" y1="6" x2="10" y2="22" strokeWidth="1.2" opacity="0.6"/><path d="M16 0C13.2 0 11 2.2 11 5c0 3.5 5 9 5 9s5-5.5 5-9c0-2.8-2.2-5-5-5z" fill="currentColor" stroke="none"/><circle cx="16" cy="5" r="1.8" fill="var(--color-surface)" stroke="none"/></svg>,
    info: <svg {...SVG_ATTRS} stroke="currentColor"><path d="M3 11L12 3l9 8"/><path d="M5 9v11h5v-5h4v5h5V9"/></svg>,
    chart: <svg {...SVG_ATTRS} stroke="currentColor"><polyline points="3,17 8,10 12,13 16,7 21,9"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="21" x2="3" y2="4"/></svg>,
    board: <svg {...SVG_ATTRS} stroke="currentColor"><path d="M4 3h16a1 1 0 011 1v11a1 1 0 01-1 1H8l-5 4V4a1 1 0 011-1z"/></svg>,
    login: <svg {...SVG_ATTRS} stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>,
    master: <svg {...SVG_ATTRS} stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  };

  const panelButtons = [
    { icon: NAV_ICONS.map,  label: '지도',    key: 'map'   },
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
  const panelWidth = isMobile ? '100vw' : isTablet ? '420px' : 'min(50vw, 800px)';

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
                isVisible={openPanel === 'info'}
                theme={theme}
              />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column' }}>
              <ChartPanel isOpen={openPanel === 'chart'} favApts={favApts} removeFavoriteApt={removeFavoriteApt} isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop} user={user} boardIsWriting={boardIsWriting} restoreKey={chartRestoreKey} theme={theme} onWritePost={(html, title, meta) => { setPendingPostContent(html); setPendingPostTitle(title || ''); setPendingPostMeta(meta || null); setOpenPanel('board'); }} onOpenMinimap={() => setOpenPanel(null)} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'board' ? 'flex' : 'none', flexDirection: 'column' }}>
              <BoardPanel backHandlerRef={boardBackHandlerRef} user={user} pendingPostContent={pendingPostContent} pendingPostTitle={pendingPostTitle} pendingPostMeta={pendingPostMeta} onWritingStateChange={setBoardIsWriting} onOpenChart={(meta) => { setFavApts(prev => { const restoreKeys = new Set((meta.apts || []).map(a => a.key)); const filtered = prev.filter(f => !restoreKeys.has(f.key)); return [...(meta.apts || []), ...filtered]; }); setChartRestoreKey(k => k + 1); setOpenPanel('chart'); }} onPendingPostConsumed={() => { setPendingPostContent(null); setPendingPostTitle(''); setPendingPostMeta(null); }} onOpenMinimap={() => setOpenPanel(null)} isMobile={isMobile} isTablet={isTablet} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'login' ? 'flex' : 'none', flexDirection: 'column' }}>
              <Login user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} onUpdateUser={handleUpdateUser} theme={theme} setTheme={handleSetTheme} onOpenMinimap={() => setOpenPanel(null)} isMobile={isMobile} isTablet={isTablet} />
            </div>
            {isMaster && (
              <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'master' ? 'flex' : 'none', flexDirection: 'column' }}>
                <MasterMenu theme={theme} setTheme={handleSetTheme} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 지도 영역 ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: (!isDesktop && openPanel) ? 'none' : 'block' }}>
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
            isHidden={!isDesktop && !!openPanel}
            relayoutKey={sidebarOpen ? 1 : 0}
            mapPaddingTop={!isDesktop && openPanel === null ? chipAreaHeight : 0}
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
              const active = btn.key === 'map' ? openPanel === null : openPanel === btn.key;
              return (
                <button
                  key={btn.key}
                  onClick={() => btn.key === 'map' ? setOpenPanel(null) : setOpenPanel(btn.key)}
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
      {!isDesktop && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0,
            bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--color-surface)',
            display: openPanel ? 'flex' : 'none', flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
          }}
        >
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'info' ? 'flex' : 'none', flexDirection: 'column' }}>
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
              onOpenMap={() => setOpenPanel(null)}
              onChartData={(data) => { if (data?.x?.length > 0) setMapChartData(data); }}
              isVisible={openPanel === 'info'}
              theme={theme}
            />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'login' ? 'flex' : 'none', flexDirection: 'column' }}>
            <Login user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} onUpdateUser={handleUpdateUser} theme={theme} setTheme={handleSetTheme} onOpenMinimap={() => setOpenPanel(null)} isMobile={isMobile} isTablet={isTablet} />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'board' ? 'flex' : 'none', flexDirection: 'column' }}>
            <BoardPanel backHandlerRef={boardBackHandlerRef} user={user} pendingPostContent={pendingPostContent} pendingPostTitle={pendingPostTitle} pendingPostMeta={pendingPostMeta} onWritingStateChange={setBoardIsWriting} onOpenChart={(meta) => { setFavApts(prev => { const restoreKeys = new Set((meta.apts || []).map(a => a.key)); const filtered = prev.filter(f => !restoreKeys.has(f.key)); return [...(meta.apts || []), ...filtered]; }); setChartRestoreKey(k => k + 1); setOpenPanel('chart'); }} onPendingPostConsumed={() => { setPendingPostContent(null); setPendingPostTitle(''); setPendingPostMeta(null); }} onOpenMinimap={() => setOpenPanel(null)} isMobile={isMobile} isTablet={isTablet} />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'chart' ? 'flex' : 'none', flexDirection: 'column' }}>
            <ChartPanel isOpen={openPanel === 'chart'} favApts={favApts} removeFavoriteApt={removeFavoriteApt} isMobile={isMobile} isTablet={isTablet} isDesktop={isDesktop} user={user} boardIsWriting={boardIsWriting} restoreKey={chartRestoreKey} theme={theme} onWritePost={(html, title, meta) => { setPendingPostContent(html); setPendingPostTitle(title || ''); setPendingPostMeta(meta || null); setOpenPanel('board'); }} onOpenMinimap={() => setOpenPanel(null)} />
          </div>
          {isMaster && (
            <div style={{ flex: 1, overflow: 'hidden', display: openPanel === 'master' ? 'flex' : 'none', flexDirection: 'column' }}>
              <MasterMenu theme={theme} setTheme={handleSetTheme} />
            </div>
          )}
        </div>
      )}


      {/* 지도탭 오버레이 — 칩 + compact L1 차트 */}
      {!isDesktop && openPanel === null && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500, pointerEvents: 'none' }}>
          {/* 칩 행 — FavChipGrid (2줄 페이지네이션) */}
          <div ref={chipAreaRef} style={{
            padding: '0 10px',
            height: 52,
            background: 'var(--color-primary)',
            borderBottom: '1.5px solid var(--color-primary-border)',
            pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {selectedApt && (() => {
              const aptKey = `${selectedApt.kaptName}_${selectedApt.bjdCode || ''}`;
              const isFav = favApts.some(a => a.key === aptKey);
              return (
                <PickButton
                  isFav={isFav}
                  onClick={() => isFav ? removeFavoriteApt(aptKey) : addFavoriteApt(selectedApt)}
                />
              );
            })()}
            {favApts.length > 0 && (
              <FavChipGrid
                favApts={favApts}
                selectedApt={selectedApt}
                theme={theme}
                flashAll={chipFlash}
                maxChars={5}
                onSelect={(fav) => {
                  setSelectedApt(fav);
                  if (fav['위도'] && fav['경도']) setMapCenter({ lat: Number(fav['위도']), lng: Number(fav['경도']) });
                }}
                onRemove={removeFavoriteApt}
              />
            )}
          </div>


            {/* compact 차트 — 우측 정렬, 라운드, 토글 버튼 내장 */}
            {mapChartData?.x?.length > 0 && (
              <div style={{
                pointerEvents: 'none',
                display: 'flex', justifyContent: 'flex-end',
                padding: '10px 10px 0',
              }}>
                <div style={{
                  pointerEvents: 'auto',
                  width: '50%',
                  maxWidth: 260,
                  background: 'var(--color-surface)',
                  borderRadius: 12,
                  border: '1px solid var(--map-accent-border)',
                  overflow: 'hidden',
                  boxShadow: chartDragging ? '0 8px 24px rgba(0,0,0,0.22)' : '0 2px 8px rgba(0,0,0,0.10)',
                  position: 'relative',
                  minHeight: showMapChart ? 0 : 'auto',
                  transform: `translate(${chartPos.x}px, ${chartPos.y}px)`,
                  transition: chartDragging ? 'none' : 'box-shadow 0.2s',
                  cursor: chartDragging ? 'grabbing' : 'default',
                  userSelect: 'none',
                }}>
                  {/* 드래그 핸들 pill */}
                  <div style={{ display: 'flex', justifyContent: 'center', padding: showMapChart ? '6px 0 2px' : '6px 0 6px' }}>
                    <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--color-accent)', opacity: 0.3 }} />
                  </div>

                  {/* 토글 버튼 — 항상 absolute 고정 위치 */}
                  <button
                    onClick={() => setShowMapChart(v => !v)}
                    style={{
                      position: 'absolute', top: 0, right: 5, zIndex: 2,
                      border: 'none', background: 'none', cursor: 'pointer',
                      padding: '3px 5px', fontSize: '0.8rem', fontWeight: 700,
                      color: 'var(--color-accent)', opacity: 0.3, lineHeight: 1,
                    }}
                  >{showMapChart ? '▲' : '▼'}</button>

                  <div
                    style={{ display: showMapChart ? 'block' : 'none', paddingLeft: 10 }}
                    onPointerDown={handleChartDown}
                  >
                    <AptTradeChart
                      compact
                      x={mapChartData.x}
                      vol={mapChartData.vol}
                      avg={mapChartData.avg}
                      ptsX={mapChartData.ptsX}
                      ptsY={mapChartData.ptsY}
                      pPtsX={mapChartData.pPtsX}
                      pPtsY={mapChartData.pPtsY}
                      selArea={mapChartData.selArea}
                      aptName={mapChartData.aptName}
                      yearWindow={5}
                      isMobile={isMobile}
                      theme={theme}
                    />
                  </div>
                </div>
              </div>
            )}
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
            const active = btn.key === 'map' ? openPanel === null : openPanel === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => {
                  if (btn.key === 'map') { setOpenPanel(null); }
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
