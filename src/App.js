// src/App.js
import React, { useState, useCallback } from 'react';
import './App.css';
import Mainmap from './pages/Mainmap';
import LeftPanel from './pages/LeftPanel';

// 패널 컴포넌트
import Login from './pages/Login';
import BoardPanel from './pages/BoardPanel';
import ChartPanel from './pages/ChartPanel';

function App() {
  // 지도 중심
  const [mapCenter, setMapCenter] = useState({ lat: 37.5665, lng: 126.9780 }); // 서울시청
  // 선택된 아파트(= CSV 한 행 전체)
  const [selectedApt, setSelectedApt] = useState(null);

  // 어떤 패널이 열려있는지: 'login' | 'chart' | 'board' | null
  const [openPanel, setOpenPanel] = useState(null);
  const togglePanel = (key) => setOpenPanel(prev => (prev === key ? null : key));
  const closePanel = () => setOpenPanel(null);
  
  //App.js에 즐겨찾기 단지 상태를 추가 LeftPanel과 ChartPanel이 공통
  const [favApts, setFavApts] = useState([]);
  const addFavoriteApt = (row) => {
    if (!row) return;

    const aptKey = `${row.kaptName}_${row.bjdCode || ''}`;

    const newFav = {
      key: aptKey,
      kaptName: row.kaptName,
      kaptAddr: row.kaptAddr,   // ✅ 추가
      bjdCode: row.bjdCode,
      as1: row.as1,
      as2: row.as2,
      as3: row.as3,             // ✅ 추가
      as4: row.as4,             // ✅ 추가
    };

    setFavApts(prev => (prev.some(a => a.key === aptKey) ? prev : [...prev, newFav]));
  };

  const removeFavoriteApt = (aptKey) => {
    setFavApts(prev => prev.filter(a => a.key !== aptKey));
  };
  
  const panelButtons = [
    { icon: '👤', label: '로그인', key: 'login' },
    { icon: '📈', label: '차트비교', key: 'chart' },
    { icon: '💬', label: '게시판', key: 'board' },
  ];

  // Mainmap에서 마커/라벨 클릭 시 선택
  const handleSelectApt = useCallback((row) => {
    setSelectedApt(row || null);
  }, []);

  return (
    <div className="App" style={{ display: 'flex', height: '100vh', width: '100%' }}>
      {/* 왼쪽 패널 */}
      <LeftPanel
        selectedApt={selectedApt}
        onPanTo={(lat, lng) => setMapCenter({ lat, lng })}
        favApts={favApts}
        addFavoriteApt={addFavoriteApt}
        removeFavoriteApt={removeFavoriteApt}
      />

      {/* 지도 영역 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Mainmap
          mapCenter={mapCenter}
          setMapCenter={setMapCenter}
          onSelectApt={handleSelectApt}
        />

        {/* 오른쪽 버튼 3개 */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: '10px',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 6
          }}
        >
          {panelButtons.map(btn => {
            const active = openPanel === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => togglePanel(btn.key)}
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  backgroundColor: active ? '#f0f4ff' : '#fff',
                  border: active ? '2px solid #6476FF' : '1px solid #ccc',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                }}
                title={btn.label}
                aria-pressed={active}
              >
                {btn.icon}
              </button>
            );
          })}
        </div>

        {/* 패널 외부 클릭 시 닫힘용 반투명 오버레이 */}
        {openPanel && (
          <div
            onClick={closePanel}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.12)',
              zIndex: 4
            }}
            aria-hidden
          />
        )}

        {/* 오른쪽 슬라이드 인 패널 컨테이너 */}
        <div
          style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: '50%',
            transform: openPanel ? 'translateX(-50%)' : 'translateX(200%)', // 닫힐 때는 화면 밖
            width: 'min(720px, 90vw)',
            transition: 'width 0.22s ease',
            background: '#fff',
            borderLeft: openPanel ? '1px solid #e6ebf5' : 'none',
            boxShadow: openPanel ? '0 0 20px rgba(0,0,0,0.08)' : 'none',
            overflow: 'hidden',
            zIndex: 5,
            borderRadius: 12
          }}
          aria-hidden={!openPanel}
        >
          {openPanel === 'login' && <Login onClose={closePanel} />}

          {openPanel === 'board' && <BoardPanel onClose={closePanel} />}

          <div style={{ display: openPanel === "chart" ? "block" : "none", height: "100%" }}>
            <ChartPanel
              isOpen={openPanel === "chart"}   // ✅ 추가
              favApts={favApts}
              removeFavoriteApt={removeFavoriteApt}
              onClose={closePanel}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
