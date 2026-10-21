# TeraBoxVD

Paste a TeraBox share link → browse the files → stream the video in your browser → grab a
direct download link.

Self-hosted, **zero runtime dependencies** (Node's standard library only), and it works with
no API key at all — you only need a key if you want *direct download* links.

> Built after reverse-engineering `TeraBoxDL 1.3.5` (React Native / Expo) and reading
> TeraBox's own web-share bundle. Full integration map in
> [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

---

## Quick start

```bash
cd teraboxvd
cp .env.example .env      # optional — the app works with an empty .env
npm start                 # → http://localhost:8080
```

Check the wiring at any time:

```bash
npm run selftest
npm run selftest -- "https://www.terabox.com/s/1YOURCODEHERE"
```

---

## What works without any account

| | Free (anonymous) | With API key / own account |
|---|---|---|
| List files in a share | ✅ | ✅ |
| Browse sub-folders | ✅ | ✅ |
| Extraction-code links | ✅ | ✅ |
| Stream video (HLS) | ✅ | ✅ |
| Direct download link | ❌ | ✅ |

TeraBox does not hand out anonymous `dlink`s any more. To get download buttons working, pick
one of these (all three are implemented — see `docs/REQUIREMENTS.md`):

1. **Commercial TeraBox API** — https://teraboxapi.com, from $25/mo.
   ```bash
   TBX_API_KEY=tbx_xxx
   TBX_API_SECRET=yyy
   ```
2. **DiskWala / Flezen lifetime API** — same vendor, one-off payment.
   ```bash
   DISKWALA_API_KEY=xxx
   ```
3. **Your own TeraBox account** (Open Platform) — free, but you must apply and wait.
   ```bash
   TB_CLIENT_ID=…  TB_CLIENT_SECRET=…  TB_PRIVATE_SECRET=…
   npm run token -- setup      # scan the QR with the TeraBox app
   ```

---

## API

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `POST` | `/api/resolve` | `{url, pwd?, dir?, page?}` | file list |
| `POST` | `/api/stream` | `{url, pwd?, fs_id, dir?}` | `{src}` — playable HLS url |
| `GET` | `/api/download` | `?url=&pwd=&fs_id=&dir=` | 302 to the CDN link |
| `GET` | `/api/hls` | `?u=&s=` | proxied playlist / segment |
| `GET` | `/api/health` | – | provider status |
| `GET` | `/api/config` | – | public config for the UI |

```bash
curl -X POST http://localhost:8080/api/resolve \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.terabox.com/s/1LNr3tyl5pI5KUM8BecGtyQ"}'
```

---

## Project layout

```
teraboxvd/
├─ site.config.js          brand + every credential in one file
├─ server.js               http server, static files, rate limit
├─ server/
│  ├─ providers.js         provider chain + fallback + cache
│  ├─ terabox/
│  │  ├─ parse.js          link parser (35 mirror domains)
│  │  ├─ web.js            anonymous resolver + HLS sign
│  │  ├─ commercial.js     api.teraboxdl.site HMAC client
│  │  ├─ diskwala.js       DiskWala / Flezen adapters
│  │  ├─ openplatform.js   OAuth device flow + token refresh
│  │  └─ hls.js            HLS proxy (playlist rewrite, signed URLs)
│  ├─ routes/api.js        the JSON API
│  └─ util/                http, cache, log, format
├─ tools/
│  ├─ terabox-token.js     Open Platform setup / QR / refresh
│  └─ selftest.js          config + parsing + live resolve
├─ bot/telegram-bot.js     optional Telegram bot
├─ android/                Expo app source (the mobile client)
└─ docs/REQUIREMENTS.md    ⭐ the full "what do I need / what do I connect" list
```

---

## Deploy

**Render** — `render.yaml` is included; push the repo and add the env vars in the dashboard.

**Docker** — `docker build -t teraboxvd . && docker run -p 8080:8080 -e TBX_API_KEY=… teraboxvd`

**VPS** — `node server.js` behind nginx/Caddy. Set `TRUST_PROXY=1` and a long random
`PROXY_SECRET`.

---

## Telegram bot (optional)

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC-DEF
export BOT_API_BASE=http://127.0.0.1:8080
npm run bot
```

`/list <link> [code]` · `/get <link> <n> [code]` · `/play <link> [code]`

---

## Android app

`android/` holds an Expo (React Native) client that talks to this same API — the same
six-tab shape as the reference app: home, downloads, history, links, settings.

```bash
cd android
npm install
npx expo start          # then press "a" for Android, or scan the QR
```

To ship it to the Play Store you need a package name, a keystore, an EAS build, and — if you
want ads — an AdMob app id. The full list is in `docs/REQUIREMENTS.md` §2.

---

## Notes & limits

- **Only for files you own or that the owner shared with you.** Respect copyright and
  TeraBox's terms.
- teraboxvd proxies HLS on the fly and never stores a file on disk.
- Not affiliated with TeraBox.
- The HLS proxy URL is signed with `PROXY_SECRET`; set a real one in production.

## License

MIT
