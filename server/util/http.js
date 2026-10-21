/**
 * Small HTTP helpers: timeout-aware fetch, a cookie jar, and a
 * throw-on-non-2xx JSON call. No external dependencies on purpose.
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class HttpError extends Error {
  constructor(message, status = 502, body = '') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Minimal cookie jar — enough for TeraBox's browserid / BDCLND dance. */
class CookieJar {
  constructor() {
    this.jar = new Map();
  }

  absorb(response) {
    const list =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie')]
          : [];
    for (const raw of list) {
      for (const chunk of String(raw).split(/,(?=\s*[^;=]+=)/)) {
        const [pair] = chunk.split(';');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!value || /expires=Thu, 01 Jan 1970/i.test(chunk)) {
          this.jar.delete(name);
        } else {
          this.jar.set(name, value);
        }
      }
    }
    return this;
  }

  set(name, value) {
    this.jar.set(name, value);
    return this;
  }

  get(name) {
    return this.jar.get(name) || null;
  }

  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.jar);
  }
}

/**
 * fetch() with a hard timeout. AbortController handles the socket hang.
 * TeraBox's CDN drops connections often, so we retry transient failures.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') {
        lastErr = new Error(`timed out after ${timeoutMs}ms`);
      }
      if (attempt < retries) {
        // 250ms, 750ms — enough to ride out a flaky edge without stalling.
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1) * (attempt + 1)));
        continue;
      }
      throw new HttpError(
        `Network error contacting ${hostOf(url)}: ${lastErr.message}`,
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new HttpError(`Network error contacting ${hostOf(url)}: ${lastErr?.message}`, 502);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'upstream';
  }
}

/** GET/POST JSON with sane defaults. Never throws on non-2xx — returns status. */
async function json(url, options = {}, timeoutMs = 20_000) {
  const res = await fetchWithTimeout(
    url,
    {
      ...options,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json, text/plain, */*',
        ...(options.headers || {}),
      },
    },
    timeoutMs
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, data, headers: res.headers, text };
}

/** POST JSON body. */
function postJson(url, body, options = {}, timeoutMs = 20_000) {
  return json(
    url,
    {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    },
    timeoutMs
  );
}

/** POST form-encoded. */
function postForm(url, fields, options = {}, timeoutMs = 20_000) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) usp.append(k, String(v));
  }
  return json(
    url,
    {
      method: 'POST',
      body: usp.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(options.headers || {}) },
      ...options,
    },
    timeoutMs
  );
}

module.exports = { fetchWithTimeout, json, postJson, postForm, CookieJar, HttpError, DEFAULT_UA };
