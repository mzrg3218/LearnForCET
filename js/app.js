/* ============================================================
   单词星球 WordPlanet — 应用逻辑
   纯原生 JS，无依赖。数据通过 localStorage 持久化。
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
  var dateStr = function (d) {
    var x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };

  /* ---------------- 常量 ---------------- */
  var USERS_KEY = 'cetbase:users';        // { 用户名: { h: 密码散列, created } }
  var CURRENT_KEY = 'cetbase:current';    // 当前登录用户名
  var THEME_KEY = 'cetbase:theme';        // 主题（全局，不随账户）
  var DAILY_GOAL = 20;        // 每日练习目标（次）
  var MASTER_STREAK = 3;      // 连续答对次数达到即视为「已掌握」
  var QUIZ_COUNT = 10;        // 每轮测验 / 拼写题数

  /* 词书模式：LFCET4 = 四级全量；LFCET6 = 四级全量 + 六级拓展（含全部词） */
  var BUILTIN_BOOKS = [
    { id: 'LFCET4', label: 'LFCET4', name: '四级词书', desc: '四级词汇全量', bar: '#8fc3e4', cls: 'lv-4', filter: function (x) { return x.lv === 'CET-4'; } },
    { id: 'LFCET6', label: 'LFCET6', name: '六级词书', desc: '四级全量 + 六级拓展', bar: '#a8dcc6', cls: 'lv-6', filter: function () { return true; } }
  ];

  /* 单词来源徽章（词书内的构成标识） */
  var LEVEL_META = {
    'CET-4': { label: '四级', cls: 'lv-4' },
    'CET-6': { label: '六级拓展', cls: 'lv-6' },
    '自定义': { label: '自建', cls: 'lv-custom' }
  };

  var WORDS = window.WORD_BANK || [];
  var WORD_MAP = {};
  WORDS.forEach(function (x) { WORD_MAP[x.w] = x; });

  var ALL_CACHE = null;       // 全部词条缓存

  function allWords() {
    if (!ALL_CACHE) ALL_CACHE = WORDS.slice();
    return ALL_CACHE;
  }
  function wordEntry(w) { return WORD_MAP[w]; }

  function getBooks() { return BUILTIN_BOOKS.slice(); }

  function bookOf(id) {
    var all = getBooks();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function bookWords(id) {
    var b = bookOf(id);
    if (!b) return allWords();
    if (b._words) return b._words.slice();
    return WORDS.filter(b.filter);
  }

  /* ---------------- 学习记录存储（按账户隔离） ---------------- */
  function defaultStore() {
    return {
      words: {},                                  // word -> { s:见过次数, c:答对次数, w:答错次数, streak:连续答对 }
      wrongList: [],                              // 错题本中的单词
      daily: { date: '', studied: 0, correct: 0 },// 今日练习
      streakDays: 0,                              // 连续打卡天数
      dailyGoal: 20,                              // 每日目标（可设置，次）
      lastStudyDate: '',
      autoTts: true,                              // 卡片自动发音
    };
  }
  var store = defaultStore();
  var currentUser = null;

  function progressKey() { return 'cetbase:progress:' + currentUser; }

  function loadStore() {
    store = defaultStore();
    try {
      var raw = localStorage.getItem(progressKey());
      if (raw) store = Object.assign(defaultStore(), JSON.parse(raw));
    } catch (e) { store = defaultStore(); }
    delete store.customBooks;   // 「我的词书」功能已下线，清理旧数据
  }

  function saveStore() {
    if (!currentUser) return;
    try { localStorage.setItem(progressKey(), JSON.stringify(store)); } catch (e) { /* 隐私模式等场景忽略 */ }
  }
  function ensureDaily() {
    var t = dateStr();
    if (store.daily.date !== t) store.daily = { date: t, studied: 0, correct: 0 };
  }
  function recordStudied(isCorrect) {
    ensureDaily();
    store.daily.studied++;
    if (isCorrect) store.daily.correct++;
    var t = dateStr();
    if (store.lastStudyDate !== t) {
      var y = new Date(); y.setDate(y.getDate() - 1);
      store.streakDays = (store.lastStudyDate === dateStr(y)) ? store.streakDays + 1 : 1;
      store.lastStudyDate = t;
    }
    saveStore();
  }

  function wstat(w) { return store.words[w] || (store.words[w] = { s: 0, c: 0, w: 0, streak: 0 }); }
  function statusOf(word) {
    var st = store.words[word];
    if (!st || st.s === 0) return 'new';
    return st.streak >= MASTER_STREAK ? 'mastered' : 'learning';
  }
  function removeWrong(w) {
    store.wrongList = store.wrongList.filter(function (x) { return x !== w; });
  }
  function markCorrect(word) {
    var st = wstat(word.w);
    st.s++; st.c++; st.streak++;
    if (st.streak >= MASTER_STREAK) removeWrong(word.w);
  }
  function markWrong(word) {
    var st = wstat(word.w);
    st.s++; st.w++; st.streak = 0;
    if (store.wrongList.indexOf(word.w) < 0) store.wrongList.push(word.w);
  }

  function scopeWords(scopeId) {
    if (scopeId === 'smart') {
      return allWords().filter(function (x) {
        var st = store.words[x.w];
        return st && st.s > 0 && st.streak < MASTER_STREAK;
      }).sort(function (a, b) {
        var sa = store.words[a.w], sb = store.words[b.w];
        return (sb.w - sa.w) || (sb.s - sa.s);
      });
    }
    if (scopeId === 'wrong') {
      var set = {};
      store.wrongList.forEach(function (w) { set[w] = 1; });
      return allWords().filter(function (x) { return set[x.w]; });
    }
    if (bookOf(scopeId)) return bookWords(scopeId);
    return allWords();
  }
  function bookStats(bookId) {
    var list = bookWords(bookId);
    var learned = 0, mastered = 0;
    list.forEach(function (x) {
      var s = statusOf(x.w);
      if (s !== 'new') learned++;
      if (s === 'mastered') mastered++;
    });
    return { total: list.length, learned: learned, mastered: mastered };
  }

  /* ---------------- 语音朗读 (Web Speech API) ---------------- */
  function speak(word) {
    try {
      if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音朗读'); return; }
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US'; u.rate = 0.85;
      var vs = window.speechSynthesis.getVoices();
      var v = vs.filter(function (x) { return /en[-_]US/i.test(x.lang); })[0] ||
              vs.filter(function (x) { return /^en/i.test(x.lang); })[0];
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices(); // 触发浏览器提前加载音色列表
  }

  /* ---------------- 账户系统（仅存本地，无任何验证） ---------------- */
  function pwHash(pw) {
    var str = 'cetbase#' + pw, h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8) + str.length.toString(16);
  }
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch (e) { return {}; }
  }
  function setUsers(u) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (e) {}
  }

  function renderAuth(mode) {
    document.body.classList.add('logged-out');
    var root = $('#authRoot');
    root.classList.remove('hidden');
    root.innerHTML =
      '<div class="auth-mask">' +
        '<div class="auth-deco" aria-hidden="true">' + decoArt() + '</div>' +
        '<div class="auth-card">' +
          '<div class="auth-logo"><span>LearnFor<i class="logo-cet">CET</i></span></div>' +
          '<div class="auth-tabs">' +
            '<button class="auth-tab' + (mode === 'login' ? ' active' : '') + '" data-auth="login">登录</button>' +
            '<button class="auth-tab' + (mode === 'reg' ? ' active' : '') + '" data-auth="reg">注册</button>' +
          '</div>' +
          '<form id="authForm">' +
            '<input class="auth-input" id="authUser" placeholder="用户名" maxlength="20" autocomplete="username">' +
            '<input class="auth-input" id="authPass" type="password" placeholder="密码" autocomplete="current-password">' +
            '<div class="auth-err" id="authErr"></div>' +
            '<button type="submit" class="btn btn-primary auth-submit">' + (mode === 'reg' ? '创建账户并进入' : '登 录') + '</button>' +
          '</form>' +
        '</div>' +
      '</div>';

    $$('.auth-tab', root).forEach(function (b) {
      b.addEventListener('click', function () { renderAuth(b.dataset.auth); });
    });
    // 切换账户：聚焦并全选用户名，方便直接输入另一个账户
    try {
      if (sessionStorage.getItem('cetbase:switch') === '1') {
        sessionStorage.removeItem('cetbase:switch');
        setTimeout(function () {
          var u = $('#authUser');
          if (u) { u.focus(); u.select(); }
        }, 60);
      }
    } catch (e) {}
    $('#authForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = ($('#authUser').value || '').trim();
      var pw = $('#authPass').value || '';
      var err = $('#authErr');
      err.textContent = '';
      if (!name || !pw) { err.textContent = '用户名和密码都要填哦'; return; }
      if (/[:\s]/.test(name)) { err.textContent = '用户名不能包含空格或冒号'; return; }

      /* 在线模式：账户存在服务器，任意设备可登录 */
      if (LFAPI.available) {
        var btn = $('.auth-submit');
        btn.disabled = true;
        var done = function (r) {
          btn.disabled = false;
          if (!r.ok) { err.textContent = r.error || '操作失败，请重试'; return; }
          currentUser = LFAPI.user.username;
          loadStore();
          enterApp();
        };
        if (mode === 'reg') {
          if (pw.length < 6) { err.textContent = '公网模式密码至少 6 位'; return; }
          LFAPI.register(name, pw).then(done);
        } else {
          LFAPI.login(name, pw).then(done);
        }
        return;
      }

      /* 本机模式 */
      var key = name.toLowerCase();           // 账户名不区分大小写，统一以小写为键
      var users = getUsers();
      if (mode === 'reg') {
        if (users[key]) { err.textContent = '这个用户名已经被注册了，换一个吧'; return; }
        users[key] = { h: pwHash(pw), created: dateStr(), name: name };
        setUsers(users);
        var back = getUsers()[key];           // 回读校验，防止存储失败导致“假注册”
        if (!back) { delete users[key]; setUsers(users); err.textContent = '注册失败：浏览器存储不可用（是否隐私模式？）'; return; }
        doLogin(key, pw, true);
      } else {
        var u = users[key];
        if (!u) {
          var names = Object.keys(users).map(function (k) { return users[k].name || k; });
          err.textContent = '用户名不存在。' +
            (names.length ? '本机此地址已注册：' + names.join('、') : '本机此地址下还没有任何账户。') +
            '账户按「浏览器 + 访问地址」保存，换浏览器或换地址（如 file:// 与 localhost）需重新注册。';
          return;
        }
        if (u.h !== pwHash(pw)) { err.textContent = '密码不对，再想想'; return; }
        doLogin(key, pw, true);
      }
    });
    setTimeout(function () { $('#authUser').focus(); }, 50);
  }

  function doLogin(name, pw, okPw) {
    currentUser = name;
    try { localStorage.setItem(CURRENT_KEY, name); } catch (e) {}
    loadStore();
    enterApp();
  }

  function displayName() {
    if (LFAPI.available) return (LFAPI.user && LFAPI.user.display_name) || currentUser || '同学';
    var u = getUsers()[currentUser];
    return (u && u.name) || currentUser || '同学';
  }

  function enterApp() {
    document.body.classList.remove('logged-out');
    $('#authRoot').classList.add('hidden');
    // 顶栏：在线模式显示头像（点击进个人中心），本机模式显示文字
    var friendsNav = $('.nav-btn[data-view="friends"]');
    if (friendsNav) friendsNav.classList.toggle('hidden', !LFAPI.available);
    var chip = $('#userChip');
    var avHtml;
    if (LFAPI.available && LFAPI.user) {
      avHtml = LFAPI.user.avatar
        ? '<img class="chip-avatar" src="' + esc(LFAPI.user.avatar) + '" alt="">'
        : '<span class="chip-avatar chip-avatar-text">' + esc((displayName()[0] || 'U').toUpperCase()) + '</span>';
    } else {
      avHtml = ICONS.userIco;
    }
    chip.innerHTML = avHtml + '<span>' + esc(displayName()) + '</span>' +
      '<svg class="chip-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    chip.dataset.action = 'account-menu';
    chip.classList.add('clickable');
    ensureDaily();
    saveStore();
    $('#footTotal').textContent = allWords().length;
    switchView('dashboard');
  }

  /* ---------------- toast ---------------- */
  function toast(msg) {
    var root = $('#toastRoot');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  /* ---------------- UI 状态 ---------------- */
  var ui = {
    view: 'dashboard',
    bank: { q: '', book: 'LFCET6', limit: 60 },
    study: { mode: 'setup', scope: 'all' },
    quiz: { state: 'setup', scope: 'LFCET6', mode: 'e2c' },
    spell: { state: 'setup', scope: 'LFCET6' },
    lookup: { tab: 'dict', q: '', res: null, tl: 'zh-CN', trans: '' },
    friends: { active: null, lastId: 0, msgs: [], data: null, q: '', results: [] }
  };

  var appEl = $('#app');

  function badgeLevel(lv) {
    var m = LEVEL_META[lv] || { label: lv, cls: '' };
    return '<span class="badge ' + m.cls + '">' + esc(m.label) + '</span>';
  }
  function badgeStatus(word) {
    var s = statusOf(word);
    var map = { new: ['st-new', '未学习'], learning: ['st-learning', '学习中'], mastered: ['st-mastered', '已掌握'] };
    return '<span class="badge ' + map[s][0] + '">' + map[s][1] + '</span>';
  }

  /* 兼容新旧数据格式：exs 数组（新）或 ex 字符串（旧），返回 [{s, c?}] */
  function examplesOf(x) {
    if (Array.isArray(x.exs)) return x.exs;
    if (x.ex) return [{ s: x.ex, c: x.exc }];
    return [];
  }
  /* 例句 HTML（最多 2 条），真题带来源标注并高亮目标词（含屈折形式），有翻译则追加一行 */
  var reCache = {};
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function wordRe(w) {
    if (reCache[w]) return reCache[w];
    var lower = w.toLowerCase();
    var forms = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'ly']);
    if (lower.endsWith('e')) forms.add(w.slice(0, -1) + 'ing');            // come → coming
    if (lower.endsWith('y')) { forms.add(w.slice(0, -1) + 'ies'); forms.add(w.slice(0, -1) + 'ied'); } // study → studies
    if (/[a-z][^aeiou]$/.test(lower)) forms.add(w + lower.slice(-1) + 'ing'); // run → running
    var arr = Array.from(forms).sort(function (a, b) { return b.length - a.length; });
    reCache[w] = new RegExp('\\b(?:' + arr.map(escRe).join('|') + ')\\b', 'gi');
    return reCache[w];
  }
  function highlightWord(sentence, w) {
    var re = wordRe(w);
    var out = '', last = 0, m;
    while ((m = re.exec(sentence))) {
      out += esc(sentence.slice(last, m.index)) + '<span class="hl">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(sentence.slice(last));
  }
  function examplesHtml(x) {
    return examplesOf(x).slice(0, 2).map(function (e) {
      return '<div class="fc-ex"><span class="ex-tag">真题</span>' + highlightWord(e.s, x.w) +
             (e.src ? '<span class="ex-src">' + esc(e.src) + '</span>' : '') +
             (e.c ? '<span class="exc">' + esc(e.c) + '</span>' : '') + '</div>';
    }).join('');
  }
  /* 释义可能很长（词汇表原样），紧凑场景取第一义项 */
  function shortCn(x) {
    var s = (x.cn || '').split(/；|;|\bn\.|\bvi\.|\bvt\./)[0].trim();
    if (s.length > 16) s = s.slice(0, 16) + '…';
    return s;
  }
  /* 首条例句 + 来源 + 高亮（测验/拼写反馈用） */
  function firstExampleLine(x) {
    var e = examplesOf(x)[0];
    if (!e) return '例句：（近年真题未出现）';
    return '例句：' + highlightWord(e.s, x.w) + (e.src ? '（' + esc(e.src) + '）' : '');
  }

  /* ============================================================
     首页仪表盘
     ============================================================ */
  // 内联 SVG 线性图标（stroke=currentColor，禁止 emoji 作功能图标）
  var SVG_ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var ICONS = {
    library: '<svg ' + SVG_ATTR + '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    bookOpen: '<svg ' + SVG_ATTR + '><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    trophy: '<svg ' + SVG_ATTR + '><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>',
    circleX: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
    layers: '<svg ' + SVG_ATTR + '><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>',
    checkCircle: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    pen: '<svg ' + SVG_ATTR + '><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    refresh: '<svg ' + SVG_ATTR + '><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
    flame: '<svg ' + SVG_ATTR + '><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    calendar: '<svg ' + SVG_ATTR + '><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    play: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/></svg>',
    volume: '<svg ' + SVG_ATTR + '><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    searchX: '<svg ' + SVG_ATTR + '><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="m8 8 6 6"/><path d="m14 8-6 6"/></svg>',
    lightbulb: '<svg ' + SVG_ATTR + '><path d="M15 14c.2-1 .7-1.7 1.5-2.5A7 7 0 1 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
    thumbsUp: '<svg ' + SVG_ATTR + '><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
    sparkles: '<svg ' + SVG_ATTR + '><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
    smile: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>',
    circleHelp: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    frown: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>',
    fileText: '<svg ' + SVG_ATTR + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    check: '<svg ' + SVG_ATTR + '><path d="M20 6 9 17l-5-5"/></svg>',
    xClose: '<svg ' + SVG_ATTR + '><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    languages: '<svg ' + SVG_ATTR + '><path d="m5 8 6 6"/><path d="m4 14 6-6 2 2"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
    quote: '<svg ' + SVG_ATTR + '><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
    target: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    globe: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    chat: '<svg ' + SVG_ATTR + '><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>',
    userIco: '<svg ' + SVG_ATTR + '><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    contrast: '<svg ' + SVG_ATTR + '><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z" fill="currentColor" stroke="none"/></svg>',
    externalLink: '<svg ' + SVG_ATTR + '><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    settings: '<svg ' + SVG_ATTR + '><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    logout: '<svg ' + SVG_ATTR + '><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>'
  };


  // 每日励志语录（按当年第几天轮换）
  var QUOTES = [
    { en: 'The limits of my language mean the limits of my world.', cn: '语言的边界，就是世界的边界。', by: '维特根斯坦' },
    { en: 'Little by little, one travels far.', cn: '积跬步，方能至千里。', by: '西方谚语' },
    { en: 'Practice does not make perfect. Only perfect practice makes perfect.', cn: '并非练习成就完美，只有完美的练习才能成就完美。', by: 'Vince Lombardi' },
    { en: 'A different language is a different vision of life.', cn: '多一门语言，就多一种看待人生的视角。', by: '费里尼' },
    { en: 'It always seems impossible until it is done.', cn: '在做成之前，一切看起来都不可能。', by: '曼德拉' },
    { en: 'The expert in anything was once a beginner.', cn: '任何领域的专家都曾是初学者。', by: '海伦·海耶斯' },
    { en: 'Words are, of course, the most powerful drug used by mankind.', cn: '词语是人类所用最强大的良药。', by: '吉卜林' },
    { en: 'Genius is one percent inspiration and ninety-nine percent perspiration.', cn: '天才是百分之一的灵感加百分之九十九的汗水。', by: '爱迪生' },
    { en: 'Do not fear going slowly; fear only standing still.', cn: '不怕慢，就怕站。', by: '中国谚语' },
    { en: 'To have another language is to possess a second soul.', cn: '掌握另一门语言，就像拥有第二个灵魂。', by: '查理曼大帝' },
    { en: 'Fall seven times, stand up eight.', cn: '跌倒七次，站起来八次。', by: '日本谚语' },
    { en: 'The beautiful thing about learning is no one can take it away from you.', cn: '学习最美妙之处，在于无人能将它从你身上夺走。', by: 'B.B. King' },
    { en: 'Success is the sum of small efforts repeated day in and day out.', cn: '成功是日复一日微小努力的总和。', by: '罗伯特·科利尔' },
    { en: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', cn: '如明天将死般生活，如永远不死般学习。', by: '甘地' },
    { en: 'A journey of a thousand miles begins with a single step.', cn: '千里之行，始于足下。', by: '老子' },
    { en: 'You do not have to be great to start, but you have to start to be great.', cn: '不必等到强大才开始，开始了才会强大。', by: 'Zig Ziglar' },
    { en: 'Knowledge is a treasure, but practice is the key to it.', cn: '知识是宝库，实践是开启它的钥匙。', by: '托马斯·富勒' },
    { en: 'The harder you work for something, the greater you feel when you achieve it.', cn: '为一件事付出的努力越多，实现时的成就感就越强。', by: '谚语' },
    { en: 'Doubt kills more dreams than failure ever will.', cn: '扼杀梦想的从来不是失败，而是怀疑。', by: 'Suzy Kassem' },
    { en: 'Reading is to the mind what exercise is to the body.', cn: '阅读之于头脑，如同锻炼之于身体。', by: '爱迪生' },
    { en: 'Word by word, the world widens.', cn: '一词一句，世界渐宽。', by: 'learnforCET' },
    { en: 'Perseverance is not a long race; it is many short races one after another.', cn: '坚持不是一场长跑，而是一场接一场的短跑。', by: 'Walter Elliot' },
    { en: 'Learn something new every day, and forget less every night.', cn: '每天学一点新东西，每晚就少忘记一点。', by: '谚语' },
    { en: 'Nothing great was ever achieved without enthusiasm.', cn: '没有热情，成不了大事。', by: '爱默生' },
    { en: 'The best time to plant a tree was twenty years ago. The second best time is now.', cn: '种一棵树最好的时间是二十年前，其次是现在。', by: '谚语' },
    { en: 'Small daily improvements are the key to staggering long-term results.', cn: '每天进步一点点，长期结果会惊人。', by: 'Robin Sharma' },
    { en: 'Language is the road map of a culture.', cn: '语言是文化的地图。', by: 'Rita Mae Brown' },
    { en: 'Keep your eyes on the stars, and your feet on the ground.', cn: '仰望星空，脚踏实地。', by: '西奥多·罗斯福' }
  ];
  function quoteOfToday() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    var day = Math.floor((now - start) / 86400000);
    return QUOTES[day % QUOTES.length];
  }
  function dailyGoal() { return store.dailyGoal || 20; }

  // 果冻字母 + 几何小装饰（纯装饰，CSS 模拟通透亚克力材质）
  function decoArt() {
    return '<span class="deco-page"></span><span class="deco-page deco-page-2"></span>' +
      '<span class="deco-line deco-line-1"></span><span class="deco-line deco-line-2"></span>' +
      '<span class="orb orb-1"></span><span class="orb orb-2"></span><span class="orb orb-3"></span>' +
      '<span class="jelly jelly-a" data-l="A">A</span>' +
      '<span class="jelly jelly-b" data-l="B">B</span>' +
      '<span class="jelly jelly-c" data-l="C">C</span>';
  }

  // 省份 → 城市（地址选项）
  var PROVINCES = {
    '北京': ['北京市'], '上海': ['上海市'], '天津': ['天津市'], '重庆': ['重庆市'],
    '广东': ['广州', '深圳', '珠海', '汕头', '佛山', '东莞', '中山', '惠州', '其他'],
    '江苏': ['南京', '苏州', '无锡', '常州', '南通', '徐州', '扬州', '其他'],
    '浙江': ['杭州', '宁波', '温州', '嘉兴', '绍兴', '金华', '其他'],
    '四川': ['成都', '绵阳', '德阳', '宜宾', '南充', '其他'],
    '湖北': ['武汉', '宜昌', '襄阳', '荆州', '黄石', '其他'],
    '湖南': ['长沙', '株洲', '湘潭', '衡阳', '岳阳', '其他'],
    '山东': ['济南', '青岛', '烟台', '潍坊', '临沂', '淄博', '其他'],
    '河南': ['郑州', '洛阳', '开封', '新乡', '南阳', '其他'],
    '河北': ['石家庄', '唐山', '保定', '秦皇岛', '廊坊', '其他'],
    '陕西': ['西安', '咸阳', '宝鸡', '渭南', '延安', '其他'],
    '福建': ['福州', '厦门', '泉州', '漳州', '其他'],
    '安徽': ['合肥', '芜湖', '蚌埠', '安庆', '其他'],
    '江西': ['南昌', '赣州', '九江', '上饶', '其他'],
    '辽宁': ['沈阳', '大连', '鞍山', '抚顺', '其他'],
    '吉林': ['长春', '吉林市', '四平', '延边', '其他'],
    '黑龙江': ['哈尔滨', '齐齐哈尔', '大庆', '其他'],
    '山西': ['太原', '大同', '临汾', '其他'],
    '云南': ['昆明', '大理', '丽江', '曲靖', '其他'],
    '贵州': ['贵阳', '遵义', '六盘水', '其他'],
    '广西': ['南宁', '桂林', '柳州', '北海', '其他'],
    '海南': ['海口', '三亚', '其他'],
    '甘肃': ['兰州', '天水', '敦煌', '其他'],
    '内蒙古': ['呼和浩特', '包头', '鄂尔多斯', '其他'],
    '新疆': ['乌鲁木齐', '喀什', '伊犁', '其他'],
    '西藏': ['拉萨', '其他'],
    '宁夏': ['银川', '其他'],
    '青海': ['西宁', '其他'],
    '香港': ['香港'], '澳门': ['澳门'], '台湾': ['台北', '高雄', '台南', '其他'],
    '海外': ['其他']
  };

  function renderDashboard() {
    ensureDaily(); saveStore();
    var total = allWords().length, learned = 0, mastered = 0;
    allWords().forEach(function (x) {
      var s = statusOf(x.w);
      if (s !== 'new') learned++;
      if (s === 'mastered') mastered++;
    });
    var wrongN = store.wrongList.length;
    var studied = store.daily.studied;
    var goal = dailyGoal();
    var goalPct = Math.min(100, pct(studied, goal));
    var now = new Date();
    var wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    var dateStr = (now.getMonth() + 1) + '月' + now.getDate() + '日 · 周' + wd;
    var RING_C = 2 * Math.PI * 54;
    var quote = quoteOfToday();

    var levelRows = getBooks().map(function (b) {
      var st = bookStats(b.id);
      var p = pct(st.mastered, st.total);
      return '<div class="lp-row">' +
        '<div class="lp-name"><span>' + esc(b.label) + '</span><span class="lp-desc">' + esc(b.desc) + '</span></div>' +
        '<div class="lp-bar" role="progressbar" aria-label="' + esc(b.label) + ' 已掌握 ' + p + '%" aria-valuenow="' + p + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + p + '%;background:' + b.bar + '"></div></div>' +
        '<div class="lp-num"><b>' + st.mastered + '</b>/' + st.total + ' 已掌握 · ' + p + '%</div></div>';
    }).join('');

    var tiles = [
      { v: 'study', ico: 'layers', cls: 'ico-violet', tit: '学单词', sub: '卡片翻面 · 真题例句' },
      { v: 'quiz', ico: 'checkCircle', cls: 'ico-teal', tit: '每日测验', sub: QUIZ_COUNT + ' 道选择题' },
      { v: 'spell', ico: 'pen', cls: 'ico-amber', tit: '拼写练习', sub: '听音默写巩固记忆' },
      { v: 'wrong', ico: 'circleX', cls: 'ico-red', tit: '错题本', sub: wrongN ? wrongN + ' 个单词待复习' : '暂无错题，保持住' }
    ].map(function (t) {
      return '<button class="quick-tile" data-action="nav" data-view="' + t.v + '" aria-label="' + t.tit + '">' +
        '<span class="quick-ico ' + t.cls + '">' + ICONS[t.ico] + '</span>' +
        '<span class="q-tit">' + t.tit + '</span>' +
        '<span class="q-sub">' + t.sub + '</span></button>';
    }).join('');

    var goalText = goalPct >= 100
      ? '今日目标已达成，超额练习 ' + (studied - goal) + ' 次'
      : '距离今日目标还差 <b>' + (goal - studied) + '</b> 次练习';

    $('#view-dashboard').innerHTML =
      '<div class="hero card">' +
        '<div class="hero-main">' +
          '<div class="hero-meta">' +
            '<span class="hero-chip">' + ICONS.calendar + esc(dateStr) + '</span>' +
            '<span class="hero-chip">' + ICONS.flame + '连续打卡 ' + (store.streakDays || 0) + ' 天</span>' +
          '</div>' +
          '<h1>你好，' + esc(displayName()) + '</h1>' +
          '<p class="hero-sub">今天已练习 <b>' + studied + '</b> 次 · 已学习 <b>' + learned + '</b> 词 · ' + goalText + '</p>' +
          '<div class="hero-actions">' +
            '<button class="btn btn-solid" data-action="nav" data-view="study">' + ICONS.play + '开始学习</button>' +
            '<button class="btn" data-action="quick-smart">' + ICONS.refresh + '智能复习</button>' +
          '</div>' +
        '</div>' +
        '<div class="hero-art" aria-hidden="true">' + decoArt() + '</div>' +
        '<button class="goal-ring" data-action="goal-edit" title="设置每日目标" aria-label="今日目标完成 ' + goalPct + '%，已完成 ' + studied + ' / ' + goal + ' 次，点击设置目标">' +
          '<svg viewBox="0 0 132 132" aria-hidden="true">' +
            '<circle class="track" cx="66" cy="66" r="54"/>' +
            '<circle class="arc" cx="66" cy="66" r="54" stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="' + (RING_C * (1 - goalPct / 100)).toFixed(1) + '"/>' +
          '</svg>' +
          '<span class="ring-text"><span class="ring-pct">' + goalPct + '<small>%</small></span><span class="ring-sub">今日 ' + studied + '/' + goal + '</span></span>' +
        '</button>' +
      '</div>' +
      '<div class="card quote-card">' +
        '<span class="quote-ico">' + ICONS.quote + '</span>' +
        '<div class="quote-body">' +
          '<div class="quote-en">“' + esc(quote.en) + '”</div>' +
          '<div class="quote-cn">' + esc(quote.cn) + '<span class="quote-by">—— ' + esc(quote.by) + '</span></div>' +
        '</div>' +
        '<span class="quote-tag">每日一句</span>' +
      '</div>' +
      '<div class="quick-grid">' + tiles + '</div>' +
      '<div class="stat-grid">' +
        '<div class="card stat-card"><div class="stat-ico ico-violet">' + ICONS.library + '</div><div><div class="num">' + total + '</div><div class="lbl">词库总量</div></div></div>' +
        '<div class="card stat-card"><div class="stat-ico ico-amber">' + ICONS.bookOpen + '</div><div><div class="num">' + learned + '</div><div class="lbl">已学习</div></div></div>' +
        '<div class="card stat-card"><div class="stat-ico ico-teal">' + ICONS.trophy + '</div><div><div class="num">' + mastered + '</div><div class="lbl">已掌握</div></div></div>' +
        '<div class="card stat-card"><div class="stat-ico ico-red">' + ICONS.circleX + '</div><div><div class="num">' + wrongN + '</div><div class="lbl">错题本</div></div></div>' +
      '</div>' +
      '<h2 class="section-title">词书进度</h2>' +
      '<div class="card level-progress">' + levelRows + '</div>';
  }

  /* ============================================================
     查词 / 翻译
     ============================================================ */
  function dictLinksHtml(word) {
    var w = encodeURIComponent(word);
    var links = [
      ['必应词典', 'https://cn.bing.com/dict/search?q=' + w],
      ['有道词典', 'https://dict.youdao.com/result?word=' + w + '&lang=en'],
      ['剑桥词典', 'https://dictionary.cambridge.org/search/direct/?dataset=english-chinese-simplified&q=' + w],
      ['韦氏词典', 'https://www.merriam-webster.com/dictionary/' + w],
      ['朗文词典', 'https://www.ldoceonline.com/dictionary/' + w],
      ['谷歌翻译', 'https://translate.google.com/?sl=auto&tl=zh-CN&text=' + w + '&op=translate']
    ];
    return '<div class="dict-links"><span class="dict-lbl">' + ICONS.externalLink + '权威词典：</span>' +
      links.map(function (l) {
        return '<a class="dict-link" href="' + l[1] + '" target="_blank" rel="noopener">' + l[0] + '</a>';
      }).join('') + '</div>';
  }

  function lookupSearch(q) {
    q = (q || '').trim().toLowerCase();
    ui.lookup.q = q;
    if (!q) { ui.lookup.res = null; renderLookup(); return; }
    var pool = allWords();
    var exact = [], prefix = [], incl = [];
    pool.forEach(function (x) {
      var w = x.w.toLowerCase();
      if (w === q) exact.push(x);
      else if (w.indexOf(q) === 0) prefix.push(x);
      else if (w.indexOf(q) >= 0 || x.cn.toLowerCase().indexOf(q) >= 0) incl.push(x);
    });
    ui.lookup.res = exact.concat(prefix).concat(incl).slice(0, 12);
    renderLookup();
  }

  function renderLookup() {
    var lk = ui.lookup;
    var isDict = lk.tab === 'dict';

    var dictHtml =
      '<div class="lookup-bar">' +
        '<input class="search-input" id="lookupInput" placeholder="输入英文单词查词库、音标、释义与真题例句…" value="' + esc(lk.q) + '">' +
        '<button class="btn btn-primary" data-action="lookup-go">查词</button>' +
      '</div>';

    if (isDict) {
      var body;
      if (!lk.q) {
        body = '<div class="card empty"><div class="e-ico">' + ICONS.languages + '</div>' +
          '<div class="e-tit">查词库 ' + allWords().length + ' 词 + 跳转权威词典</div>' +
          '<div class="e-sub">先在本站词库检索（含真题例句），没有的词一键跳转必应 / 有道 / 剑桥 / 韦氏 / 朗文</div></div>';
      } else if (!lk.res || !lk.res.length) {
        body = '<div class="card empty"><div class="e-ico">' + ICONS.searchX + '</div>' +
          '<div class="e-tit">词库里没有「' + esc(lk.q) + '」</div>' +
          '<div class="e-sub">可以跳转权威词典查看详细释义</div>' + dictLinksHtml(lk.q) + '</div>';
      } else {
        body = '<div class="lookup-count">在本站词库找到 ' + lk.res.length + ' 个匹配' +
          (lk.res.length >= 12 ? '（仅显示前 12 个）' : '') + '</div>' +
          lk.res.map(function (x) {
            return '<div class="card lookup-word">' +
              '<div class="lw-head">' +
                '<span class="lw-word">' + esc(x.w) + '</span>' +
                '<span class="word-ph">' + esc(x.p) + '</span>' +
                '<button class="tts-btn" data-action="tts" data-word="' + esc(x.w) + '" title="朗读">' + ICONS.volume + '</button>' +
                badgeLevel(x.lv) +
              '</div>' +
              '<div class="lw-cn">' + esc(x.pos ? x.pos + ' ' : '') + esc(x.cn) + (x.en ? '<span class="lw-en"> · ' + esc(x.en) + '</span>' : '') + '</div>' +
              (examplesOf(x)[0] ? '<div class="lw-ex">' + firstExampleLine(x) + '</div>' : '') +
              '<div class="lw-row-open"><button class="btn btn-ghost btn-sm" data-action="row-open" data-word="' + esc(x.w) + '">查看全部例句</button></div>' +
              dictLinksHtml(x.w) +
            '</div>';
          }).join('');
      }
      dictHtml += body;
    } else {
      var t = (lk.trans || '').trim();
      var tl = lk.tl === 'zh-CN' ? 'zh-CN' : 'en';
      var gurl = 'https://translate.google.com/?sl=auto&tl=' + tl + '&text=' + encodeURIComponent(t) + '&op=translate';
      var durl = 'https://www.deepl.com/translator#auto/' + (tl === 'zh-CN' ? 'zh' : 'en') + '/' + encodeURIComponent(t);
      dictHtml +=
        '<div class="card translate-card">' +
          '<div class="tr-row"><label>翻译方向</label>' +
            '<div class="chips">' +
              '<button class="chip' + (tl === 'zh-CN' ? ' active' : '') + '" data-action="lookup-tl" data-tl="zh-CN">英 / 中 → 中文</button>' +
              '<button class="chip' + (tl === 'en' ? ' active' : '') + '" data-action="lookup-tl" data-tl="en">中 / 英 → 英文</button>' +
            '</div></div>' +
          '<textarea class="import-paste tr-text" id="trInput" placeholder="粘贴或输入要翻译的单词、句子或段落…">' + esc(lk.trans) + '</textarea>' +
          '<div class="tr-actions">' +
            '<a class="btn btn-primary" id="trGoogle" href="' + gurl + '" target="_blank" rel="noopener"' + (t ? '' : ' onclick="return false"') + '>' + ICONS.languages + 'Google 翻译打开</a>' +
            '<a class="btn btn-ghost" id="trDeep" href="' + durl + '" target="_blank" rel="noopener"' + (t ? '' : ' onclick="return false"') + '>DeepL 打开</a>' +
          '</div>' +
          '<p class="tr-tip">点击按钮会在新标签页打开翻译网站，文本已自动带入；翻译结果以权威词典与翻译引擎为准。</p>' +
        '</div>';
    }

    $('#view-lookup').innerHTML =
      '<div class="setup-head"><div><h2>查词 · 翻译</h2><div class="sub">本地词库秒查 + 权威词典一键跳转 + 划词翻译</div></div></div>' +
      '<div class="chips lookup-tabs">' +
        '<button class="chip' + (isDict ? ' active' : '') + '" data-action="lookup-tab" data-tab="dict">' + ICONS.bookOpen + '查词</button>' +
        '<button class="chip' + (!isDict ? ' active' : '') + '" data-action="lookup-tab" data-tab="trans">' + ICONS.languages + '翻译</button>' +
      '</div>' +
      dictHtml;

    var input = $('#lookupInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); lookupSearch(input.value); }
      });
      if (!lk.q) input.focus();
    }
    var tr = $('#trInput');
    if (tr) tr.addEventListener('input', function () {
      ui.lookup.trans = tr.value;
      var t = tr.value.trim();
      var tl = ui.lookup.tl === 'zh-CN' ? 'zh-CN' : 'en';
      var g = $('#trGoogle'), d = $('#trDeep');
      if (g) {
        g.href = 'https://translate.google.com/?sl=auto&tl=' + tl + '&text=' + encodeURIComponent(t) + '&op=translate';
        g.classList.toggle('disabled-link', !t);
        g.onclick = t ? null : function () { return false; };
      }
      if (d) {
        d.href = 'https://www.deepl.com/translator#auto/' + (tl === 'zh-CN' ? 'zh' : 'en') + '/' + encodeURIComponent(t);
        d.classList.toggle('disabled-link', !t);
        d.onclick = t ? null : function () { return false; };
      }
    });
  }

  /* ============================================================
     词库浏览
     ============================================================ */
  function renderBank() {
    var b = ui.bank;
    var chips = getBooks().map(function (bk) {
      return '<button class="chip' + (b.book === bk.id ? ' active' : '') + '" data-action="bank-chip" data-lv="' + bk.id + '">' +
        esc(bk.label) + '（' + bookStats(bk.id).total + '）</button>';
    }).join('');

    $('#view-bank').innerHTML =
      '<div class="card bank-tools">' +
        '<input class="search-input" id="bankSearch" placeholder="搜索单词、释义或例句…" value="' + esc(b.q) + '">' +
        '<div class="chips">' + chips + '</div>' +
      '</div>' +
      '<div id="bankList"></div>';

    renderBankList();
    var input = $('#bankSearch');
    input.addEventListener('input', function () {
      ui.bank.q = input.value;
      renderBankList();
    });
  }

  function bankFiltered() {
    var b = ui.bank;
    var q = b.q.trim().toLowerCase();
    var pool = bookWords(b.book);
    return pool.filter(function (x) {
      if (!q) return true;
      if (x.w.toLowerCase().indexOf(q) >= 0 || x.cn.toLowerCase().indexOf(q) >= 0) return true;
      if (x.en && x.en.toLowerCase().indexOf(q) >= 0) return true;
      return examplesOf(x).some(function (e) { return e.s.toLowerCase().indexOf(q) >= 0; });
    });
  }

  function renderBankList() {
    var b = ui.bank;
    var list = bankFiltered();
    var shown = list.slice(0, b.limit);
    if (!list.length) {
      $('#bankList').innerHTML = '<div class="card empty"><div class="e-ico">' + ICONS.searchX + '</div><div class="e-tit">没有找到匹配的单词</div><div class="e-sub">换个关键词试试</div></div>';
      return;
    }
    var rows = shown.map(function (x) {
      return '<div class="word-row" data-action="row-open" data-word="' + esc(x.w) + '">' +
        '<button class="tts-btn" data-action="tts" data-word="' + esc(x.w) + '" title="朗读">' + ICONS.volume + '</button>' +
        '<div class="word-en-wrap"><span class="word-en">' + esc(x.w) + '</span><span class="word-ph">' + esc(x.p) + '</span></div>' +
        '<div class="word-cn">' + esc(x.pos) + ' ' + esc(x.cn) + '</div>' +
        badgeLevel(x.lv) + badgeStatus(x.w) +
      '</div>';
    }).join('');
    $('#bankList').innerHTML =
      '<div class="card word-list">' +
        '<div class="list-count">共 ' + list.length + ' 个单词' + (list.length > shown.length ? '，当前显示前 ' + shown.length + ' 个' : '') + '</div>' +
        rows +
        (list.length > shown.length ? '<button class="list-more" data-action="bank-more">显示更多 ↓</button>' : '') +
      '</div>';
  }

  /* ============================================================
     学单词（卡片模式）
     ============================================================ */
  function renderStudy() {
    if (ui.study.mode === 'setup') renderStudySetup();
    else if (ui.study.mode === 'card') renderStudyCard();
    else renderStudyDone();
  }

  function renderStudySetup() {
    var cards = getBooks().map(function (bk) {
      var st = bookStats(bk.id);
      var p = pct(st.mastered, st.total);
      return '<button class="card scope-card" data-action="study-scope" data-scope="' + bk.id + '">' +
        '<h3>' + ICONS.library + esc(bk.label) + '</h3>' +
        '<div class="sc-sub">' + esc(bk.desc) + ' · ' + st.total + ' 词</div>' +
        '<div class="sc-bar"><div style="width:' + p + '%;background:' + bk.bar + '"></div></div>' +
        '<div class="sc-foot">已掌握 ' + st.mastered + ' · 已学 ' + st.learned + ' · 未学 ' + (st.total - st.learned) + '</div>' +
      '</button>';
    }).join('');

    var smartN = scopeWords('smart').length;
    var wrongN = scopeWords('wrong').length;

    $('#view-study').innerHTML =
      '<div class="setup-head"><div><h2>学单词</h2><div class="sub">选择一本词书开始卡片学习 · 翻转卡片后标记记忆情况</div></div></div>' +
      '<div class="scope-grid">' + cards +
        '<button class="card scope-card special" data-action="study-scope" data-scope="smart">' +
          '<h3>' + ICONS.refresh + '智能复习</h3><div class="sc-sub">优先复习答错多、还没掌握的词</div>' +
          '<div class="sc-foot">当前 ' + smartN + ' 个待复习</div>' +
        '</button>' +
        '<button class="card scope-card special" data-action="study-scope" data-scope="wrong">' +
          '<h3>' + ICONS.circleX + '错题本复习</h3><div class="sc-sub">逐个过一遍最近做错的词</div>' +
          '<div class="sc-foot">当前 ' + wrongN + ' 个单词</div>' +
        '</button>' +
      '</div>';
  }

  function startStudy(scopeId) {
    var deck = shuffle(scopeWords(scopeId));
    if (!deck.length) {
      toast(scopeId === 'wrong' ? '错题本是空的，先去做几道题吧' : '这个范围暂时没有需要学习的单词');
      return;
    }
    ui.study = { mode: 'card', scope: scopeId, deck: deck, i: 0, flipped: false, stats: { known: 0, fuzzy: 0, unknown: 0 } };
    renderStudyCard();
  }

  function markButtonsHtml() {
    return '<button class="mark-btn mk-known" data-action="study-mark" data-kind="known">' + ICONS.smile + '认识</button>' +
           '<button class="mark-btn mk-fuzzy" data-action="study-mark" data-kind="fuzzy">' + ICONS.circleHelp + '模糊</button>' +
           '<button class="mark-btn mk-unknown" data-action="study-mark" data-kind="unknown">' + ICONS.frown + '不认识</button>';
  }

  function renderStudyCard() {
    var st = ui.study;
    if (st.i >= st.deck.length) { renderStudyDone(); return; }
    var x = st.deck[st.i];
    var m = LEVEL_META[x.lv];
    var p = pct(st.i, st.deck.length);

    $('#view-study').innerHTML =
      '<div class="study-top">' +
        '<button class="btn btn-ghost btn-sm" data-action="study-exit">← 退出</button>' +
        '<span class="progress-text">第 ' + (st.i + 1) + ' / ' + st.deck.length + ' 张</span>' +
        '<span class="spacer"></span>' +
        '<label class="chk"><input type="checkbox" id="autoTts"' + (store.autoTts ? ' checked' : '') + '> 自动发音</label>' +
      '</div>' +
      '<div class="session-bar"><div style="width:' + p + '%"></div></div>' +
      '<div class="flashcard' + (st.flipped ? ' flipped' : '') + '" id="flashcard" data-action="flip">' +
        '<div class="flashcard-inner">' +
          '<div class="face face-front">' +
            '<div class="fc-level">' + badgeLevel(x.lv) + '</div>' +
            '<div class="fc-word">' + esc(x.w) + '</div>' +
            '<div class="fc-ph">' + esc(x.p) + ' <span class="tts-inline" data-action="tts" data-word="' + esc(x.w) + '" style="cursor:pointer">' + ICONS.volume + '</span></div>' +
            '<div class="fc-hint">点击卡片或按 <span class="kbd">空格</span> 查看释义</div>' +
          '</div>' +
          '<div class="face face-back">' +
            '<div class="fc-level">' + badgeLevel(x.lv) + ' ' + badgeStatus(x.w) + '</div>' +
            '<div class="fc-pos">' + esc(x.pos) + '</div>' +
            '<div class="fc-cn">' + esc(x.cn) + '</div>' +
            (x.en ? '<div class="fc-en">' + esc(x.en) + '</div>' : '') +
            examplesHtml(x) +
            '<div class="fc-hint">' + esc(x.w) + ' ' + esc(x.p) + ' <span class="tts-inline" data-action="tts" data-word="' + esc(x.w) + '" style="cursor:pointer">' + ICONS.volume + ' 再听一次</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="study-actions" id="studyActions">' +
        (st.flipped ? markButtonsHtml() :
          '<span class="mark-hint">快捷键：<span class="kbd">空格</span> 翻面 · <span class="kbd">←</span> 不认识 · <span class="kbd">↓</span> 模糊 · <span class="kbd">→</span> 认识</span>') +
      '</div>';

    var chk = $('#autoTts');
    chk.addEventListener('change', function () { store.autoTts = chk.checked; saveStore(); });
    if (store.autoTts) setTimeout(function () { speak(x.w); }, 200);
  }

  function flipCard() {
    var st = ui.study;
    if (st.mode !== 'card') return;
    var el = $('#flashcard');
    if (!el) return;
    st.flipped = !st.flipped;
    el.classList.toggle('flipped', st.flipped);
    $('#studyActions').innerHTML = st.flipped
      ? markButtonsHtml()
      : '<span class="mark-hint">点击卡片查看释义</span>';
  }

  function studyMark(kind) {
    var st = ui.study;
    if (st.mode !== 'card' || st.i >= st.deck.length) return;
    var x = st.deck[st.i];
    var stat = wstat(x.w);
    if (kind === 'known') { markCorrect(x); st.stats.known++; recordStudied(true); }
    else if (kind === 'unknown') { markWrong(x); st.stats.unknown++; recordStudied(false); }
    else { stat.s++; st.stats.fuzzy++; st.deck.push(x); recordStudied(false); }
    saveStore();
    st.i++; st.flipped = false;
    renderStudyCard();
  }

  function renderStudyDone() {
    var st = ui.study;
    var total = st.stats.known + st.stats.fuzzy + st.stats.unknown;
    var acc = pct(st.stats.known, total);
    var nb = bookOf(st.scope);
    var name = st.scope === 'smart' ? '智能复习' : st.scope === 'wrong' ? '错题本复习' :
               (nb ? nb.label + ' 词书' : '全部词库');
    $('#view-study').innerHTML =
      '<div class="card result-card">' +
        '<div class="result-ico">' + (acc >= 80 ? ICONS.sparkles : acc >= 50 ? ICONS.thumbsUp : ICONS.bookOpen) + '</div>' +
        '<div class="result-sub" style="margin-top:6px">' + esc(name) + ' · 本轮完成</div>' +
        '<div class="result-score">' + st.stats.known + ' / ' + total + '</div>' +
        '<div class="result-sub">认识 ' + st.stats.known + ' · 模糊 ' + st.stats.fuzzy + ' · 不认识 ' + st.stats.unknown + ' · 记忆率 ' + acc + '%</div>' +
        '<div class="result-actions">' +
          '<button class="btn btn-primary" data-action="study-again">再来一轮</button>' +
          '<button class="btn btn-ghost" data-action="study-back">返回选择</button>' +
        '</div>' +
      '</div>';
    ui.study.mode = 'done';
  }

  /* ============================================================
     测验（选择题）
     ============================================================ */
  function renderQuiz() {
    if (ui.quiz.state === 'setup') renderQuizSetup();
    else if (ui.quiz.state === 'run') renderQuizQ();
    else renderQuizDone();
  }

  function renderQuizSetup() {
    var chipHtml = getBooks().map(function (bk) {
      return '<button class="chip' + (ui.quiz.scope === bk.id ? ' active' : '') + '" data-action="quiz-chip" data-lv="' + bk.id + '">' +
        esc(bk.label) + '（' + bookStats(bk.id).total + '）</button>';
    }).join('');
    var wrongN = scopeWords('wrong').length;
    if (wrongN >= 4) {
      chipHtml += '<button class="chip' + (ui.quiz.scope === 'wrong' ? ' active' : '') + '" data-action="quiz-chip" data-lv="wrong">错题本 (' + wrongN + ')</button>';
    }

    $('#view-quiz').innerHTML =
      '<div class="setup-head"><div><h2>选择题测验</h2><div class="sub">每轮 ' + QUIZ_COUNT + ' 题 · 答错的词自动进入错题本</div></div></div>' +
      '<div class="card" style="padding:20px 22px">' +
        '<div style="font-weight:600;margin-bottom:10px">① 选择范围</div>' +
        '<div class="chips">' + chipHtml + '</div>' +
        '<div style="font-weight:600;margin:18px 0 10px">② 选择题型</div>' +
        '<div class="mode-row">' +
          '<button class="mode-card' + (ui.quiz.mode === 'e2c' ? ' active' : '') + '" data-action="quiz-mode" data-mode="e2c"><b>EN → 中文 · 英译中</b><span>看英文单词，选出正确中文释义</span></button>' +
          '<button class="mode-card' + (ui.quiz.mode === 'c2e' ? ' active' : '') + '" data-action="quiz-mode" data-mode="c2e"><b>中文 → EN · 中译英</b><span>看中文释义，选出正确英文单词</span></button>' +
        '</div>' +
        '<button class="btn btn-primary" data-action="quiz-start">开始测验</button>' +
      '</div>';
  }

  function optText(x, mode) { return mode === 'e2c' ? shortCn(x) : x.w; }

  function pickDistractors(correct, mode, n, pool) {
    pool = (pool && pool.length >= 8) ? pool : WORDS;
    var out = [];
    var seen = {};
    seen[optText(correct, mode)] = 1;
    var pools = [
      shuffle(pool.filter(function (x) { return x.lv === correct.lv && x.w !== correct.w; })),
      shuffle(pool),
      shuffle(WORDS)
    ];
    for (var p = 0; p < pools.length && out.length < n; p++) {
      var pl = pools[p];
      for (var i = 0; i < pl.length && out.length < n; i++) {
        var v = optText(pl[i], mode);
        if (!seen[v]) { seen[v] = 1; out.push(v); }
      }
    }
    return out;
  }

  function startQuiz() {
    var pool = scopeWords(ui.quiz.scope);
    if (pool.length < 4) { toast('该词书的单词数量太少，无法出题（至少 4 词）'); return; }
    var picks = shuffle(pool).slice(0, QUIZ_COUNT);
    var mode = ui.quiz.mode;
    var qs = picks.map(function (x) {
      var options = shuffle([optText(x, mode)].concat(pickDistractors(x, mode, 3, pool)));
      return { word: x, options: options };
    });
    ui.quiz = { state: 'run', scope: ui.quiz.scope, mode: mode, qs: qs, i: 0, correct: 0, wrongWords: [], answered: false, picked: '' };
    renderQuizQ();
  }

  function renderQuizQ() {
    var q = ui.quiz;
    if (q.i >= q.qs.length) { renderQuizDone(); return; }
    var item = q.qs[q.i];
    var x = item.word;
    var isE2C = q.mode === 'e2c';

    var prompt = isE2C
      ? '<div class="q-prompt">' + esc(x.w) + '</div><div class="q-prompt-sub">' + esc(x.p) + ' · <span class="tts-inline" data-action="tts" data-word="' + esc(x.w) + '">' + ICONS.volume + ' 点击朗读</span></div>'
      : '<div class="q-prompt" style="font-size:24px">' + esc(x.pos) + ' ' + esc(x.cn) + '</div><div class="q-prompt-sub">选出对应的英文单词</div>';

    var opts = item.options.map(function (o, idx) {
      return '<button class="opt-btn" data-action="quiz-opt" data-val="' + esc(o) + '">' +
        '<span class="opt-idx">' + (idx + 1) + '</span><span>' + esc(o) + '</span></button>';
    }).join('');

    $('#view-quiz').innerHTML =
      '<div class="study-top">' +
        '<button class="btn btn-ghost btn-sm" data-action="quiz-exit">← 退出</button>' +
        '<span class="progress-text">第 ' + (q.i + 1) + ' / ' + q.qs.length + ' 题 · 已答对 ' + q.correct + '</span>' +
      '</div>' +
      '<div class="session-bar"><div style="width:' + pct(q.i, q.qs.length) + '%"></div></div>' +
      '<div class="card q-card">' +
        '<div class="q-progress">' + (isE2C ? '英译中' : '中译英') + '</div>' +
        prompt +
        '<div class="opt-grid">' + opts + '</div>' +
        '<div id="quizExplain"></div>' +
      '</div>';
  }

  function quizAnswer(val) {
    var q = ui.quiz;
    if (q.state !== 'run' || q.answered) return;
    var item = q.qs[q.i];
    var x = item.word;
    var correctVal = optText(x, q.mode);
    var isRight = val === correctVal;
    q.answered = true; q.picked = val;
    if (isRight) { markCorrect(x); q.correct++; recordStudied(true); }
    else { markWrong(x); q.wrongWords.push(x); recordStudied(false); }
    saveStore();

    $$('#view-quiz .opt-btn').forEach(function (btn) {
      btn.disabled = true;
      var v = btn.dataset.val;
      if (v === correctVal) btn.classList.add('correct');
      else if (v === q.picked) btn.classList.add('wrong');
      else btn.classList.add('dim');
    });

    $('#quizExplain').innerHTML =
      '<div class="q-explain"><b>' + esc(x.w) + '</b> ' + esc(x.p) +
      ' <span class="tts-inline" data-action="tts" data-word="' + esc(x.w) + '" style="color:var(--brand);cursor:pointer;font-weight:600">' + ICONS.volume + '</span><br>' +
      esc(x.pos) + ' ' + esc(x.cn) + (x.en ? ' —— ' + esc(x.en) : '') + '<br>' +
      '<span style="color:var(--text-3)">' + firstExampleLine(x) + '</span></div>' +
      '<div class="q-next-row"><button class="btn btn-primary" data-action="quiz-next">' + (q.i + 1 >= q.qs.length ? '查看结果' : '下一题 →') + '</button></div>';
  }

  function renderQuizDone() {
    var q = ui.quiz;
    var acc = pct(q.correct, q.qs.length);
    var wrongHtml = q.wrongWords.length
      ? '<div class="wrong-summary"><h4>本轮答错的单词：</h4>' +
        q.wrongWords.map(function (x) {
          return '<div class="ws-row"><b>' + esc(x.w) + '</b><span>' + esc(x.p) + ' ' + esc(x.pos) + ' ' + esc(x.cn) + '</span>' +
                 '<button class="tts-btn" style="margin-left:auto" data-action="tts" data-word="' + esc(x.w) + '">' + ICONS.volume + '</button></div>';
        }).join('') + '</div>'
      : '';
    $('#view-quiz').innerHTML =
      '<div class="card result-card">' +
        '<div class="result-ico">' + (acc >= 80 ? ICONS.trophy : acc >= 60 ? ICONS.thumbsUp : ICONS.flame) + '</div>' +
        '<div class="result-score">' + q.correct + ' / ' + q.qs.length + '</div>' +
        '<div class="result-sub">正确率 ' + acc + '% · 答错的词已加入错题本</div>' +
        wrongHtml +
        '<div class="result-actions">' +
          '<button class="btn btn-primary" data-action="quiz-again">再来一轮</button>' +
          '<button class="btn btn-ghost" data-action="quiz-back">返回设置</button>' +
        '</div>' +
      '</div>';
    ui.quiz.state = 'done';
  }

  /* ============================================================
     拼写练习
     ============================================================ */
  function renderSpell() {
    if (ui.spell.state === 'setup') renderSpellSetup();
    else if (ui.spell.state === 'run') renderSpellQ();
    else renderSpellDone();
  }

  function renderSpellSetup() {
    var chipHtml = getBooks().map(function (bk) {
      return '<button class="chip' + (ui.spell.scope === bk.id ? ' active' : '') + '" data-action="spell-chip" data-lv="' + bk.id + '">' +
        esc(bk.label) + '（' + bookStats(bk.id).total + '）</button>';
    }).join('');

    $('#view-spell').innerHTML =
      '<div class="setup-head"><div><h2>拼写练习</h2><div class="sub">根据中文释义拼写出英文单词 · 每轮 ' + QUIZ_COUNT + ' 词</div></div></div>' +
      '<div class="card" style="padding:20px 22px">' +
        '<div style="font-weight:600;margin-bottom:10px">选择范围</div>' +
        '<div class="chips">' + chipHtml + '</div>' +
        '<div style="margin-top:18px"><button class="btn btn-primary" data-action="spell-start">开始拼写</button></div>' +
      '</div>';
  }

  function startSpell() {
    var pool = scopeWords(ui.spell.scope);
    if (!pool.length) { toast('该范围没有可练习的单词'); return; }
    var picks = shuffle(pool).slice(0, QUIZ_COUNT);
    ui.spell = { state: 'run', scope: ui.spell.scope, qs: picks, i: 0, correct: 0, wrongWords: [], hint: false, checked: false };
    renderSpellQ();
  }

  function renderSpellQ() {
    var sp = ui.spell;
    if (sp.i >= sp.qs.length) { renderSpellDone(); return; }
    var x = sp.qs[sp.i];

    var hintHtml = sp.hint && !sp.checked
      ? '<div class="spell-hint-line">提示：' + esc(x.w[0]) + ' ' + x.w.slice(1).replace(/[a-zA-Z]/g, '_ ').trim() + '（共 ' + x.w.length + ' 个字母）</div>'
      : '';

    var feedback = '';
    if (sp.checked) {
      feedback = sp.lastRight
        ? '<div class="spell-feedback ok">' + ICONS.check + '拼写正确！' + esc(x.w) + ' ' + esc(x.p) + '</div>'
        : '<div class="spell-feedback no">' + ICONS.xClose + '正确答案：<b>' + esc(x.w) + '</b> ' + esc(x.p) +
          (examplesOf(x)[0] ? '<br><span style="color:var(--text-3)">' + firstExampleLine(x) + '</span>' : '') + '</div>';
    }

    $('#view-spell').innerHTML =
      '<div class="study-top">' +
        '<button class="btn btn-ghost btn-sm" data-action="spell-exit">← 退出</button>' +
        '<span class="progress-text">第 ' + (sp.i + 1) + ' / ' + sp.qs.length + ' 词 · 已拼对 ' + sp.correct + '</span>' +
      '</div>' +
      '<div class="session-bar"><div style="width:' + pct(sp.i, sp.qs.length) + '%"></div></div>' +
      '<div class="card q-card">' +
        '<div class="q-progress">根据释义拼写单词</div>' +
        '<div class="q-prompt" style="font-size:23px">' + esc(x.pos) + ' ' + esc(x.cn) + '</div>' +
        '<div class="q-prompt-sub">' + (x.en ? esc(x.en) : '&nbsp;') + '</div>' +
        hintHtml +
        '<form class="spell-form" id="spellForm">' +
          '<input class="spell-input" id="spellInput" placeholder="输入英文单词…" autocomplete="off" autocapitalize="off" spellcheck="false"' + (sp.checked ? ' disabled' : '') + '>' +
          (sp.checked
            ? '<button type="button" class="btn btn-primary" data-action="spell-next">' + (sp.i + 1 >= sp.qs.length ? '查看结果' : '下一个 →') + '</button>'
            : '<button type="submit" class="btn btn-primary">检查</button>') +
        '</form>' +
        '<div style="margin-top:12px">' +
          (sp.checked
            ? '<button class="tts-btn" data-action="tts" data-word="' + esc(x.w) + '">' + ICONS.volume + ' 听发音</button>'
            : '<button class="btn btn-ghost btn-sm" data-action="spell-hint">' + ICONS.lightbulb + '首字母提示</button>') +
        '</div>' +
        feedback +
      '</div>';

    var form = $('#spellForm');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); spellCheck(); });
    var input = $('#spellInput');
    if (input) {
      // 显式监听回车，避免浏览器隐式提交失效的情况
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); spellCheck(); }
      });
      if (sp.checked) { input.classList.add(sp.lastRight ? 'ok' : 'no'); input.value = sp.lastVal || ''; }
      else input.focus();
    }
    if (sp.checked) speak(x.w);
  }

  function spellCheck() {
    var sp = ui.spell;
    if (sp.state !== 'run' || sp.checked) return;
    var x = sp.qs[sp.i];
    var input = $('#spellInput');
    var val = (input.value || '').trim();
    if (!val) { toast('先输入你的答案哦'); return; }
    var right = val.toLowerCase() === x.w.toLowerCase();
    sp.checked = true;
    sp.lastRight = right;
    sp.lastVal = val;
    if (right) { markCorrect(x); sp.correct++; recordStudied(true); }
    else { markWrong(x); sp.wrongWords.push(x); recordStudied(false); }
    saveStore();
    renderSpellQ();
  }

  function renderSpellDone() {
    var sp = ui.spell;
    var acc = pct(sp.correct, sp.qs.length);
    var wrongHtml = sp.wrongWords.length
      ? '<div class="wrong-summary"><h4>本轮拼错的单词：</h4>' +
        sp.wrongWords.map(function (x) {
          return '<div class="ws-row"><b>' + esc(x.w) + '</b><span>' + esc(x.p) + ' ' + esc(x.cn) + '</span></div>';
        }).join('') + '</div>'
      : '';
    $('#view-spell').innerHTML =
      '<div class="card result-card">' +
        '<div class="result-ico">' + ICONS.pen + '</div>' +
        '<div class="result-score">' + sp.correct + ' / ' + sp.qs.length + '</div>' +
        '<div class="result-sub">拼写正确率 ' + acc + '% · 拼错的词已加入错题本</div>' +
        wrongHtml +
        '<div class="result-actions">' +
          '<button class="btn btn-primary" data-action="spell-again">再来一轮</button>' +
          '<button class="btn btn-ghost" data-action="spell-back">返回设置</button>' +
        '</div>' +
      '</div>';
    ui.spell.state = 'done';
  }

  /* ============================================================
     错题本
     ============================================================ */
  function renderWrong() {
    var list = store.wrongList.map(function (w) { return wordEntry(w); }).filter(Boolean);
    if (!list.length) {
      $('#view-wrong').innerHTML =
        '<div class="card empty"><div class="e-ico">' + ICONS.sparkles + '</div><div class="e-tit">错题本是空的</div>' +
        '<div class="e-sub">测验、拼写中答错或不认识的单词会自动收集到这里</div>' +
        '<button class="btn btn-primary" data-action="nav" data-view="quiz">去做几道题</button></div>';
      return;
    }
    var rows = list.map(function (x) {
      return '<div class="word-row" data-action="row-open" data-word="' + esc(x.w) + '">' +
        '<button class="tts-btn" data-action="tts" data-word="' + esc(x.w) + '">' + ICONS.volume + '</button>' +
        '<div class="word-en-wrap"><span class="word-en">' + esc(x.w) + '</span><span class="word-ph">' + esc(x.p) + '</span></div>' +
        '<div class="word-cn">' + esc(x.pos) + ' ' + esc(x.cn) + '</div>' +
        badgeLevel(x.lv) +
        '<button class="remove-btn" data-action="wrong-remove" data-word="' + esc(x.w) + '">已掌握，移除</button>' +
      '</div>';
    }).join('');
    $('#view-wrong').innerHTML =
      '<div class="wrong-head"><div><h2>错题本</h2><div class="sub">共 ' + list.length + ' 个单词待消灭</div></div>' +
      '<button class="btn btn-primary" data-action="wrong-review">开始复习</button></div>' +
      '<div class="card word-list">' + rows + '</div>';
  }

  /* ============================================================
     个人中心（在线模式：头像 / 签名 / 地址 / 改密码）
     ============================================================ */
  function cropAvatar(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var s = Math.min(img.width, img.height);
        var c = document.createElement('canvas');
        c.width = c.height = 128;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
        cb(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function renderProfile() {
    var root = $('#view-profile');
    if (!LFAPI.available || !LFAPI.user) {
      root.innerHTML = '<div class="card empty"><div class="e-ico">' + ICONS.globe + '</div><div class="e-tit">个人中心需要在线模式</div>' +
        '<div class="e-sub">网站部署到服务器后可用（Cloudflare Workers），本机离线模式暂不支持头像、签名等资料功能</div></div>';
      return;
    }
    var u = LFAPI.user;
    var addrParts = (u.address || '').split(' · ');
    var prov = addrParts[0] || '';
    var city = addrParts[1] || '';
    if (!PROVINCES[prov]) { prov = ''; city = ''; }
    var av = u.avatar
      ? '<img class="profile-avatar" src="' + esc(u.avatar) + '" alt="头像">'
      : '<span class="profile-avatar chip-avatar-text">' + esc((displayName()[0] || 'U').toUpperCase()) + '</span>';
    root.innerHTML =
      '<div class="setup-head"><div><h2>个人中心</h2><div class="sub">用户名 @' + esc(u.username) + ' · 注册于 ' + esc(new Date(u.created_at).toLocaleDateString()) + '</div></div></div>' +
      '<div class="card profile-card">' +
        '<div class="profile-avatar-row">' + av +
          '<label class="btn btn-ghost btn-sm">更换头像<input type="file" id="avatarFile" accept="image/*" hidden></label>' +
        '</div>' +
        '<div class="pf-field"><label>昵称</label><input class="auth-input" id="pfName" value="' + esc(u.display_name || '') + '" maxlength="24"></div>' +
        '<div class="pf-field"><label>签名</label><input class="auth-input" id="pfBio" value="' + esc(u.bio || '') + '" placeholder="一句话介绍自己" maxlength="100"></div>' +
        '<div class="pf-field"><label>地址</label>' +
          '<div class="pf-addr-row">' +
            '<select class="auth-input" id="pfProv"><option value="">选择省份</option>' +
              Object.keys(PROVINCES).map(function (p) { return '<option value="' + esc(p) + '"' + (p === prov ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
            '</select>' +
            '<select class="auth-input" id="pfCity"><option value="">选择城市</option></select>' +
            '<input type="hidden" id="pfAddr" value="' + esc(u.address || '') + '">' +
          '</div></div>' +
        '<button class="btn btn-primary" data-action="profile-save">保存资料</button>' +
      '</div>' +
      '<div class="card profile-card" style="margin-top:14px">' +
        '<div class="pf-goal-row"><label>' + ICONS.target + '每日学习目标</label>' +
          '<select class="auth-input pf-goal-select" id="pfGoal">' +
            [5, 10, 15, 20, 30, 40, 50, 80, 100].map(function (n) {
              return '<option value="' + n + '"' + (n === dailyGoal() ? ' selected' : '') + '>' + n + ' 次' + (n === 20 ? '（推荐）' : '') + '</option>';
            }).join('') +
          '</select></div>' +
        '<p class="sub" style="margin-top:8px">目标影响首页进度环与每日完成度，按当前账户在本机保存。</p>' +
      '</div>' +
      '<div class="card profile-card" style="margin-top:14px">' +
        '<div class="pf-field"><label>原密码</label><input class="auth-input" id="pwOld" type="password"></div>' +
        '<div class="pf-field"><label>新密码（至少 6 位）</label><input class="auth-input" id="pwNew" type="password"></div>' +
        '<button class="btn btn-ghost" data-action="profile-passwd">修改密码</button>' +
      '</div>';

    var provSel = $('#pfProv'), citySel = $('#pfCity'), addrInput = $('#pfAddr');
    function fillCities(provName, selCity) {
      var cities = PROVINCES[provName] || [];
      citySel.innerHTML = '<option value="">选择城市</option>' + cities.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === selCity ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
    }
    function syncAddr() {
      var p = provSel.value, c = citySel.value;
      addrInput.value = p && c ? p + ' · ' + c : '';
    }
    fillCities(prov, city);
    provSel.addEventListener('change', function () { fillCities(provSel.value, ''); syncAddr(); });
    citySel.addEventListener('change', syncAddr);
    var goalSel = $('#pfGoal');
    goalSel.addEventListener('change', function () {
      store.dailyGoal = parseInt(goalSel.value, 10) || 20;
      saveStore();
      toast('每日目标已设为 ' + store.dailyGoal + ' 次');
    });

    var avatarInput = $('#avatarFile');
    avatarInput.addEventListener('change', function () {
      var f = avatarInput.files && avatarInput.files[0];
      if (!f) return;
      toast('正在上传头像…');
      cropAvatar(f, function (dataUrl) {
        LFAPI.uploadAvatar(dataUrl).then(function (r) {
          if (!r.ok) { toast(r.error || '头像上传失败'); return; }
          toast('头像已更新');
          enterAppTopbar();
          renderProfile();
        });
      });
    });
  }

  /* ---------------- 账户菜单（头像下拉） ---------------- */
  var acctMenuEl = null;
  function closeAccountMenu() {
    if (acctMenuEl) { acctMenuEl.remove(); acctMenuEl = null; }
    var chip = $('#userChip');
    if (chip) chip.classList.remove('open');
  }
  function openAccountMenu() {
    closeAccountMenu();
    var chip = $('#userChip');
    if (!chip) return;
    var r = chip.getBoundingClientRect();
    acctMenuEl = document.createElement('div');
    acctMenuEl.className = 'acct-menu';
    acctMenuEl.style.top = (r.bottom + 9) + 'px';
    acctMenuEl.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    acctMenuEl.innerHTML =
      '<div class="acct-head"><div class="acct-name">' + esc(displayName()) + '</div>' +
      (LFAPI.available
        ? '<div class="acct-sub">@' + esc(LFAPI.user ? LFAPI.user.username : '') + ' · 在线账户</div>'
        : '<div class="acct-sub">本机账户</div>') + '</div>' +
      (LFAPI.available ? '<button class="acct-item" data-action="account-profile">' + ICONS.userIco + '个人中心</button>' : '') +
      '<button class="acct-item" data-action="account-switch">' + ICONS.refresh + '切换账户</button>' +
      '<button class="acct-item acct-danger" data-action="account-logout">' + ICONS.logout + '退出登录</button>';
    document.body.appendChild(acctMenuEl);
    chip.classList.add('open');
  }

  function enterAppTopbar() {
    var chip = $('#userChip');
    if (chip && LFAPI.available && LFAPI.user) {
      var av = LFAPI.user.avatar
        ? '<img class="chip-avatar" src="' + esc(LFAPI.user.avatar) + '" alt="">'
        : '<span class="chip-avatar chip-avatar-text">' + esc((displayName()[0] || 'U').toUpperCase()) + '</span>';
      chip.innerHTML = av + '<span>' + esc(displayName()) + '</span>';
    }
  }

  /* ============================================================
     好友 + 聊天（在线模式）
     ============================================================ */
  var chatTimer = null;
  function stopChatPoll() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } }
  function seenKey(name) { return 'cetbase:seen:' + (currentUser || '') + ':' + name.toLowerCase(); }
  function getSeen(name) { try { return parseInt(localStorage.getItem(seenKey(name)) || '0', 10) || 0; } catch (e) { return 0; } }
  function setSeen(name, id) { try { localStorage.setItem(seenKey(name), String(id)); } catch (e) {} }

  function renderFriends() {
    var root = $('#view-friends');
    if (!LFAPI.available) {
      root.innerHTML = '<div class="card empty"><div class="e-ico">' + ICONS.chat + '</div><div class="e-tit">好友功能需要在线模式</div>' +
        '<div class="e-sub">部署到 Cloudflare 后，可以搜索用户、加好友、在线聊天</div></div>';
      return;
    }
    root.innerHTML = '<div class="card" style="padding:30px;text-align:center">加载中…</div>';
    refreshFriends();
  }

  function refreshFriends() {
    LFAPI.friends().then(function (r) {
      if (!r.ok) { $('#view-friends').innerHTML = '<div class="card empty"><div class="e-ico">' + ICONS.circleX + '</div><div class="e-tit">' + esc(r.error || '加载失败') + '</div></div>'; return; }
      ui.friends.data = r.data;
      drawFriends();
    });
  }

  function drawFriends() {
    var d = ui.friends.data || { friends: [], requests_in: [], requests_out: [] };
    var root = $('#view-friends');

    var reqHtml = d.requests_in.map(function (q) {
      return '<div class="fr-row"><b>' + esc(q.display_name || q.username) + '</b><span style="color:var(--text-3)">@' + esc(q.username) + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary btn-sm" data-action="friend-accept" data-id="' + q.id + '">接受</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="friend-reject" data-id="' + q.id + '">拒绝</button></div>';
    }).join('');

    var friendHtml = d.friends.map(function (f) {
      var unread = (f.last_id || 0) > getSeen(f.username) && f.last_from !== null && f.last_from !== undefined && f.last_from !== myId();
      return '<div class="fr-row friend-item" data-action="chat-open" data-name="' + esc(f.username) + '">' +
        (f.avatar ? '<img class="chip-avatar" src="' + esc(f.avatar) + '">' : '<span class="chip-avatar chip-avatar-text">' + esc((f.display_name || f.username)[0].toUpperCase()) + '</span>') +
        '<div class="fr-main"><b>' + esc(f.display_name || f.username) + '</b>' +
        '<span class="fr-last">' + esc((f.last_text || '开始聊天吧').slice(0, 24)) + '</span></div>' +
        (unread ? '<span class="unread-dot">新</span>' : '') +
        '</div>';
    }).join('');

    var outHtml = d.requests_out.length
      ? '<div class="fr-note">已发出申请：' + d.requests_out.map(function (q) { return '@' + esc(q.username); }).join('、') + '</div>' : '';

    root.innerHTML =
      '<div class="setup-head"><div><h2>好友</h2><div class="sub">搜索用户名或昵称，加好友开始聊天</div></div></div>' +
      '<div class="friends-layout">' +
        '<div class="friends-side">' +
          '<div class="card" style="padding:14px 16px">' +
            '<input class="search-input" id="frSearch" placeholder="搜索用户名…" value="' + esc(ui.friends.q) + '">' +
            '<div id="frResults" class="fr-results">' + (ui.friends.results || []).map(function (u) {
              var isFriend = d.friends.some(function (f) { return f.username === u.username; });
              var isOut = d.requests_out.some(function (q) { return q.username === u.username; });
              return '<div class="fr-row"><b>' + esc(u.display_name || u.username) + '</b><span style="color:var(--text-3)">@' + esc(u.username) + '</span>' +
                '<span class="spacer"></span>' + (isFriend ? '<span class="badge st-mastered">好友</span>' :
                  isOut ? '<span class="badge st-new">已申请</span>' :
                  '<button class="btn btn-ghost btn-sm" data-action="friend-add" data-name="' + esc(u.username) + '">+ 好友</button>') + '</div>';
            }).join('') + '</div>' +
          '</div>' +
          (reqHtml ? '<div class="card" style="padding:14px 16px;margin-top:12px"><div class="fr-title">好友申请</div>' + reqHtml + '</div>' : '') +
          '<div class="card" style="padding:14px 16px;margin-top:12px"><div class="fr-title">我的好友（' + d.friends.length + '）</div>' +
            (friendHtml || '<div class="fr-note">还没有好友，先搜索添加一个吧</div>') + outHtml + '</div>' +
        '</div>' +
        '<div class="friends-chat" id="chatPane">' + (ui.friends.active ? '' : '<div class="chat-empty">' + ICONS.chat + '<span>选择一位好友开始聊天</span></div>') + '</div>' +
      '</div>';

    var search = $('#frSearch');
    search.addEventListener('input', function () {
      ui.friends.q = search.value;
      var q = search.value.trim();
      if (!q) { ui.friends.results = []; var el = $('#frResults'); if (el) el.innerHTML = ''; return; }
      LFAPI.searchUsers(q).then(function (rr) {
        if (!rr.ok) return;
        ui.friends.results = rr.data.users || [];
        var box = $('#frResults');
        if (!box) return;
        box.innerHTML = ui.friends.results.map(function (u) {
          var isFriend = (ui.friends.data || { friends: [] }).friends.some(function (f) { return f.username === u.username; });
          var isOut = (ui.friends.data || { requests_out: [] }).requests_out.some(function (q2) { return q2.username === u.username; });
          return '<div class="fr-row"><b>' + esc(u.display_name || u.username) + '</b><span style="color:var(--text-3)">@' + esc(u.username) + '</span>' +
            '<span class="spacer"></span>' + (isFriend ? '<span class="badge st-mastered">好友</span>' :
              isOut ? '<span class="badge st-new">已申请</span>' :
              '<button class="btn btn-ghost btn-sm" data-action="friend-add" data-name="' + esc(u.username) + '">+ 好友</button>') + '</div>';
        }).join('');
      });
    });

    if (ui.friends.active) openChatPane();
  }

  function myId() { return LFAPI.user && LFAPI.user.id; }

  function openChatPane() {
    var name = ui.friends.active;
    var pane = $('#chatPane');
    if (!pane) return;
    var f = ((ui.friends.data || {}).friends || []).filter(function (x) { return x.username === name; })[0] || { display_name: name };
    pane.innerHTML =
      '<div class="chat-head">' +
        '<button class="btn btn-ghost btn-sm" data-action="chat-back">←</button>' +
        '<b>' + esc(f.display_name || name) + '</b><span style="color:var(--text-3)">@' + esc(name) + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="remove-btn" data-action="friend-del" data-name="' + esc(name) + '">删除好友</button>' +
      '</div>' +
      '<div class="chat-msgs" id="chatMsgs"></div>' +
      '<form class="chat-form" id="chatForm">' +
        '<input class="chat-input" id="chatInput" placeholder="输入消息，回车发送…" maxlength="500" autocomplete="off">' +
        '<button type="submit" class="btn btn-primary">发送</button>' +
      '</form>';
    $('#chatForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#chatInput');
      var text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      LFAPI.sendChat(name, text).then(function (r) {
        if (!r.ok) { toast(r.error || '发送失败'); return; }
        pollChat();
      });
    });
    drawChatMsgs();
    stopChatPoll();
    chatTimer = setInterval(pollChat, 3000);
  }

  function drawChatMsgs() {
    var box = $('#chatMsgs');
    if (!box) return;
    box.innerHTML = ui.friends.msgs.map(function (m) {
      var mine = m.from_id === myId();
      var t = new Date(m.created_at);
      var hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      return '<div class="msg ' + (mine ? 'mine' : 'theirs') + '"><div class="msg-bubble">' + esc(m.text) + '</div><div class="msg-time">' + hh + '</div></div>';
    }).join('') || '<div class="chat-hint">暂无消息，打个招呼吧</div>';
    box.scrollTop = box.scrollHeight;
  }

  function pollChat() {
    if (!ui.friends.active) return stopChatPoll();
    LFAPI.chatWith(ui.friends.active, ui.friends.lastId).then(function (r) {
      if (!r.ok) return;
      var list = r.data.messages || [];
      if (list.length) {
        ui.friends.msgs = ui.friends.msgs.concat(list);
        ui.friends.lastId = list[list.length - 1].id;
        setSeen(ui.friends.active, ui.friends.lastId);
        drawChatMsgs();
      }
    });
  }

  /* ============================================================
     单词详情弹窗
     ============================================================ */
  function openWordModal(word) {
    var x = wordEntry(word);
    if (!x) return;
    var st = statusOf(x.w);
    $('#modalRoot').innerHTML =
      '<div class="modal-mask" data-action="modal-close">' +
        '<div class="modal" data-stop="1">' +
          '<div class="modal-head"><div class="modal-word">' + esc(x.w) +
            '<button class="tts-btn" data-action="tts" data-word="' + esc(x.w) + '">' + ICONS.volume + '</button></div>' +
            '<button class="close-x" data-action="modal-close">' + ICONS.xClose + '</button></div>' +
          '<div class="modal-ph">' + esc(x.p) + '</div>' +
          '<div class="modal-badges">' + badgeLevel(x.lv) + badgeStatus(x.w) + '</div>' +
          '<div class="modal-sec"><div class="lbl">中文释义</div>' + esc(x.pos ? x.pos + ' ' : '') + esc(x.cn) + '</div>' +
          (x.en ? '<div class="modal-sec"><div class="lbl">英文释义</div>' + esc(x.en) + '</div>' : '') +
          '<div class="modal-sec"><div class="lbl">真题例句</div>' +
            (examplesHtml(x) || '<span style="color:var(--text-3)">该词在收录的近年真题中未出现</span>') +
          '</div>' +
          '<div class="modal-actions">' +
            (st !== 'mastered' ? '<button class="btn btn-primary btn-sm" data-action="modal-master" data-word="' + esc(x.w) + '">标记为已掌握</button>' : '') +
            '<button class="btn btn-ghost btn-sm" data-action="modal-reset" data-word="' + esc(x.w) + '">重置学习记录</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    speak(x.w);
  }

  function closeModal() { $('#modalRoot').innerHTML = ''; }

  /* ============================================================
     视图切换
     ============================================================ */
  var RENDERERS = {
    dashboard: renderDashboard,
    bank: renderBank,
    study: renderStudy,
    quiz: renderQuiz,
    spell: renderSpell,
    wrong: renderWrong,
    lookup: renderLookup,
    profile: renderProfile,
    friends: renderFriends
  };

  function switchView(name) {
    if (ui.view === 'friends' && name !== 'friends') stopChatPoll();
    ui.view = name;
    $$('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    Object.keys(RENDERERS).forEach(function (k) {
      var el = $('#view-' + k);
      if (el) el.classList.toggle('hidden', k !== name);
    });
    RENDERERS[name]();
    window.scrollTo(0, 0);
  }

  function rerender() { RENDERERS[ui.view](); }

  /* ============================================================
     事件与动作
     ============================================================ */
  var ACTIONS = {
    'nav': function (el) { switchView(el.dataset.view); },
    'theme': function () {
      try { localStorage.setItem(THEME_KEY, getTheme() === 'light' ? 'dark' : 'light'); } catch (e) {}
      applyTheme();
    },
    'logout': function () {
      if (LFAPI.available) {
        LFAPI.logout().then(function () { location.reload(); });
        return;
      }
      try { localStorage.removeItem(CURRENT_KEY); } catch (e) {}
      location.reload();
    },

    /* 账户菜单 */
    'account-menu': function () {
      if (acctMenuEl) closeAccountMenu(); else openAccountMenu();
    },
    'account-profile': function () { closeAccountMenu(); switchView('profile'); },
    'account-switch': function () {
      closeAccountMenu();
      try { sessionStorage.setItem('cetbase:switch', '1'); } catch (e) {}
      if (LFAPI.available) {
        LFAPI.logout().then(function () { location.reload(); });
        return;
      }
      try { localStorage.removeItem(CURRENT_KEY); } catch (e) {}
      location.reload();
    },
    'account-logout': function () {
      closeAccountMenu();
      if (LFAPI.available) {
        LFAPI.logout().then(function () { location.reload(); });
        return;
      }
      try { localStorage.removeItem(CURRENT_KEY); } catch (e) {}
      location.reload();
    },
    'quick-smart': function () {
      switchView('study');
      startStudy('smart');
    },

    /* 每日目标设置 */
    'goal-edit': function () {
      var opts = [5, 10, 15, 20, 30, 40, 50, 80, 100];
      var cur = dailyGoal();
      $('#modalRoot').innerHTML =
        '<div class="modal-mask" data-action="modal-close">' +
          '<div class="modal" data-stop="1">' +
            '<div class="modal-head"><div class="modal-word">每日学习目标</div></div>' +
            '<div class="modal-sec"><div class="lbl">目标（每天练习次数）</div>' +
              '<select class="auth-input" id="goalSelect">' +
                opts.map(function (n) {
                  return '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + n + ' 次' + (n === 20 ? '（推荐）' : '') + '</option>';
                }).join('') +
              '</select></div>' +
            '<div class="modal-sec"><div class="lbl">说明</div>目标只影响首页进度环与每日完成度统计，随时可以调整。</div>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-primary btn-sm" data-action="goal-save">保存</button>' +
              '<button class="btn btn-ghost btn-sm" data-action="modal-close">取消</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    },
    'goal-save': function () {
      var v = parseInt($('#goalSelect').value, 10) || 20;
      store.dailyGoal = v;
      saveStore();
      closeModal();
      toast('每日目标已设为 ' + v + ' 次');
      rerender();
    },

    /* 查词 / 翻译 */
    'lookup-go': function () { lookupSearch($('#lookupInput').value); },
    'lookup-tab': function (el) { ui.lookup.tab = el.dataset.tab; renderLookup(); },
    'lookup-tl': function (el) { ui.lookup.tl = el.dataset.tl; renderLookup(); },
    'tts': function (el) { speak(el.dataset.word); },

    /* 词库 */
    'bank-chip': function (el) { ui.bank.book = el.dataset.lv; ui.bank.limit = 60; renderBank(); },
    'bank-more': function () { ui.bank.limit += 60; renderBankList(); },
    'row-open': function (el) { openWordModal(el.dataset.word); },

    /* 学单词 */
    'study-scope': function (el) { startStudy(el.dataset.scope); },
    'flip': function (el, e) {
      if (e && e.target && e.target.closest && e.target.closest('[data-action="tts"]')) return; // 点朗读不翻面
      flipCard();
    },
    'study-mark': function (el) { studyMark(el.dataset.kind); },
    'study-exit': function () { ui.study.mode = 'setup'; renderStudySetup(); },
    'study-again': function () { startStudy(ui.study.scope); },
    'study-back': function () { ui.study.mode = 'setup'; renderStudySetup(); },

    /* 测验 */
    'quiz-chip': function (el) { ui.quiz.scope = el.dataset.lv; renderQuizSetup(); },
    'quiz-mode': function (el) { ui.quiz.mode = el.dataset.mode; renderQuizSetup(); },
    'quiz-start': function () { startQuiz(); },
    'quiz-opt': function (el) { quizAnswer(el.dataset.val); },
    'quiz-next': function () {
      var q = ui.quiz;
      q.answered = false; q.i++;
      q.i >= q.qs.length ? renderQuizDone() : renderQuizQ();
    },
    'quiz-exit': function () { ui.quiz.state = 'setup'; renderQuizSetup(); },
    'quiz-again': function () { startQuiz(); },
    'quiz-back': function () { ui.quiz.state = 'setup'; renderQuizSetup(); },

    /* 拼写 */
    'spell-chip': function (el) { ui.spell.scope = el.dataset.lv; renderSpellSetup(); },
    'spell-start': function () { startSpell(); },
    'spell-hint': function () { ui.spell.hint = true; renderSpellQ(); },
    'spell-next': function () {
      var sp = ui.spell;
      sp.checked = false; sp.hint = false; sp.i++;
      sp.i >= sp.qs.length ? renderSpellDone() : renderSpellQ();
    },
    'spell-exit': function () { ui.spell.state = 'setup'; renderSpellSetup(); },
    'spell-again': function () { startSpell(); },
    'spell-back': function () { ui.spell.state = 'setup'; renderSpellSetup(); },

    /* 错题本 */
    'wrong-remove': function (el) {
      removeWrong(el.dataset.word);
      saveStore();
      toast('已从错题本移除');
      renderWrong();
    },
    'wrong-review': function () { startStudy('wrong'); },

    /* 个人中心 */
    'profile-save': function () {
      LFAPI.saveProfile(($('#pfName').value || '').trim(), ($('#pfBio').value || '').trim(), ($('#pfAddr').value || '').trim())
        .then(function (r) {
          toast(r.ok ? '资料已保存' : (r.error || '保存失败'));
          if (r.ok) { enterAppTopbar(); renderProfile(); }
        });
    },
    'profile-passwd': function () {
      var oldPw = $('#pwOld').value || '', newPw = $('#pwNew').value || '';
      if (newPw.length < 6) { toast('新密码至少 6 位'); return; }
      LFAPI.changePassword(oldPw, newPw).then(function (r) {
        toast(r.ok ? '密码已修改 ✓' : (r.error || '修改失败'));
        if (r.ok) { $('#pwOld').value = ''; $('#pwNew').value = ''; }
      });
    },

    /* 好友 */
    'friend-add': function (el) {
      LFAPI.sendRequest(el.dataset.name).then(function (r) {
        toast(r.ok ? '好友申请已发出' : (r.error || '发送失败'));
        if (r.ok) refreshFriends();
      });
    },
    'friend-accept': function (el) {
      LFAPI.respondRequest(parseInt(el.dataset.id, 10), true).then(function (r) {
        if (!r.ok) toast(r.error || '操作失败');
        refreshFriends();
      });
    },
    'friend-reject': function (el) {
      LFAPI.respondRequest(parseInt(el.dataset.id, 10), false).then(function () { refreshFriends(); });
    },
    'friend-del': function (el) {
      if (!confirm('确定删除这位好友吗？聊天记录将保留在服务器')) return;
      LFAPI.removeFriend(el.dataset.name).then(function (r) {
        if (!r.ok) { toast(r.error || '删除失败'); return; }
        ui.friends.active = null;
        stopChatPoll();
        refreshFriends();
      });
    },
    'chat-open': function (el) {
      ui.friends.active = el.dataset.name;
      ui.friends.lastId = 0;
      ui.friends.msgs = [];
      openChatPane();
      pollChat();
      LFAPI.friends().then(function (r) { if (r.ok) { ui.friends.data = r.data; } });
    },
    'chat-back': function () {
      ui.friends.active = null;
      stopChatPoll();
      drawFriends();
    },

    /* 弹窗 */
    'modal-close': function (el, e) {
      if (e && e.target && e.target.closest && e.target.closest('.modal') && e.type === 'click' && el.classList.contains('modal-mask') && e.target !== el) return;
      closeModal();
    },
    'modal-master': function (el) {
      var st = wstat(el.dataset.word);
      if (st.s === 0) st.s = 1;
      st.streak = MASTER_STREAK;
      removeWrong(el.dataset.word);
      saveStore(); closeModal();
      toast('已标记为「已掌握」');
      rerender();
    },
    'modal-reset': function (el) {
      delete store.words[el.dataset.word];
      removeWrong(el.dataset.word);
      saveStore(); closeModal();
      toast('已重置该词的学习记录');
      rerender();
    }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    var fn = ACTIONS[t.dataset.action];
    if (fn) { e.preventDefault(); fn(t, e); }
  });

  document.addEventListener('click', function (e) {
    if (!acctMenuEl) return;
    if (e.target.closest && (e.target.closest('.acct-menu') || e.target.closest('#userChip'))) return;
    closeAccountMenu();
  });

  /* 点击遮罩关闭弹窗（弹窗本体除外） */
  document.addEventListener('click', function (e) {
    var mask = e.target.classList && e.target.classList.contains('modal-mask') ? e.target : null;
    if (mask) closeModal();
  });

  /* 键盘快捷键 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); closeAccountMenu(); return; }
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (ui.view === 'study' && ui.study.mode === 'card') {
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
      else if (ui.study.flipped) {
        if (e.key === 'ArrowRight') studyMark('known');
        else if (e.key === 'ArrowLeft') studyMark('unknown');
        else if (e.key === 'ArrowDown') studyMark('fuzzy');
      }
    } else if (ui.view === 'quiz' && ui.quiz.state === 'run') {
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) {
        var btn = $$('#view-quiz .opt-btn')[n - 1];
        if (btn && !btn.disabled) btn.click();
      }
    }
  });

  /* ---------------- 主题（全局，不随账户） ---------------- */
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme() {
    var t = getTheme();
    document.documentElement.dataset.theme = t;
    var btn = $('#themeToggle');
    if (btn) btn.innerHTML = ICONS.contrast;
  }

  /* ---------------- 启动：先探测后端，在线模式优先，失败回退本机模式 ---------------- */
  applyTheme();
  LFAPI.probe().then(function (online) {
    if (online) {
      LFAPI.me().then(function (r) {
        if (r.ok && LFAPI.user) {
          currentUser = LFAPI.user.username;
          loadStore();
          enterApp();
        } else {
          renderAuth('login');
        }
      });
      return;
    }
    var savedUser = null;
    try { savedUser = localStorage.getItem(CURRENT_KEY); } catch (e) {}
    if (savedUser && getUsers()[savedUser]) {
      currentUser = savedUser;
      loadStore();
      enterApp();
    } else {
      renderAuth('login');
    }
  });
})();
