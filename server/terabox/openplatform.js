/**
 * TeraBox Open Platform provider — uses YOUR OWN TeraBox account.
 *
 * This is the free-but-authenticated path: apply for an app at
 * https://www.terabox.com/integrations/contact-us and you get
 * client_id / client_secret / private_secret. Then run:
 *
 *   npm run token -- setup     # prints a QR + user code
 *   npm run token -- qr         # re-show the QR
 *
 * The token lands in data/terabox-token.json and is refreshed automatically
 * 5 minutes before it expires (access_token lasts 2 days, refresh_token 30).
 *
 * Endpoints (base https://www.terabox.com):
 *   POST /oauth/refreshtoken
 *   POST /openapi/share/verify     → randsk
 *   GET  /openapi/api/shorturlinfo → list[]
 *   GET  /openapi/share/list       → list[] (needs sekey = base64(randsk))
 *   GET  /openapi/share/download   → dlink
 *   GET  /openapi/share/streaming  → HLS
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { json, postForm, fetchWithTimeout } = require('../util/http');
const { kindOf, formatSize, toBool, toNum } = require('../util/format');
const log = require('../util/log');

class OpenPlatformProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = cfg.baseUrl.replace(/\/$/, '');
    this.tokenFile = path.resolve(cfg.tokenFile);
  }

  get enabled() {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret && this.cfg.privateSecret);
  }

  /* ------------------------------------------------------------------ */
  /* Token plumbing                                                       */
  /* ------------------------------------------------------------------ */

  /** md5(client_id + timestamp + client_secret + private_secret) */
  sign(timestamp) {
    const raw = `${this.cfg.clientId}${timestamp}${this.cfg.clientSecret}${this.cfg.privateSecret}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  readTokenFile() {
    try {
      return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
    } catch {
      return null;
    }
  }

  writeTokenFile(token) {
    fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(token, null, 2));
    fs.chmodSync(this.tokenFile, 0o600);
  }

  /** Return a valid access token, refreshing it when it is about to expire. */
  async getAccessToken() {
    const store = this.readTokenFile();
    if (!store || !store.access_token) {
      throw Object.assign(
        new Error('No TeraBox Open Platform token found. Run: npm run token -- setup'),
        { status: 503, code: 'NO_TOKEN' }
      );
    }
    const expiresAt = store.expires_at || 0;
    if (expiresAt - Date.now() > 5 * 60_000) {
      return store.access_token;
    }
    if (!store.refresh_token) {
      throw Object.assign(new Error('TeraBox token expired and cannot be refreshed.'), {
        status: 503,
        code: 'TOKEN_EXPIRED',
      });
    }
    const refreshed = await this.refresh(store.refresh_token);
    this.writeTokenFile(refreshed);
    return refreshed.access_token;
  }

  async refresh(refreshToken) {
    const ts = Math.floor(Date.now() / 1000);
    const res = await postForm(
      `${this.base}/oauth/refreshtoken`,
      {
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: refreshToken,
        timestamp: ts,
        sign: this.sign(ts),
      },
      {},
      this.cfg.timeoutMs
    );
    if (res.data && res.data.errno) {
      throw Object.assign(new Error(`Token refresh failed: ${res.data.errmsg || res.data.errno}`), {
        status: 502,
        code: 'REFRESH_FAILED',
      });
    }
    const d = res.data || {};
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token || refreshToken,
      expires_in: d.expires_in || 172800,
      expires_at: Date.now() + (d.expires_in || 172800) * 1000,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Share operations                                                    */
  /* ------------------------------------------------------------------ */

  async resolve(share, opts = {}) {
    if (!this.enabled) {
      throw Object.assign(new Error('Open Platform credentials are not configured.'), {
        status: 503,
        code: 'NO_CREDENTIALS',
      });
    }
    const token = await this.getAccessToken();
    const dir = opts.dir || '';

    let randsk = null;
    if (share.pwd) {
      const v = await postForm(
        `${this.base}/openapi/share/verify?access_tokens=${encodeURIComponent(token)}&surl=${encodeURIComponent(share.code)}`,
        { pwd: share.pwd },
        {},
        this.cfg.timeoutMs
      );
      if (!v.data || Number(v.data.errno) !== 0) {
        throw Object.assign(new Error('TeraBox rejected the extraction code.'), {
          status: 400,
          code: 'BAD_PASSWORD',
        });
      }
      randsk = v.data.randsk;
    }

    const sekey = randsk ? Buffer.from(randsk).toString('base64') : null;
    const common = {
      access_tokens: token,
      shorturl: `1${share.code}`,
      root: '1',
    };

    let list = [];
    let shareid = null;
    let uk = null;

    if (dir && sekey) {
      const res = await json(
        `${this.base}/openapi/share/list?${new URLSearchParams({
          ...common,
          shorturl: share.code,
          dir,
          page: String(opts.page || 1),
          num: String(opts.num || 200),
          sekey,
        })}`,
        {},
        this.cfg.timeoutMs
      );
      const d = res.data || {};
      if (d.errno !== undefined && Number(d.errno) !== 0) throw this.errnoError(d.errno);
      list = d.list || [];
      shareid = d.share_id || d.shareid;
      uk = d.uk;
    } else {
      const res = await json(
        `${this.base}/openapi/api/shorturlinfo?${new URLSearchParams(common)}`,
        {},
        this.cfg.timeoutMs
      );
      const d = res.data || {};
      if (d.errno !== undefined && Number(d.errno) !== 0) {
        if (Number(d.errno) === -9 || Number(d.errno) === -6) {
          throw Object.assign(new Error('This link is protected by an extraction code.'), {
            status: 400,
            code: 'NEEDS_PASSWORD',
          });
        }
        throw this.errnoError(d.errno);
      }
      list = d.list || [];
      shareid = d.shareid;
      uk = d.uk;
    }

    return {
      provider: 'openplatform',
      shareid,
      uk,
      randsk,
      sekey,
      accessToken: token,
      dir,
      title: share.code,
      files: list.map((f) => this.normalize(f, dir)),
    };
  }

  /**
   * Direct download link for one file (this is the big win of using your
   * own account — no commercial API needed).
   */
  async directLink(resolved, file) {
    if (!resolved.sekey || !resolved.shareid || !resolved.uk) {
      return null;
    }
    const params = new URLSearchParams({
      access_tokens: resolved.accessToken,
      shareid: String(resolved.shareid),
      uk: String(resolved.uk),
      fid_list: `[${file.fs_id}]`,
      sekey: resolved.sekey,
    });
    const res = await json(`${this.base}/openapi/share/download?${params}`, {}, this.cfg.timeoutMs);
    const d = res.data || {};
    if (d.errno !== undefined && Number(d.errno) !== 0) {
      log.debug('openapi download failed', { errno: d.errno });
      return null;
    }
    const entry = (d.list || [])[0];
    return entry ? entry.dlink || null : null;
  }

  async streamUrl(resolved, file) {
    if (!resolved.sekey || !resolved.shareid || !resolved.uk) {
      throw Object.assign(new Error('Open Platform streaming needs a verified share.'), {
        status: 415,
        code: 'NO_STREAM',
      });
    }
    const params = new URLSearchParams({
      access_tokens: resolved.accessToken,
      shareid: String(resolved.shareid),
      uk: String(resolved.uk),
      sekey: resolved.sekey,
      type: 'M3U8_AUTO_480',
      fid: String(file.fs_id),
    });
    return { url: `${this.base}/openapi/share/streaming?${params}`, type: 'openplatform' };
  }

  normalize(f, parentDir = '') {
    const name = f.server_filename || f.filename || f.name || '';
    const isDir = toBool(f.isdir);
    const path_ = f.path || (parentDir ? `${parentDir}/${name}` : name);
    return {
      fs_id: String(f.fs_id ?? f.fsid ?? ''),
      name,
      path: path_,
      isDir,
      size: toNum(f.size),
      sizeText: formatSize(f.size),
      kind: kindOf(name, isDir),
      md5: f.md5 || null,
      mtime: f.server_mtime || f.mtime || null,
      thumbs: f.thumbs || null,
      direct_link: f.dlink || null,
      stream_url: null,
      stream_download_url: null,
    };
  }

  errnoError(errno) {
    const map = {
      '-9': 'This link is protected by an extraction code.',
      '-12': 'This share link is invalid or has expired.',
      2: 'TeraBox needs a signed-in session for this action.',
    };
    return Object.assign(new Error(map[errno] || `TeraBox errno ${errno}.`), { status: 404 });
  }
}

module.exports = { OpenPlatformProvider };
