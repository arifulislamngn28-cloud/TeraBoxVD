/* ==================================================================
   TeraBoxVD — client
   ================================================================== */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    form: $('#resolveForm'),
    link: $('#linkInput'),
    pwd: $('#pwdInput'),
    pwdWrap: $('#pwdWrap'),
    clear: $('#clearBtn'),
    go: $('#goBtn'),
    goLabel: $('#goBtn .btn-label'),
    spinner: $('#goBtn .spinner'),
    alert: $('#alert'),
    results: $('#results'),
    title: $('#shareTitle'),
    meta: $('#shareMeta'),
    list: $('#fileList'),
    crumbs: $('#crumbs'),
    back: $('#backBtn'),
    copy: $('#copyLinkBtn'),
    modal: $('#playerModal'),
    video: $('#video'),
    playerTitle: $('#playerTitle'),
    playerMeta: $('#playerMeta'),
    playerDownload: $('#playerDownload'),
    theme: $('#themeToggle'),
  };

  const API_BASE = resolveApiBase();

  /**
   * Where the teraboxvd backend lives.
   *   1. a value the user saved in this browser
   *   2. the value baked into assets/js/config.js
   *   3. '' → same origin (the Node server serves the UI itself)
   */
  function resolveApiBase() {
    try {
      const saved = localStorage.getItem('tbvd.apiBase');
      if (saved) return saved.replace(/\/$/, '');
    } catch {
      /* private mode */
    }
    const baked = window.TBVD_CONFIG && window.TBVD_CONFIG.apiBase;
    return (baked || '').replace(/\/$/, '');
  }

  function absolute(pathOrUrl) {
    if (!pathOrUrl) return pathOrUrl;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${API_BASE}${pathOrUrl}`;
  }

  /** Everything the current share looks like right now. */
  const state = {
    url: '',
    pwd: '',
    dir: '',
    provider: '',
    files: [],
    hls: null,
  };

  /* ---------------------------------------------------------------- */
  /* Theme                                                             */
  /* ---------------------------------------------------------------- */

  const savedTheme = localStorage.getItem('tbvd-theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  els.theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('tbvd-theme', next);
  });

  /* ---------------------------------------------------------------- */
  /* Small helpers                                                     */
  /* ---------------------------------------------------------------- */

  function showAlert(message, kind = 'error') {
    els.alert.textContent = message;
    els.alert.className = `alert ${kind}`;
    els.alert.hidden = false;
  }

  function clearAlert() {
    els.alert.hidden = true;
    els.alert.textContent = '';
  }

  function setBusy(on) {
    els.go.disabled = on;
    els.spinner.hidden = !on;
    els.goLabel.textContent = on ? 'Resolving' : 'Resolve';
  }

  async function api(path, options = {}) {
    const res = await fetch(absolute(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = { ok: false, error: `Server returned ${res.status}.` };
    }
    if (!res.ok || body.ok === false) {
      const err = new Error(body.error || `Request failed (${res.status}).`);
      err.code = body.code;
      throw err;
    }
    return body;
  }

  const ICONS = {
    folder: '📁',
    video: '🎬',
    audio: '🎵',
    image: '🖼️',
    archive: '🗜️',
    file: '📄',
  };

  /* ---------------------------------------------------------------- */
  /* Resolve                                                           */
  /* ---------------------------------------------------------------- */

  els.link.addEventListener('input', () => {
    els.clear.hidden = !els.link.value;
  });

  els.clear.addEventListener('click', () => {
    els.link.value = '';
    els.clear.hidden = true;
    els.link.focus();
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const url = els.link.value.trim();
    if (!url) return;

    state.url = url;
    state.pwd = els.pwd.value.trim();
    state.dir = '';

    setBusy(true);
    try {
      const data = await api('/api/resolve', {
        method: 'POST',
        body: JSON.stringify({ url, pwd: state.pwd || undefined, dir: '' }),
      });
      state.provider = data.provider;
      state.files = data.files || [];
      render(data);
      els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      els.results.hidden = true;
      showAlert(err.message + (err.code === 'NEEDS_PASSWORD' ? ' Enter the code in the box above.' : ''));
      if (err.code === 'NEEDS_PASSWORD') els.pwdWrap.hidden = false;
    } finally {
      setBusy(false);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  function render(data) {
    els.results.hidden = false;
    els.title.textContent = data.title || 'Files';
    const totalSize = (data.files || []).reduce((a, f) => a + (f.size || 0), 0);
    els.meta.textContent = [
      `${data.total} item${data.total === 1 ? '' : 's'}`,
      totalSize ? formatSize(totalSize) : null,
      `via ${data.provider}`,
      data.share?.code ? `· ${data.share.code}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    els.back.hidden = true;
    renderCrumbs('');
    renderList(data.files || []);
  }

  function renderCrumbs(dir) {
    els.crumbs.hidden = !dir;
    els.crumbs.innerHTML = '';
    if (!dir) return;

    const root = document.createElement('button');
    root.type = 'button';
    root.textContent = 'root';
    root.addEventListener('click', () => navigate(''));
    els.crumbs.appendChild(root);

    const parts = dir.split('/').filter(Boolean);
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      els.crumbs.appendChild(sep);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = part;
      const target = acc;
      b.addEventListener('click', () => navigate(target));
      els.crumbs.appendChild(b);
    });
  }

  function renderList(files) {
    els.list.innerHTML = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'This share folder is empty.';
      els.list.appendChild(empty);
      return;
    }

    files.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.style.animationDelay = `${Math.min(idx, 12) * 22}ms`;

      const ico = document.createElement('div');
      ico.className = `file-ico ${f.kind}`;
      ico.textContent = ICONS[f.kind] || ICONS.file;
      row.appendChild(ico);

      const main = document.createElement('div');
      main.className = 'file-main';
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = f.name;
      name.title = f.name;
      const sub = document.createElement('div');
      sub.className = 'file-sub';
      sub.textContent = f.isDir ? 'Folder' : `${f.sizeText} · ${f.kind.toUpperCase()}`;
      main.append(name, sub);
      row.appendChild(main);

      const actions = document.createElement('div');
      actions.className = 'file-actions';

      if (f.isDir) {
        const open = document.createElement('button');
        open.className = 'mini-btn';
        open.type = 'button';
        open.innerHTML = 'Open <span class="label">→</span>';
        open.addEventListener('click', (e) => {
          e.stopPropagation();
          navigate(f.path);
        });
        actions.appendChild(open);
        row.addEventListener('click', () => navigate(f.path));
      } else if (f.streamable) {
        const play = document.createElement('button');
        play.className = 'mini-btn play';
        play.type = 'button';
        play.innerHTML = '▶ Play';
        play.addEventListener('click', (e) => {
          e.stopPropagation();
          openPlayer(f);
        });
        actions.appendChild(play);
      }

      const dl = document.createElement('a');
      dl.className = 'mini-btn';
      dl.href = downloadUrl(f);
      dl.textContent = '↓ Get';
      dl.addEventListener('click', (e) => {
        e.stopPropagation();
        startDownload(f, dl);
      });
      actions.appendChild(dl);

      row.appendChild(actions);
      els.list.appendChild(row);
    });
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const v = n / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`;
  }

  function downloadUrl(f) {
    const u = new URL(absolute('/api/download'), location.origin);
    u.searchParams.set('url', state.url);
    if (state.pwd) u.searchParams.set('pwd', state.pwd);
    if (state.dir) u.searchParams.set('dir', state.dir);
    u.searchParams.set('fs_id', f.fs_id);
    return u.toString();
  }

  async function startDownload(f, anchor) {
    clearAlert();
    try {
      const res = await fetch(downloadUrl(f), { redirect: 'follow' });
      if (res.ok) {
        const blob = await res.blob();
        const name = (f.name || 'file').split('/').pop();
        const objUrl = URL.createObjectURL(blob);
        anchor.href = objUrl;
        anchor.download = name;
        showAlert(`Downloading ${name}…`, 'info');
      } else {
        let msg = `Download failed (${res.status}).`;
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch {
          /* not json */
        }
        showAlert(msg);
      }
    } catch (err) {
      showAlert(err.message);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Folder navigation                                                 */
  /* ---------------------------------------------------------------- */

  async function navigate(dir) {
    clearAlert();
    state.dir = dir || '';
    els.back.hidden = !state.dir;
    renderCrumbs(state.dir);

    const list = document.createElement('div');
    list.className = 'empty';
    list.textContent = 'Loading…';
    els.list.innerHTML = '';
    els.list.appendChild(list);

    try {
      const data = await api('/api/resolve', {
        method: 'POST',
        body: JSON.stringify({
          url: state.url,
          pwd: state.pwd || undefined,
          dir: state.dir,
        }),
      });
      state.files = data.files || [];
      renderList(state.files);
    } catch (err) {
      els.list.innerHTML = '';
      showAlert(err.message);
    }
  }

  els.back.addEventListener('click', () => {
    const parts = state.dir.split('/').filter(Boolean);
    parts.pop();
    navigate(parts.join('/'));
  });

  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.url);
      showAlert('Share link copied to clipboard.', 'info');
    } catch {
      showAlert('Could not copy — select the link manually.');
    }
  });

  /* ---------------------------------------------------------------- */
  /* Player                                                            */
  /* ---------------------------------------------------------------- */

  async function openPlayer(f) {
    clearAlert();
    els.playerTitle.textContent = f.name;
    els.playerMeta.textContent = f.sizeText;
    els.playerDownload.href = downloadUrl(f);
    els.modal.hidden = false;
    document.body.style.overflow = 'hidden';

    els.video.removeAttribute('src');
    els.video.load();

    try {
      const data = await api('/api/stream', {
        method: 'POST',
        body: JSON.stringify({
          url: state.url,
          pwd: state.pwd || undefined,
          dir: state.dir || undefined,
          fs_id: f.fs_id,
        }),
      });

      if (state.hls) {
        state.hls.destroy();
        state.hls = null;
      }

      const src = absolute(data.src);
      if (src.includes('.m3u8') || data.type !== 'direct') {
        if (window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
          hls.loadSource(src);
          hls.attachMedia(els.video);
          hls.on(window.Hls.Events.ERROR, (_e, err) => {
            if (err.fatal) showAlert(`Playback error: ${err.details || err.type}`);
          });
          state.hls = hls;
        } else {
          els.video.src = src; // native HLS (Safari / iOS)
        }
      } else {
        els.video.src = src;
      }
    } catch (err) {
      showAlert(err.message);
      els.modal.hidden = true;
      document.body.style.overflow = '';
    }
  }

  function closePlayer() {
    els.modal.hidden = true;
    document.body.style.overflow = '';
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    els.video.removeAttribute('src');
    els.video.load();
  }

  $$('[data-close]').forEach((el) => el.addEventListener('click', closePlayer));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.hidden) closePlayer();
  });

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* Backend connection                                                  */
  /* ---------------------------------------------------------------- */

  const banner = $('#connectBanner');
  const connectBtn = $('#connectBtn');

  async function checkBackend() {
    try {
      const res = await fetch(absolute('/api/health'), { method: 'GET' });
      if (!res.ok) throw new Error('bad status');
      const body = await res.json();
      banner.hidden = true;
      return body;
    } catch {
      banner.hidden = false;
      return null;
    }
  }

  connectBtn.addEventListener('click', () => {
    const current = API_BASE || `${location.origin}`;
    const next = window.prompt(
      'Your teraboxvd server URL (for example https://teraboxvd.onrender.com).\nLeave as-is to use this same site.',
      current
    );
    if (next === null) return;
    const value = next.trim().replace(/\/$/, '');
    try {
      if (value) localStorage.setItem('tbvd.apiBase', value);
      else localStorage.removeItem('tbvd.apiBase');
    } catch {
      /* ignore */
    }
    location.reload();
  });

  // Prefill from ?url= so links can be shared straight to the site.
  const params = new URLSearchParams(location.search);
  if (params.get('url')) {
    els.link.value = params.get('url');
    els.clear.hidden = false;
  }
  if (params.get('pwd')) {
    els.pwd.value = params.get('pwd');
    els.pwdWrap.hidden = false;
  }
  checkBackend();

  if (params.get('url')) {
    els.form.requestSubmit();
  }
})();
