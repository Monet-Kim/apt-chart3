const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── 유저 프로필 + 즐겨찾기 (R2) ──────────────────────────

    // GET /api/user/:kakao_id
    if (request.method === 'GET' && path.startsWith('/api/user/')) {
      const kakaoId = path.split('/')[3];
      if (!kakaoId) return err('kakao_id required');
      const obj = await env.R2.get(`users/${kakaoId}.json`);
      if (!obj) return json({ favorites: [], boardNickname: null });
      const data = await obj.json();
      return json(data);
    }

    // PUT /api/user/:kakao_id
    if (request.method === 'PUT' && path.startsWith('/api/user/')) {
      const kakaoId = path.split('/')[3];
      if (!kakaoId) return err('kakao_id required');
      const body = await request.json();
      await env.R2.put(
        `users/${kakaoId}.json`,
        JSON.stringify(body),
        { httpMetadata: { contentType: 'application/json' } }
      );
      return json({ ok: true });
    }

    // ── 게시판 (D1) ──────────────────────────────────────────

    // GET /api/posts?page=N&limit=N
    if (request.method === 'GET' && path === '/api/posts') {
      const page  = Math.max(1, parseInt(url.searchParams.get('page')  || '1', 10));
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
      const offset = (page - 1) * limit;

      const { results } = await env.DB.prepare(
        'SELECT id, kakao_id, nickname, title, created_at, updated_at FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).bind(limit, offset).all();

      const { results: countRes } = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM posts'
      ).all();

      return json({ posts: results, total: countRes[0].cnt, page, limit });
    }

    // GET /api/posts/:id
    if (request.method === 'GET' && path.startsWith('/api/posts/')) {
      const id = path.split('/')[3];
      const { results } = await env.DB.prepare(
        'SELECT * FROM posts WHERE id = ?'
      ).bind(id).all();
      if (!results.length) return err('not found', 404);
      return json(results[0]);
    }

    // POST /api/posts
    if (request.method === 'POST' && path === '/api/posts') {
      const { kakao_id, nickname, title, content } = await request.json();
      if (!kakao_id || !nickname || !title || !content) return err('missing fields');
      const id = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        'INSERT INTO posts (id, kakao_id, nickname, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, kakao_id, nickname, title, content, now, now).run();
      return json({ id, created_at: now }, 201);
    }

    // PUT /api/posts/:id
    if (request.method === 'PUT' && path.startsWith('/api/posts/')) {
      const id = path.split('/')[3];
      const { kakao_id, title, content } = await request.json();
      if (!kakao_id) return err('kakao_id required');
      const { results } = await env.DB.prepare(
        'SELECT kakao_id FROM posts WHERE id = ?'
      ).bind(id).all();
      if (!results.length) return err('not found', 404);
      if (results[0].kakao_id !== String(kakao_id)) return err('forbidden', 403);
      const now = Date.now();
      await env.DB.prepare(
        'UPDATE posts SET title = ?, content = ?, updated_at = ? WHERE id = ?'
      ).bind(title, content, now, id).run();
      return json({ ok: true });
    }

    // DELETE /api/posts/:id
    if (request.method === 'DELETE' && path.startsWith('/api/posts/')) {
      const id = path.split('/')[3];
      const { kakao_id } = await request.json().catch(() => ({}));
      if (!kakao_id) return err('kakao_id required');
      const { results } = await env.DB.prepare(
        'SELECT kakao_id FROM posts WHERE id = ?'
      ).bind(id).all();
      if (!results.length) return err('not found', 404);
      if (results[0].kakao_id !== String(kakao_id)) return err('forbidden', 403);
      await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    return err('not found', 404);
  },
};
