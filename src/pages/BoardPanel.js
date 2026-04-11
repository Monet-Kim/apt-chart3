import { useState, useEffect, useRef } from 'react';
import { commonPanelStyle, commonHeaderStyle } from '../styles/panelStyles';

/* ── 공통 버튼/입력 스타일 ── */
const btnPrimary = {
  background: '#6B625B', color: '#fff', fontWeight: 700,
  border: 'none', borderRadius: 8, padding: '0 16px',
  height: 36, fontSize: '0.88rem', cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center', gap: 6,
};
const btnSecondary = {
  background: 'none', color: '#6B625B', fontWeight: 600,
  border: '1.5px solid #E6DED4', borderRadius: 8, padding: '0 14px',
  height: 36, fontSize: '0.88rem', cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center',
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid #E6DED4', fontSize: '0.95rem',
  outline: 'none', background: '#F7F3EE', color: '#1F1D1B',
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
    <line x1="13" y1="8" x2="3" y2="8" stroke="#aaa" strokeWidth="1.3" strokeLinecap="round"/>
    <polyline points="7,4 3,8 7,12" stroke="#aaa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const closeBtn = {
  display: 'flex', alignItems: 'center', gap: 5,
  border: 'none', background: 'none', cursor: 'pointer',
  color: '#6B625B', fontWeight: 600, fontSize: '0.88rem',
  padding: '4px 6px 4px 2px', borderRadius: 8, flexShrink: 0,
};
const IconImage  = () => <SVG size={16}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></SVG>;
const IconTrash  = () => <SVG size={16}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></SVG>;

/* ── 툴바 버튼 ── */
const ToolbarBtn = ({ onMouseDown, active, title, children }) => (
  <button
    type="button"
    title={title}
    onMouseDown={onMouseDown}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 30, height: 30, border: 'none', borderRadius: 6,
      background: active ? '#E6DED4' : 'transparent',
      color: active ? '#3D3530' : '#6B625B',
      cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
      transition: 'background 0.12s',
      flexShrink: 0,
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#EEE8E0'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
  >
    {children}
  </button>
);

const Divider = () => (
  <div style={{ width: 1, height: 18, background: '#E6DED4', margin: '0 2px', flexShrink: 0 }} />
);

/* ── HTML WYSIWYG 에디터 ── */
function RichEditor({ value, onChange }) {
  const editorRef  = useRef();
  const fileInputRef = useRef();
  const [activeFormats, setActiveFormats] = useState({});
  const [fontSize, setFontSize] = useState(14);
  const imgCountRef = useRef(0);

  // 이미지 개수 계산
  const countImages = () => {
    if (!editorRef.current) return 0;
    return editorRef.current.querySelectorAll('img').length;
  };

  // 포커스 상태 추적
  const updateActiveFormats = () => {
    setActiveFormats({
      bold:      document.queryCommandState('bold'),
      italic:    document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      ul:        document.queryCommandState('insertUnorderedList'),
      ol:        document.queryCommandState('insertOrderedList'),
    });
  };

  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    updateActiveFormats();
  };

  const handleInput = () => {
    onChange(editorRef.current.innerHTML);
    updateActiveFormats();
  };

  const handleKeyUp = () => updateActiveFormats();
  const handleMouseUp = () => updateActiveFormats();

  const changeFontSize = (delta) => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      // 선택된 텍스트 → execCommand 트릭으로 font 태그 삽입 후 span으로 교체
      document.execCommand('fontSize', false, '7');
      editorRef.current?.querySelectorAll('font[size="7"]').forEach(el => {
        const current = parseFloat(window.getComputedStyle(el).fontSize) || fontSize;
        const next = Math.max(8, Math.min(40, current + delta));
        const span = document.createElement('span');
        span.style.fontSize = `${next}px`;
        while (el.firstChild) span.appendChild(el.firstChild);
        el.replaceWith(span);
      });
      onChange(editorRef.current.innerHTML);
    } else {
      // 선택 없음 → 에디터 기본 크기 변경
      setFontSize(prev => {
        const next = Math.max(8, Math.min(40, prev + delta));
        if (editorRef.current) editorRef.current.style.fontSize = `${next}px`;
        return next;
      });
    }
  };

  const insertImage = (src) => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false,
      `<img src="${src}" style="max-width:100%;max-height:400px;object-fit:contain;border-radius:8px;display:block;margin:6px 0;" />`
    );
    onChange(editorRef.current.innerHTML);
  };

  const handlePaste = (e) => {
    const file = e.clipboardData?.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    e.preventDefault();
    if (countImages() >= 5) { alert('이미지는 최대 5개까지 첨부할 수 있습니다.'); return; }
    const reader = new FileReader();
    reader.onload = (evt) => insertImage(evt.target.result);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (countImages() >= 5) { alert('이미지는 최대 5개까지 첨부할 수 있습니다.'); break; }
      const reader = new FileReader();
      reader.onload = (evt) => insertImage(evt.target.result);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  // 초기값 세팅 (한 번만)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && editorRef.current) {
      editorRef.current.innerHTML = value || '';
      initializedRef.current = true;
    }
  }, []);

  const imgCount = countImages();

  return (
    <div style={{
      border: '1.5px solid #E6DED4', borderRadius: 10,
      background: '#fff', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* 툴바 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '6px 10px', borderBottom: '1.5px solid #E6DED4',
        background: '#F7F3EE', flexWrap: 'wrap',
      }}>
        {/* 텍스트 서식 */}
        <ToolbarBtn title="굵게 (Ctrl+B)" active={activeFormats.bold}
          onMouseDown={e => { e.preventDefault(); exec('bold'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M6 4h8a4 4 0 010 8H6V4zm0 8h9a4 4 0 010 8H6v-8z"/></svg>
        </ToolbarBtn>
        <ToolbarBtn title="기울임 (Ctrl+I)" active={activeFormats.italic}
          onMouseDown={e => { e.preventDefault(); exec('italic'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M10 4h4l-4 16H6l4-16zm4 0h4v2h-4V4zm-8 14H2v2h4v-2z"/></svg>
        </ToolbarBtn>
        <ToolbarBtn title="밑줄 (Ctrl+U)" active={activeFormats.underline}
          onMouseDown={e => { e.preventDefault(); exec('underline'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M6 3v7a6 6 0 0012 0V3h-2v7a4 4 0 01-8 0V3H6zm-2 16v2h16v-2H4z"/></svg>
        </ToolbarBtn>

        <Divider />

        {/* 헤딩 */}
        <ToolbarBtn title="제목 1" onMouseDown={e => { e.preventDefault(); exec('formatBlock', '<h2>'); }}>
          <span style={{ fontWeight: 800, fontSize: '0.7rem', letterSpacing: '-0.5px' }}>H1</span>
        </ToolbarBtn>
        <ToolbarBtn title="제목 2" onMouseDown={e => { e.preventDefault(); exec('formatBlock', '<h3>'); }}>
          <span style={{ fontWeight: 800, fontSize: '0.7rem', letterSpacing: '-0.5px' }}>H2</span>
        </ToolbarBtn>
        <ToolbarBtn title="본문" onMouseDown={e => { e.preventDefault(); exec('formatBlock', '<p>'); }}>
          <span style={{ fontSize: '0.7rem' }}>본문</span>
        </ToolbarBtn>

        <Divider />

        {/* 목록 */}
        <ToolbarBtn title="글머리 목록" active={activeFormats.ul}
          onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
            <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </ToolbarBtn>
        <ToolbarBtn title="번호 목록" active={activeFormats.ol}
          onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/>
            <text x="2" y="8" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold">1.</text>
            <text x="2" y="14" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold">2.</text>
            <text x="2" y="20" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold">3.</text>
          </svg>
        </ToolbarBtn>

        <Divider />

        {/* 글자 크기 */}
        <ToolbarBtn title="글자 크게" onMouseDown={e => { e.preventDefault(); changeFontSize(2); }}>
          <span style={{ fontWeight: 800, fontSize: '0.82rem', letterSpacing: '-0.5px' }}>A+</span>
        </ToolbarBtn>
        <ToolbarBtn title="글자 작게" onMouseDown={e => { e.preventDefault(); changeFontSize(-2); }}>
          <span style={{ fontWeight: 800, fontSize: '0.68rem', letterSpacing: '-0.5px' }}>A-</span>
        </ToolbarBtn>

        <Divider />

        {/* 정렬 */}
        <ToolbarBtn title="왼쪽 정렬" onMouseDown={e => { e.preventDefault(); exec('justifyLeft'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>
          </svg>
        </ToolbarBtn>
        <ToolbarBtn title="가운데 정렬" onMouseDown={e => { e.preventDefault(); exec('justifyCenter'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
          </svg>
        </ToolbarBtn>

        <Divider />

        {/* 이미지 */}
        <ToolbarBtn title={imgCount >= 5 ? '이미지 최대 5개' : '이미지 추가'}
          onMouseDown={e => { e.preventDefault(); if (imgCount < 5) fileInputRef.current.click(); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </ToolbarBtn>
        {imgCount > 0 && (
          <span style={{ fontSize: '0.72rem', color: '#9E9590', marginLeft: 2 }}>{imgCount}/5</span>
        )}

        <Divider />

        {/* 실행 취소 / 재실행 */}
        <ToolbarBtn title="실행 취소" onMouseDown={e => { e.preventDefault(); exec('undo'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>
          </svg>
        </ToolbarBtn>
        <ToolbarBtn title="다시 실행" onMouseDown={e => { e.preventDefault(); exec('redo'); }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/>
          </svg>
        </ToolbarBtn>
      </div>

      {/* 편집 영역 */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyUp={handleKeyUp}
        onMouseUp={handleMouseUp}
        onPaste={handlePaste}
        data-placeholder="내용을 입력하세요 (이미지 붙여넣기 가능)"
        style={{
          minHeight: 180, padding: '14px 16px',
          outline: 'none', lineHeight: 1.7,
          fontSize: `${fontSize}px`, color: '#1F1D1B',
          fontFamily: 'inherit', flex: 1,
          overflowY: 'auto', textAlign: 'left',
        }}
      />

      {/* placeholder CSS */}
      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #C9BFB4;
          pointer-events: none;
        }
        [contenteditable] h2 { font-size: 1.2rem; font-weight: 800; margin: 10px 0 4px; color: #1F1D1B; }
        [contenteditable] h3 { font-size: 1.05rem; font-weight: 700; margin: 8px 0 4px; color: #1F1D1B; }
        [contenteditable] p  { margin: 4px 0; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 1.4em; margin: 4px 0; }
        [contenteditable] li { margin: 2px 0; }
      `}</style>

      <input
        type="file" accept="image/*" multiple
        ref={fileInputRef} style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}

/* ── 상세보기 HTML 렌더링 ── */
function renderContent(post) {
  // 신규 형식: content가 HTML 문자열
  if (post.contentHtml) {
    return (
      <div
        className="post-content"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        style={{ fontSize: '1rem', lineHeight: 1.8, color: '#1F1D1B' }}
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
          <div key={i} style={{ whiteSpace: 'pre-line', fontSize: '1rem', lineHeight: 1.75, color: '#1F1D1B' }}>
            {block.value}
          </div>
        ) : null
      )
    );
  }
  return (
    <div style={{ whiteSpace: 'pre-line', fontSize: '1rem', lineHeight: 1.75, color: '#1F1D1B' }}>
      {post.content}
    </div>
  );
}

/* ════════════════════════════════════════════════
   BoardPanel
════════════════════════════════════════════════ */
function BoardPanel({ backHandlerRef, user, pendingPostContent, onPendingPostConsumed }) {
  const [posts, setPosts]             = useState([]);
  const [editingPostId, setEditingPostId] = useState(null);
  const [showForm, setShowForm]       = useState(false);
  const [author, setAuthor]           = useState('');
  const [title, setTitle]             = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [selectedPost, setSelectedPost] = useState(null);
  const [page, setPage]               = useState(1);
  const [topPosts, setTopPosts]       = useState([]);

  const postsPerPage  = 20;
  const totalPages    = Math.ceil(posts.length / postsPerPage);
  const currentPosts  = posts.slice((page - 1) * postsPerPage, page * postsPerPage);

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
    setContentHtml('');
    setShowForm(false); setEditingPostId(null);
  };

  const openWriteForm = () => {
    setAuthor(user?.nickname || '');
    setShowForm(true);
  };

  useEffect(() => {
    if (!pendingPostContent) return;
    setContentHtml(pendingPostContent);
    setAuthor(user?.nickname || '');
    setShowForm(true);
    onPendingPostConsumed?.();
  }, [pendingPostContent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePost = (e) => {
    e.preventDefault();
    if (!author.trim() || !title.trim()) return;
    const stripped = contentHtml.replace(/<[^>]*>/g, '').trim();
    if (!stripped && !contentHtml.includes('<img')) return;

    const isEdit = Boolean(editingPostId);
    const editingPost = isEdit ? posts.find(p => p.id === editingPostId) : null;
    const newPost = {
      id:          isEdit ? editingPostId : Date.now(),
      author:      author.trim(),
      title:       title.trim(),
      contentHtml,
      time:        isEdit && editingPost ? editingPost.time : new Date().toISOString(),
      views:       isEdit && editingPost ? editingPost.views : 0,
      likes:       isEdit && editingPost ? editingPost.likes : 0,
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
    setContentHtml(selectedPost.contentHtml || '');
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
        <button onClick={handleEditPost}   style={btnSecondary}><IconEdit /></button>
        <button onClick={handleDeletePost} style={{ ...btnSecondary, color: '#C0392B', borderColor: '#FADBD8' }}><IconTrash /></button>
      </div>

      {/* 제목 — 위 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 46, borderBottom: '1px solid #E6DED4', flexShrink: 0 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#C9A84C', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>제&nbsp;&nbsp;목</span>
        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1F1D1B', lineHeight: 1.45, textAlign: 'left' }}>{selectedPost.title}</span>
      </div>

      {/* 작성자 + 날짜 + 조회수 — 아래, 더 작고 연하게 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 36, borderBottom: '1px solid #E6DED4', background: '#FDFAF5', flexShrink: 0 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#C9A84C', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>작성자</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#9E9590' }}>{selectedPost.author}</span>
        <span style={{ fontSize: '0.72rem', color: '#C9BFB4', marginLeft: 4 }}>{fmtTime(selectedPost.time)}</span>
        <span style={{ fontSize: '0.72rem', color: '#C9BFB4', marginLeft: 'auto' }}>조회 {selectedPost.views || 0}</span>
      </div>

      {/* 본문 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {renderContent(selectedPost)}
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
        <span style={{ flex: 1, fontWeight: 800, fontSize: '1rem', color: '#1F1D1B' }}>
          {editingPostId ? '글 수정' : '새 글 작성'}
        </span>
        <button type="submit" form="board-write-form" style={btnPrimary}>
          {editingPostId ? '수정 완료' : '등록'}
        </button>
      </div>

      {/* 폼 본문 */}
      <form id="board-write-form" onSubmit={handlePost}
        style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* 제목 — 위로 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 46, borderBottom: '1px solid #E6DED4' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#C9A84C', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>제&nbsp;&nbsp;목</span>
          <input
            placeholder="제목을 입력하세요"
            value={title} onChange={e => setTitle(e.target.value)}
            maxLength={40} required
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontWeight: 800, fontSize: '0.95rem', padding: 0,
              background: 'transparent', color: '#1F1D1B',
            }}
          />
        </div>

        {/* 작성자 — 아래, 더 작고 연하게 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 36, borderBottom: '1px solid #E6DED4', background: '#FDFAF5' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#C9A84C', width: 36, flexShrink: 0, textAlign: 'justify', textAlignLast: 'justify' }}>작성자</span>
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
              color: '#9E9590',
              cursor: user ? 'default' : 'text',
            }}
          />
        </div>

        {/* 내용 — 섹션 라벨 스타일 */}
        <div style={{ padding: '10px 16px 4px', fontSize: '0.72rem', fontWeight: 700, color: '#9E9590', letterSpacing: '0.05em' }}>
          내용
        </div>
        <div style={{ padding: '0 16px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <RichEditor value={contentHtml} onChange={setContentHtml} />
        </div>
      </form>
    </aside>
  );

  /* ── 게시판 목록 ── */
  return (
    <aside style={commonPanelStyle}>
      <div style={commonHeaderStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: '1rem', color: '#1F1D1B', flex: 1 }}>
          <span style={{ color: '#6B625B' }}><IconBoard /></span>
          게시판
        </span>
        {user ? (
          <button onClick={openWriteForm} style={{ ...btnSecondary, gap: 4, height: 30, padding: '0 10px', fontSize: '0.78rem' }}>
            <IconEdit /> 글쓰기
          </button>
        ) : (
          <span style={{ fontSize: '0.8rem', color: '#C9BFB4', fontWeight: 500 }}>
            로그인 후 작성 가능
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* 인기글 TOP 5 — 왼쪽 정렬, 압축형 */}
        {topPosts.length > 0 && (
          <div style={{ padding: '10px 16px 0' }}>
            <div style={{ marginBottom: 6, textAlign: 'left' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#C9A84C', letterSpacing: '0.05em' }}>인기글 TOP 5</span>
            </div>
            <div>
              {topPosts.map((post, i) => (
                <div key={post.id} onClick={() => handleShowDetail(post)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', borderBottom: i < topPosts.length - 1 ? '1px solid #E6DED4' : 'none', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#EEE8E0'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <span style={{ minWidth: 14, fontWeight: 800, fontSize: '0.72rem', color: i < 3 ? '#C9A84C' : '#C9BFB4' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: '#1F1D1B', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>{post.title}</span>
                  <span style={{ fontSize: '0.7rem', color: '#C9BFB4', flexShrink: 0 }}>조회 {post.views || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 전체 글 라벨 */}
        <div style={{ padding: '10px 16px 4px', fontSize: '0.72rem', fontWeight: 700, color: '#9E9590', letterSpacing: '0.05em', textAlign: 'left' }}>
          전체 글 <span style={{ color: '#6B625B', fontWeight: 800 }}>{posts.length}</span>
        </div>

        {/* 전체 글 목록 — 콤팩트 썸네일형 */}
        <div style={{ marginInline: 16, marginBottom: 16 }}>
          {posts.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#C9BFB4', padding: '32px 0', fontSize: '0.88rem' }}>
              아직 작성된 글이 없습니다.
            </div>
          ) : currentPosts.map((p, i) => {
            const hasChart = p.contentHtml?.includes('<img') || p.blocks?.some(b => b.type === 'image');
            return (
              <div key={p.id} onClick={() => handleShowDetail(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: i < currentPosts.length - 1 ? '1px solid #E6DED4' : 'none', background: '#fff', transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F7F3EE'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                {/* 24px 썸네일 아이콘 */}
                <div style={{ width: 24, height: 24, borderRadius: 5, background: hasChart ? '#FDF3DC' : '#F7F3EE', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {hasChart ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3,17 8,10 12,13 16,7 21,9"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="21" x2="3" y2="4"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C9BFB4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 3h16a1 1 0 011 1v11a1 1 0 01-1 1H8l-5 4V4a1 1 0 011-1z"/>
                    </svg>
                  )}
                </div>
                {/* 제목 + 작성자/조회수 세로 배치 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1F1D1B', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>
                    {p.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#C9A84C' }}>{p.author}</span>
                    <span style={{ fontSize: '0.68rem', color: '#C9BFB4' }}>조회 {p.views || 0}</span>
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
                  style={{ width: 32, height: 32, border: page === pn ? 'none' : '1.5px solid #E6DED4', borderRadius: 8, background: page === pn ? '#6B625B' : '#fff', color: page === pn ? '#fff' : '#6B625B', fontWeight: page === pn ? 700 : 400, cursor: 'pointer', fontSize: '0.85rem' }}>
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
