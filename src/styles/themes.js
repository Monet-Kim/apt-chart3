// ─────────────────────────────────────────────
//  테마 시스템 — 컬러 레퍼런스
//  현재 적용 테마: rose_slate (기본)
// ─────────────────────────────────────────────

// ── CSS 변수 테마 정의 ──────────────────────
// applyTheme()으로 :root에 주입되는 값들.
// 인라인 스타일에서는 var(--color-xxx) 로 참조.

export const THEMES = {
  // ── Rose & Slate ────────────────────────────────────────────────────────
  // 기반색: Mauve/Dusty Rose 계열  (#5C3840 → #8C5860)
  // 보완색: Slate Blue 계열         (#3A4860 → #6880A0)
  rose_slate: {
    // 메인 브랜드
    '--color-primary':           '#5C3840',  // 패널 헤더 배경 (Mauve Dark)
    '--color-primary-border':    '#4A2830',  // 헤더 하단 보더
    '--color-primary-text':      '#F0E0E0',  // 헤더 위 텍스트

    '--color-accent':            '#8C5860',  // 활성 버튼, 강조 레이블 (Dusty Rose)
    '--color-accent-muted':      '#C8A0A8',  // 액센트 연한 버전 — 뱃지 배경, 태그
    '--color-accent-text':       '#2A1418',  // 액센트 배경 위 텍스트

    // 보완색 (Slate Blue)
    '--color-complement':        '#3A4860',  // 보완색 기본 (Slate Blue)
    '--color-complement-muted':  '#9AAAC0',  // 보완색 연한 버전 — 차트 tint

    // 배경 레이어
    '--color-bg':                '#F8F4F3',  // 앱 전체 배경
    '--color-surface':           '#FAF8F5',  // 패널·카드 배경
    '--color-surface-raised':    '#FDF9F8',  // 카드 hover/선택 시 뜨는 레이어
    '--color-surface-2':         '#FCF8F7',  // 패널 내부 약간 따뜻한 배경
    '--color-surface-3':         '#F0E8E8',  // 테이블 행, 스티키 헤더 (Rose tint)
    '--color-surface-active':    '#EAE0E2',  // 활성 항목 하이라이트 배경
    '--color-surface-chart':     '#E4EAF0',  // 차트 썸네일 배경 (Slate tint)
    '--color-hover':             '#EDE4E4',  // 호버 배경

    // 텍스트
    '--color-text-main':         '#241E1C',  // 주요 텍스트
    '--color-text-sub':          '#5A4A4C',  // 보조 텍스트
    '--color-text-muted':        '#8A7878',  // 흐린 텍스트
    '--color-text-faint':        '#A09090',  // 더 흐린 텍스트
    '--color-text-disabled':     '#C8B8B8',  // 비활성·힌트 텍스트

    // 테두리
    '--color-border':            '#E0D4D4',  // 주요 테두리·구분선
    '--color-border-strong':     '#C8B8B8',  // 사이드바 등 강조 테두리

    // 스크롤바
    '--color-scrollbar':         '#C8B8BC',  // 스크롤바 thumb
    '--color-scrollbar-hover':   '#A89098',  // 스크롤바 thumb hover

    // Mainmap UI
    '--map-accent':              'var(--color-accent)',
    '--map-accent-border':       'var(--color-primary-border)',
    '--map-accent-bg':           'var(--color-surface-3)',
    '--map-accent-muted':        'var(--color-accent-muted)',
    '--map-border':              'var(--color-surface-2)',
    '--map-text':                'var(--color-text-main)',
    '--map-surface':             'var(--color-bg)',
    '--map-text-muted':          'var(--color-text-disabled)',

    // 지도 마커
    '--marker-normal':           '#6880A0',  // 일반 마커 — Slate Blue (보완색)
    '--marker-active':           '#8C5860',  // 선택 마커 — Dusty Rose (주색)
    '--marker-cluster':          '#3A4860',  // 클러스터 마커 — Slate Dark
  },

  // ── Gold ────────────────────────────────────────────────────────────────
  gold: {
    // 메인 브랜드
    '--color-primary':           '#B8943F',  // 패널 헤더 배경
    '--color-primary-border':    '#A07828',  // 헤더 하단 보더
    '--color-primary-text':      '#FDF5DC',  // 헤더 위 텍스트 (크림)

    '--color-accent':            '#C9A84C',  // 활성 버튼, 강조 레이블
    '--color-accent-muted':      '#EDD898',  // 액센트 연한 버전 — 뱃지 배경, 태그
    '--color-accent-text':       '#2A1800',  // 액센트 배경 위 텍스트

    // 보완색 (Bronze/Earth)
    '--color-complement':        '#5C4A20',  // 보완색 기본 (다크 브론즈)
    '--color-complement-muted':  '#A89060',  // 보완색 연한 버전

    // 배경 레이어
    '--color-bg':                '#F7F3EE',  // 앱 전체 배경
    '--color-surface':           '#FAF8F5',  // 패널·카드 배경
    '--color-surface-raised':    '#FFFEF5',  // 카드 hover/선택 시 뜨는 레이어
    '--color-surface-2':         '#FDFBF8',  // 패널 내부 약간 따뜻한 배경
    '--color-surface-3':         '#F5F1EC',  // 테이블 행, 스티키 헤더
    '--color-surface-active':    '#FDF8EE',  // 활성 항목 하이라이트 배경
    '--color-surface-chart':     '#FDF3DC',  // 차트 썸네일 배경 (노란 톤)
    '--color-hover':             '#EEE8E0',  // 호버 배경

    // 텍스트
    '--color-text-main':         '#1F1D1B',  // 주요 텍스트
    '--color-text-sub':          '#6B625B',  // 보조 텍스트
    '--color-text-muted':        '#888780',  // 흐린 텍스트
    '--color-text-faint':        '#9E9589',  // 더 흐린 텍스트
    '--color-text-disabled':     '#C9BFB4',  // 비활성·힌트 텍스트

    // 테두리
    '--color-border':            '#E6DED4',  // 주요 테두리·구분선
    '--color-border-strong':     '#D5CCC4',  // 사이드바 등 강조 테두리

    // 스크롤바
    '--color-scrollbar':         '#D3D1C7',  // 스크롤바 thumb
    '--color-scrollbar-hover':   '#B4B2A9',  // 스크롤바 thumb hover

    // Mainmap UI
    '--map-accent':              'var(--color-accent)',
    '--map-accent-border':       'var(--color-primary-border)',
    '--map-accent-bg':           'var(--color-surface-3)',
    '--map-accent-muted':        'var(--color-accent-muted)',
    '--map-border':              'var(--color-surface-2)',
    '--map-text':                'var(--color-text-main)',
    '--map-surface':             'var(--color-bg)',
    '--map-text-muted':          'var(--color-text-disabled)',

    // 지도 마커
    '--marker-normal':           '#FF6B35',  // 일반 마커 (주황)
    '--marker-active':           '#C9A84C',  // 선택 마커 (= --color-accent)
    '--marker-cluster':          '#B8943F',  // 클러스터 마커 (= --color-primary)
  },

  //타깃: 화사하되 차분한 봄의 생명력, 신록의 에너지
  spring_bloom: {
    // 메인 브랜드
    
    '--color-primary':           '#304820',  // 패널 헤더 배경 (Deep Olive)
    '--color-primary-border':    '#283A18',  // 헤더 하단 보더
    '--color-primary-text':      '#C8DEB0',  // 헤더 위 텍스트

    '--color-accent':            '#6A9448',  // 활성 버튼, 강조 레이블 (Yellow-Green)
    '--color-accent-muted':      '#B8D4A0',  // 액센트 연한 버전 — 뱃지 배경, 태그
    '--color-accent-text':       '#1C2C10',  // 액센트 배경 위 텍스트

    // 보완색 (Peach-Apricot)
    '--color-complement':        '#C87858',  // 보완색 기본 — 변동률·금융 강조
    '--color-complement-muted':  '#E8A888',  // 보완색 연한 버전 — 상승 수치 배경

    // 배경 레이어
    '--color-bg':                '#F8F6F2',  // 앱 전체 배경 (따뜻한 크림)
    '--color-surface':           '#FAF8F5',  // 패널·카드 배경
    '--color-surface-raised':    '#FDFCF8',  // 카드 hover/선택 시 뜨는 레이어
    '--color-surface-2':         '#FAFAF5',  // 패널 내부 약간 따뜻한 배경
    '--color-surface-3':         '#EFF5E8',  // 테이블 행, 스티키 헤더 (Green tint)
    '--color-surface-active':    '#E4EDD8',  // 활성 항목 하이라이트 배경
    '--color-surface-chart':     '#FAEEE8',  // 차트 썸네일 배경 (Peach tint — 보완색)
    '--color-hover':             '#EAF0E0',  // 호버 배경

    // 텍스트
    '--color-text-main':         '#1C2814',  // 주요 텍스트
    '--color-text-sub':          '#485838',  // 보조 텍스트
    '--color-text-muted':        '#7A8A68',  // 흐린 텍스트
    '--color-text-faint':        '#96A480',  // 더 흐린 텍스트
    '--color-text-disabled':     '#BCC8A8',  // 비활성·힌트 텍스트

    // 테두리
    '--color-border':            '#D8E4CC',  // 주요 테두리·구분선
    '--color-border-strong':     '#C0D0A8',  // 사이드바 등 강조 테두리

    // 스크롤바
    '--color-scrollbar':         '#C4D4B0',  // 스크롤바 thumb
    '--color-scrollbar-hover':   '#A4B890',  // 스크롤바 thumb hover

    // Mainmap UI
    '--map-accent':              'var(--color-accent)',
    '--map-accent-border':       'var(--color-primary-border)',
    '--map-accent-bg':           'var(--color-surface-3)',
    '--map-accent-muted':        'var(--color-accent-muted)',
    '--map-border':              'var(--color-surface-2)',
    '--map-text':                'var(--color-text-main)',
    '--map-surface':             'var(--color-bg)',
    '--map-text-muted':          'var(--color-text-disabled)',

    // 지도 마커
    '--marker-normal':           '#6A9448',  // 일반 마커 — Yellow-Green (주색)
    '--marker-active':           '#C87858',  // 선택 마커 — Peach (보완색)
    '--marker-cluster':          '#304820',  // 클러스터 마커 — Deep Olive
  },

    // 타깃: 각진 권위, 금융 시스템의 냉정한 전문성, 장중함
  steel_authority: {

    // 메인 브랜드
    '--color-primary':           '#181C28',  // 패널 헤더 배경 (Near-Black Steel)
    '--color-primary-border':    '#0E1016',  // 헤더 하단 보더
    '--color-primary-text':      '#8898B8',  // 헤더 위 텍스트

    '--color-accent':            '#4A5C78',  // 활성 버튼, 강조 레이블 (Steel Blue)
    '--color-accent-muted':      '#B8C4D4',  // 액센트 연한 버전 — 뱃지 배경, 태그
    '--color-accent-text':       '#0E1420',  // 액센트 배경 위 텍스트

    // 보완색 (Prussian Blue)
    '--color-complement':        '#6878A0',  // 보완색 기본 — 차트 강조·링크
    '--color-complement-muted':  '#CDD5E4',  // 보완색 연한 버전 — 차트 배경 tint

    // 배경 레이어
    '--color-bg':                '#F2F4F7',  // 앱 전체 배경 (차가운 청회)
    '--color-surface':           '#FAF8F5',  // 패널·카드 배경
    '--color-surface-raised':    '#F8F9FB',  // 카드 hover/선택 시 뜨는 레이어
    '--color-surface-2':         '#F5F6F9',  // 패널 내부 약간 차가운 배경
    '--color-surface-3':         '#E8ECF2',  // 테이블 행, 스티키 헤더 (Steel tint)
    '--color-surface-active':    '#DDE3EE',  // 활성 항목 하이라이트 배경
    '--color-surface-chart':     '#E4E9F4',  // 차트 썸네일 배경 (Prussian tint — 보완색)
    '--color-hover':             '#E2E6EF',  // 호버 배경

    // 텍스트
    '--color-text-main':         '#0E1220',  // 주요 텍스트
    '--color-text-sub':          '#3A4258',  // 보조 텍스트
    '--color-text-muted':        '#6878A0',  // 흐린 텍스트 (보완색과 연계)
    '--color-text-faint':        '#8898B8',  // 더 흐린 텍스트
    '--color-text-disabled':     '#B8C4D4',  // 비활성·힌트 텍스트

    // 테두리
    '--color-border':            '#CCD4E0',  // 주요 테두리·구분선
    '--color-border-strong':     '#B0BDD0',  // 사이드바 등 강조 테두리

    // 스크롤바
    '--color-scrollbar':         '#B8C4D4',  // 스크롤바 thumb
    '--color-scrollbar-hover':   '#96A8C0',  // 스크롤바 thumb hover

    // Mainmap UI
    '--map-accent':              'var(--color-accent)',
    '--map-accent-border':       'var(--color-primary-border)',
    '--map-accent-bg':           'var(--color-surface-3)',
    '--map-accent-muted':        'var(--color-accent-muted)',
    '--map-border':              'var(--color-surface-2)',
    '--map-text':                'var(--color-text-main)',
    '--map-surface':             'var(--color-bg)',
    '--map-text-muted':          'var(--color-text-disabled)',

    // 지도 마커
    '--marker-normal':           '#4A5C78',  // 일반 마커 — Steel Blue (주색)
    '--marker-active':           '#6878A0',  // 선택 마커 — Prussian Blue (보완색)
    '--marker-cluster':          '#181C28',  // 클러스터 마커 — Near-Black Steel
  },

  // ── Pistachio & Peach ───────────────────────────────────────────────────
  // 베이스: 복숭아(Peach) 계열의 따뜻하고 부드러운 배경
  // 포인트: 피스타치오(Pistachio) 계열의 차분한 연초록 액센트
  pistachio_peach: {
    // 메인 브랜드
    '--color-primary':           '#7A4838',  // 패널 헤더 배경 (Deep Terracotta/Peach)
    '--color-primary-border':    '#603828',  // 헤더 하단 보더
    '--color-primary-text':      '#F5DDD0',  // 헤더 위 텍스트 (연한 복숭아)

    '--color-accent':            '#6A9470',  // 활성 버튼, 강조 레이블 (Pistachio — 포인트)
    '--color-accent-muted':      '#B4D0B8',  // 액센트 연한 버전 — 뱃지 배경, 태그
    '--color-accent-text':       '#1C2E1E',  // 액센트 배경 위 텍스트

    // 보완색 (Peach/Apricot)
    '--color-complement':        '#C87858',  // 보완색 기본 (Peach Orange)
    '--color-complement-muted':  '#E8B090',  // 보완색 연한 버전

    // 배경 레이어 — 복숭아 크림 기반
    '--color-bg':                '#FBF4EF',  // 앱 전체 배경 (복숭아 크림)
    '--color-surface':           '#FAF8F5',  // 패널·카드 배경
    '--color-surface-raised':    '#FEFAF7',  // 카드 hover/선택 시 뜨는 레이어
    '--color-surface-2':         '#FCF6F1',  // 패널 내부 (복숭아 tint)
    '--color-surface-3':         '#F5EDE6',  // 테이블 행, 스티키 헤더 (복숭아 tint)
    '--color-surface-active':    '#EDE4DC',  // 활성 항목 하이라이트 배경
    '--color-surface-chart':     '#EBF2EC',  // 차트 썸네일 배경 (피스타치오 tint — 포인트)
    '--color-hover':             '#F0E6DF',  // 호버 배경

    // 텍스트
    '--color-text-main':         '#261810',  // 주요 텍스트 (깊은 따뜻한 갈색)
    '--color-text-sub':          '#5A3C2E',  // 보조 텍스트
    '--color-text-muted':        '#927060',  // 흐린 텍스트
    '--color-text-faint':        '#AA9080',  // 더 흐린 텍스트
    '--color-text-disabled':     '#CDBDAF',  // 비활성·힌트 텍스트

    // 테두리
    '--color-border':            '#E8D8CC',  // 주요 테두리·구분선
    '--color-border-strong':     '#D4C0B0',  // 사이드바 등 강조 테두리

    // 스크롤바
    '--color-scrollbar':         '#CCC0B4',  // 스크롤바 thumb
    '--color-scrollbar-hover':   '#ACA098',  // 스크롤바 thumb hover

    // Mainmap UI
    '--map-accent':              'var(--color-accent)',
    '--map-accent-border':       'var(--color-primary-border)',
    '--map-accent-bg':           'var(--color-surface-3)',
    '--map-accent-muted':        'var(--color-accent-muted)',
    '--map-border':              'var(--color-surface-2)',
    '--map-text':                'var(--color-text-main)',
    '--map-surface':             'var(--color-bg)',
    '--map-text-muted':          'var(--color-text-disabled)',

    // 지도 마커
    '--marker-normal':           '#6A9470',  // 일반 마커 — Pistachio (포인트색)
    '--marker-active':           '#C87858',  // 선택 마커 — Peach Orange
    '--marker-cluster':          '#7A4838',  // 클러스터 마커 — Terracotta
  },
};

// ── 고정 컬러 (테마 무관, 시맨틱/브랜드) ───
export const FIXED_COLORS = {
  error:        '#c33',
  errorStrong:  '#e03131',
  errorBg:      '#FFAAAA',
  warning:      '#b35a00',
  favStar:      '#f5c518',
  favStarFill:  '#FFD700',
  kakaoBtn:     '#FEE500',
  kakaoBtnText: '#3B1E1E',
  series: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'],
  assets: {
    SP500:   '#C1614E',
    NASDAQ:  '#5B7FA8',
    DOW:     '#8B7AB8',
    GOLD:    '#B8872A',
    KOSPI:   '#5E8F6B',
    KTB5Y:   '#6B75C0',
    KR_RATE: '#4A8A75',
    US_RATE: '#C8A84B',
    BTC:     '#B06880',
    ETH:     '#7890C0',
    USDKRW:  '#4A8FA0',
  },
};

// ── Accent 반투명 변형 (차트 JS 옵션용) ────
// lightweight-charts 등 CSS 변수를 쓸 수 없는 곳에서 사용.
// 테마별로 분리 — ACCENT_ALPHA[theme].a35 형태로 참조.
export const ACCENT_ALPHA = {
  gold: {
    a35: 'rgba(201,168,76,0.35)',
    a40: 'rgba(201,168,76,0.40)',
    a50: 'rgba(201,168,76,0.50)',
    a55: 'rgba(201,168,76,0.55)',
    a70: 'rgba(201,168,76,0.70)',
    a90: 'rgba(201,168,76,0.90)',
  },
  rose_slate: {
    a35: 'rgba(140,88,96,0.35)',
    a40: 'rgba(140,88,96,0.40)',
    a50: 'rgba(140,88,96,0.50)',
    a55: 'rgba(140,88,96,0.55)',
    a70: 'rgba(140,88,96,0.70)',
    a90: 'rgba(140,88,96,0.90)',
  },
  spring_bloom: {
    a35: 'rgba(106,148,72,0.35)',
    a40: 'rgba(106,148,72,0.40)',
    a50: 'rgba(106,148,72,0.50)',
    a55: 'rgba(106,148,72,0.55)',
    a70: 'rgba(106,148,72,0.70)',
    a90: 'rgba(106,148,72,0.90)',
  },
  steel_authority: {
    a35: 'rgba(74,92,120,0.35)',
    a40: 'rgba(74,92,120,0.40)',
    a50: 'rgba(74,92,120,0.50)',
    a55: 'rgba(74,92,120,0.55)',
    a70: 'rgba(74,92,120,0.70)',
    a90: 'rgba(74,92,120,0.90)',
  },
  pistachio_peach: {
    a35: 'rgba(106,148,112,0.35)',
    a40: 'rgba(106,148,112,0.40)',
    a50: 'rgba(106,148,112,0.50)',
    a55: 'rgba(106,148,112,0.55)',
    a70: 'rgba(106,148,112,0.70)',
    a90: 'rgba(106,148,112,0.90)',
  },
};

// ── 보완색 반투명 변형 ───────────────────────
// gold: Bronze(#5C4A20) / rose_slate: Slate(#6880A0)
export const COMPLEMENT_ALPHA = {
  gold: {
    a20: 'rgba(92,74,32,0.20)',
    a35: 'rgba(92,74,32,0.35)',
    a50: 'rgba(92,74,32,0.50)',
    a70: 'rgba(92,74,32,0.70)',
  },
  rose_slate: {
    a20: 'rgba(104,128,160,0.20)',
    a35: 'rgba(104,128,160,0.35)',
    a50: 'rgba(104,128,160,0.50)',
    a70: 'rgba(104,128,160,0.70)',
  },
  spring_bloom: {
    a20: 'rgba(200,120,88,0.20)',
    a35: 'rgba(200,120,88,0.35)',
    a50: 'rgba(200,120,88,0.50)',
    a70: 'rgba(200,120,88,0.70)',
  },
  steel_authority: {
    a20: 'rgba(104,120,160,0.20)',
    a35: 'rgba(104,120,160,0.35)',
    a50: 'rgba(104,120,160,0.50)',
    a70: 'rgba(104,120,160,0.70)',
  },
  pistachio_peach: {
    a20: 'rgba(200,120,88,0.20)',
    a35: 'rgba(200,120,88,0.35)',
    a50: 'rgba(200,120,88,0.50)',
    a70: 'rgba(200,120,88,0.70)',
  },
};

// ── 지도 팝업 그림자 반투명 변형 ─────────────
// MAP_ALPHA[theme].a25 형태로 참조.
export const MAP_ALPHA = {
  gold:           { a25: 'rgba(201,168,76,0.25)' },
  rose_slate:     { a25: 'rgba(140,88,96,0.25)' },
  spring_bloom:   { a25: 'rgba(106,148,72,0.25)' },
  steel_authority:  { a25: 'rgba(74,92,120,0.25)' },
  pistachio_peach:  { a25: 'rgba(106,148,112,0.25)' },
};

// ── 차트 시리즈 공통 색상 (G1/G2/L1/F1/F2 공유) ──
export const SERIES_COLORS = [
  '#0047AB', // [0] avgLine / 아파트 기준선 — Cobalt
  '#E74C3C', // [1] S&P500 — Red
  '#6A9470', // [2] NASDAQ — Pistachio
  '#4F8EF7', // [3] DOW — Blue
  '#FFD93D', // [4] Gold — Yellow
  '#F97316', // [5] KOSPI — Orange
  '#1A6BBF', // [6] 국채5년 — Cobalt↓
  '#2B8CB8', // [7] 한국금리 — Steel Blue
  '#C0392B', // [8] 미국금리 — Red↓
  '#922B21', // [9] BTC — Red↓↓
  '#B5407A', // [10] ETH — Magenta
  '#7C3AED', // [11] 원/달러 — Purple
];

// ── CSS 변수 값 읽기 (lightweight-charts 등 JS 옵션용) ──
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── 테마 적용 함수 ──────────────────────────
export function applyTheme(themeName = 'rose_slate') {
  const theme = THEMES[themeName] ?? THEMES.rose_slate;
  const root = document.documentElement;
  Object.entries(theme).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
}
