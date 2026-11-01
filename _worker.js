/* ============================================================
   LEARNforCET 服务端 — Cloudflare Worker + D1
   账户（PBKDF2 加盐 + HttpOnly 会话）、资料（头像/签名/地址）、
   好友（搜索/申请/接受/删除）、私聊（增量轮询）。
   部署见 README；本地开发：npx wrangler dev
   ============================================================ */

const SESSION_DAYS = 30;
const MAX_BODY = 200 * 1024;          // 头像等上传上限
const rateMap = new Map();            // 简易限流（实例内存，防暴力登录）

/* ---------------- 工具 ---------------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const bad = (msg, status = 400) => json({ error: msg }, status);

const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b, 16)));

async function pbkdf2(pw, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100000 }, key, 256);
  return hex(bits);
}
const sha256Hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return hex(d);
};

function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function sessionCookie(token, req, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? ' Secure;' : '';
  return `lfcet_session=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const r = rateMap.get(key);
  if (!r || now > r.reset) { rateMap.set(key, { count: 1, reset: now + windowMs }); return true; }
  r.count++;
  return r.count <= limit;
}

async function readJson(req) {
  const len = parseInt(req.headers.get('content-length') || '0', 10);
  if (len > MAX_BODY) throw new Error('请求体过大');
  return req.json();
}

const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

/* ---------------- 鉴权 ---------------- */
async function authUser(req, env) {
  const token = getCookie(req, 'lfcet_session');
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.expires, u.id, u.username, u.display_name, u.avatar, u.bio, u.address, u.created_at, u.pass, u.salt
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return row;
}

async function createSession(env, userId, req) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare('INSERT INTO sessions(token_hash, user_id, expires) VALUES (?,?,?)')
    .bind(await sha256Hex(token), userId, expires).run();
  return token;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username,
    display_name: u.display_name || u.username,
    avatar: u.avatar || '', bio: u.bio || '', address: u.address || '',
    created_at: u.created_at
  };
}

/* ---------------- 路由 ---------------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      // Workers 部署：静态资源由 ASSETS 提供；Pages Functions 不会走到这里
      return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    }

    try {
      const path = url.pathname.slice(4); // 去掉 /api
      const method = req.method;
      const ip = req.headers.get('cf-connecting-ip') || 'local';

      /* ---------- 健康检查 ---------- */
      if (path === '/health') return json({ ok: true, name: 'learnforCET', time: Date.now() });

      /* ---------- 注册 ---------- */
      if (path === '/register' && method === 'POST') {
        if (!rateLimit('reg:' + ip, 10, 60000)) return bad('操作太频繁，稍后再试', 429);
        const body = await readJson(req);
        const username = clean(body.username, 20);
        const password = String(body.password || '');
        if (username.length < 2 || !/^[\w\u4e00-\u9fff.-]+$/.test(username)) return bad('用户名需 2-20 位字母/数字/中文/._-');
        if (password.length < 6) return bad('密码至少 6 位（公网环境请勿使用弱密码）');
        const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
        if (exists) return bad('这个用户名已经被注册了');
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        const pass = await pbkdf2(password, salt);
        const r = await env.DB.prepare(
          'INSERT INTO users(username, display_name, pass, salt, created_at) VALUES (?,?,?,?,?)'
        ).bind(username, username, pass, salt, Date.now()).run();
        const token = await createSession(env, r.meta.last_row_id, req);
        const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(r.meta.last_row_id).first();
        return new Response(JSON.stringify(publicUser(u)), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': sessionCookie(token, req, SESSION_DAYS * 86400) }
        });
      }

      /* ---------- 登录 ---------- */
      if (path === '/login' && method === 'POST') {
        if (!rateLimit('login:' + ip, 15, 60000)) return bad('尝试太频繁，稍后再试', 429);
        const body = await readJson(req);
        const username = clean(body.username, 20);
        const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
        if (!u || (await pbkdf2(String(body.password || ''), u.salt)) !== u.pass) return bad('用户名或密码不对', 401);
        const token = await createSession(env, u.id, req);
        return new Response(JSON.stringify(publicUser(u)), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': sessionCookie(token, req, SESSION_DAYS * 86400) }
        });
      }

      /* ---------- 以下均需登录 ---------- */
      const me = await authUser(req, env);
      if (!me) return bad('未登录', 401);

      if (path === '/logout' && method === 'POST') {
        const token = getCookie(req, 'lfcet_session');
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': sessionCookie('', req, 0) }
        });
      }

      if (path === '/me' && method === 'GET') return json(publicUser(me));

      if (path === '/profile' && method === 'PUT') {
        const body = await readJson(req);
        const displayName = clean(body.display_name, 24) || me.username;
        const bio = clean(body.bio, 100);
        const address = clean(body.address, 60);
        await env.DB.prepare('UPDATE users SET display_name=?, bio=?, address=? WHERE id=?')
          .bind(displayName, bio, address, me.id).run();
        return json({ ok: true, display_name: displayName, bio, address });
      }

      if (path === '/avatar' && method === 'PUT') {
        const body = await readJson(req);
        const avatar = String(body.avatar || '');
        if (avatar && !/^data:image\/(png|jpeg|webp);base64,/.test(avatar)) return bad('仅支持 png/jpeg/webp 图片');
        if (avatar.length > 120 * 1024) return bad('图片太大（超过 120KB）');
        await env.DB.prepare('UPDATE users SET avatar=? WHERE id=?').bind(avatar, me.id).run();
        return json({ ok: true, avatar });
      }

      if (path === '/password' && method === 'PUT') {
        const body = await readJson(req);
        const oldPass = String(body.old || '');
        const newPass = String(body.new || '');
        if ((await pbkdf2(oldPass, me.salt)) !== me.pass) return bad('原密码不对');
        if (newPass.length < 6) return bad('新密码至少 6 位');
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        await env.DB.prepare('UPDATE users SET pass=?, salt=? WHERE id=?')
          .bind(await pbkdf2(newPass, salt), salt, me.id).run();
        return json({ ok: true });
      }

      /* ---------- 用户搜索 ---------- */
      if (path === '/search' && method === 'GET') {
        const q = clean(url.searchParams.get('q'), 20);
        if (q.length < 1) return json({ users: [] });
        const like = '%' + q.replace(/[%_]/g, '') + '%';
        const rows = await env.DB.prepare(
          `SELECT id, username, display_name, avatar FROM users
           WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 10`
        ).bind(like, like, me.id).all();
        return json({ users: rows.results });
      }

      /* ---------- 好友列表（含最近一条消息） ---------- */
      if (path === '/friends' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar,
                  (SELECT text   FROM messages m WHERE (m.conv_a=f.a_id AND m.conv_b=f.b_id) ORDER BY m.id DESC LIMIT 1) AS last_text,
                  (SELECT m2.id  FROM messages m2 WHERE (m2.conv_a=f.a_id AND m2.conv_b=f.b_id) ORDER BY m2.id DESC LIMIT 1) AS last_id,
                  (SELECT m3.from_id FROM messages m3 WHERE (m3.conv_a=f.a_id AND m3.conv_b=f.b_id) ORDER BY m3.id DESC LIMIT 1) AS last_from
           FROM friends f JOIN users u ON u.id = CASE WHEN f.a_id = ? THEN f.b_id ELSE f.a_id END
           WHERE f.a_id = ? OR f.b_id = ?`
        ).bind(me.id, me.id, me.id).all();
        const reqIn = await env.DB.prepare(
          `SELECT r.id, u.username, u.display_name, u.avatar FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ?`
        ).bind(me.id).all();
        const reqOut = await env.DB.prepare(
          `SELECT r.id, u.username FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ?`
        ).bind(me.id).all();
        return json({ friends: rows.results, requests_in: reqIn.results, requests_out: reqOut.results });
      }

      /* ---------- 发好友申请 ---------- */
      if (path === '/friend-request' && method === 'POST') {
        const body = await readJson(req);
        const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(clean(body.username, 20)).first();
        if (!target) return bad('找不到这个用户');
        if (target.id === me.id) return bad('不能加自己为好友');
        const a = Math.min(me.id, target.id), b = Math.max(me.id, target.id);
        const already = await env.DB.prepare('SELECT id FROM friends WHERE a_id=? AND b_id=?').bind(a, b).first();
        if (already) return bad('你们已经是好友了');
        const pending = await env.DB.prepare(
          'SELECT id, from_id FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)'
        ).bind(me.id, target.id, target.id, me.id).first();
        if (pending) return bad(pending.from_id === me.id ? '申请已发出，等待对方处理' : '对方已向你发出申请，请先处理');
        await env.DB.prepare('INSERT INTO friend_requests(from_id, to_id, created_at) VALUES (?,?,?)')
          .bind(me.id, target.id, Date.now()).run();
        return json({ ok: true });
      }

      /* ---------- 处理好友申请 ---------- */
      if (path === '/friend-respond' && method === 'POST') {
        const body = await readJson(req);
        const r = await env.DB.prepare('SELECT * FROM friend_requests WHERE id=? AND to_id=?')
          .bind(parseInt(body.requestId, 10) || 0, me.id).first();
        if (!r) return bad('申请不存在');
        await env.DB.prepare('DELETE FROM friend_requests WHERE id=?').bind(r.id).run();
        if (body.accept) {
          const a = Math.min(me.id, r.from_id), b = Math.max(me.id, r.from_id);
          await env.DB.prepare('INSERT OR IGNORE INTO friends(a_id, b_id, created_at) VALUES (?,?,?)')
            .bind(a, b, Date.now()).run();
        }
        return json({ ok: true });
      }

      /* ---------- 删除好友 ---------- */
      if (path === '/friend-remove' && method === 'POST') {
        const body = await readJson(req);
        const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(clean(body.username, 20)).first();
        if (!target) return bad('找不到这个用户');
        const a = Math.min(me.id, target.id), b = Math.max(me.id, target.id);
        await env.DB.prepare('DELETE FROM friends WHERE a_id=? AND b_id=?').bind(a, b).run();
        return json({ ok: true });
      }

      /* ---------- 聊天：拉取（增量） ---------- */
      if (path === '/chat' && method === 'GET') {
        const withName = clean(url.searchParams.get('with'), 20);
        const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
        const other = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(withName).first();
        if (!other) return bad('找不到这个用户');
        const a = Math.min(me.id, other.id), b = Math.max(me.id, other.id);
        const isFriend = await env.DB.prepare('SELECT id FROM friends WHERE a_id=? AND b_id=?').bind(a, b).first();
        if (!isFriend) return bad('你们不是好友');
        const rows = await env.DB.prepare(
          `SELECT id, from_id, text, created_at FROM messages
           WHERE conv_a=? AND conv_b=? AND id > ? ORDER BY id ASC LIMIT 200`
        ).bind(a, b, after).all();
        return json({ messages: rows.results, me_id: me.id });
      }

      /* ---------- 聊天：发送 ---------- */
      if (path === '/chat' && method === 'POST') {
        const body = await readJson(req);
        const other = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(clean(body.with, 20)).first();
        if (!other) return bad('找不到这个用户');
        const text = clean(body.text, 500);
        if (!text) return bad('消息不能为空');
        const a = Math.min(me.id, other.id), b = Math.max(me.id, other.id);
        const isFriend = await env.DB.prepare('SELECT id FROM friends WHERE a_id=? AND b_id=?').bind(a, b).first();
        if (!isFriend) return bad('你们不是好友');
        const r = await env.DB.prepare(
          'INSERT INTO messages(conv_a, conv_b, from_id, text, created_at) VALUES (?,?,?,?,?)'
        ).bind(a, b, me.id, text, Date.now()).run();
        return json({ ok: true, id: r.meta.last_row_id });
      }

      return bad('接口不存在', 404);
    } catch (e) {
      return bad('服务器错误：' + (e && e.message ? e.message : 'unknown'), 500);
    }
  }
};
