/**
 * Provider chain.
 *
 * teraboxvd can talk to four different upstreams. They are tried in order
 * until one of them actually answers — which means the app keeps working
 * whether you have a paid API key, your own TeraBox account, or nothing
 * but a free anonymous session.
 *
 *   1. teraboxapi    commercial extraction API   (best: direct links + HLS)
 *   2. diskwala      lifetime-quota API          (direct links)
 *   3. openplatform  your own TeraBox account    (free, direct links)
 *   4. web           anonymous web-share API     (always free, no direct links)
 */

const { config, AUTO_ORDER } = require('../site.config');
const { parseShareLink, LinkError } = require('./terabox/parse');
const { TeraboxApiProvider } = require('./terabox/commercial');
const { DiskWalaProvider, FlezenProvider } = require('./terabox/diskwala');
const { OpenPlatformProvider } = require('./terabox/openplatform');
const { TeraboxWeb } = require('./terabox/web');
const { TTLCache } = require('./util/cache');
const log = require('./util/log');

class Providers {
  constructor() {
    this.commercial = new TeraboxApiProvider(config.teraboxapi);
    this.diskwala = new DiskWalaProvider(config.diskwala);
    this.flezen = new FlezenProvider(config.diskwala);
    this.openplatform = new OpenPlatformProvider(config.openplatform);
    this.web = new TeraboxWeb(config.web);

    this.cache = new TTLCache({ max: 300, ttl: config.server.cache.resolve });
    this.listCache = new TTLCache({ max: 600, ttl: config.server.cache.list });
  }

  /** Ordered list of provider names that are actually usable right now. */
  available() {
    const map = {
      teraboxapi: this.commercial.enabled,
      diskwala: this.diskwala.enabled,
      flezen: this.diskwala.enabled,
      openplatform: this.openplatform.enabled,
      web: this.web.enabled,
    };
    if (config.server.provider !== 'auto') {
      const forced = config.server.provider;
      return map[forced] ? [forced] : [];
    }
    return AUTO_ORDER.filter((n) => map[n]);
  }

  providerByName(name) {
    switch (name) {
      case 'teraboxapi':
        return this.commercial;
      case 'diskwala':
        return this.diskwala;
      case 'flezen':
        return this.flezen;
      case 'openplatform':
        return this.openplatform;
      case 'web':
        return this.web;
      default:
        return null;
    }
  }

  /**
   * Resolve a share link into a file list, trying providers in order.
   * @param {string} rawLink
   * @param {{dir?:string, page?:number, pwd?:string, force?:string}} opts
   */
  async resolve(rawLink, opts = {}) {
    const share = parseShareLink(rawLink);
    if (opts.pwd && !share.pwd) share.pwd = String(opts.pwd).trim();

    const dir = opts.dir || '';
    const cacheKey = `${share.code}|${share.pwd || ''}|${dir}|${opts.page || 1}`;

    if (!opts.fresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) return { ...cached, cached: true };
    }

    const order = opts.force
      ? [opts.force]
      : this.available();

    if (order.length === 0) {
      throw Object.assign(new Error('No TeraBox provider is configured.'), {
        status: 503,
        code: 'NO_PROVIDER',
      });
    }

    const errors = [];
    for (const name of order) {
      const provider = this.providerByName(name);
      if (!provider) continue;
      try {
        const result = await provider.resolve(share, { dir, page: opts.page || 1 });
        const payload = {
          provider: name,
          share: {
            code: share.code,
            surl: share.surl,
            shortUrl: share.shortUrl,
            pwd: share.pwd || null,
            originalUrl: share.url,
          },
          title: result.title || share.code,
          dir: result.dir || dir,
          files: result.files || [],
          total: (result.files || []).length,
          totalSize: result.totalSize || 0,
          shareid: result.shareid || null,
          uk: result.uk || null,
          // internal: keep the live session for streaming
          _session: result.session || null,
          _resolved: result,
        };
        this.cache.set(cacheKey, payload);
        log.info('resolved share', { provider: name, code: share.code, files: payload.total });
        return payload;
      } catch (err) {
        log.warn('provider failed, trying next', { provider: name, err: err.message });
        errors.push({ provider: name, error: err.message, code: err.code });
        // A bad link is a hard stop — no point trying the next provider.
        if (err instanceof LinkError || err.code === 'BAD_LINK' || err.code === 'NO_CODE') {
          throw err;
        }
        if (err.code === 'NEEDS_PASSWORD' || err.code === 'BAD_PASSWORD') {
          throw err;
        }
      }
    }

    const last = errors[errors.length - 1];
    throw Object.assign(
      new Error(
        last?.error
          ? `Could not resolve that link: ${last.error}`
          : 'Could not resolve that link right now.'
      ),
      { status: last?.code === 'NEEDS_PASSWORD' ? 400 : 502, code: last?.code || 'ALL_FAILED' }
    );
  }

  /**
   * Get a playable HLS url for a file inside a resolved share.
   * @returns {Promise<{url:string, type:string}>}
   */
  async streamUrl(resolved, file, quality = config.player.quality) {
    const name = resolved.provider;
    const provider = this.providerByName(name);

    if (provider && typeof provider.streamUrl === 'function') {
      try {
        return await provider.streamUrl(resolved._resolved || resolved, file, quality);
      } catch (err) {
        log.warn('stream via provider failed', { provider: name, err: err.message });
        // The anonymous session may have gone stale (it is cached with the
        // resolve result). Re-resolve once with a fresh session and retry.
        if (name === 'web' && resolved.share?.code) {
          try {
            const fresh = await this.resolve(
              `https://www.terabox.com/s/1${resolved.share.code}`,
              { pwd: resolved.share.pwd, dir: resolved.dir, fresh: true }
            );
            const freshFile =
              fresh.files.find((f) => f.fs_id === file.fs_id) || file;
            return await this.web.streamUrl(fresh._resolved, freshFile, quality);
          } catch (err2) {
            log.warn('fresh stream retry failed', { err: err2.message });
          }
        }
      }
    }

    // Fallback: anonymous web session.
    if (name !== 'web' && this.web.enabled && resolved._resolved?.session) {
      return this.web.streamUrl(resolved._resolved, file, quality);
    }
    throw Object.assign(new Error('No stream available for this file.'), {
      status: 415,
      code: 'NO_STREAM',
    });
  }

  /**
   * Get a direct download link for a file.
   * @returns {Promise<string|null>}
   */
  async directLink(resolved, file) {
    if (file.direct_link) return file.direct_link;

    const provider = this.providerByName(resolved.provider);
    if (provider && typeof provider.directLink === 'function') {
      try {
        const link = await provider.directLink(resolved._resolved || resolved, file);
        if (link) return link;
      } catch (err) {
        log.warn('directLink failed', { provider: resolved.provider, err: err.message });
      }
    }
    return null;
  }
}

module.exports = { Providers };
