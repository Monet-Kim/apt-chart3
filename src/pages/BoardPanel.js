import React, { useState, useEffect, useRef } from 'react';
import { commonPanelStyle } from '../styles/panelStyles';

/* ── 공통 버튼 스타일 ── */
const btnPrimary = {
  background: '#6B625B', color: '#fff', fontWeight: 700,
  border: 'none', borderRadius: 10, padding: '0 20px',
  height: 42, fontSize: '0.97rem', cursor: 'pointer', flexShrink: 0,
};
const btnSecondary = {
  background: '#E6DED4', color: '#6B625B', fontWeight: 600,
  border: 'none', borderRadius: 10, padding: '0 16px',
  height: 42, fontSize: '0.97rem', cursor: 'pointer', flexShrink: 0,
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid #E6DED4', fontSize: '0.97rem',
  outline: 'none', background: '#F7F3EE',
};

function BoardPanel({ onClose, backHandlerRef }) {
  const [posts, setPosts] = useState([]);
  const [editingPostId, setEditingPostId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [author, setAuthor] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [imgSizes, setImgSizes] = useState([]);
  const [page, setPage] = useState(1);
  const postsPerPage = 20;
  const totalPages = Math.ceil(posts.length / postsPerPage);
  const currentPosts = posts.slice((page - 1) * postsPerPage, page * postsPerPage);
  const [topPosts, setTopPosts] = useState([]);
  const fileInputRef = useRef();

  // 뒤로가기 핸들러 등록: detail→list, form→list 순으로 내부 이동
  useEffect(() => {
    if (!backHandlerRef) return;
    backHandlerRef.current = () => {
      if (selectedPost) { setSelectedPost(null); return true; }
      if (showForm) { resetForm(); return true; }
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
    setAuthor(''); setTitle(''); setContent(''); setImages([]);
    setShowForm(false); setEditingPostId(null);
  };

  const handlePost = (e) => {
    e.preventDefault();
    if (!author.trim() || !title.trim() || !content.trim()) return;
    const isEdit = Boolean(editingPostId);
    const editingPost = isEdit ? posts.find(p => p.id === editingPostId) : null;
    const newPost = {
      id: isEdit ? editingPostId : Date.now(),
      author: author.trim(), title: title.trim(), content, images,
      time: isEdit && editingPost ? editingPost.time : new Date().toISOString(),
      views: isEdit && editingPost ? editingPost.views : 0,
      likes: isEdit && editingPost ? editingPost.likes : 0,
    };
    const arr = isEdit ? posts.map(p => p.id === editingPostId ? newPost : p) : [newPost, ...posts];
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
      setImgSizes([]);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      if (images.length >= 5) { alert('최대 5개까지 첨부할 수 있습니다!'); break; }
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = (evt) => setImages(prev => prev.length >= 5 ? prev : [...prev, evt.target.result]);
      reader.readAsDataURL(file);
    }
  };

  const handlePasteImage = (e) => {
    if (e.clipboardData?.files?.length > 0) {
      const file = e.clipboardData.files[0];
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = (evt) => setImages(prev => [...prev, evt.target.result]);
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDeletePost = () => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      savePosts(posts.filter(p => p.id !== selectedPost.id));
      setSelectedPost(null);
    }
  };

  const handleEditPost = () => {
    setShowForm(true);
    setSelectedPost(null);
    setAuthor(selectedPost.author);
    setTitle(selectedPost.title);
    setContent(selectedPost.content);
    setImages(selectedPost.images || []);
    setEditingPostId(selectedPost.id);
  };

  const fmtTime = (iso) => iso?.slice(5, 16).replace('T', ' ') ?? '';

  /* ════════════════════════════════════
     상세보기
  ════════════════════════════════════ */
  if (selectedPost) return (
    <aside style={commonPanelStyle}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', height: 52, borderBottom: '1.5px solid #E6DED4' }}>
        <button onClick={() => setSelectedPost(null)} style={{ ...btnSecondary, height: 34, padding: '0 12px', fontSize: '0.88rem' }}>
          ◀ 목록
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={handleEditPost} style={{ ...btnSecondary, height: 34, padding: '0 12px', fontSize: '0.88rem' }}>수정</button>
        <button onClick={handleDeletePost} style={{ height: 34, padding: '0 12px', fontSize: '0.88rem', background: '#fff0f0', color: '#e03131', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}>삭제</button>
      </div>

      {/* 본문 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px' }}>
        <div style={{ fontWeight: 800, fontSize: '1.18rem', color: '#1F1D1B', marginBottom: 10, lineHeight: 1.4 }}>
          {selectedPost.title}
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: '0.83rem', color: '#6B625B', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: '#6B625B' }}>{selectedPost.author}</span>
          <span>{fmtTime(selectedPost.time)}</span>
          <span>조회 {selectedPost.views || 0}</span>
        </div>
        <div style={{ borderTop: '1.5px solid #E6DED4', paddingTop: 16 }}>
          {selectedPost.images?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {selectedPost.images.map((img, idx) => (
                <img key={idx} src={img} alt={`첨부${idx + 1}`}
                  style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 8,
                    ...(imgSizes[idx] ? { width: imgSizes[idx].width, height: imgSizes[idx].height } : {}) }}
                  onLoad={e => {
                    const { naturalWidth: nw, naturalHeight: nh } = e.target;
                    let ratio = 360 / nh, w = nw * ratio, h = 360;
                    const maxW = e.target.parentElement?.offsetWidth || 9999;
                    if (w > maxW) { ratio = maxW / nw; w = maxW; h = nh * ratio; }
                    setImgSizes(prev => { const next = [...prev]; next[idx] = { width: w, height: h }; return next; });
                  }}
                />
              ))}
            </div>
          )}
          <div style={{ whiteSpace: 'pre-line', fontSize: '1.02rem', lineHeight: 1.7, color: '#1F1D1B' }}>
            {selectedPost.content}
          </div>
        </div>
      </div>
    </aside>
  );

  /* ════════════════════════════════════
     글쓰기 폼
  ════════════════════════════════════ */
  if (showForm) return (
    <aside style={commonPanelStyle}>
      {/* 고정 헤더 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', height: 52, borderBottom: '1.5px solid #E6DED4' }}>
        <span style={{ fontWeight: 800, fontSize: '1.08rem', color: '#1F1D1B', flex: 1 }}>
          {editingPostId ? '✏️ 글 수정' : '✏️ 글쓰기'}
        </span>
        <button onClick={resetForm} style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#6B625B', borderRadius: 8 }}>✕</button>
      </div>

      {/* 스크롤 가능한 폼 본문 */}
      <form id="board-write-form" onSubmit={handlePost}
        style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '16px', gap: 10 }}>
        <input
          placeholder="작성자 (최대 10자)"
          value={author} onChange={e => setAuthor(e.target.value)}
          maxLength={10} required style={inputStyle}
        />
        <input
          placeholder="제목 (최대 40자)"
          value={title} onChange={e => setTitle(e.target.value)}
          maxLength={40} required style={inputStyle}
        />
        <textarea
          placeholder="내용을 입력하세요 (Ctrl+V로 이미지 붙여넣기 가능)"
          value={content} onChange={e => setContent(e.target.value)}
          onPaste={handlePasteImage} required
          style={{ ...inputStyle, minHeight: 180, maxHeight: 320, resize: 'vertical', lineHeight: 1.6 }}
        />

        {/* 이미지 미리보기 */}
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {images.map((img, idx) => (
              <div key={idx} style={{ position: 'relative' }}>
                <img src={img} alt={`첨부${idx + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #E6DED4' }} />
                <button type="button"
                  onClick={() => setImages(images.filter((_, i) => i !== idx))}
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, border: 'none', background: '#e03131', color: '#fff', borderRadius: '50%', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
                >×</button>
              </div>
            ))}
            {images.length < 5 && (
              <button type="button" onClick={() => fileInputRef.current.click()}
                style={{ width: 72, height: 72, border: '1.5px dashed #C9BFB4', borderRadius: 8, background: '#F7F3EE', cursor: 'pointer', color: '#6B625B', fontSize: '1.4rem' }}>
                +
              </button>
            )}
          </div>
        )}

        {/* 숨김 파일 인풋 */}
        <input type="file" accept="image/*" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
      </form>

      {/* 고정 푸터 — form 외부에서 form 속성으로 연결 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1.5px solid #E6DED4', background: '#fff' }}>
        <button type="button" onClick={() => fileInputRef.current.click()}
          style={{ ...btnSecondary, height: 38, padding: '0 12px', fontSize: '0.88rem' }}>
          🖼 이미지 {images.length > 0 ? `(${images.length})` : ''}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={resetForm} style={{ ...btnSecondary, height: 38 }}>취소</button>
        <button type="submit" form="board-write-form" style={{ ...btnPrimary, height: 38 }}>
          {editingPostId ? '수정 완료' : '등록'}
        </button>
      </div>
    </aside>
  );

  /* ════════════════════════════════════
     게시판 목록
  ════════════════════════════════════ */
  return (
    <aside style={commonPanelStyle}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', height: 52, borderBottom: '1.5px solid #E6DED4' }}>
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1F1D1B', flex: 1 }}>📑 게시판</span>
        <button onClick={onClose} style={{ width: 34, height: 34, border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#6B625B', borderRadius: 8 }} title="닫기">✕</button>
      </div>

      {/* 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* 인기글 TOP 5 */}
        {topPosts.length > 0 && (
          <div style={{ padding: '14px 16px 0 16px' }}>
            <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#6B625B', marginBottom: 8, letterSpacing: 0.2 }}>🔥 인기글 TOP 5</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#F7F3EE', borderRadius: 12, overflow: 'hidden', border: '1px solid #E6DED4' }}>
              {topPosts.map((post, i) => (
                <div key={post.id} onClick={() => handleShowDetail(post)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: '#fff', borderBottom: i < topPosts.length - 1 ? '1px solid #E6DED4' : 'none' }}>
                  <span style={{ minWidth: 20, fontWeight: 800, fontSize: '0.82rem', color: i < 3 ? '#6B625B' : '#C9BFB4' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: '0.92rem', fontWeight: 600, color: '#1F1D1B', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{post.title}</span>
                  <span style={{ fontSize: '0.78rem', color: '#C9BFB4', flexShrink: 0 }}>조회 {post.views || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 전체 게시글 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px 8px 16px' }}>
          <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#6B625B', flex: 1 }}>
            전체 글 <span style={{ color: '#6B625B' }}>{posts.length}</span>
          </span>
          <button onClick={() => setShowForm(true)} style={btnPrimary}>✏️ 글쓰기</button>
        </div>

        {/* 게시글 카드 목록 */}
        <div style={{ padding: '0 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {posts.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#C9BFB4', padding: '40px 0', fontSize: '0.95rem' }}>
              아직 작성된 글이 없습니다.
            </div>
          ) : currentPosts.map((p) => (
            <div key={p.id} onClick={() => handleShowDetail(p)}
              style={{ background: '#fff', border: '1.5px solid #E6DED4', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {/* 제목 줄 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.images?.length > 0 && <span style={{ fontSize: '0.78rem' }}>🖼️</span>}
                <span style={{ fontWeight: 700, fontSize: '0.97rem', color: '#1F1D1B', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {p.title}
                </span>
              </div>
              {/* 메타 줄 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#C9BFB4' }}>
                <span style={{ fontWeight: 700, color: '#6B625B' }}>{p.author}</span>
                <span>{fmtTime(p.time)}</span>
                <span style={{ marginLeft: 'auto' }}>조회 {p.views || 0}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '0 16px 20px 16px', flexWrap: 'wrap' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ ...btnSecondary, height: 34, padding: '0 12px', fontSize: '0.85rem', opacity: page === 1 ? 0.4 : 1 }}>
              ◀
            </button>
            {[...Array(Math.min(totalPages, 10)).keys()].map(i => {
              const pn = i + 1;
              return (
                <button key={pn} onClick={() => setPage(pn)}
                  style={{ width: 34, height: 34, border: page === pn ? '2px solid #6B625B' : '1.5px solid #E6DED4', borderRadius: 8, background: page === pn ? '#6B625B' : '#fff', color: page === pn ? '#fff' : '#6B625B', fontWeight: page === pn ? 700 : 400, cursor: 'pointer', fontSize: '0.88rem' }}>
                  {pn}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ ...btnSecondary, height: 34, padding: '0 12px', fontSize: '0.85rem', opacity: page === totalPages ? 0.4 : 1 }}>
              ▶
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default BoardPanel;
