import React, { useState, useEffect, useRef } from 'react';
import { commonPanelStyle } from '../styles/panelStyles';

function BoardPanel({ onClose }) {
    const [posts, setPosts] = useState([]);
    const [editingPostId, setEditingPostId] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [author, setAuthor] = useState('');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [images, setImages] = useState([]); // 여러 이미지
    const [selectedPost, setSelectedPost] = useState(null);
    const [imgSizes, setImgSizes] = useState([]);
    const [page, setPage] = useState(1);
    const postsPerPage = 28;
    const totalPages = Math.ceil(posts.length / postsPerPage);
    const currentPosts = posts.slice((page-1)*postsPerPage, page*postsPerPage);
  
    // 인기글 (조회수 상위 10개)
    const [topPosts, setTopPosts] = useState([]);

    // 파일 업로드용 ref
    const fileInputRef = useRef();

    // 로컬스토리지 불러오기
    useEffect(() => {
        const saved = localStorage.getItem('board-posts');
        if (saved) {
        const arr = JSON.parse(saved);
        setPosts(arr);
        setTopPosts(
            [...arr].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10)
        );
        }
    }, []);

    // 저장 함수
    const savePosts = (arr) => {
        setPosts(arr);
        setTopPosts(
        [...arr].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10)
        );
        localStorage.setItem('board-posts', JSON.stringify(arr));
    };

    // 글 작성 그리고 수정기능 추가
    const handlePost = (e) => {
    e.preventDefault();
    if (!author.trim() || !title.trim() || !content.trim()) return;
    const now = new Date();
    const isEdit = Boolean(editingPostId);
    const editingPost = isEdit ? posts.find(p => p.id === editingPostId) : null;

    const newPost = {
        id: isEdit ? editingPostId : Date.now(),
        author: author.trim(),
        title: title.trim(),
        content,
        images, // 반드시!
        time: isEdit && editingPost ? editingPost.time : now.toISOString(),
        views: isEdit && editingPost ? editingPost.views : 0,
        likes: isEdit && editingPost ? editingPost.likes : 0,
    };

    let arr;
    if (isEdit) {
        arr = posts.map(p => p.id === editingPostId ? newPost : p);
    } else {
        arr = [newPost, ...posts];
    }
    savePosts(arr);
    setAuthor('');
    setTitle('');
    setContent('');
    setImages([]); // 여러 장 작성 후 초기화
    setShowForm(false);
    setEditingPostId(null);
    };

    // 글 클릭 시 상세보기 및 조회수 증가
    const handleShowDetail = (post) => {
    // 조회수 증가 반영
    const idx = posts.findIndex((p) => p.id === post.id);
    if (idx !== -1) {
        const arr = [...posts];
        arr[idx].views = (arr[idx].views || 0) + 1;
        savePosts(arr);
        setSelectedPost({ ...arr[idx] });
        setImgSizes([]); // 이미지 크기 초기화
    }};

     // 파일 첨부
    const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    let nextImages = [...images];
    for (const file of files) {
        if (nextImages.length >= 5) {
        alert('최대 5개까지 첨부할 수 있습니다!');
        break;
        }
        if (!file.type.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = (evt) => {
        setImages(prev => prev.length >= 5 ? prev : [...prev, evt.target.result]);
        }; reader.readAsDataURL(file);}};

     // textarea에서 Ctrl+V 이미지 붙여넣기 지원
    const handlePasteImage = (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith("image/")) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = (evt) => {
            setImages(prev => [...prev, evt.target.result]); // 배열에 추가!
        };
        reader.readAsDataURL(file);
        }
    }
    };

    // 게시글 삭제
    function handleDeletePost() {
    if (window.confirm('정말 삭제하시겠습니까?')) {
        const filtered = posts.filter(p => p.id !== selectedPost.id);
        savePosts(filtered);
        setSelectedPost(null); // 목록으로
    }
    }

    // 게시글 수정
    function handleEditPost() {
    setShowForm(true);
    setSelectedPost(null); // 폼 진입, 상세보기 종료
    setAuthor(selectedPost.author);
    setTitle(selectedPost.title);
    setContent(selectedPost.content);
    setImages(selectedPost.images || []);
    // 수정할 때 기존 글 id 따로 저장하고, 등록시엔 같은 id로 교체해줘야 함
    setEditingPostId(selectedPost.id); // 새 state 필요!
    }

  // 팝업 스타일 통일 (공용)
    return (
        <aside style={commonPanelStyle}>
            {/* 👇 글 상세보기 화면 */}
            {selectedPost ? (
                <div style={{padding: '32px 40px', minHeight: '70vh', display: 'flex', flexDirection: 'column'}}>
                    <button
                    style={{
                        marginBottom: 18,
                        color:'#6476FF', background:'none', border:'none',
                        fontWeight:900, cursor:'pointer', fontSize:'1.13rem',
                        alignSelf: 'flex-start'
                    }}
                    onClick={() => setSelectedPost(null)}
                    >
                    ◀ 목록으로
                    </button>

                    <div style={{ fontWeight: 700, fontSize: '1.25rem', marginBottom: 12 }}>
                    {selectedPost.title}
                    </div>
                    
                    <div style={{ fontSize: '1.03rem', marginBottom: 8, color: '#444' }}>
                    <span>{selectedPost.author}</span> |{' '}
                    <span>{selectedPost.time?.slice(5, 16).replace('T', ' ')}</span>{' '}
                    | <span>조회 {selectedPost.views || 0}</span>
                    </div>
                    
                    {/* 이미지&본문 전체 감싸기 */}
                    <div style={{ 
                        borderTop: '1px solid #eee', 
                        margin: '8px 0 20px 0', 
                        overflowY: 'auto',
                        }}>                           
                        {/* 이미지 */}
                        {selectedPost.images && selectedPost.images.length > 0 && (
                        <div style={{display:'flex', gap:12, flexDirection: 'column', alignItems: 'left'}}>
                            {selectedPost.images.map((img, idx) => (
                                <img
                                    key={idx}
                                    src={img}
                                    alt={`첨부이미지${idx+1}`}
                                    style={{
                                    background: "none",
                                    borderRadius: 0,
                                    ...(imgSizes[idx]?.width && imgSizes[idx]?.height
                                        ? { width: imgSizes[idx].width, height: imgSizes[idx].height }
                                        : { maxWidth: '100%', maxHeight: '400px' }
                                    ),
                                        objectFit: 'contain',
                                        display: 'block',
                                    }}
                                    onLoad={e => {
                                    const { naturalWidth, naturalHeight } = e.target;
                                    let ratio = 400 / naturalHeight;
                                    let width = naturalWidth * ratio;
                                    let height = 400;
                                    const container = e.target.parentElement;
                                    const maxW = container ? container.offsetWidth : 9999;
                                    if (width > maxW) {
                                        ratio = maxW / naturalWidth;
                                        width = maxW;
                                        height = naturalHeight * ratio;
                                    }
                                    setImgSizes(prev => {
                                        const next = [...prev];
                                        next[idx] = { width, height };
                                        return next;
                                    });
                                    }}
                                />
                            ))}
                        </div>
                        )}

                        {/* 본문 */}
                        <div style={{
                            whiteSpace: 'pre-line',
                            fontSize: '1.13rem',
                            margin: '12px 0 0 0',
                            flex: 1}}>
                        {selectedPost.content}
                        </div>
                    </div>

                    {/* 수정 삭제 버튼 */}
                    <div style={{marginTop: 32, display:'flex', gap: '12px'}}>
                        <button
                            style={{
                            padding: '5px 13px', borderRadius: 8, fontSize: '1.0rem',
                            background: '#eee', color:'#333', border:'none', fontWeight: 700, cursor:'pointer'
                            }}
                            onClick={handleEditPost}
                        >수정</button>
                        <button
                            style={{
                            padding: '5px 13px', borderRadius: 8, fontSize: '1.0rem',
                            background: '#eee', color:'#333', border:'none', fontWeight: 700, cursor:'pointer'
                            }}
                            onClick={handleDeletePost}
                        >삭제</button>
                    </div>         
                </div>

            // 👇 글 작성하는 창
            ) : showForm ? (
            <form onSubmit={handlePost} style={{
                //maxWidth: 700,                 // 전체 폼 가로폭 (권장: 500~800)
                //margin: '50px auto',           // 중앙 정렬
                //background: '#fff',
                //borderRadius: 13,
                //boxShadow: '0 2px 18px #e2e7f8',
                padding: '36px 42px 28px 42px',// 상 우 하 좌 (전체 내부 여백)
                display: 'flex',
                flexDirection: 'column',
                //gap: 0
            }}>
                <input
                    placeholder="작성자"
                    value={author}
                    onChange={e => setAuthor(e.target.value)}
                    maxLength={10} // 👈 최대 10자
                    style={{
                    marginBottom: 13, padding: '9px 12px', borderRadius: 8,
                    border: '1.2px solid #ccd1e2', fontSize: '1rem', width: '90%'
                    }}
                    required
                />
                <input
                    placeholder="제목"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={40} // 👈 최대 40자
                    style={{
                    marginBottom: 13, padding: '9px 12px', borderRadius: 8,
                    border: '1.2px solid #ccd1e2', fontSize: '1rem', width: '90%'
                    }}
                    required
                />        
                <textarea
                    placeholder="내용"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    onPaste={handlePasteImage}
                    style={{
                    marginBottom: 16, padding: '11px 13px', borderRadius: 8,
                    border: '1.2px solid #ccd1e2', fontSize: '1.06rem', minHeight: 600, width: '90%', resize: 'vertical'
                    }}
                    required
                />
                {/* 이미지 미리보기 최대5개 */}
                {images.length > 0  && 
                <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
                    {images.map((img, idx) => (
                    <div key={idx} style={{ position: 'relative' }}>
                        <img src={img} alt={`첨부${idx+1}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 7 }} />
                        <button
                        onClick={() => setImages(images.filter((_, i) => i !== idx))}
                        style={{
                            position: 'absolute', top: -7, right: -7, border: 'none', background: '#f44', color: '#fff',
                            borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontWeight: 'bold'
                        }}
                        title="삭제"
                        >×</button>
                    </div>
                    ))}
                </div>
                }

                {/* 이미지 첨부하기 최대5개 */}
                <input
                    type="file"
                    accept="image/*"
                    multiple                // 여러 파일 첨부 허용
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
                <button type="button"  style={{ width: 120 }} onClick={() => fileInputRef.current.click()}> 
                이미지 첨부
                </button>
                    
                <div style={{display: 'flex', gap: 9, marginTop: 5}}>
                    <button type="submit" style={{
                    background: '#6476FF', color: '#fff', fontWeight: 700,
                    border: 'none', borderRadius: 8, padding: '5px 13px', fontSize: '1.0rem', cursor: 'pointer'
                    }}>등록</button>
                    <button type="button" onClick={() => { setShowForm(false); setEditingPostId(null); }} style={{
                    background: '#eee', color: '#333', fontWeight: 600,
                    border: 'none', borderRadius: 8, padding: '5px 13px', fontSize: '1.0rem', cursor: 'pointer'
                    }}>취소</button>
                </div>
            </form>
            ) : (
                <>

                {/* 상단 헤더 */}
                <div style={{
                    padding:'0 30px',
                    height:56,
                    display:'flex',
                    alignItems:'center',
                    borderBottom:'1.5px solid #e7eaf3',
                    fontWeight:700,
                    fontSize:'1.17rem',
                    justifyContent:'space-between'}}>
                <span>📑 주식 게시판</span>
                <button
                    onClick={onClose}
                    style={{
                    color:'#6476FF',background:'none',border:'none',
                    fontWeight:900,cursor:'pointer',fontSize:'1.18rem',
                    width:28,height:28,borderRadius:7,transition:'background 0.13s'
                    }}
                    title="닫기"
                    aria-label="닫기"
                    onMouseOver={e => e.currentTarget.style.background = "#e8eefa"}
                    onMouseOut={e => e.currentTarget.style.background = "none"}
                >✕</button>
                </div>

                {/* 인기글 */}
                <div style={{padding:'18px 30px 0 30px'}}>
                <div style={{fontWeight:800,fontSize:'1.03rem',marginBottom:9,color:'#4667d9'}}>
                    🔥 인기글 TOP 10</div>
                <table style={{
                    width:'100%',marginBottom:18,borderCollapse:'collapse',fontSize:'0.99rem',background:'#fbfcff',borderRadius:10,overflow:'hidden'}}>
                    <thead>
                    <tr style={{background:'#f4f6fa'}}>
                        <th style={{width:40}}>순위</th>
                        <th style={{textAlign:'left'}}>제목</th>
                        <th style={{width:90}}>작성자</th>
                        <th style={{width:120}}>작성시간</th>
                        <th style={{width:50}}>조회</th>
                        <th style={{width:50}}>추천</th>
                    </tr>
                    </thead>
                    <tbody>
                    {topPosts.length === 0
                        ? <tr><td colSpan={6} style={{
                            textAlign:'center',color:'#aaa'}}>인기글이 없습니다.</td></tr>
                        : topPosts.map((post,i) => (
                            <tr key={post.id}>
                            <td style={{textAlign:'center'}}>{i+1}</td> 
                            {/* 제목 */}
                            <td
                            style={{
                                maxWidth: 180,             // 픽셀 고정(반응형이면 %)
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                fontWeight: 600,
                                cursor: 'pointer',
                                color: '#294e98',
                            }}
                            onClick={() => handleShowDetail(post)}
                            title={post.title}           // 마우스 올리면 전체 제목
                            >
                            {post.title}
                            </td>
                            {/* 작성자 */}
                            <td
                            style={{
                                textAlign: 'center',
                                maxWidth: 80,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                            title={post.author}
                            >
                            {post.author}
                            </td>
                            <td style={{textAlign:'center'}}>{post.time?.slice(5,16).replace('T',' ')}</td>
                            <td style={{textAlign:'center'}}>{post.views || 0}</td>
                            <td style={{textAlign:'center'}}>{post.likes || 0}</td>
                            </tr>
                        ))
                    }
                    </tbody>
                </table>
                </div>

                {/* 전체 게시글 */}
                <div style={{padding:'0 30px 22px 30px',flex:1,overflow:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7}}>
                    <div style={{fontWeight:800,fontSize:'1.07rem',color:'#384056'}}>📄 전체 게시글</div>
                    <button
                    onClick={() => setShowForm(true)}
                    style={{
                        background:'#6476FF',color:'#fff',fontWeight:700,
                        border:'none',borderRadius:8,padding:'5px 13px',
                        fontSize:'1.0rem',cursor:'pointer',marginLeft:8
                    }}
                    >글쓰기</button>
                </div>

                {/* 게시글 목록 */}
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'1.03rem',background:'#fff',borderRadius:9,overflow:'hidden'}}>
                    <thead>
                    <tr style={{background:'#f7faff'}}>
                        <th style={{textAlign:'left',width:36}}> </th>
                        <th style={{textAlign:'left'}}>제목</th>
                        <th style={{width:90}}>작성자</th>
                        <th style={{width:110}}>작성시간</th>
                        <th style={{width:46}}>조회</th>
                        <th style={{width:46}}>추천</th>
                    </tr>
                    </thead>
                    <tbody>
                    {posts.length === 0
                        ? <tr><td colSpan={6} style={{textAlign:'center',color:'#aaa'}}>작성된 글이 없습니다.</td></tr>
                        : currentPosts.map((p,idx) => (
                        <tr key={p.id}>
                            <td style={{
                                maxWidth: 36,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                textAlign: 'center'
                            }}>
                            {p.images?.length > 0 ? <span role="img" aria-label="img">🖼️</span> : ''}
                            </td>
                            <td
                                style={{
                                maxWidth: 220,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                }}
                            >
                            <span
                                style={{fontWeight:600, cursor:'pointer', color:'#294e98'}}
                                onClick={()=>handleShowDetail(p)}
                                title={p.title} //마우스올리면 타이틀 보임
                            >{p.title}</span>
                            </td>
                            <td
                                style={{
                                maxWidth: 90,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                textAlign: 'center'
                                }}
                            >
                                <span title={p.author}>{p.author}</span>
                            </td>
                            <td style={{textAlign:'center'}}>{p.time?.slice(5,16).replace('T',' ')}</td>
                            <td style={{textAlign:'center'}}>{p.views || 0}</td>
                            <td style={{textAlign:'center'}}>{p.likes || 0}</td>
                        </tr>
                        ))
                    }
                    </tbody>
                </table>

                {/* 페이지네이션 */}
                <div style={{display:'flex',justifyContent:'center',marginTop:12,gap:7}}>
                <button onClick={()=>setPage(page-1)} disabled={page===1}>이전</button>
                {[...Array(totalPages).keys()].map(i => {
                    const pageNum = i + 1;
                    // 1~10페이지만 노출, 혹은 필요한 만큼
                    if (pageNum > 10) return null;
                    return (
                    <button
                        key={pageNum}
                        style={{
                        fontWeight: page===pageNum ? 700 : 400,
                        background: page===pageNum ? '#f4f6fa' : 'none',
                        border: '1px solid #eee',
                        borderRadius: 4,
                        width: 28,
                        cursor: 'pointer'
                        }}
                        onClick={()=>setPage(pageNum)}
                    >{pageNum}</button>
                    );
                })}
                <button onClick={()=>setPage(page+1)} disabled={page===totalPages}>다음</button>
                </div>

                </div>
                </>
            )}
        </aside>
    )
}

export default BoardPanel;
