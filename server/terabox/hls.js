/**
 * HLS proxy.
 *
 * TeraBox's playlists point at *.freeterabox.com segment URLs which do not
 * send CORS headers — a browser <video> cannot fetch them directly. So we
 * rewrite every URI in the playlist to go through our own server, and the
 * server streams the bytes back (with Range support for seeking).
 *
 * To stop this turning into an open proxy, every upstream URL is signed
 * with an HMAC using a per-process secret.
 */

const crypto = require('node:crypto');
const { fetchWithTimeout } = require('../util/http');
const log = require('../util/log');

const SECRET = process.env.PROXY_SECRET || crypto.randomBytes(24).toString('hex');
const TTL_MS = 30 * 60_000;

/** Signed URL tokens are short-lived. */
function sign(url) {
  const exp = Date.now() + TTL_MS;
  const payload = `${exp}.${url}`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${exp}.${mac}`;
}

function verify(url, token) {
  if (!token) return false;
  const [exp, mac] = String(token).split('.');
  if (!exp || !mac) return false;
  if (Number(exp) < Date.now()) return false;
  const payload = `${exp}.${url}`;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Rewrite a playlist so every URI points back at us.
 * Handles both media playlists (.m3u8) and master playlists.
 */
function rewritePlaylist(text, upstreamUrl, basePath = '/api/hls') {
  const base = new URL(upstreamUrl);
  const lines = text.split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith('#')) {
      // URI="..." attributes inside EXT-X-KEY / EXT-X-MEDIA need rewriting too.
      out.push(
        line.replace(/URI="([^"]+)"/g, (full, uri) => {
          if (uri.startsWith('data:') || uri.startsWith('/api/')) return full;
          const abs = new URL(uri, base).toString();
          return `URI="${basePath}?u=${encodeURIComponent(abs)}&s=${sign(abs)}"`;
        })
      );
      continue;
    }

    // A bare URI line.
    if (trimmed.startsWith('data:')) {
      out.push(line);
      continue;
    }
    let abs;
    try {
      abs = new URL(trimmed, base).toString();
    } catch {
      out.push(line);
      continue;
    }
    out.push(`${basePath}?u=${encodeURIComponent(abs)}&s=${sign(abs)}`);
  }

  return out.join('\n');
}

/**
 * Proxy a playlist (text) or a media segment (binary).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} upstreamUrl
 */
async function proxy(req, res, upstreamUrl) {
  const headers = {
    'User-Agent':
      process.env.TB_UA ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: '*/*',
    Referer: 'https://www.terabox.com/',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetchWithTimeout(upstreamUrl, { headers }, 30_000);
  if (!upstream.ok && upstream.status !== 206) {
    res.writeHead(upstream.status, { 'Content-Type': 'text/plain' });
    res.end(`Upstream error ${upstream.status}`);
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  const ct = contentType.toLowerCase();
  const looksLikePlaylist =
    ct.includes('mpegurl') ||
    ct.includes('m3u8') ||
    ct.includes('vnd.apple') ||
    ct.startsWith('text/');

  if (looksLikePlaylist) {
    const text = await upstream.text();
    if (text.includes('#EXTM3U')) {
      const rewritten = rewritePlaylist(text, upstreamUrl, '/api/hls');
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(rewritten);
      return;
    }
    // Not a playlist after all — fall through and stream it raw.
    res.writeHead(200, {
      'Content-Type': contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(text);
    return;
  }

  const outHeaders = {
    'Content-Type': contentType || 'video/mp2t',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  res.writeHead(upstream.status, outHeaders);
  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (res.writableEnded) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

module.exports = { sign, verify, rewritePlaylist, proxy, SECRET };
