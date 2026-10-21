/**
 * teraboxvd API routes.
 *
 *   POST /api/resolve   { url, pwd?, dir?, page? }  → file list
 *   POST /api/stream    { url, pwd?, fs_id, path? }  → playable HLS source
 *   GET  /api/download  ?url=&pwd=&fs_id=&path=      → 302 to the CDN link
 *   GET  /api/hls       ?u=&s=                       → proxied playlist/segment
 *   GET  /api/health                               → provider + build info
 *   GET  /api/config                               → public config for the UI
 */

const { config } = require('../../site.config');
const { Providers } = require('../providers');
const { parseShareLink } = require('../terabox/parse');
const hls = require('../terabox/hls');
const { isPlayable } = require('../util/format');
const log = require('../util/log');

const providers = new Providers();

/* -------------------------------------------------------------------- */
/* Helpers                                                               */
/* -------------------------------------------------------------------- */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function ok(res, payload) {
  send(res, 200, { ok: true, ...payload });
}

function fail(res, err) {
  const status = err.status || 500;
  const code = err.code || 'ERROR';
  const message = err.message || 'Something went wrong.';
  if (status >= 500) log.error('request failed', { code, message });
  else log.info('request rejected', { code, message });
  send(res, status, { ok: false, error: message, code });
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Body must be valid JSON.'), { status: 400 });
  }
}

/** Strip internal fields before sending to the browser. */
function publicFile(f) {
  return {
    fs_id: f.fs_id,
    name: f.name,
    path: f.path,
    isDir: f.isDir,
    size: f.size,
    sizeText: f.sizeText,
    kind: f.kind,
    md5: f.md5,
    mtime: f.mtime,
    thumbs: f.thumbs,
    streamable: isPlayable(f.kind),
    hasDirect: Boolean(f.direct_link),
  };
}

/* -------------------------------------------------------------------- */
/* Routes                                                                */
/* -------------------------------------------------------------------- */

async function handleResolve(req, res) {
  const body = await readBody(req);
  const url = body.url || body.link || '';
  if (!url) throw Object.assign(new Error('Send the share link in "url".'), { status: 400 });

  const resolved = await providers.resolve(url, {
    pwd: body.pwd,
    dir: body.dir,
    page: body.page,
    force: body.provider,
  });

  ok(res, {
    provider: resolved.provider,
    share: resolved.share,
    title: resolved.title,
    dir: resolved.dir,
    total: resolved.total,
    totalSize: resolved.totalSize,
    files: resolved.files.map(publicFile),
  });
}

async function handleStream(req, res, query) {
  const body = req.method === 'POST' ? await readBody(req) : query;
  const url = body.url || body.link || '';
  if (!url) throw Object.assign(new Error('Send the share link in "url".'), { status: 400 });

  const fsId = String(body.fs_id || body.fsId || '');
  if (!fsId) throw Object.assign(new Error('Send the file id in "fs_id".'), { status: 400 });

  const resolved = await providers.resolve(url, {
    pwd: body.pwd,
    dir: body.dir,
    page: body.page,
  });

  const file =
    resolved.files.find((f) => f.fs_id === fsId) ||
    resolved.files.find((f) => f.path === body.path) ||
    null;

  if (!file) {
    throw Object.assign(new Error('That file is not in this share (try re-resolving).'), {
      status: 404,
    });
  }
  if (!isPlayable(file.kind)) {
    throw Object.assign(new Error('Only video and audio files can be streamed here.'), {
      status: 415,
    });
  }

  const stream = await providers.streamUrl(resolved, file, body.quality || config.player.quality);
  const proxied = config.player.hlsProxy
    ? `/api/hls?u=${encodeURIComponent(stream.url)}&s=${hls.sign(stream.url)}`
    : stream.url;

  ok(res, {
    src: proxied,
    direct: !config.player.hlsProxy,
    type: stream.type,
    name: file.name,
    size: file.size,
  });
}

async function handleDownload(req, res, query) {
  const url = query.get('url') || '';
  if (!url) throw Object.assign(new Error('Missing ?url='), { status: 400 });

  const fsId = query.get('fs_id') || '';
  const resolved = await providers.resolve(url, {
    pwd: query.get('pwd'),
    dir: query.get('dir') || '',
  });

  const file =
    resolved.files.find((f) => f.fs_id === fsId) ||
    resolved.files.find((f) => f.path === query.get('path')) ||
    null;
  if (!file) throw Object.assign(new Error('File not found in this share.'), { status: 404 });

  const direct = await providers.directLink(resolved, file);
  if (!direct) {
    throw Object.assign(
      new Error(
        'No direct download link available on this plan. Add a TeraBox API key (TBX_API_KEY/TBX_API_SECRET) or connect your own TeraBox account to enable downloads.'
      ),
      { status: 501, code: 'NO_DIRECT_LINK' }
    );
  }

  const target = new URL(direct);
  const filename = encodeURIComponent(file.name);
  res.writeHead(302, {
    Location: direct,
    'Cache-Control': 'no-store',
  });
  log.info('download redirect', { file: file.name, host: target.host, filename });
}

async function handleHls(req, res, query) {
  const upstream = query.get('u');
  const token = query.get('s');
  if (!upstream) throw Object.assign(new Error('Missing ?u='), { status: 400 });
  if (!hls.verify(upstream, token)) {
    throw Object.assign(new Error('Bad or expired stream token.'), { status: 403 });
  }
  let parsed;
  try {
    parsed = new URL(upstream);
  } catch {
    throw Object.assign(new Error('Bad upstream URL.'), { status: 400 });
  }
  // Defence in depth — the real gate is the signed token above. This stops
  // the proxy being pointed at arbitrary hosts even with a valid signature.
  const allowed = /terabox|4funbox|nephobox|mirrobox|momerybox|tibibox|terashare|terafile|dubox|mibox|hdsfbox|gibibox|goaibox/i;
  if (!allowed.test(parsed.hostname)) {
    throw Object.assign(new Error('Upstream host is not allowed.'), { status: 403 });
  }
  await hls.proxy(req, res, upstream);
}

function handleHealth(res) {
  const available = providers.available();
  ok(res, {
    status: available.length ? 'ok' : 'degraded',
    providers: {
      configured: available,
      commercial: providers.commercial.enabled,
      diskwala: providers.diskwala.enabled,
      openplatform: providers.openplatform.enabled,
      web: providers.web.enabled,
    },
    brand: config.brand.name,
    version: require('../../package.json').version,
    time: new Date().toISOString(),
  });
}

function handleConfig(res) {
  ok(res, {
    brand: config.brand,
    player: { hlsProxy: config.player.hlsProxy, quality: config.player.quality },
    limits: { rateLimitMax: config.server.rateLimit.max },
  });
}

/* -------------------------------------------------------------------- */
/* Dispatcher                                                            */
/* -------------------------------------------------------------------- */

async function handleApi(req, res, url) {
  const query = url.searchParams;
  const path = url.pathname.replace(/\/+$/, '') || '/api';

  switch (path) {
    case '/api/resolve':
      return handleResolve(req, res);
    case '/api/stream':
      return handleStream(req, res, query);
    case '/api/download':
      return handleDownload(req, res, query);
    case '/api/hls':
      return handleHls(req, res, query);
    case '/api/health':
      return handleHealth(res);
    case '/api/config':
      return handleConfig(res);
    default:
      return send(res, 404, { ok: false, error: 'Unknown API endpoint.', code: 'NO_ROUTE' });
  }
}

module.exports = { handleApi, providers, send, fail, readBody, publicFile };
