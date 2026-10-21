/**
 * Anonymous TeraBox web-share resolver.
 *
 * This is the FREE path — no API key, no account. It talks to the same
 * endpoints TeraBox's own web player uses:
 *
 *   1. GET  /sharing/link?surl=<code>   → cookies (browserid, csrfToken)
 *                                         + window.jsToken + pcftoken
 *   2. GET  /api/shorturlinfo?...       → shareid, uk, sign, timestamp, list[]
 *   3. POST /share/verify?surl=&pwd=    → extraction code (only if errno -9)
 *   4. GET  /share/list?dir=...         → sub-folder listing
 *   5. GET  /share/streaming?...        → HLS playlist for video
 *
 * Known limits: the list + HLS stream work anonymously, but a *direct
 * download* needs an account or a commercial API key. That is exactly why
 * the provider chain exists (see server/providers.js).
 */

const crypto = require('node:crypto');
const { json, postForm, fetchWithTimeout, CookieJar } = require('../util/http');
const { kindOf, formatSize, toBool, toNum } = require('../util/format');
const log = require('../util/log');

/** Key TeraBox's web client uses when signing streaming requests. */
const STREAM_SIGN_KEY = 'iuuPc64E4Fhn0rTXEzrnbLph0o5qyEEa';

/** Map TeraBox's errno values to something a human can read. */
const ERRNO = {
  '-9': 'This link is protected by an extraction code.',
  '-6': 'The extraction code is wrong.',
  '-7': 'Wrong extraction code.',
  '-12': 'This share link is invalid or has expired.',
  '-11': 'Wrong extraction code.',
  2: 'TeraBox needs a signed-in session for this action.',
  105: 'This share link is invalid or has expired.',
  400210: 'TeraBox asked for a re-verification (try again).',
  400310: 'TeraBox asked for a re-verification (try again).',
};

class TeraboxWeb {
  constructor(cfg) {
    this.cfg = cfg;
    // TeraBox mirrors all sit on the same backend, so if one host is slow or
    // blocked we can hop to the next one. The share code stays valid.
    this.hosts = (cfg.baseUrl || 'https://www.terabox.com')
      .split(',')
      .map((h) => h.trim().replace(/\/$/, ''))
      .filter(Boolean);
    if (this.hosts.length === 1) {
      this.hosts.push('https://terabox.app', 'https://1024terabox.com');
    }
    this.base = this.hosts[0];
  }

  get enabled() {
    return Boolean(this.cfg.enabled);
  }

  /**
   * Run `fn(base)` against each mirror until one of them answers.
   * Only network failures trigger a hop — a TeraBox errno is a real answer.
   */
  async acrossMirrors(fn) {
    let lastErr = null;
    for (const base of this.hosts) {
      try {
        const out = await fn(base);
        if (out !== undefined && out !== null) return out;
        lastErr = new Error(`Mirror ${base} returned nothing.`);
      } catch (err) {
        lastErr = err;
        // A TeraBox-level error (errno / bad password) is a real answer —
        // do not keep hammering other mirrors.
        if (err && err.teraboxError) throw err;
        if (err && err.status && err.status < 500 && err.code !== 'UPSTREAM') throw err;
        log.debug('mirror failed, trying next', { base, err: err.message });
      }
    }
    throw lastErr || new Error('All TeraBox mirrors failed.');
  }

  /* ------------------------------------------------------------------ */
  /* Session bootstrap                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Fetch the share landing page once and keep its cookies + tokens.
   * @param {{code:string, pwd?:string|null}} share
   */
  async bootstrap(share, base = this.base) {
    const jar = new CookieJar();
    const url = `${base}/sharing/link?surl=${encodeURIComponent(share.code)}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': this.cfg.userAgent, 'Accept-Language': 'en-US,en;q=0.9' } },
      this.cfg.timeoutMs
    );
    jar.absorb(res);
    const html = await res.text();

    const jsToken = extractJsToken(html);
    const pcftoken = extractPcftoken(html);

    if (!jar.get('browserid')) {
      throw Object.assign(new Error('TeraBox did not hand out a session cookie.'), {
        status: 502,
        code: 'NO_SESSION',
      });
    }
    if (!jsToken) {
      throw Object.assign(
        new Error('Could not read the session token from the TeraBox share page.'),
        { status: 502, code: 'NO_JSTOKEN' }
      );
    }

    return { jar, jsToken, pcftoken, browserid: jar.get('browserid'), base };
  }

  /* ------------------------------------------------------------------ */
  /* Share info + root listing                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve a share into its file list.
   * @param {{code:string, pwd?:string|null}} share
   * @param {{dir?:string, page?:number, num?:number}} opts
   */
  async resolve(share, opts = {}) {
    return this.acrossMirrors(async (base) => {
    const session = await this.bootstrap(share, base);
    const dir = opts.dir || '';
    const page = opts.page || 1;
    const num = opts.num || 200;

    let info = await this.shortUrlInfo(session, share);
    let needPwd = info.errno === -9 || info.errno === -6 || info.errno === -7 || info.errno === -11;

    if (needPwd) {
      if (!share.pwd) {
        throw Object.assign(new Error(ERRNO['-9']), {
          status: 400,
          code: 'NEEDS_PASSWORD',
        });
      }
      await this.verifyPassword(session, share);
      info = await this.shortUrlInfo(session, share);
      if (info.errno !== 0) {
        throw this.errnoError(info.errno);
      }
    }

    if (info.errno !== 0) throw this.errnoError(info.errno);

    // Root listing comes from shorturlinfo. Sub-folders need /share/list.
    let list = info.list || [];
    if (dir) {
      const sub = await this.listDir(session, share, dir, page, num);
      if (sub.errno !== 0) throw this.errnoError(sub.errno);
      list = sub.list || [];
    }

    return {
      provider: 'web',
      shareid: info.shareid,
      uk: info.uk,
      sign: info.sign,
      timestamp: info.timestamp,
      randsk: info.randsk || null,
      dir,
      title: share.code,
      files: list.map((f) => this.normalizeFile(f, dir)),
      session, // kept so the caller can ask for a stream URL right after
    };
    });
  }

  /** GET /api/shorturlinfo — the share header + root file list. */
  async shortUrlInfo(session, share) {
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      web: '1',
      channel: this.cfg.channel,
      clienttype: '0',
      shorturl: `1${share.code}`,
      root: '1',
      jsToken: session.jsToken,
    });
    const res = await json(
      `${session.base}/api/shorturlinfo?${params}`,
      {
        headers: {
          'User-Agent': this.cfg.userAgent,
          Cookie: session.jar.header(),
          Referer: `${session.base}/sharing/link?surl=${share.code}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
      this.cfg.timeoutMs
    );
    return res.data || { errno: res.status };
  }

  /** POST /share/verify — exchange the 4-char extraction code for BDCLND. */
  async verifyPassword(session, share) {
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      surl: share.code,
    });
    const res = await postForm(
      `${session.base}/share/verify?${params}`,
      { pwd: share.pwd },
      {
        headers: {
          'User-Agent': this.cfg.userAgent,
          Cookie: session.jar.header(),
          Referer: `${session.base}/sharing/link?surl=${share.code}`,
        },
      },
      this.cfg.timeoutMs
    );
    session.jar.absorb(res.headers);
    const errno = res.data && res.data.errno;
    if (errno !== undefined && errno !== 0) {
      throw Object.assign(new Error(ERRNO[errno] || `TeraBox rejected the code (errno ${errno}).`), {
        status: 400,
        code: 'BAD_PASSWORD',
      });
    }
    return res.data;
  }

  /** GET /share/list — listing for a sub-folder inside the share. */
  async listDir(session, share, dir, page = 1, num = 200) {
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      web: '1',
      channel: this.cfg.channel,
      clienttype: '0',
      shorturl: share.code,
      root: '1',
      dir,
      page: String(page),
      num: String(num),
      jsToken: session.jsToken,
    });
    const res = await json(
      `${session.base}/share/list?${params}`,
      {
        headers: {
          'User-Agent': this.cfg.userAgent,
          Cookie: session.jar.header(),
          Referer: `${session.base}/sharing/link?surl=${share.code}`,
        },
      },
      this.cfg.timeoutMs
    );
    return res.data || { errno: res.status };
  }

  /* ------------------------------------------------------------------ */
  /* Streaming                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Build an HLS (m3u8) playlist URL for a video inside a share.
   * @param {object} resolved result of resolve()
   * @param {object} file normalized file entry
   * @param {string} quality 'auto' | '480' | '720' | '1080'
   */
  async streamUrl(resolved, file, quality = 'auto') {
    if (!resolved.session) {
      throw Object.assign(new Error('No live session — re-resolve the share.'), { status: 409 });
    }
    const { session } = resolved;
    const types = ['M3U8_AUTO_480', 'M3U8_AUTO_720', 'M3U8_AUTO_1080'];
    const wanted = quality === 'auto' ? types : [this.cfg.types?.[quality] || types[0]];

    let lastErr = null;
    for (const type of wanted) {
      const params = new URLSearchParams({
        app_id: this.cfg.appId,
        web: '1',
        channel: this.cfg.channel,
        clienttype: '0',
        jsToken: session.jsToken,
        shareid: String(resolved.shareid || ''),
        uk: String(resolved.uk || ''),
        sign: String(resolved.sign || ''),
        timestamp: String(resolved.timestamp || ''),
        type,
        fid: String(file.fs_id),
        psign: '0',
      });
      const url = `${this.base}/share/streaming?${params}`;
      const ok = await this.streamingWorks(url, session);
      if (ok) return { url, type };
      lastErr = ok;
    }

    // Fallback: TeraBox sometimes wants an HMAC-signed streaming call.
    const hmacUrl = this.signedStreamingUrl(resolved, file, 'M3U8_AUTO_480');
    if (await this.streamingWorks(hmacUrl, resolved.session)) {
      return { url: hmacUrl, type: 'M3U8_AUTO_480' };
    }

    throw Object.assign(
      new Error('TeraBox would not hand out a stream for this file (it may not be transcoded yet).'),
      { status: 415, code: 'NO_STREAM' }
    );
  }

  /** Does the streaming endpoint return a real playlist? */
  async streamingWorks(url, session) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': this.cfg.userAgent,
            Cookie: session.jar.header(),
            Accept: '*/*',
          },
        },
        this.cfg.timeoutMs
      );
      if (!res.ok) return false;
      const text = await res.text();
      return text.includes('#EXTM3U');
    } catch (err) {
      log.debug('streaming probe failed', { err: err.message });
      return false;
    }
  }

  /** sign = HMAC-SHA1(key, "0dubox<browserid><unix_ts>") */
  signedStreamingUrl(resolved, file, type) {
    const browserid = resolved.session.browserid || '';
    const ts = Math.floor(Date.now() / 1000);
    const sign = crypto
      .createHmac('sha1', STREAM_SIGN_KEY)
      .update(`0dubox${browserid}${ts}`)
      .digest('base64');
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      web: '1',
      channel: this.cfg.channel,
      clienttype: '0',
      jsToken: resolved.session.jsToken,
      shareid: String(resolved.shareid || ''),
      uk: String(resolved.uk || ''),
      sign,
      timestamp: String(ts),
      type,
      fid: String(file.fs_id),
    });
    return `${this.base}/share/streaming?${params}`;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  normalizeFile(f, parentDir = '') {
    const name = f.server_filename || f.filename || f.name || '';
    const isDir = toBool(f.isdir);
    const path = f.path || (parentDir ? `${parentDir}/${name}` : name);
    return {
      fs_id: String(f.fs_id ?? f.fsid ?? ''),
      name,
      path,
      isDir,
      size: toNum(f.size),
      sizeText: formatSize(f.size),
      kind: kindOf(name, isDir),
      md5: f.md5 || null,
      mtime: f.server_mtime || f.mtime || null,
      thumbs: f.thumbs || null,
      // filled in later by the direct-link provider if available
      direct_link: f.dlink || f.direct_link || null,
      stream_url: f.stream_url || null,
      stream_download_url: f.stream_download_url || null,
    };
  }

  errnoError(errno) {
    const msg = ERRNO[errno] || ERRNO[String(errno)] || `TeraBox returned errno ${errno}.`;
    const err = Object.assign(new Error(msg), {
      status: errno === -9 ? 400 : 404,
      code: `ERRNO_${errno}`,
    });
    err.teraboxError = true;
    return err;
  }
}

/* -------------------------------------------------------------------- */
/* Token extraction                                                      */
/* -------------------------------------------------------------------- */

/**
 * TeraBox ships its session token in one of two shapes:
 *   window.jsToken = "abcdef0123..."
 *   eval(decodeURIComponent(`function%20fn%28a%29%7Bwindow.jsToken%20%3D%20a%7D%3Bfn%28%22abc%22%29`))
 *
 * The second form is wrapped in BACKTICKS, not quotes — that detail matters.
 */
function extractJsToken(html) {
  const direct = html.match(/window\.jsToken\s*=\s*["'`]([0-9a-fA-F]{8,})["'`]/);
  if (direct) return direct[1];

  for (const m of html.matchAll(/decodeURIComponent\(\s*(["'`])((?:[^\\]|\\.)*?)\1\s*\)/g)) {
    let decoded;
    try {
      decoded = decodeURIComponent(m[2]);
    } catch {
      continue;
    }
    const asg = decoded.match(/jsToken\s*=\s*["'`]([0-9a-fA-F]{8,})["'`]/);
    if (asg) return asg[1];
    const fn = decoded.match(/fn\(\s*["'`]([0-9a-fA-F]{8,})["'`]\s*\)/);
    if (fn) return fn[1];
  }
  return null;
}

function extractPcftoken(html) {
  const m = html.match(/["']pcftoken["']\s*:\s*["']([0-9a-fA-F]{8,})["']/);
  return m ? m[1] : null;
}

module.exports = { TeraboxWeb, extractJsToken, extractPcftoken, ERRNO };
