/**
 * TeraBox share-link parsing.
 *
 * Handles every shape TeraBox and its mirror domains hand out:
 *   https://www.terabox.com/s/1AbCdEfGh
 *   https://terabox.com/sharing/link?surl=1AbCdEfGh
 *   https://terabox.app/s/1AbCdEfGh?pwd=1234
 *   https://1024terabox.com/s/1AbCdEfGh#1234
 *   https://terabox.com/s/1AbCdEfGh?password=xyz9
 *
 * The "code" we keep is the part AFTER the leading "1" (that is what
 * TeraBox's own API calls `surl`), because /api/shorturlinfo wants the
 * code WITH the leading 1 while /share/list wants it WITHOUT.
 */

/** Domains known to serve the same TeraBox backend. */
const TERA_BOX_HOSTS = [
  'terabox.com',
  'www.terabox.com',
  'teraboxapp.com',
  'www.teraboxapp.com',
  'terabox.app',
  'www.terabox.app',
  'terabox.link',
  'www.terabox.link',
  'teraboxlink.com',
  'www.teraboxlink.com',
  'terasharefile.com',
  'www.terasharefile.com',
  'terafileshare.com',
  'www.terafileshare.com',
  'terasharelink.com',
  'www.terasharelink.com',
  'teraboxshare.com',
  'www.teraboxshare.com',
  'terabox.club',
  'www.terabox.club',
  'teraboxurl.com',
  'www.teraboxurl.com',
  'terabox.vip',
  'www.terabox.vip',
  'freeterabox.com',
  'www.freeterabox.com',
  '1024tera.com',
  'www.1024tera.com',
  '1024terabox.com',
  'www.1024terabox.com',
  '4funbox.com',
  '4funbox.co',
  'www.4funbox.com',
  'www.4funbox.co',
  'nephobox.com',
  'www.nephobox.com',
  'mirrobox.com',
  'www.mirrobox.com',
  'ww.mirrobox.com',
  'momerybox.com',
  'www.momerybox.com',
  'tibibox.com',
  'www.tibibox.com',
  'dubox.com',
  'www.dubox.com',
  'mibox.com',
  'www.mibox.com',
  'hdsfbox.com',
  'www.hdsfbox.com',
];

/** Short-code alphabet TeraBox uses (base58-ish, no 0/O/I/l). */
const CODE_RE = /^[A-Za-z0-9_-]{6,64}$/;

class LinkError extends Error {
  constructor(message, code = 'BAD_LINK') {
    super(message);
    this.name = 'LinkError';
    this.code = code;
    this.status = 400;
  }
}

/**
 * @param {string} raw user input (may be a bare code, not a full URL)
 * @returns {{code:string, shortUrl:string, surl:string, pwd:string|null,
 *            host:string, url:string, source:'url'|'code'}}
 */
function parseShareLink(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new LinkError('Paste a TeraBox share link first.');
  }
  let input = raw.trim();

  // Strip a leading "@" or quotes people paste by accident.
  input = input.replace(/^[@"']+|["']+$/g, '');

  // A bare code (no scheme, no slash) is accepted too.
  if (!/^https?:\/\//i.test(input) && !input.includes('/') && CODE_RE.test(input)) {
    const code = normalizeCode(input);
    return {
      code,
      surl: code,
      shortUrl: `1${code}`,
      pwd: null,
      host: 'www.terabox.com',
      url: `https://www.terabox.com/s/1${code}`,
      source: 'code',
    };
  }

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new LinkError('That does not look like a valid link.');
  }

  const host = u.hostname.toLowerCase();
  if (!TERA_BOX_HOSTS.includes(host)) {
    throw new LinkError(
      `Unsupported host "${host}". Use a terabox.com (or mirror) share link.`,
      'BAD_HOST'
    );
  }

  let code = null;

  // /s/<code>
  const sPath = u.pathname.match(/\/s\/([A-Za-z0-9_-]{4,64})/);
  if (sPath) {
    code = sPath[1];
  }

  // /sharing/link?surl=<code>  (also ?shorturl=)
  if (!code) {
    code =
      u.searchParams.get('surl') ||
      u.searchParams.get('shorturl') ||
      u.searchParams.get('code') ||
      null;
  }

  // /sharing/link/<code>
  if (!code) {
    const sharePath = u.pathname.match(/\/sharing\/link\/([A-Za-z0-9_-]{4,64})/);
    if (sharePath) code = sharePath[1];
  }

  // Last resort: a trailing path segment that looks like a code.
  if (!code) {
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (last && CODE_RE.test(last) && !['s', 'sharing', 'link', 'f'].includes(last)) {
      code = last;
    }
  }

  if (!code || !CODE_RE.test(code)) {
    throw new LinkError('No share code found in that link.', 'NO_CODE');
  }

  // The 4-char extraction code: ?pwd= / ?password= / #pwd
  const pwd =
    u.searchParams.get('pwd') ||
    u.searchParams.get('password') ||
    (u.hash && u.hash.length > 1 && !u.hash.includes('?') ? u.hash.slice(1) : null) ||
    null;

  code = normalizeCode(code);

  return {
    code,
    surl: code,
    shortUrl: `1${code}`,
    pwd: pwd ? String(pwd).trim().slice(0, 16) : null,
    host,
    url: `https://www.terabox.com/s/1${code}`,
    source: 'url',
  };
}

/**
 * TeraBox share codes start with "1" in the public URL (/s/1XXXX).
 * Everything downstream wants the part AFTER that "1".
 */
function normalizeCode(raw) {
  let code = String(raw).trim();
  // "1AbCdEf" -> "AbCdEf"
  if (code.length > 8 && code.startsWith('1')) code = code.slice(1);
  return code;
}

/** Does this string look like a TeraBox share link at all? */
function looksLikeShareLink(value) {
  if (typeof value !== 'string' || value.length < 6) return false;
  const v = value.trim().toLowerCase();
  if (v.includes('terabox') || v.includes('4funbox') || v.includes('nephobox')) return true;
  if (v.includes('mirrobox') || v.includes('1024tera') || v.includes('dubox')) return true;
  return /^https?:\/\//.test(v) && /\/s\/[a-z0-9_-]{6,}/.test(v);
}

module.exports = { parseShareLink, looksLikeShareLink, TERA_BOX_HOSTS, LinkError };
