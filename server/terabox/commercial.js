/**
 * Commercial TeraBox extraction API (the same backend TeraBoxDL 1.3.5 uses).
 *
 *   POST https://api.teraboxdl.site/v1/api
 *   Headers: X-API-Key, X-Timestamp, X-Signature, Content-Type: application/json
 *   Signature: HMAC-SHA256("POST/v1/api" + timestamp + body, apiSecret)
 *   Body:    {"url":"https://terabox.com/s/...","dir_path":"","page":1}
 *
 * Response carries direct_link (CDN), stream_url (HLS) and full metadata.
 * Docs + pricing: https://teraboxapi.com/docs
 */

const crypto = require('node:crypto');
const { postJson } = require('../util/http');
const { kindOf, formatSize, toBool, toNum } = require('../util/format');
const log = require('../util/log');

class TeraboxApiProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = cfg.baseUrl.replace(/\/$/, '');
  }

  get enabled() {
    return Boolean(this.cfg.apiKey && this.cfg.apiSecret);
  }

  /** Build the signed headers for one request. */
  sign(bodyString, timestamp) {
    const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
    const message = `${this.cfg.signTemplate}${ts}${bodyString}`;
    const signature = crypto
      .createHmac('sha256', this.cfg.apiSecret)
      .update(message)
      .digest('hex');
    return { ts, signature, message };
  }

  /**
   * @param {{url:string, code:string, pwd?:string|null}} share
   * @param {{dir?:string, page?:number}} opts
   */
  async resolve(share, opts = {}) {
    if (!this.enabled) {
      throw Object.assign(new Error('TeraBox API key is not configured.'), { status: 503, code: 'NO_KEY' });
    }

    const payload = {
      url: share.url || `https://www.terabox.com/s/1${share.code}`,
      dir_path: opts.dir || '',
      page: opts.page || 1,
    };
    if (share.pwd) payload.pwd = share.pwd;

    const bodyString = JSON.stringify(payload);
    const { ts, signature } = this.sign(bodyString);

    const res = await postJson(
      `${this.base}${this.cfg.path}`,
      bodyString,
      {
        headers: {
          'X-API-Key': this.cfg.apiKey,
          'X-Timestamp': ts,
          'X-Signature': signature,
        },
      },
      this.cfg.timeoutMs
    );

    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error('TeraBox API rejected the key (401/403).'), {
        status: 502,
        code: 'BAD_KEY',
      });
    }
    if (res.status === 429) {
      throw Object.assign(new Error('TeraBox API daily quota exhausted (429).'), {
        status: 429,
        code: 'QUOTA',
      });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`TeraBox API error ${res.status}.`), {
        status: 502,
        code: 'UPSTREAM',
      });
    }

    const data = res.data || {};
    if (data.errno !== undefined && Number(data.errno) !== 0) {
      throw Object.assign(
        new Error(data.errmsg || `TeraBox API errno ${data.errno}.`),
        { status: 400, code: `ERRNO_${data.errno}` }
      );
    }

    const list = data.list || [];
    return {
      provider: 'teraboxapi',
      requestId: data.request_id || null,
      title: data.title || share.code,
      totalSize: data.total_size_bytes || 0,
      dir: opts.dir || '',
      files: list.map((f) => this.normalize(f, opts.dir || '')),
    };
  }

  normalize(f, parentDir = '') {
    const name = f.server_filename || f.filename || f.name || '';
    const isDir = toBool(f.isdir);
    const path = f.path || (parentDir ? `${parentDir}/${name}` : name);
    return {
      fs_id: String(f.fs_id ?? f.fsid ?? ''),
      name,
      path,
      isDir,
      size: toNum(f.size),
      sizeText: f.formatted_size || formatSize(f.size),
      kind: kindOf(name, isDir),
      md5: f.md5 || null,
      mtime: f.server_mtime || f.mtime || null,
      thumbs: f.thumbs || null,
      direct_link: f.direct_link || f.dlink || null,
      stream_url: f.stream_url || null,
      stream_download_url: f.stream_download_url || null,
    };
  }

  /** The commercial API hands back a ready-made HLS url. */
  async streamUrl(resolved, file) {
    if (file.stream_url) return { url: file.stream_url, type: 'provider' };
    if (file.stream_download_url) return { url: file.stream_download_url, type: 'provider' };
    throw Object.assign(new Error('This API response has no stream url for that file.'), {
      status: 415,
      code: 'NO_STREAM',
    });
  }
}

module.exports = { TeraboxApiProvider };
