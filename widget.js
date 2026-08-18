/*!
 * ============================================================
 *  ChatWidget CS v1.0 — Widget Chatbot Vanilla JS (TANPA framework)
 * ============================================================
 *  CARA PASANG di website manapun (HTML biasa, WordPress, dll):
 *
 *  <script>
 *    window.CHAT_WIDGET_CONFIG = { whatsapp: '6281234567890' };
 *  </script>
 *  <script src="https://domain-anda.com/widget.js"></script>
 *
 *  Opsi config lengkap: whatsapp, botName, primary, autoOpenDelay,
 *  greeting, supabaseUrl, supabaseKey
 * ============================================================
 */
(function () {
  'use strict';
  if (window.__cwLoaded) return;
  window.__cwLoaded = true;

  /* ================= KONFIGURASI ================= */
  var CFG = Object.assign({
    supabaseUrl: 'https://lmsgunuqsigdpnagkmjq.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtc2d1bnVxc2lnZHBuYWdrbWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NjE5NzMsImV4cCI6MjEwMjMzNzk3M30.-sl-P0_Mr7hakna5XYq0hj_Q0g-EgM0ef5nAeX6iqKA',
    whatsapp: '6281234567890', // << GANTI: nomor WhatsApp CS (format 62xxx, tanpa +)
    botName: 'CS Assistant',
    primary: '#16a34a',        // warna utama widget
    autoOpenDelay: 5000,       // auto-popup setelah 5 detik
    greeting: 'Halo! 👋 Selamat datang. Ada yang bisa kami bantu?'
  }, window.CHAT_WIDGET_CONFIG || {});

  /* ================= STATE ================= */
  var LS_SESSION = 'cw_session';
  var LS_HISTORY = 'cw_history';
  var SS_CLOSED = 'cw_closed';

  var sessionId = null;
  try {
    sessionId = localStorage.getItem(LS_SESSION);
    if (!sessionId) {
      sessionId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(LS_SESSION, sessionId);
    }
  } catch (e) { sessionId = 's_anon'; }

  var history = [];
  try { history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); } catch (e) {}

  var sb = null;
  var isOpen = false;
  var unread = 0;
  var greeted = history.length > 0;

  /* ================= UTIL ================= */
  function saveHistory() {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(-100))); } catch (e) {}
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
    if (!c) return;
    c.from('chat_logs')
      .insert({ session_id: sessionId, sender: sender, message: message || null, image_url: imageUrl || null })
      .then(function (r) { if (r.error) console.warn('[ChatWidget] gagal menyimpan log:', r.error.message); });
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

  /* ================= OTAK BOT ================= */
  var REPLIES = [
    { keys: ['harga', 'price', 'berapa', 'mahal'], text: 'Untuk info harga terbaru, silakan sebutkan produk yang Anda cari, atau cek katalog di website kami ya 😊' },
    { keys: ['ongkir', 'kirim', 'pengiriman', 'shipping', 'ekspedisi'], text: 'Kami kirim ke seluruh Indonesia via JNE, J&T, dan SiCepat 📦 Ongkir dihitung otomatis saat checkout.' },
    { keys: ['bayar', 'pembayaran', 'transfer', 'payment', 'qris'], text: 'Pembayaran bisa via transfer bank (BCA/Mandiri/BRI), e-wallet (OVO, GoPay, DANA), dan QRIS 💳' },
    { keys: ['refund', 'retur', 'tukar', 'rusak'], text: 'Untuk retur/refund, mohon siapkan nomor pesanan Anda. Tim kami bantu maksimal 1x24 jam 🙏' },
    { keys: ['order', 'pesan', 'beli', 'checkout'], text: 'Untuk pemesanan, silakan pilih produk lalu checkout di website. Kalau ada kendala, kabari kami di sini ya 🛒' },
    { keys: ['halo', 'hai', 'hi', 'pagi', 'siang', 'sore', 'malam', 'tes', 'test'], text: 'Halo juga! 😊 Ada yang bisa kami bantu hari ini?' },
    { keys: ['terima kasih', 'makasih', 'thanks', 'thank'], text: 'Sama-sama! 🙏 Senang bisa membantu. Ada lagi yang bisa kami bantu?' }
  ];
  var HUMAN_KEYS = ['manusia', 'admin', 'operator', 'komplain', 'complain', 'whatsapp', 'wa', 'cs', 'orang', 'telepon', 'telp'];

  function botReply(text) {
    var t = ' ' + text.toLowerCase() + ' ';
    var i, j, k;
    for (i = 0; i < HUMAN_KEYS.length; i++) {
      if (t.indexOf(HUMAN_KEYS[i]) !== -1) {
        return { text: 'Baik, saya sambungkan ke CS manusia kami. Silakan klik tombol WhatsApp di bawah ini ya 👇', showWa: true };
      }
    }
    for (j = 0; j < REPLIES.length; j++) {
      for (k = 0; k < REPLIES[j].keys.length; k++) {
        if (t.indexOf(REPLIES[j].keys[k]) !== -1) return { text: REPLIES[j].text, showWa: false };
      }
    }
    return { text: 'Maaf, saya belum memahami pertanyaan Anda 😅 Untuk bantuan lebih lanjut, silakan hubungi CS manusia kami:', showWa: true };
  }

  /* ================= CSS ================= */
  var css = '' +
    '#cw-root *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '#cw-bubble{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;background:' + CFG.primary + ';border:none;cursor:pointer;z-index:999998;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.28);transition:transform .2s}' +
    '#cw-bubble:hover{transform:scale(1.08)}' +
    '#cw-bubble svg{width:28px;height:28px;fill:#fff}' +
    '#cw-badge{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}' +
    '#cw-panel{position:fixed;right:20px;bottom:90px;width:370px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;z-index:999999;transform-origin:bottom right;transition:opacity .22s,transform .22s}' +
    '#cw-panel.cw-hidden{opacity:0;transform:scale(.85) translateY(24px);pointer-events:none}' +
    '.cw-header{background:' + CFG.primary + ';color:#fff;padding:13px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0}' +
    '.cw-avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0}' +
    '.cw-title{font-weight:700;font-size:15px;line-height:1.2}' +
    '.cw-status{font-size:11.5px;opacity:.92;display:flex;align-items:center;gap:5px;margin-top:2px}' +
    '.cw-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;display:inline-block}' +
    '.cw-close{margin-left:auto;background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:8px;font-size:16px;cursor:pointer;line-height:1}' +
    '.cw-close:hover{background:rgba(255,255,255,.3)}' +
    '#cw-msgs{flex:1;overflow-y:auto;padding:14px;background:#f1f5f9;display:flex;flex-direction:column;gap:8px}' +
    '.cw-msg{display:flex;width:100%}' +
    '.cw-msg.cw-user{justify-content:flex-end}' +
    '.cw-bbl{padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;max-width:82%;word-break:break-word;white-space:pre-wrap}' +
    '.cw-user .cw-bbl{background:' + CFG.primary + ';color:#fff;border-bottom-right-radius:4px}' +
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
    '.cw-inputbar{display:flex;align-items:center;gap:6px;padding:10px;background:#fff;border-top:1px solid #e2e8f0;flex-shrink:0}' +
    '.cw-iconbtn{background:none;border:none;cursor:pointer;color:#64748b;padding:7px;border-radius:8px;display:flex;align-items:center;justify-content:center}' +
    '.cw-iconbtn:hover{background:#f1f5f9;color:' + CFG.primary + '}' +
    '.cw-iconbtn svg{width:20px;height:20px;fill:currentColor}' +
    '#cw-input{flex:1;border:1px solid #e2e8f0;border-radius:20px;padding:9px 14px;font-size:13.5px;outline:none;background:#f8fafc}' +
    '#cw-input:focus{border-color:' + CFG.primary + ';background:#fff}' +
    '#cw-send{background:' + CFG.primary + ';border:none;color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '#cw-send:hover{opacity:.9}' +
    '#cw-send svg{width:17px;height:17px;fill:#fff;margin-left:2px}';

  /* ================= BANGUN DOM ================= */
  var root = document.createElement('div');
  root.id = 'cw-root';

  var style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);

  // Bubble
  var bubble = document.createElement('button');
  bubble.id = 'cw-bubble';
  bubble.setAttribute('aria-label', 'Buka chat CS');
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.02 2 11c0 2.4 1.02 4.6 2.7 6.27L4 22l4.93-1.48c.95.26 1.97.4 3.07.4 5.52 0 10-4.02 10-9S17.52 2 12 2z"/></svg>';
  var badge = document.createElement('span');
  badge.id = 'cw-badge';
  bubble.appendChild(badge);
  root.appendChild(bubble);

  // Panel
  var panel = document.createElement('div');
  panel.id = 'cw-panel';
  panel.className = 'cw-hidden';

  var header = document.createElement('div');
  header.className = 'cw-header';
  header.innerHTML =
    '<div class="cw-avatar">' + CFG.botName.charAt(0).toUpperCase() + '</div>' +
    '<div><div class="cw-title"></div><div class="cw-status"><span class="cw-dot"></span>Online — siap membantu</div></div>' +
    '<button class="cw-close" aria-label="Tutup chat">&#8211;</button>';
  header.querySelector('.cw-title').textContent = CFG.botName;
  panel.appendChild(header);

  var msgs = document.createElement('div');
  msgs.id = 'cw-msgs';
  panel.appendChild(msgs);

  var waBar = document.createElement('div');
  waBar.id = 'cw-wa';
  waBar.innerHTML = '<a href="' + waLink() + '" target="_blank" rel="noopener">' +
    '<svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.11 3.22 5.1 4.51.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.58-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.85 9.85 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88a9.82 9.82 0 0 1 9.88 9.9c0 5.44-4.44 9.87-9.89 9.87m8.42-18.29A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.47-8.4"/></svg>' +
    'Hubungi CS via WhatsApp</a>';
  panel.appendChild(waBar);

  var inputBar = document.createElement('div');
  inputBar.className = 'cw-inputbar';
  inputBar.innerHTML =
    '<input type="file" id="cw-file" accept="image/*" style="display:none">' +
    '<button class="cw-iconbtn" id="cw-clip" title="Kirim foto / screenshot" aria-label="Upload gambar">' +
    '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>' +
    '</button>' +
    '<input id="cw-input" type="text" placeholder="Tulis pesan..." autocomplete="off">' +
    '<button id="cw-send" aria-label="Kirim pesan"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>';
  panel.appendChild(inputBar);

  root.appendChild(panel);
  document.body.appendChild(root);

  var input = inputBar.querySelector('#cw-input');
  var fileInput = inputBar.querySelector('#cw-file');

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
      history.push({ sender: sender, message: text || null, image_url: imageUrl || null });
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
    if (!/^image\//.test(file.type)) { addMsg('bot', 'Maaf, hanya file gambar (JPG/PNG/dsb) yang didukung 🙏'); return; }
    if (file.size > 5 * 1024 * 1024) { addMsg('bot', 'Ukuran gambar maksimal 5MB ya 🙏'); return; }

    var localUrl = URL.createObjectURL(file);
    var rowEl = addMsg('user', null, localUrl, true); // preview instan
    var c = client();
    if (!c) { addMsg('bot', 'Koneksi bermasalah, foto gagal terkirim. Coba lagi ya.'); return; }

    var fname = Date.now() + '_' + file.name.replace(/[^\w.\-]/g, '_');
    var path = sessionId + '/' + fname;

    c.storage.from('chat-media').upload(path, file, { cacheControl: '3600', upsert: false })
      .then(function (res) {
        if (res.error) {
          console.warn('[ChatWidget] upload gagal:', res.error.message);
          addMsg('bot', 'Foto gagal terkirim 😥 Silakan coba lagi atau kirim via WhatsApp.');
          showWaBar();
          return;
        }
        var pub = c.storage.from('chat-media').getPublicUrl(path).data.publicUrl;
        var img = rowEl.querySelector('img');
        if (img) { img.src = pub; img.onclick = function () { window.open(pub, '_blank'); }; }
        history.push({ sender: 'user', message: null, image_url: pub });
        saveHistory();
        logChat('user', '[foto]', pub);
        setTimeout(function () {
          var t = 'Foto sudah kami terima, terima kasih! 🙏 Untuk respon lebih cepat, Anda juga bisa hubungi CS kami langsung:';
          addMsg('bot', t);
          logChat('bot', t);
          showWaBar();
          if (!isOpen) { bumpUnread(); playDing(); }
        }, 600);
      });
  }

  /* ================= EVENT ================= */
  bubble.addEventListener('click', function () { isOpen ? closePanel() : openPanel(); });
  header.querySelector('.cw-close').addEventListener('click', closePanel);
  inputBar.querySelector('#cw-send').addEventListener('click', handleSend);
  inputBar.querySelector('#cw-clip').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { handleUpload(fileInput.files[0]); fileInput.value = ''; });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleSend(); });

  /* ================= INIT ================= */
  loadSupabase(function () { client(); });

  // Pulihkan riwayat chat dari localStorage
  history.forEach(function (m) { addMsg(m.sender, m.message, m.image_url, true); });
  if (history.some(function (m) { return m.sender === 'user'; })) {
    // jika user pernah chat, siapkan tombol WA bila terakhir kali dimunculkan — opsional, biar simpel tidak disimpan
  }

  // Auto-popup setelah N detik + bunyi ding (sekali per tab, kecuali user sudah menutup manual)
  setTimeout(function () {
    if (isOpen) return;
    try { if (sessionStorage.getItem(SS_CLOSED)) return; } catch (e) {}
    openPanel();
    playDing();
  }, CFG.autoOpenDelay);
})();