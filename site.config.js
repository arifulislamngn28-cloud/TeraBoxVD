/**
 * teraboxvd — single source of truth for branding + wiring.
 * Everything the operator needs to change lives here or in .env.
 */

const config = {
  /* ------------------------------------------------------------------ */
  /* Branding                                                            */
  /* ------------------------------------------------------------------ */
  brand: {
    name: 'TeraBoxVD',
    tagline: 'Paste a TeraBox link. Stream it. Download it.',
    domain: 'teraboxvd.com',
    supportEmail: 'support@teraboxvd.com',
    telegram: '@teraboxvd',
    themeColor: '#0B1220',
    accent: '#22C55E',
  },

  /* ------------------------------------------------------------------ */
  /* Server                                                              */
  /* ------------------------------------------------------------------ */
  server: {
    port: Number(process.env.PORT) || 8080,
    host: process.env.HOST || '0.0.0.0',
    // 'auto' | 'teraboxapi' | 'diskwala' | 'openplatform' | 'web'
    provider: process.env.PROVIDER || 'auto',
    trustProxy: process.env.TRUST_PROXY === '1',
    // Rate limit: max resolves per IP per minute.
    rateLimit: { windowMs: 60_000, max: Number(process.env.RATE_LIMIT_MAX) || 30 },
    // Cache TTLs (ms)
    cache: {
      resolve: Number(process.env.CACHE_RESOLVE_MS) || 5 * 60_000,
      list: Number(process.env.CACHE_LIST_MS) || 3 * 60_000,
    },
  },

  /* ------------------------------------------------------------------ */
  /* Provider: commercial TeraBox API (api.teraboxdl.site)               */
  /* Docs: https://teraboxapi.com/docs                                   */
  /* ------------------------------------------------------------------ */
  teraboxapi: {
    enabled: Boolean(process.env.TBX_API_KEY && process.env.TBX_API_SECRET),
    baseUrl: process.env.TBX_API_BASE || 'https://api.teraboxdl.site',
    path: process.env.TBX_API_PATH || '/v1/api',
    apiKey: process.env.TBX_API_KEY || '',
    apiSecret: process.env.TBX_API_SECRET || '',
    // HMAC message template: METHOD + PATH + timestamp + body
    signTemplate: process.env.TBX_SIGN_TEMPLATE || 'POST/v1/api',
    timeoutMs: Number(process.env.TBX_TIMEOUT_MS) || 20_000,
  },

  /* ------------------------------------------------------------------ */
  /* Provider: DiskWala API (same vendor, lifetime quota)                */
  /* Endpoints observed in TeraBoxDL 1.3.5 bundle:                       */
  /*   /v1/app-api/diskwala/decrypt                                     */
  /*   /v1/app-api/download_diskwala?url=                              */
  /* ------------------------------------------------------------------ */
  diskwala: {
    enabled: Boolean(process.env.DISKWALA_API_KEY),
    baseUrl: process.env.DISKWALA_BASE || 'https://api.teraboxdl.site',
    apiKey: process.env.DISKWALA_API_KEY || '',
    apiSecret: process.env.DISKWALA_API_SECRET || '',
    decryptPath: '/v1/app-api/diskwala/decrypt',
    downloadPath: '/v1/app-api/download_diskwala',
    timeoutMs: Number(process.env.DISKWALA_TIMEOUT_MS) || 20_000,
  },

  /* ------------------------------------------------------------------ */
  /* Provider: TeraBox Open Platform (your own account — free)          */
  /* Apply: https://www.terabox.com/integrations/contact-us              */
  /* Token file path is written by `npm run token`                       */
  /* ------------------------------------------------------------------ */
  openplatform: {
    enabled: Boolean(process.env.TB_CLIENT_ID && process.env.TB_CLIENT_SECRET && process.env.TB_PRIVATE_SECRET),
    baseUrl: process.env.TB_BASE || 'https://www.terabox.com',
    clientId: process.env.TB_CLIENT_ID || '',
    clientSecret: process.env.TB_CLIENT_SECRET || '',
    privateSecret: process.env.TB_PRIVATE_SECRET || '',
    tokenFile: process.env.TB_TOKEN_FILE || './data/terabox-token.json',
    timeoutMs: Number(process.env.TB_TIMEOUT_MS) || 20_000,
  },

  /* ------------------------------------------------------------------ */
  /* Provider: anonymous web-share API (free, no key, no direct dl)      */
  /* ------------------------------------------------------------------ */
  web: {
    enabled: true,
    baseUrl: process.env.TB_WEB_BASE || 'https://www.terabox.com',
    appId: process.env.TB_APP_ID || '250528',
    channel: process.env.TB_CHANNEL || 'dubox',
    userAgent:
      process.env.TB_UA ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    timeoutMs: Number(process.env.TB_WEB_TIMEOUT_MS) || 20_000,
  },

  /* ------------------------------------------------------------------ */
  /* Streaming / player                                                  */
  /* ------------------------------------------------------------------ */
  player: {
    // HLS proxy is on by default: keeps CORS happy and hides upstream URLs.
    hlsProxy: process.env.HLS_PROXY !== '0',
    // 'auto' | '480' | '720' | '1080'
    quality: process.env.STREAM_QUALITY || 'auto',
    types: {
      480: 'M3U8_AUTO_480',
      720: 'M3U8_AUTO_720',
      1080: 'M3U8_AUTO_1080',
    },
  },

  /* ------------------------------------------------------------------ */
  /* Telegram bot (optional)                                             */
  /* ------------------------------------------------------------------ */
  bot: {
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    // Bot talks to the web app's own API so there is one source of truth.
    apiBase: process.env.BOT_API_BASE || '',
  },
};

/**
 * Provider order used when PROVIDER=auto.
 * First one that can actually serve the request wins.
 */
const AUTO_ORDER = ['teraboxapi', 'diskwala', 'openplatform', 'web'];

module.exports = { config, AUTO_ORDER };
