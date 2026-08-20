/*!
 * ============================================================
 *  ChatWidget CS v2.0 — Widget Chatbot Vanilla JS (TANPA framework)
 * ============================================================
 *  CARA PASANG di website manapun (HTML biasa, WordPress, dll):
 *
 *  <script src="https://domain-anda.com/widget.js" async></script>
 *
 *  Nama bot, warna, nomor WhatsApp, pesan sambutan, dan pesan
 *  fallback diambil otomatis dari tabel Supabase "widget_settings"
 *  (dikelola lewat tab "Pengaturan Widget" di Admin Panel).
 *
 *  Opsi teknis tambahan (opsional) lewat window.CHAT_WIDGET_CONFIG
 *  sebelum script di-load: whatsapp, botName, primary, autoOpenDelay,
 *  greeting, supabaseUrl, supabaseKey — nilai ini akan override
 *  data dari database jika diisi.
 * ============================================================
 */
(function () {
  'use strict';
  if (window.__cwLoaded) return;
  window.__cwLoaded = true;

   /* ================= KONFIGURASI DASAR (FALLBACK) ================= */
  var USER_CFG = window.CHAT_WIDGET_CONFIG || {};

  // Baca botId dari atribut data-bot-id di tag <script> jika tidak diset via window config
  // Contoh embed: <script src="widget.js" data-bot-id="UUID-ADMIN" async></script>
  if (!USER_CFG.botId) {
    var _scripts = document.querySelectorAll('script[data-bot-id]');
    if (_scripts.length) {
      USER_CFG.botId = _scripts[_scripts.length - 1].getAttribute('data-bot-id');
    }
  }

  var CFG = Object.assign({
    supabaseUrl: 'https://lmsgunuqsigdpnagkmjq.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtc2d1bnVxc2lnZHBuYWdrbWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NjE5NzMsImV4cCI6MjEwMjMzNzk3M30.-sl-P0_Mr7hakna5XYq0hj_Q0g-EgM0ef5nAeX6iqKA',
    botId: null,
    whatsapp: '6281234567890',
    botName: 'CS Assistant',
    primary: '#16a34a',
    headerColor: null,
    buttonColor: null,
    accentColor: null,
    autoOpenDelay: 5000,
    greeting: 'Halo! Selamat datang. Ada yang bisa kami bantu?',
    fallback: 'Maaf, kami belum menemukan jawaban untuk pertanyaan Anda. Silakan hubungi CS kami melalui WhatsApp di bawah ini.'
  }, USER_CFG);

  if (!CFG.botId) {
    console.error('[ChatWidget] botId belum diisi. Gunakan salah satu cara:\n' +
      '  Cara 1: <script src="widget.js" data-bot-id="UUID-ADMIN" async></script>\n' +
      '  Cara 2: window.CHAT_WIDGET_CONFIG = { botId: "UUID-ADMIN" }; (sebelum tag script)');
    return;
  }
  /* ================= STATE ================= */
  var NS = '_' + String(CFG.botId).slice(0, 8);
  var LS_SESSION = 'cw_session' + NS;
  var LS_HISTORY = 'cw_history' + NS;
  var SS_CLOSED = 'cw_closed' + NS;

  var sessionId = null;
  try {
    sessionId = localStorage.getItem(LS_SESSION);
    if (!sessionId) {
      sessionId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(LS_SESSION, sessionId);
    }
  } catch (e) { sessionId = 's_anon'; }

  var chatHistory = [];
  try { chatHistory = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); } catch (e) {}

  var sb = null;
  var isOpen = false;
  var unread = 0;
  var greeted = chatHistory.length > 0;
  var faqCache = [];

  /* ================= UTIL ================= */
  function saveHistory() {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(chatHistory.slice(-100))); } catch (e) {}
  }

  function loadSupabase(cb) {
    if (window.supabase) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = cb;
    s.onerror = cb; // lanjut mode offline (chat lokal tetap jalan)
    document.head.appendChild(s);
  }

  function client() {
    if (!sb && window.supabase) {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    }
    return sb;
  }

   function logChat(sender, message, imageUrl) {
    var c = client();
    if (!c || !CFG.botId) return;
    c.from('chat_logs')
      .insert({
        user_id:   CFG.botId,        // UUID admin pemilik widget
        session_id: sessionId,
        sender:    sender,
        message:   message   || null,
        image_url: imageUrl  || null
      })
      .then(function (r) {
        if (r.error) console.warn('[ChatWidget] gagal menyimpan log:', r.error.message);
      });
  }

  // Bunyi "ding" lembut via Web Audio API (tanpa file eksternal)
  function playDing() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(987.77, ctx.currentTime);          // B5
      o.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.12);  // E6
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      o.start(); o.stop(ctx.currentTime + 1);
    } catch (e) {}
  }

  function waLink() {
    return 'https://wa.me/' + CFG.whatsapp + '?text=' + encodeURIComponent('Halo, saya butuh bantuan CS.');
  }

  /* ================= LOAD PENGATURAN DARI SUPABASE ================= */
  function fetchSettings(done) {
    var c = client();
    if (!c) return done();
    var finished = false;
    var timer = setTimeout(function () { if (!finished) { finished = true; done(); } }, 3000);

    c.from('widget_settings').select('*').eq('user_id', CFG.botId).maybeSingle().then(function (r) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!r.error && r.data) {
        var d = r.data;
        if (!USER_CFG.botName && d.bot_name) CFG.botName = d.bot_name;
        if (!USER_CFG.whatsapp && d.whatsapp) CFG.whatsapp = d.whatsapp;
        if (!USER_CFG.greeting && d.greeting) CFG.greeting = d.greeting;
        if (d.fallback_message) CFG.fallback = d.fallback_message;

        // Warna: window.CHAT_WIDGET_CONFIG.primary (jika diisi manual) selalu menang.
        // Kalau tidak diisi, pakai warna dari database; kalau database juga kosong, pakai CFG.primary default.
        if (!USER_CFG.primary) {
          CFG.headerColor = d.header_color || CFG.primary;
          CFG.buttonColor = d.button_color || CFG.primary;
          CFG.accentColor = d.accent_color || CFG.primary;
        }
      }
      done();
    }).catch(function () {
      if (!finished) { finished = true; clearTimeout(timer); done(); }
    });
  }

  function fetchFaqCache(done) {
    var c = client();
    if (!c) return done();
    c.from('faq_data').select('id,question,answer,keywords').eq('user_id', CFG.botId).order('id', { ascending: true }).limit(100)
      .then(function (r) {
        if (!r.error) faqCache = r.data || [];
        done();
      })
      .catch(function () { done(); });
  }

  /* ================= OTAK BOT: KEYWORD MATCHING ================= */
  var HUMAN_KEYS = ['manusia', 'admin', 'operator', 'komplain', 'complain', 'whatsapp', 'wa', 'cs', 'orang', 'telepon', 'telp'];

  function wantsHuman(text) {
    var t = ' ' + text.toLowerCase() + ' ';
    for (var i = 0; i < HUMAN_KEYS.length; i++) {
      if (t.indexOf(' ' + HUMAN_KEYS[i] + ' ') !== -1) return true;
    }
    return false;
  }

  function matchFaq(text) {
    var t = text.toLowerCase();
    var i, j, kws;
    for (i = 0; i < faqCache.length; i++) {
      kws = (faqCache[i].keywords || '').split(',');
      for (j = 0; j < kws.length; j++) {
        var kw = kws[j].trim().toLowerCase();
        if (kw && t.indexOf(kw) !== -1) return faqCache[i];
      }
    }
    // fallback: cocokkan langsung dengan teks pertanyaan itu sendiri
    for (i = 0; i < faqCache.length; i++) {
      var q = (faqCache[i].question || '').toLowerCase();
      if (q && (t.indexOf(q) !== -1 || q.indexOf(t) !== -1)) return faqCache[i];
    }
    return null;
  }

  function botReply(text) {
    if (wantsHuman(text)) {
      return { text: 'Baik, saya sambungkan ke CS kami. Silakan klik tombol WhatsApp di bawah ini.', showWa: true };
    }
    var faq = matchFaq(text);
    if (faq) return { text: faq.answer, showWa: false };
    return { text: CFG.fallback, showWa: true };
  }

  /* ================= ICON SVG ================= */
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.126A59.77 59.77 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5"/></svg>';
  var ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3 4.5h18v15H3v-15Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25a1.125 1.125 0 1 1-2.25 0 1.125 1.125 0 0 1 2.25 0Z"/></svg>';
  var ICON_WA = '<svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.11 3.22 5.1 4.51.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.58-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.85 9.85 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88a9.82 9.82 0 0 1 9.88 9.9c0 5.44-4.44 9.87-9.89 9.87m8.42-18.29A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.47-8.4"/></svg>';

  /* ================= CSS ================= */
  function buildCss() { return '' +
    '#cw-root *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '#cw-root{--cw-header:' + (CFG.headerColor || CFG.primary) + ';--cw-button:' + (CFG.buttonColor || CFG.primary) + ';--cw-accent:' + (CFG.accentColor || CFG.primary) + '}' +
    '#cw-bubble{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;background:var(--cw-button);border:none;cursor:pointer;z-index:999998;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.28);transition:transform .2s}' +
    '#cw-bubble:hover{transform:scale(1.08)}' +
    '#cw-bubble svg{width:27px;height:27px;color:#fff}' +
    '#cw-badge{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}' +
    '#cw-panel{position:fixed;right:20px;bottom:90px;width:370px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;z-index:999999;transform-origin:bottom right;transition:opacity .22s,transform .22s}' +
    '#cw-panel.cw-hidden{opacity:0;transform:scale(.85) translateY(24px);pointer-events:none}' +
    '.cw-header{background:var(--cw-header);color:#fff;padding:13px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0}' +
    '.cw-avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0}' +
    '.cw-title{font-weight:700;font-size:15px;line-height:1.2}' +
    '.cw-status{font-size:11.5px;opacity:.92;display:flex;align-items:center;gap:5px;margin-top:2px}' +
    '.cw-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;display:inline-block}' +
    '.cw-close{margin-left:auto;background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
    '.cw-close svg{width:16px;height:16px}' +
    '.cw-close:hover{background:rgba(255,255,255,.3)}' +
    '#cw-msgs{flex:1;overflow-y:auto;padding:14px;background:#f1f5f9;display:flex;flex-direction:column;gap:8px}' +
    '.cw-msg{display:flex;width:100%}' +
    '.cw-msg.cw-user{justify-content:flex-end}' +
    '.cw-bbl{padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;max-width:82%;word-break:break-word;white-space:pre-wrap}' +
    '.cw-user .cw-bbl{background:var(--cw-accent);color:#fff;border-bottom-right-radius:4px}' +
    '.cw-bot .cw-bbl{background:#fff;color:#1e293b;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.08)}' +
    '.cw-img{max-width:210px;max-height:210px;border-radius:10px;cursor:pointer;display:block}' +
    '.cw-typing .cw-bbl{display:flex;gap:4px;align-items:center;padding:12px 14px}' +
    '.cw-tdot{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:cwblink 1.2s infinite}' +
    '.cw-tdot:nth-child(2){animation-delay:.2s}.cw-tdot:nth-child(3){animation-delay:.4s}' +
    '@keyframes cwblink{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
    '#cw-wa{display:none;padding:9px 12px;background:#f0fdf4;border-top:1px solid #bbf7d0;flex-shrink:0}' +
    '#cw-wa a{display:flex;align-items:center;justify-content:center;gap:8px;background:#22c55e;color:#fff;text-decoration:none;padding:10px;border-radius:10px;font-size:13.5px;font-weight:700}' +
    '#cw-wa a:hover{background:#16a34a}' +
    '#cw-wa svg{width:18px;height:18px;fill:#fff}' +
    '.cw-faqwrap{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:2px}' +
    '.cw-faqlabel{font-size:11.5px;font-weight:700;color:#64748b;margin:2px 0 2px 2px;text-transform:uppercase;letter-spacing:.03em}' +
    '.cw-faqbtn{background:#fff;border:1.5px solid var(--cw-accent);color:var(--cw-accent);font-size:13px;font-weight:600;text-align:left;padding:8px 12px;border-radius:12px;cursor:pointer;transition:background .15s,color .15s;line-height:1.4}' +
    '.cw-faqbtn:hover{background:var(--cw-accent);color:#fff}' +
    '.cw-inputbar{display:flex;align-items:center;gap:6px;padding:10px;background:#fff;border-top:1px solid #e2e8f0;flex-shrink:0}' +
    '.cw-iconbtn{background:none;border:none;cursor:pointer;color:#64748b;padding:7px;border-radius:8px;display:flex;align-items:center;justify-content:center}' +
    '.cw-iconbtn:hover{background:#f1f5f9;color:var(--cw-accent)}' +
    '.cw-iconbtn svg{width:20px;height:20px}' +
    '#cw-input{flex:1;border:1px solid #e2e8f0;border-radius:20px;padding:9px 14px;font-size:13.5px;outline:none;background:#f8fafc}' +
    '#cw-input:focus{border-color:var(--cw-accent);background:#fff}' +
    '#cw-send{background:var(--cw-accent);border:none;color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '#cw-send:hover{opacity:.9}' +
    '#cw-send svg{width:17px;height:17px}'; }

  /* ================= BANGUN DOM ================= */
  var root, bubble, badge, panel, header, msgs, waBar, inputBar, input, fileInput;

  function buildWidget() {
    root = document.createElement('div');
    root.id = 'cw-root';

    var style = document.createElement('style');
    style.textContent = buildCss();
    root.appendChild(style);

    // Bubble
    bubble = document.createElement('button');
    bubble.id = 'cw-bubble';
    bubble.setAttribute('aria-label', 'Buka chat CS');
    bubble.innerHTML = ICON_CHAT;
    badge = document.createElement('span');
    badge.id = 'cw-badge';
    bubble.appendChild(badge);
    root.appendChild(bubble);

    // Panel
    panel = document.createElement('div');
    panel.id = 'cw-panel';
    panel.className = 'cw-hidden';

    header = document.createElement('div');
    header.className = 'cw-header';
    header.innerHTML =
      '<div class="cw-avatar">' + CFG.botName.charAt(0).toUpperCase() + '</div>' +
      '<div><div class="cw-title"></div><div class="cw-status"><span class="cw-dot"></span>Online &mdash; siap membantu</div></div>' +
      '<button class="cw-close" aria-label="Tutup chat">' + ICON_CLOSE + '</button>';
    header.querySelector('.cw-title').textContent = CFG.botName;
    panel.appendChild(header);

    msgs = document.createElement('div');
    msgs.id = 'cw-msgs';
    panel.appendChild(msgs);

    waBar = document.createElement('div');
    waBar.id = 'cw-wa';
    waBar.innerHTML = '<a href="' + waLink() + '" target="_blank" rel="noopener">' + ICON_WA + 'Hubungi CS via WhatsApp</a>';
    panel.appendChild(waBar);

    inputBar = document.createElement('div');
    inputBar.className = 'cw-inputbar';
    inputBar.innerHTML =
      '<input type="file" id="cw-file" accept="image/*" style="display:none">' +
      '<button class="cw-iconbtn" id="cw-clip" title="Kirim foto" aria-label="Upload gambar">' + ICON_IMAGE + '</button>' +
      '<input id="cw-input" type="text" placeholder="Tulis pesan..." autocomplete="off">' +
      '<button id="cw-send" aria-label="Kirim pesan">' + ICON_SEND + '</button>';
    panel.appendChild(inputBar);

    root.appendChild(panel);
    document.body.appendChild(root);

    input = inputBar.querySelector('#cw-input');
    fileInput = inputBar.querySelector('#cw-file');

    // Pulihkan riwayat chat dari localStorage
    chatHistory.forEach(function (m) { addMsg(m.sender, m.message, m.image_url, true); });

    /* ================= EVENT ================= */
    bubble.addEventListener('click', function () { isOpen ? closePanel() : openPanel(); });
    header.querySelector('.cw-close').addEventListener('click', closePanel);
    inputBar.querySelector('#cw-send').addEventListener('click', handleSend);
    inputBar.querySelector('#cw-clip').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { handleUpload(fileInput.files[0]); fileInput.value = ''; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleSend(); });

    // Auto-popup setelah N detik + bunyi ding (sekali per tab, kecuali user sudah menutup manual)
    setTimeout(function () {
      if (isOpen) return;
      try { if (sessionStorage.getItem(SS_CLOSED)) return; } catch (e) {}
      openPanel();
      playDing();
    }, CFG.autoOpenDelay);
  }

  function applyColors() {
    if (!root) return;
    root.style.setProperty('--cw-header', CFG.headerColor || CFG.primary);
    root.style.setProperty('--cw-button', CFG.buttonColor || CFG.primary);
    root.style.setProperty('--cw-accent', CFG.accentColor || CFG.primary);
  }

  /* ================= RENDER PESAN ================= */
  function addMsg(sender, text, imageUrl, skipSave) {
    var row = document.createElement('div');
    row.className = 'cw-msg ' + (sender === 'user' ? 'cw-user' : 'cw-bot');
    if (imageUrl) {
      var img = document.createElement('img');
      img.src = imageUrl;
      img.className = 'cw-img';
      img.alt = 'Foto terlampir';
      img.onclick = function () { window.open(imageUrl, '_blank'); };
      row.appendChild(img);
    }
    if (text) {
      var b = document.createElement('div');
      b.className = 'cw-bbl';
      b.textContent = text;
      row.appendChild(b);
    }
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    if (!skipSave) {
      chatHistory.push({ sender: sender, message: text || null, image_url: imageUrl || null });
      saveHistory();
    }
    return row;
  }

  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'cw-msg cw-bot cw-typing';
    typingEl.innerHTML = '<div class="cw-bbl"><span class="cw-tdot"></span><span class="cw-tdot"></span><span class="cw-tdot"></span></div>';
    msgs.appendChild(typingEl);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  function showWaBar() { waBar.style.display = 'block'; }

  function bumpUnread() {
    unread++;
    badge.textContent = unread;
    badge.style.display = 'flex';
  }

  /* ================= FAQ QUICK REPLY ================= */
  function renderFaqButtons() {
    if (!faqCache.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'cw-msg cw-bot';
    var inner = document.createElement('div');
    inner.className = 'cw-faqwrap';
    var label = document.createElement('div');
    label.className = 'cw-faqlabel';
    label.textContent = 'Pertanyaan yang sering ditanyakan';
    inner.appendChild(label);
    faqCache.slice(0, 20).forEach(function (faq) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cw-faqbtn';
      btn.textContent = faq.question;
      btn.addEventListener('click', function () { handleFaqClick(faq, wrap); });
      inner.appendChild(btn);
    });
    wrap.appendChild(inner);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function handleFaqClick(faq, wrapEl) {
    if (wrapEl && wrapEl.parentNode) wrapEl.parentNode.removeChild(wrapEl);
    addMsg('user', faq.question);
    logChat('user', faq.question);
    showTyping();
    setTimeout(function () {
      hideTyping();
      var answer = faq.answer || CFG.fallback;
      addMsg('bot', answer);
      logChat('bot', answer);
      if (!isOpen) { bumpUnread(); playDing(); }
    }, 500 + Math.random() * 500);
  }

  /* ================= AKSI ================= */
  function openPanel() {
    isOpen = true;
    panel.classList.remove('cw-hidden');
    unread = 0;
    badge.style.display = 'none';
    try { sessionStorage.removeItem(SS_CLOSED); } catch (e) {}
    if (!greeted) {
      greeted = true;
      addMsg('bot', CFG.greeting);
      logChat('bot', CFG.greeting);
      renderFaqButtons();
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function closePanel() {
    isOpen = false;
    panel.classList.add('cw-hidden');
    try { sessionStorage.setItem(SS_CLOSED, '1'); } catch (e) {}
  }

  function handleSend() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    logChat('user', text);
    showTyping();
    setTimeout(function () {
      hideTyping();
      var r = botReply(text);
      addMsg('bot', r.text);
      logChat('bot', r.text);
      if (r.showWa) showWaBar();
      if (!isOpen) { bumpUnread(); playDing(); }
    }, 600 + Math.random() * 600);
  }

  function handleUpload(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { addMsg('bot', 'Maaf, hanya file gambar (JPG/PNG/dsb) yang didukung.'); return; }
    if (file.size > 5 * 1024 * 1024) { addMsg('bot', 'Ukuran gambar maksimal 5MB ya.'); return; }

    var localUrl = URL.createObjectURL(file);
    var rowEl = addMsg('user', null, localUrl, true);
    var c = client();
    if (!c) { if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl); addMsg('bot', 'Koneksi bermasalah, foto gagal terkirim. Coba lagi ya.'); return; }

    var fname = Date.now() + '_' + file.name.replace(/[^\w.\-]/g, '_');
    var path = CFG.botId + '/' + sessionId + '/' + fname;

    c.storage.from('chat-media').upload(path, file, { cacheControl: '3600', upsert: false })
      .then(function (res) {
        if (res.error) {
          console.warn('[ChatWidget] upload gagal:', res.error.message);
          addMsg('bot', 'Foto gagal terkirim. Silakan coba lagi atau kirim via WhatsApp.');
          showWaBar();
          return;
        }
        var pub = c.storage.from('chat-media').getPublicUrl(path).data.publicUrl;
        var img = rowEl.querySelector('img');
        if (img) { img.src = pub; img.onclick = function () { window.open(pub, '_blank'); }; }
        chatHistory.push({ sender: 'user', message: null, image_url: pub });
        saveHistory();
        logChat('user', '[foto]', pub);
        setTimeout(function () {
          var t = 'Foto sudah kami terima, terima kasih. Untuk respon lebih cepat, Anda juga bisa hubungi CS kami langsung:';
          addMsg('bot', t);
          logChat('bot', t);
          showWaBar();
          if (!isOpen) { bumpUnread(); playDing(); }
        }, 600);
      })
      .catch(function (err) {
        console.warn('[ChatWidget] upload error:', err);
        addMsg('bot', 'Foto gagal terkirim. Silakan coba lagi atau kirim via WhatsApp.');
        showWaBar();
      });
  }

  /* ================= INIT ================= */
  loadSupabase(function () {
    client();
    fetchSettings(function () {
      buildWidget();
      applyColors();
      fetchFaqCache(function () {
        // Jika panel sudah sempat dibuka sebelum FAQ siap (mis. history sudah ada), tampilkan tombol saat ready
        if (isOpen && greeted && !msgs.querySelector('.cw-faqwrap')) renderFaqButtons();
      });
    });
  });
})();
