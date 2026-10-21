#!/usr/bin/env node
/**
 * Optional Telegram bot for teraboxvd.
 *
 * The bot does not implement TeraBox logic of its own — it calls this same
 * project's HTTP API, so there is exactly one resolver to maintain.
 *
 *   /start                 → usage
 *   /list <url> [pwd]      → files in a share
 *   /get <url> <n> [pwd]   → direct download link for file n
 *   /play <url> [pwd]      → stream link (works in Telegram's built-in player
 *                            for mp4; HLS needs a player app)
 *
 * Setup:
 *   1. @BotFather → new bot → copy the token
 *   2. export TELEGRAM_BOT_TOKEN=123456:ABC-DEF
 *   3. export BOT_API_BASE=http://127.0.0.1:8080   (your running teraboxvd)
 *   4. npm run bot
 */

const { config } = require('../site.config');
const log = require('../server/util/log');

const TOKEN = config.bot.token;
const API_BASE = (config.bot.apiBase || `http://127.0.0.1:${config.server.port}`).replace(/\/$/, '');

if (!TOKEN) {
  console.error('\n✖ TELEGRAM_BOT_TOKEN is not set.\n');
  console.error('  1. Open @BotFather, create a bot, copy the token');
  console.error('  2. export TELEGRAM_BOT_TOKEN=123456:ABC-DEF');
  console.error('  3. export BOT_API_BASE=http://127.0.0.1:8080');
  console.error('  4. npm run bot\n');
  process.exit(1);
}

const API = `${process.env.TELEGRAM_API || 'https://api.telegram.org'}/bot${TOKEN}`;

/* -------------------------------------------------------------------- */
/* Telegram plumbing                                                     */
/* -------------------------------------------------------------------- */

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) log.warn('telegram error', { method, error: json.description });
  return json;
}

const send = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, ...extra });

async function onMessage(msg) {
  const chat_id = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!text.startsWith('/')) return;

  const [cmd, ...rest] = text.split(/\s+/);
  const command = cmd.split('@')[0].toLowerCase();

  if (command === '/start' || command === '/help') {
    await send(
      chat_id,
      [
        '*TeraBoxVD bot*',
        '',
        'Paste any TeraBox share link and I will list what is inside it.',
        '',
        '`/list <link> [code]` — list files',
        '`/get <link> <n> [code]` — direct download link for file n',
        '`/play <link> [code]` — stream link',
        '',
        '_Only for files you own or are allowed to download._',
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (!['/list', '/get', '/play'].includes(command)) {
    await send(chat_id, 'Unknown command. Try /start');
    return;
  }

  const url = rest.shift();
  if (!url) {
    await send(chat_id, 'Send the link like this:\n`/list https://www.terabox.com/s/1XXXX`');
    return;
  }
  const pwd = rest.length ? rest.pop() : null;

  try {
    if (command === '/get') {
      const index = Number.parseInt(rest[0], 10);
      if (!Number.isFinite(index)) {
        await send(chat_id, 'Give the file number, e.g. `/get <link> 1`');
        return;
      }
      const resolved = await resolve(url, pwd);
      const file = resolved.files[index - 1];
      if (!file) {
        await send(chat_id, `That share only has ${resolved.files.length} file(s).`);
        return;
      }
      const link = await downloadLink(url, file, pwd, resolved);
      await send(
        chat_id,
        link
          ? `*${file.name}*\n${file.sizeText}\n\n${link}`
          : `No direct link available for this file. Ask the bot owner to enable an API key.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const resolved = await resolve(url, pwd);
    if (command === '/play') {
      const video = resolved.files.find((f) => f.kind === 'video');
      if (!video) {
        await send(chat_id, 'No video file in this share.');
        return;
      }
      const src = await streamLink(url, video, pwd);
      await send(chat_id, `*${video.name}*\n${video.sizeText}\n\n${src}`, { parse_mode: 'Markdown' });
      return;
    }

    const lines = resolved.files
      .slice(0, 40)
      .map((f, i) => `${i + 1}. ${f.isDir ? '📁' : '📄'} ${f.name}  _${f.sizeText}_`);
    await send(
      chat_id,
      [`*${resolved.total} file(s)*`, '', ...lines].join('\n'),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await send(chat_id, `⚠️ ${err.message}`);
  }
}

/* -------------------------------------------------------------------- */
/* Calls into our own API                                                */
/* -------------------------------------------------------------------- */

async function resolve(url, pwd) {
  const res = await fetch(`${API_BASE}/api/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, pwd: pwd || undefined }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not resolve that link.');
  return json;
}

async function streamLink(url, file, pwd) {
  const res = await fetch(`${API_BASE}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, pwd: pwd || undefined, fs_id: file.fs_id }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'No stream available.');
  return json.src.startsWith('http') ? json.src : `${API_BASE}${json.src}`;
}

async function downloadLink(url, file, pwd, resolved) {
  const u = new URL(`${API_BASE}/api/download`);
  u.searchParams.set('url', url);
  if (pwd) u.searchParams.set('pwd', pwd);
  u.searchParams.set('fs_id', file.fs_id);
  const res = await fetch(u, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) return res.headers.get('location');
  const json = await res.json().catch(() => ({}));
  throw new Error(json.error || 'No direct link available.');
}

/* -------------------------------------------------------------------- */
/* Long polling loop                                                     */
/* -------------------------------------------------------------------- */

async function loop() {
  log.info(`telegram bot polling → ${API_BASE}`);
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`);
      const json = await res.json();
      if (json.ok && Array.isArray(json.result)) {
        for (const update of json.result) {
          offset = update.update_id + 1;
          if (update.message) {
            onMessage(update.message).catch((e) => log.error('handler failed', { e: e.message }));
          }
        }
      }
    } catch (err) {
      log.warn('poll failed', { e: err.message });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

loop();
