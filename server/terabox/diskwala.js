/**
 * DiskWala / Flezen API adapters.
 *
 * These are the two "lifetime quota" APIs sold by the same vendor
 * (AR Digital Services). The paths below are the ones the TeraBoxDL 1.3.5
 * app bundle calls:
 *
 *   POST {base}/v1/app-api/diskwala/decrypt        → resolved share payload
 *   GET  {base}/v1/app-api/download_diskwala?url=   → direct download link
 *   GET  {base}/v1/app-api/flezen?url=              → resolved share payload
 *   GET  {base}/v1/app-api/flezen_file_size?url=    → size probe
 *
 * Their exact payload/response shape is documented at
 * https://teraboxapi.com/docs — adjust FIELDS below if the vendor changes it.
 */

const { json, postJson } = require('../util/http');
const { kindOf, formatSize, toBool, toNum } = require('../util/format');
const log = require('../util/log');

class DiskWalaProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = cfg.baseUrl.replace(/\/$/, '');
    this.kind = 'diskwala';
  }

  get enabled() {
    return Boolean(this.cfg.apiKey);
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) h['X-API-Key'] = this.cfg.apiKey;
    if (this.cfg.apiSecret) h['X-API-Secret'] = this.cfg.apiSecret;
    return h;
  }

  async resolve(share, opts = {}) {
    if (!this.enabled) {
      throw Object.assign(new Error('DiskWala API key is not configured.'), {
        status: 503,
        code: 'NO_KEY',
      });
    }
    const path =
      this.kind === 'flezen' ? '/v1/app-api/flezen' : this.cfg.decryptPath;

    const res = await postJson(
      `${this.base}${path}`,
      { url: share.url, pwd: share.pwd || '', dir_path: opts.dir || '' },
      { headers: this.headers() },
      this.cfg.timeoutMs
    );

    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error('DiskWala API rejected the key.'), { status: 502, code: 'BAD_KEY' });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`DiskWala API error ${res.status}.`), {
        status: 502,
        code: 'UPSTREAM',
      });
    }

    const data = res.data || {};
    if (data.errno !== undefined && Number(data.errno) !== 0) {
      throw Object.assign(new Error(data.errmsg || `DiskWala errno ${data.errno}.`), {
        status: 400,
        code: `ERRNO_${data.errno}`,
      });
    }

    const list = data.list || data.files || data.data?.list || [];
    return {
      provider: this.kind,
      raw: data,
      dir: opts.dir || '',
      title: data.title || share.code,
      files: list.map((f) => this.normalize(f, opts.dir || '')),
    };
  }

  /** Direct download link for one file. */
  async directLink(resolved, file) {
    if (file.direct_link) return file.direct_link;
    if (!this.enabled) return null;
    try {
      const res = await json(
        `${this.base}${this.cfg.downloadPath}?${new URLSearchParams({ url: file.direct_url || file.path || '' })}`,
        { headers: this.headers() },
        this.cfg.timeoutMs
      );
      const d = res.data || {};
      return d.dlink || d.download_url || d.url || d.link || null;
    } catch (err) {
      log.debug('diskwala directLink failed', { err: err.message });
      return null;
    }
  }

  async streamUrl(resolved, file) {
    if (file.stream_url) return { url: file.stream_url, type: this.kind };
    throw Object.assign(new Error('This API response has no stream url.'), {
      status: 415,
      code: 'NO_STREAM',
    });
  }

  normalize(f, parentDir = '') {
    const name = f.server_filename || f.filename || f.name || f.title || '';
    const isDir = toBool(f.isdir);
    return {
      fs_id: String(f.fs_id ?? f.fsid ?? f.id ?? ''),
      name,
      path: f.path || (parentDir ? `${parentDir}/${name}` : name),
      isDir,
      size: toNum(f.size),
      sizeText: f.formatted_size || formatSize(f.size),
      kind: kindOf(name, isDir),
      md5: f.md5 || null,
      mtime: f.server_mtime || f.mtime || null,
      thumbs: f.thumbs || null,
      direct_link: f.dlink || f.download_url || f.direct_link || null,
      direct_url: f.url || null,
      stream_url: f.stream_url || f.m3u8 || null,
      stream_download_url: f.stream_download_url || null,
    };
  }
}

class FlezenProvider extends DiskWalaProvider {
  constructor(cfg) {
    super(cfg);
    this.kind = 'flezen';
  }
}

module.exports = { DiskWalaProvider, FlezenProvider };
