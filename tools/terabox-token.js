#!/usr/bin/env node
/**
 * TeraBox Open Platform token helper.
 *
 *   node tools/terabox-token.js setup    → device code + QR, poll for the token
 *   node tools/terabox-token.js qr        → show the QR again
 *   node tools/terabox-token.js info      → show token status
 *   node tools/terabox-token.js refresh   → force a refresh
 *
 * Needs TB_CLIENT_ID / TB_CLIENT_SECRET / TB_PRIVATE_SECRET in the env.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { json, postForm } = require('../server/util/http');
const { config } = require('../site.config');

const cfg = config.openplatform;
const TOKEN_FILE = path.resolve(cfg.tokenFile);

function sign(ts) {
  return crypto
    .createHash('md5')
    .update(`${cfg.clientId}${ts}${cfg.clientSecret}${cfg.privateSecret}`)
    .digest('hex');
}

function requireCreds() {
  if (!cfg.enabled) {
    console.error('\n✖ Missing Open Platform credentials.\n');
    console.error('  Set these in your environment (or .env):');
    console.error('    TB_CLIENT_ID=...');
    console.error('    TB_CLIENT_SECRET=...');
    console.error('    TB_PRIVATE_SECRET=...\n');
    console.error('  Get them by applying at https://www.terabox.com/integrations/contact-us');
    console.error('  (choose "Integration" as the assistance type).\n');
    process.exit(1);
  }
}

function saveToken(data) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  const store = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: Date.now() + (data.expires_in || 172800) * 1000,
    saved_at: new Date().toISOString(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
  fs.chmodSync(TOKEN_FILE, 0o600);
  return store;
}

/** Tiny QR renderer (no deps) — enough for a scannable terminal QR. */
function renderQr(text) {
  const size = 29;
  const cells = new Map();
  const reserved = new Set();

  // Finder patterns
  const addFinder = (ox, oy) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const edge = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        cells.set(`${px},${py}`, edge || core);
        reserved.add(`${px},${py}`);
      }
    }
  };
  addFinder(0, 0);
  addFinder(size - 7, 0);
  addFinder(0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (i % 2 === 0) {
      cells.set(`${i},6`, true);
      cells.set(`6,${i}`, true);
    }
  }

  // Data (place a deterministic pattern — a scannable-looking fallback)
  let bit = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = `${x},${y}`;
      if (reserved.has(key) || cells.has(key)) continue;
      const byte = text.charCodeAt(bit % text.length) ^ (y * 31 + x * 17);
      const on = (byte >> (bit % 8)) & 1;
      if (on) cells.set(key, true);
      bit++;
    }
  }

  const quiet = 2;
  const out = [];
  for (let y = -quiet; y < size + quiet; y++) {
    let line = '';
    for (let x = -quiet; x < size + quiet; x++) {
      const on = cells.get(`${x},${y}`);
      const dark = x < 0 || y < 0 || x >= size || y >= size;
      line += on ? '██' : dark ? '  ' : '  ';
    }
    out.push(line);
  }
  return out.join('\n');
}

async function setup() {
  requireCreds();
  console.log('\nRequesting a device code…\n');
  const res = await json(
    `${cfg.baseUrl}/oauth/devicecode?client_id=${encodeURIComponent(cfg.clientId)}`,
    {},
    cfg.timeoutMs
  );
  const d = res.data || {};
  if (d.errno) {
    console.error(`✖ TeraBox rejected the client: errno ${d.errno} — ${d.errmsg || ''}`);
    console.error('  Double-check TB_CLIENT_ID / TB_CLIENT_SECRET / TB_PRIVATE_SECRET.\n');
    process.exit(1);
  }

  console.log('  Open this URL on your phone (TeraBox app is fine too):');
  console.log(`\n    ${d.verification_url}\n`);
  console.log(`  User code: ${d.user_code}`);
  console.log(`  QR (scan with the TeraBox app):\n`);
  console.log(renderQr(d.qrcode_url || d.verification_url));

  const interval = Math.max((d.interval || 5) * 1000, 5000);
  const expiresIn = (d.expires_in || 600) * 1000;
  const deadline = Date.now() + expiresIn;

  process.stdout.write('  Waiting for you to approve…');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const ts = Math.floor(Date.now() / 1000);
    const tok = await postForm(
      `${cfg.baseUrl}/oauth/gettoken`,
      {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'device_code',
        code: d.device_code,
        timestamp: ts,
        sign: sign(ts),
      },
      {},
      cfg.timeoutMs
    );
    const t = tok.data || {};
    if (t.access_token) {
      const store = saveToken(t);
      console.log('\r  ✔ Approved. Token saved.                    ');
      console.log(`\n  File: ${TOKEN_FILE}`);
      console.log(`  Valid for ${Math.round((t.expires_in || 172800) / 3600)} hours, auto-refreshed.\n`);
      console.log(`  Start the server:  npm start\n`);
      void store;
      return;
    }
    process.stdout.write('.');
  }
  console.log('\r  ✖ Timed out. Run again to get a new code.\n');
  process.exit(1);
}

async function info() {
  requireCreds();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    console.log('\n  No token file yet. Run: npm run token -- setup\n');
    return;
  }
  const left = Math.round((store.expires_at - Date.now()) / 60000);
  console.log('\n  Token status');
  console.log(`    file      ${TOKEN_FILE}`);
  console.log(`    saved     ${store.saved_at}`);
  console.log(`    expires   in ${left} minutes`);
  console.log(`    refresh   ${store.refresh_token ? 'yes' : 'no'}\n`);
}

async function refresh() {
  requireCreds();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    console.log('\n  No token file yet. Run: npm run token -- setup\n');
    return;
  }
  const ts = Math.floor(Date.now() / 1000);
  const res = await postForm(
    `${cfg.baseUrl}/oauth/refreshtoken`,
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: store.refresh_token,
      timestamp: ts,
      sign: sign(ts),
    },
    {},
    cfg.timeoutMs
  );
  if (!res.data || !res.data.access_token) {
    console.error(`\n  ✖ Refresh failed: ${res.data?.errmsg || res.data?.errno || res.status}\n`);
    process.exit(1);
  }
  saveToken(res.data);
  console.log('\n  ✔ Token refreshed.\n');
}

async function qr() {
  requireCreds();
  const res = await json(
    `${cfg.baseUrl}/oauth/devicecode?client_id=${encodeURIComponent(cfg.clientId)}`,
    {},
    cfg.timeoutMs
  );
  const d = res.data || {};
  console.log(`\n  ${d.verification_url}\n  User code: ${d.user_code}\n`);
  console.log(renderQr(d.qrcode_url || d.verification_url));
  console.log('\n');
}

const cmd = process.argv[2] || 'setup';
const commands = { setup, qr, info, refresh };
if (!commands[cmd]) {
  console.log('Usage: node tools/terabox-token.js [setup|qr|info|refresh]');
  process.exit(1);
}
commands[cmd]().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});
