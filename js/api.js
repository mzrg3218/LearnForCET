/* ============================================================
   LEARNforCET 前端 API 客户端（在线模式）
   探测 /api/health 决定在线/本机模式；所有调用带 cookie。
   ============================================================ */
(function () {
  'use strict';

  async function call(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: {}
    };
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var res;
    try {
      res = await fetch('/api' + path, init);
    } catch (e) {
      return { ok: false, status: 0, error: '网络错误，服务器不可达' };
    }
    var data = {};
    try { data = await res.json(); } catch (e) { /* 空响应 */ }
    return { ok: res.ok, status: res.status, data: data, error: data.error || null };
  }

  window.LFAPI = {
    available: null,   // null=未探测 true/false
    user: null,        // 登录后 { username, display_name, avatar, bio, address, created_at }

    async probe() {
      try {
        var res = await fetch('/api/health', { credentials: 'same-origin' });
        this.available = res.ok;
      } catch (e) {
        this.available = false;
      }
      return this.available;
    },

    async register(username, password) {
      var r = await call('/register', { method: 'POST', body: { username: username, password: password } });
      if (r.ok) this.user = r.data;
      return r;
    },
    async login(username, password) {
      var r = await call('/login', { method: 'POST', body: { username: username, password: password } });
      if (r.ok) this.user = r.data;
      return r;
    },
    async logout() { return call('/logout', { method: 'POST' }); },
    async me() {
      var r = await call('/me');
      this.user = r.ok ? r.data : null;
      return r;
    },
    async saveProfile(displayName, bio, address) {
      var r = await call('/profile', { method: 'PUT', body: { display_name: displayName, bio: bio, address: address } });
      if (r.ok && this.user) {
        this.user.display_name = r.data.display_name;
        this.user.bio = r.data.bio;
        this.user.address = r.data.address;
      }
      return r;
    },
    async uploadAvatar(dataUrl) {
      var r = await call('/avatar', { method: 'PUT', body: { avatar: dataUrl } });
      if (r.ok && this.user) this.user.avatar = r.data.avatar;
      return r;
    },
    async changePassword(oldPw, newPw) {
      return call('/password', { method: 'PUT', body: { old: oldPw, new: newPw } });
    },
    async friends() { return call('/friends'); },
    async searchUsers(q) { return call('/search?q=' + encodeURIComponent(q)); },
    async sendRequest(username) { return call('/friend-request', { method: 'POST', body: { username: username } }); },
    async respondRequest(requestId, accept) { return call('/friend-respond', { method: 'POST', body: { requestId: requestId, accept: accept } }); },
    async removeFriend(username) { return call('/friend-remove', { method: 'POST', body: { username: username } }); },
    async chatWith(username, after) { return call('/chat?with=' + encodeURIComponent(username) + '&after=' + (after || 0)); },
    async sendChat(username, text) { return call('/chat', { method: 'POST', body: { with: username, text: text } }); }
  };
})();
