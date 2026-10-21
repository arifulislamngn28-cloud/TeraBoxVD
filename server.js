#!/usr/bin/env node
/**
 * teraboxvd — server entry point.
 *
 * Zero runtime dependencies: node:http + the standard library only.
 * Static files from ./public, JSON API under /api.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./site.config');
const { handleApi, fail, send } = require('./server/routes/api');
const log = require('./server/util/log');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = config.server.port;
const HOST = config.server.host;

/* -------------------------------------------------------------------- */
/* Static files                                                          */
/* -------------------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const target = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback for client-side routes.
      const index = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(index, (e2, buf) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(buf);
      });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
    };
    if (target.includes(`${path.sep}vendor${path.sep}`)) {
      headers['Cache-Control'] = 'public, max-age=604800';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    fs.createReadStream(target).pipe(res);
  });
}

/* -------------------------------------------------------------------- */
/* Rate limiting                                                         */
/* -------------------------------------------------------------------- */

const buckets = new Map();

function rateLimit(req) {
  const { windowMs, max } = config.server.rateLimit;
  const ip =
    (config.server.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) ||
    req.socket.remoteAddress ||
    'unknown';
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.reset) {
    buckets.set(ip, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { ok: false, retryAfter: Math.ceil((bucket.reset - now) / 1000) };
  }
  return { ok: true, remaining: max - bucket.count };
}

// keep the bucket map from growing forever
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 60_000).unref();

/* -------------------------------------------------------------------- */
/* Server                                                                */
/* -------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const limited = rateLimit(req);
    if (!limited.ok) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(limited.retryAfter),
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          ok: false,
          error: `Too many requests. Try again in ${limited.retryAfter}s.`,
          code: 'RATE_LIMITED',
        })
      );
      return;
    }
    try {
      await handleApi(req, res, url);
    } catch (err) {
      fail(res, err);
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { ok: false, error: 'Method not allowed.', code: 'BAD_METHOD' });
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  const providers = require('./server/routes/api').providers.available();
  log.info(`${config.brand.name} listening on http://${HOST}:${PORT}`);
  log.info(`providers enabled: ${providers.join(', ') || 'none'}`);
});

process.on('unhandledRejection', (err) => {
  log.error('unhandled rejection', { err: err?.message || String(err) });
});

module.exports = server;
