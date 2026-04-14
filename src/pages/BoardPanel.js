import { useState, useEffect, useRef } from 'react';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';

/* ── 공통 버튼/입력 스타일 ── */

const btnSecondary = {
  background: 'none', color: 'var(--color-text-sub)', fontWeight: 600,
  border: '1.5px solid var(--color-border)', borderRadius: 8, padding: '0 14px',
  height: 36, fontSize: '0.88rem', cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center',
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid var(--color-border)', fontSize: '0.95rem',
  outline: 'none', background: 'var(--color-bg)', color: 'var(--color-text-main)',
};

/* ── SVG 아이콘 ── */
const SVG = ({ children, size = 18 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    width={size} height={size}>
    {children}
  </svg>
);
const IconBoard  = () => <SVG><path d="M4 3h16a1 1 0 011 1v11a1 1 0 01-1 1H8l-5 4V4a1 1 0 011-1z"/></SVG>;
const IconEdit   = () => <SVG><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></SVG>;
const IconBack    = () => <SVG size={16}><polyline points="15 18 9 12 15 6"/></SVG>;
const IconChevron = () => (
  <svg viewBox="0 0 16 16" fill="none" width={18} height={18}>
    <line x1="13" y1="8" x2="3" y2="8" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3" strokeLinecap="round"/>
    <polyline points="7,4 3,8 7,12" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const closeBtn = {
  display: 'flex', alignItems: 'center', gap: 5,
  border: 'none', background: 'none', cursor: 'pointer',
  color: '#fff', fontWeight: 600, fontSize: '0.88rem',
  padding: '4px 6px 4px 2px', borderRadius: 8, flexShrink: 0,
};
const IconTrash  = () => <SVG size={16}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></SVG>;

/* ── HTML → 평문 변환 (글 수정 시 사용) ── */
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>/gi, '\n')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

/* ── 상세보기 HTML 렌더링 ── */
function renderContent(post) {
  // 신규 형식: content가 HTML 문자열
  if (post.contentHtml) {
    return (
      <div
        className="post-content"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        style={{ fontSize: '1rem', lineHeight: 1.8, color: 'var(--color-text-main)' }}
      />
    );
  }
  // 구형 blocks 형식 호환
  if (post.blocks) {
    return post.blocks.map((block, i) =>
      block.type === 'image' ? (
        <img key={i} src={block.src} alt="첨부이미지"
          style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: 10, display: 'block', margin: '8px 0' }}
        />
      ) : (
        block.value ? (
          <div key={i} style={{ whiteSpace: 'pre-line', fontSize: '1rem', lineHeight: 1.75, color: 'var(--color-text-main)' }}>
            {block.value}
          </div>
        ) : null
      )
    );
  }
  return (
    <div style={{ whiteSpace: 'pre-line', fontSize: '1rem', lineHeight: 1.75, color: 'var(--color-text-main)' }}>
      {post.content}
    </div>
  );
}

/* ════════════════════════════════════════════════
   BoardPanel
════════════════════════════════════════════════ */
const IconMapSVG = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="6" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
    <line x1="2" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
    <line x1="10" y1="6" x2="10" y2="22" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
    <path d="M16 0C13.2 0 11 2.2 11 5c0 3.5 5 9 5 9s5-5.5 5-9c0-2.8-2.2-5-5-5z" fill="currentColor"/>
    <circle cx="16" cy="5" r="1.8" fill="white"/>
  </svg>
);

function BoardPanel({ backHandlerRef, user, pendingPostContent, pendingPostTitle, pendingPostMeta, onOpenChart, onPendingPostConsumed, onWritingStateChange, onOpenMinimap, isMobile = false, isTablet = false }) {
  const [posts, setPosts]             = useState([]);
  const [editingPostId, setEditingPostId] = useState(null);
  const [showForm, setShowForm]       = useState(false);
  const [author, setAuthor]           = useState('');
  const [title, setTitle]             = useState('');
  const [textContent, setTextContent] = useState('');
  const chartAttachRef                = useRef(null);
  const pendingPostMetaRef            = useRef(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [imgTooltip, setImgTooltip]   = useState(null);
  const [page, setPage]               = useState(1);
  const [topPosts, setTopPosts]       = useState([]);

  const postsPerPage  = 20;
  const totalPages    = Math.ceil(posts.length / postsPerPage);
  const currentPosts  = posts.slice((page - 1) * postsPerPage, page * postsPerPage);

  useEffect(() => { onWritingStateChange?.(showForm); }, [showForm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!backHandlerRef) return;
    backHandlerRef.current = () => {
      if (selectedPost) { setSelectedPost(null); return true; }
      if (showForm)     { resetForm();            return true; }
      return false;
    };
  }, [backHandlerRef, selectedPost, showForm]);

  useEffect(() => {
    const saved = localStorage.getItem('board-posts');
    if (saved) {
      const arr = JSON.parse(saved);
      setPosts(arr);
      setTopPosts([...arr].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5));
    }
  }, []);

  const savePosts = (arr) => {
    setPosts(arr);
    setTopPosts([...arr].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5));
    localStorage.setItem('board-posts', JSON.stringify(arr));
  };

  const resetForm = () => {
    setAuthor(''); setTitle('');
    setTextContent('');
    chartAttachRef.current = null;
    setShowForm(false); setEditingPostId(null);
  };

  const openWriteForm = () => {
    setAuthor(user?.nickname || '');
    setShowForm(true);
  };

  useEffect(() => {
    if (!pendingPostContent) return;
    chartAttachRef.current = pendingPostContent;
    pendingPostMetaRef.current = pendingPostMeta || null;
    setTextContent('');
    setAuthor(user?.nickname || '');
    setTitle(pendingPostTitle || '');
    setShowForm(true);
    onPendingPostConsumed?.();
  }, [pendingPostContent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePost = (e) => {
    e.preventDefault();
    if (!author.trim() || !title.trim()) return;
    if (!textContent.trim() && !chartAttachRef.current) return;

    // 최종 HTML: 차트 이미지(있으면) + 텍스트
    const textHtml = textContent.trim()
      ? `<p style="white-space:pre-wrap">${textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
      : '';
    const finalHtml = (chartAttachRef.current || '') + textHtml;

    const isEdit = Boolean(editingPostId);
    const editingPost = isEdit ? posts.find(p => p.id === editingPostId) : null;
    const newPost = {
      id:          isEdit ? editingPostId : Date.now(),
      author:      author.trim(),
      title:       title.trim(),
      contentHtml: finalHtml,
      time:        isEdit && editingPost ? editingPost.time : new Date().toISOString(),
      views:       isEdit && editingPost ? editingPost.views : 0,
      likes:       isEdit && editingPost ? editingPost.likes : 0,
      chartMeta:   isEdit ? (editingPost?.chartMeta ?? null) : (pendingPostMetaRef.current ?? null),
    };
    const arr = isEdit
      ? posts.map(p => p.id === editingPostId ? newPost : p)
      : [newPost, ...posts];
    savePosts(arr);
    resetForm();
  };

  const handleShowDetail = (post) => {
    const idx = posts.findIndex(p => p.id === post.id);
    if (idx !== -1) {
      const arr = [...posts];
      arr[idx].views = (arr[idx].views || 0) + 1;
      savePosts(arr);
      setSelectedPost({ ...arr[idx] });
    }
  };

  const handleDeletePost = () => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      savePosts(posts.filter(p => p.id !== selectedPost.id));
      setSelectedPost(null);
    }
  };

  const handleEditPost = () => {
    setTextContent(htmlToText(selectedPost.contentHtml || ''));
    chartAttachRef.current = null;
    setAuthor(user?.nickname || selectedPost.author);
    setTitle(selectedPost.title);
    setEditingPostId(selectedPost.id);
    setSelectedPost(null);
    setShowForm(true);
  };



  const fmtTime = (iso) => iso?.slice(5, 16).replace('T', ' ') ?? '';

  /* ── 상세보기 ── */
  if (selectedPost) return (
    <aside style={commonPanelStyle}>
      <div style={commonHeaderStyle}>
        <button onClick={() => setSelectedPost(null)} style={closeBtn} aria-label="목록으로">
          <IconChevron /> 목록
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={handleEditPost}   style={{ ...btnSecondary, color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}><IconEdit /></button>
        <button onClick={handleDeletePost} style={{ ...btnSecondary, color: '#FFAAAA', borderColor: 'rgba(255,170,170,0.4)' }}><IconTrash /></button>
      </div>

      {/* 제목 — 위 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 46, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>제&nbsp;&nbsp;목</span>
        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--color-text-main)', lineHeight: 1.45, textAlign: 'left' }}>{selectedPost.title}</span>
      </div>

      {/* 작성자 + 날짜 + 조회수 — 아래, 더 작고 연하게 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 36, borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)', flexShrink: 0 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>작성자</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-faint)' }}>{selectedPost.author}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-disabled)', marginLeft: 4 }}>{fmtTime(selectedPost.time)}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-disabled)', marginLeft: 'auto' }}>조회 {selectedPost.views || 0}</span>
      </div>

      {/* 본문 */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}
        onClick={(e) => {
          if (e.target.tagName === 'IMG' && selectedPost?.chartMeta) {
            const rect = e.target.getBoundingClientRect();
            setImgTooltip({ x: rect.left + rect.width / 2, y: rect.top });
          } else {
            setImgTooltip(null);
          }
        }}
      >
        {renderContent(selectedPost)}
        {imgTooltip && (
          <div
            style={{
              position: 'fixed',
              left: imgTooltip.x, top: imgTooltip.y - 44,
              transform: 'translateX(-50%)',
              background: 'var(--color-text-main)', color: '#fff',
              padding: '7px 16px', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 600,
              cursor: 'pointer', zIndex: 999,
              boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
              whiteSpace: 'nowrap',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenChart?.(selectedPost.chartMeta);
              setImgTooltip(null);
            }}
          >
            해당 단지끼리 비교로 이동
          </div>
        )}
      </div>
    </aside>
  );

  /* ── 글쓰기 폼 ── */
  if (showForm) return (
    <aside style={commonPanelStyle}>
      {/* 헤더 — 게시판 목록과 동일한 구조 */}
      <div style={commonHeaderStyle}>
        <button onClick={resetForm} style={closeBtn} aria-label="목록으로">
          <IconChevron /> 목록
        </button>
        <span style={{ flex: 1, fontWeight: 800, fontSize: '1rem', color: '#fff' }}>
          {editingPostId ? '글 수정' : '새 글 작성'}
        </span>
        <button type="submit" form="board-write-form" style={{ ...btnSecondary, gap: 4, height: 30, padding: '0 10px', fontSize: '0.78rem', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>
          {editingPostId ? '수정 완료' : '등록'}
        </button>
      </div>

      {/* 폼 본문 */}
      <form id="board-write-form" onSubmit={handlePost}
        style={{ flex: 1, overflowY: 'auto', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column' }}>

        {/* 제목 — 위로 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 46, flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>제&nbsp;&nbsp;목</span>
          <input
            placeholder="제목을 입력하세요"
            value={title} onChange={e => setTitle(e.target.value)}
            maxLength={40} required
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontWeight: 800, fontSize: '0.95rem', padding: 0,
              background: 'transparent', color: 'var(--color-text-main)',
            }}
          />
        </div>

        {/* 작성자 — 아래, 더 작고 연하게 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 36, flexShrink: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>작성자</span>
          <input
            placeholder="작성자"
            value={author}
            onChange={user ? undefined : e => setAuthor(e.target.value)}
            readOnly={!!user}
            maxLength={10} required
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: '0.75rem', fontWeight: 500, padding: 0,
              background: 'transparent',
              color: 'var(--color-text-faint)',
              cursor: user ? 'default' : 'text',
            }}
          />
        </div>

        {/* 차트 미리보기 (pendingPostContent가 있을 때) */}
        {chartAttachRef.current && (
          <div style={{ padding: '10px 16px 0', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-faint)', letterSpacing: '0.05em' }}>
            첨부 차트
          </div>
        )}
        {chartAttachRef.current && (
          <div
            dangerouslySetInnerHTML={{ __html: chartAttachRef.current }}
            style={{ padding: '6px 16px 0', maxWidth: '100%', overflow: 'hidden' }}
          />
        )}

        {/* 내용 textarea */}
        <div style={{ padding: '10px 16px 4px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-faint)', letterSpacing: '0.05em' }}>
          내용
        </div>
        <textarea
          value={textContent}
          onChange={e => setTextContent(e.target.value)}
          placeholder="내용을 입력하세요"
          style={{
            flex: 1, resize: 'none',
            border: 'none', outline: 'none',
            padding: '4px 16px 16px',
            fontSize: '0.95rem', lineHeight: 1.75,
            background: 'transparent', color: 'var(--color-text-main)',
            fontFamily: 'inherit',
          }}
        />
      </form>
    </aside>
  );

  /* ── 게시판 목록 ── */
  return (
    <aside style={commonPanelStyle}>
      <div style={commonHeaderStyle}>
        {(isMobile || isTablet) ? (
          <span onClick={onOpenMinimap} style={{ color: 'rgba(255,255,255,0.9)', flexShrink: 0, cursor: 'pointer', borderRadius: 6, padding: 2, display: 'flex', alignItems: 'center' }}>
            <IconMapSVG />
          </span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}><IconBoard /></span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#fff', flex: 1 }}>
          게시판
        </span>
        {user ? (
          <button onClick={openWriteForm} style={{ ...btnSecondary, gap: 4, height: 30, padding: '0 10px', fontSize: '0.78rem', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>
            <IconEdit /> 글쓰기
          </button>
        ) : (
          <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
            로그인 후 작성 가능
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* 인기글 TOP 5 — 왼쪽 정렬, 압축형 */}
        {topPosts.length > 0 && (
          <div style={{ padding: '10px 16px 0', background: 'var(--color-surface-raised)', borderRadius: 8, marginBottom: 4 }}>
            <div style={{ marginBottom: 6, textAlign: 'left' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.05em' }}>인기글 TOP 5</span>
            </div>
            <div>
              {topPosts.map((post, i) => (
                <div key={post.id} onClick={() => handleShowDetail(post)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', borderBottom: i < topPosts.length - 1 ? '1px solid var(--color-border)' : 'none', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <span style={{ minWidth: 14, fontWeight: 800, fontSize: '0.72rem', color: i < 3 ? 'var(--color-accent)' : 'var(--color-text-disabled)' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>{post.title}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-disabled)', flexShrink: 0 }}>조회 {post.views || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 전체 글 라벨 */}
        <div style={{ padding: '10px 16px 4px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-faint)', letterSpacing: '0.05em', textAlign: 'left' }}>
          전체 글 <span style={{ color: 'var(--color-text-sub)', fontWeight: 800 }}>{posts.length}</span>
        </div>

        {/* 전체 글 목록 — 콤팩트 썸네일형 */}
        <div style={{ marginInline: 16, marginBottom: 16 }}>
          {posts.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-disabled)', padding: '32px 0', fontSize: '0.88rem' }}>
              아직 작성된 글이 없습니다.
            </div>
          ) : currentPosts.map((p, i) => {
            const hasChart = p.contentHtml?.includes('<img') || p.blocks?.some(b => b.type === 'image');
            return (
              <div key={p.id} onClick={() => handleShowDetail(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: i < currentPosts.length - 1 ? '1px solid var(--color-border)' : 'none', background: 'var(--color-surface)', transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface)'}
              >
                {/* 24px 썸네일 아이콘 */}
                <div style={{ width: 24, height: 24, borderRadius: 5, background: hasChart ? 'var(--color-surface-chart)' : 'var(--color-bg)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {hasChart ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3,17 8,10 12,13 16,7 21,9"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="21" x2="3" y2="4"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-disabled)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 3h16a1 1 0 011 1v11a1 1 0 01-1 1H8l-5 4V4a1 1 0 011-1z"/>
                    </svg>
                  )}
                </div>
                {/* 제목 + 작성자/조회수 세로 배치 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text-main)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>
                    {p.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-accent)' }}>{p.author}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-text-disabled)' }}>조회 {p.views || 0}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '0 16px 20px', flexWrap: 'wrap' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ ...btnSecondary, height: 32, padding: '0 10px', opacity: page === 1 ? 0.4 : 1 }}>
              <IconBack />
            </button>
            {[...Array(Math.min(totalPages, 10)).keys()].map(i => {
              const pn = i + 1;
              return (
                <button key={pn} onClick={() => setPage(pn)}
                  style={{ width: 32, height: 32, border: page === pn ? 'none' : '1.5px solid var(--color-border)', borderRadius: 8, background: page === pn ? 'var(--color-text-sub)' : 'var(--color-surface)', color: page === pn ? '#fff' : 'var(--color-text-sub)', fontWeight: page === pn ? 700 : 400, cursor: 'pointer', fontSize: '0.85rem' }}>
                  {pn}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ ...btnSecondary, height: 32, padding: '0 10px', opacity: page === totalPages ? 0.4 : 1, transform: 'rotate(180deg)' }}>
              <IconBack />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default BoardPanel;
