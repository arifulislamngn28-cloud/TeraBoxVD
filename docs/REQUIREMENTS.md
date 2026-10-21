# teraboxvd — Requirements & Integration Map

**Everything you need to build this, and everything you have to connect to.**

Written after reverse-engineering `TeraBoxDL_1.3.5_APKPure.xapk` (the reference app you
attached) and reading TeraBox's own web-share JS bundle + Open Platform docs.

---

## 0. What the reference app actually is

| | |
|---|---|
| Package | `site.teraboxdl.player` |
| Version | 1.3.5 (build 146) |
| Stack | React Native 0.81 + Expo SDK 54, expo-router, New Architecture, Hermes |
| Screens | `(tabs)/index` · `downloads` · `history` · `links` · `settings` · `telegram` |
| Player | `expo-video` + a web player at `player.teraboxdl.site` |
| Ads | Google AdMob (banner, interstitial, rewarded, rewarded-interstitial, app-open) + Meta Audience Network |
| Analytics | Firebase Analytics + Remote Config + Push (FCM) |
| Updates | Expo Updates, channel `ronnie_0077`, endpoint `api.teraboxdl.site/api/updates` |
| Payments | UPI / Google Pay / Paytm (Razorpay-style) for VIP passes |
| Integrity | Play Integrity API (`androidCloudProjectNumber: 206479040406`) |
| Media | expo-media-library (save to gallery), expo-notifications, expo-file-system |

**The app is a thin client.** It does not decode TeraBox itself — it calls a vendor API and
renders the result. That is the single most important architectural fact.

### Endpoints the app bundle calls

```
GET  https://player.teraboxdl.site?browsers-share…      ← web player (HLS)
POST https://api.teraboxdl.site/v1/api                   ← commercial extraction API
POST https://api.teraboxdl.site/v1/app-api/diskwala/decrypt
GET  https://api.teraboxdl.site/v1/app-api/download_diskwala?url=
GET  https://api.teraboxdl.site/v1/app-api/flezen
GET  https://api.teraboxdl.site/v1/app-api/flezen_file_size
POST https://api.teraboxdl.site/api/checkout/verify      ← payment verification
GET  https://api.teraboxdl.site/api/checkout/history
POST https://api.teraboxdl.site/api/checkout/restore
GET  https://api.teraboxdl.site/api/updates              ← Expo OTA
```

Brand names inside the bundle — **DiskWala** and **Flezen** — are the vendor's white-label
products for the same underlying API. `Diskwala` = daily-quota plan, `Flezen` = lifetime-quota
plan, `TeraBox API` = the metered one. All three live behind `api.teraboxdl.site`.

---

## 1. The four ways to get file data — pick one

| # | Option | Cost | Direct download link? | Stream? | Effort |
|---|---|---|---|---|---|
| **A** | **Commercial TeraBox API** (`teraboxapi.com`) | $25–89/mo | ✅ | ✅ HLS | 5 min |
| **B** | **DiskWala / Flezen** lifetime API | one-off | ✅ | ✅ | 5 min |
| **C** | **Your own TeraBox account** (Open Platform) | free | ✅ | ✅ | 30 min + approval |
| **D** | **Anonymous web-share API** | free | ❌ | ✅ HLS | 0 min |

teraboxvd implements **all four** and picks the best available one at runtime
(`PROVIDER=auto`). Start with **D** (works instantly, listing + streaming), add **A** or **C**
when you want download buttons to work.

### Option A — Commercial TeraBox API

* **Where to get it:** https://teraboxapi.com (AR Digital Services) · docs at
  https://teraboxapi.com/docs
* **Pricing:** Starter $25/mo (20k req/day) · Professional $45/mo (50k/day) ·
  Enterprise $89/mo (100k/day). 100 free lifetime requests to try it.
* **Auth:** three headers, HMAC-SHA256 signed.

```
POST https://api.teraboxdl.site/v1/api
Content-Type: application/json
X-API-Key:    tbx_xxxxxxxx
X-Timestamp:  1792566692
X-Signature:  HMAC_SHA256("POST/v1/api" + timestamp + body, apiSecret)

body: {"url":"https://terabox.com/s/1…","dir_path":"","page":1}
```

**Response shape:**

```json
{
  "errno": 0,
  "request_id": 1744212345678900,
  "server_time": 1744212345,
  "title": "…",
  "total_size_bytes": 104857600,
  "list": [{
    "fs_id": 123456789,
    "server_filename": "sample-video.mp4",
    "size": 104857600,
    "formatted_size": "100.00 MB",
    "direct_link": "https://d.terabox.app/file/…",
    "stream_url": "https://stream.terabox.app/stream/…",
    "stream_download_url": "https://…",
    "thumbs": { "url1": "https://…", "icon": "https://…" }
  }]
}
```

→ Set `TBX_API_KEY` + `TBX_API_SECRET`. That is the whole integration.

### Option B — DiskWala / Flezen

* **Where to get it:** the same vendor dashboard as above, "Lifetime" tab.
* **Auth:** `X-API-Key` header (exact payload shape is vendor-specific — read their docs).
* **Endpoints:** `POST /v1/app-api/diskwala/decrypt`,
  `GET /v1/app-api/download_diskwala?url=`, `GET /v1/app-api/flezen`,
  `GET /v1/app-api/flezen_file_size`.
* → Set `DISKWALA_API_KEY` (+ `DISKWALA_API_SECRET`).

### Option C — Your own TeraBox account (Open Platform)

* **Where to apply:** https://www.terabox.com/integrations/contact-us
  * assistance type must be **"Integration"**
  * ask for **AppKey (client_id), SecretKey (client_secret), private_secret**
  * they reply by email; the account that applied is the one that authorises the app
* **Flow:** device code → user scans QR in the TeraBox app → you get an access token.
* **Lifetimes:** access_token **2 days** (auto-refreshed by teraboxvd 5 min before expiry),
  refresh_token **30 days**, auth code 5 min, device code short-lived.
* **Signature:** `md5(client_id + timestamp + client_secret + private_secret)`
* **Endpoints** (base `https://www.terabox.com`):

| Call | Notes |
|---|---|
| `GET /oauth/devicecode?client_id=…` | → device_code, qrcode_url, user_code, interval |
| `POST /oauth/gettoken` | form: client_id, client_secret, grant_type, code, timestamp, sign |
| `POST /oauth/refreshtoken` | form: + refresh_token → new access token |
| `POST /openapi/share/verify` | body `pwd=` → `randsk` |
| `GET /openapi/api/shorturlinfo` | `shorturl=1<code>&root=1` → list[], uk |
| `GET /openapi/share/list` | `shorturl=<code>&root=1&dir=…&sekey=…` |
| `GET /openapi/share/download` | `shareid, uk, fid_list=[id], sekey` → `dlink` |
| `GET /openapi/share/streaming` | HLS |

* **sekey** = `base64(randsk)` from `/openapi/share/verify`.
* → Set `TB_CLIENT_ID`, `TB_CLIENT_SECRET`, `TB_PRIVATE_SECRET`, then run
  `npm run token -- setup` and scan the QR.

### Option D — Anonymous web-share API (free, no account)

This is the flow teraboxvd's `web` provider uses. It is the same one TeraBox's own web
player uses, so it is stable.

**Step 1 — bootstrap a session**

```
GET https://www.terabox.com/sharing/link?surl=<CODE>
→ Set-Cookie: browserid, csrfToken, lang, TSID
→ body contains window.jsToken  (192 hex chars) and templateData.pcftoken
```

> The token is embedded as
> `eval(decodeURIComponent(\`function%20fn%28a%29%7Bwindow.jsToken%20%3D%20a%7D%3Bfn%28%22…%22%29\`))`
> — note the **backticks**. A regex that only matches quotes silently fails and you get
> `errno 400210 need verify_v2`. This cost us an hour; don't repeat it.

**Step 2 — share info + root file list**

```
GET /api/shorturlinfo?app_id=250528&web=1&channel=dubox&clienttype=0
                &shorturl=1<CODE>&root=1&jsToken=<jsToken>
Cookie: browserid=…
Referer: https://www.terabox.com/sharing/link?surl=<CODE>
```

Returns `shareid, uk, sign, timestamp, randsk, list[]`.

| errno | meaning |
|---|---|
| `0` | ok |
| `-9` | extraction code required |
| `-6` / `-7` / `-11` | wrong extraction code |
| `-12` / `105` | link invalid or expired |
| `400210` | missing/invalid `jsToken` (usually a failed token extraction) |
| `2` | needs a signed-in session |

**Step 3 — extraction code (only if errno −9)**

```
POST /share/verify?app_id=250528&surl=<CODE>
body: pwd=<4 chars>          → sets the BDCLND cookie
```

**Step 4 — sub-folder listing**

```
GET /share/list?app_id=250528&web=1&channel=dubox&clienttype=0
                &shorturl=<CODE>&root=1&dir=<path>&page=1&num=200
```

`root` **must** be `1`. `shorturl` here has **no** leading `1` (unlike step 2).

**Step 5 — streaming (HLS)**

```
GET /share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=…
                     &shareid=…&uk=…&sign=…&timestamp=…
                     &type=M3U8_AUTO_480&fid=<fs_id>&psign=0
```

Returns a real `#EXTM3U` playlist whose segments live on `*.terabox.com` CDN hosts.
`M3U8_AUTO_720` / `_1080` often fail with errno 130 (not transcoded) — fall back to 480.

**Limits of option D:** the list and the HLS stream work fine anonymously, but `dlink` comes
back empty — **anonymous direct downloads are not possible**. That is exactly why the
provider chain exists.

---

## 2. Component checklist

### Backend (this repo — done ✅)

| File | Job |
|---|---|
| `site.config.js` | single source of truth: brand, ports, every provider's credentials |
| `server.js` | HTTP server, static files, rate limiting, CORS |
| `server/terabox/parse.js` | link parser: `/s/1…`, `?surl=…`, `?pwd=…`, `#code`, bare codes, 35 mirror domains |
| `server/terabox/web.js` | option D — anonymous resolver + HLS sign |
| `server/terabox/commercial.js` | option A — HMAC-signed extraction API client |
| `server/terabox/diskwala.js` | option B — DiskWala / Flezen adapters |
| `server/terabox/openplatform.js` | option C — OAuth device flow, token auto-refresh, `sekey` |
| `server/terabox/hls.js` | HLS proxy: playlist rewriting, signed URLs, Range support |
| `server/providers.js` | provider chain + fallback + caching |
| `server/routes/api.js` | `/api/resolve` `/api/stream` `/api/download` `/api/hls` `/api/health` `/api/config` |
| `server/util/*` | http w/ retries, TTL cache, logger, size/kind formatting |
| `tools/terabox-token.js` | Open Platform device-code setup + QR + refresh |
| `tools/selftest.js` | config / parsing / signing / live resolve check |
| `bot/telegram-bot.js` | optional Telegram bot on the same core |
| `public/` | responsive UI + hls.js player (vendored, MIT) |

### Frontend (done ✅)

- Paste-link form + optional extraction-code box
- Breadcrumb folder navigation
- Per-file: icon by kind, human size, ▶ Play, ↓ Get
- HLS.js player modal (native HLS on Safari/iOS)
- Light/dark theme, mobile-first, PWA manifest

### Android app (scaffold included in `android/`)

If you want a real APK like the reference, you need all of this:

| Piece | Why | Where to get it |
|---|---|---|
| Expo SDK 54 + expo-router | app shell, tabs, deep links | `npx create-expo-app` |
| `expo-video` | playback | npm |
| `expo-file-system` | background/resumable downloads | npm |
| `expo-media-library` | save to the phone gallery | npm |
| `expo-notifications` | download-complete push | npm |
| `@react-native-firebase/app` | analytics + remote config | npm + `google-services.json` |
| `react-native-google-mobile-ads` | ads (optional) | AdMob console → app id + ad unit ids |
| Play Integrity API | anti-tamper (the reference uses it) | Google Cloud → `androidCloudProjectNumber` |
| EAS Build / local Gradle | producing the APK | expo.dev account (free tier OK) |
| Signing key / keystore | Play Store upload | `eas credentials` |
| Package name + versionCode | identity | e.g. `site.teraboxvd.player` |
| expo-updates channel | OTA patches | `expo updates:configure` |

**Cost ladder for the app:**

1. **Free, no Play Store** — Expo Go + EAS build. No ads, no IAP. Ship in 1 day.
2. **Free with ads** — add AdMob (needs a real device + AdMob account, $0).
3. **Paid features** — you need a payment provider that works for you:
   * India → **Razorpay** (UPI, cards, netbanking)
   * Global → **Paddle** or **Stripe**
   * The reference app used a UPI-first flow (`paytm_payment_enabled`, `google-paytm`,
     `upi_id`, `generateOrderId`, `verifyBeforeUpdateEmail`).
4. **Your own backend** — VIP status, subscription expiry, device limits all live on
   *your* server (`/api/checkout/verify` style), not in the app. Never trust the client
   to say "I am a VIP user".

---

## 3. Things you must connect, ranked by importance

| Priority | What | Where it comes from | Required? |
|---|---|---|---|
| 1 | TeraBox share API | `www.terabox.com` | ✅ always |
| 2 | HLS CDN (segments) | `*.terabox.com` | ✅ for streaming |
| 3 | Extraction API key | teraboxapi.com | ⭕ for direct downloads |
| 4 | Open Platform app creds | terabox.com/integrations | ⭕ alternative to 3 |
| 5 | Firebase project | Firebase console | ⭕ only for the app |
| 6 | AdMob app + unit ids | AdMob console | ⭕ only for the app |
| 7 | Payment provider | Razorpay / Paddle / Stripe | ⭕ only for VIP |
| 8 | Play Integrity | Google Cloud | ⭕ anti-tamper |
| 9 | Telegram bot token | @BotFather | ⭕ optional bot |
| 10 | EAS build account | expo.dev | ⭕ to build the APK |

---

## 4. Run it

```bash
cd teraboxvd
cp .env.example .env          # fill in whatever you have
npm start                     # → http://localhost:8080
npm run selftest              # config + parsing + live resolve
```

Verify against a real link you own:

```bash
npm run selftest -- "https://www.terabox.com/s/1YOURCODEHERE"
```

---

## 5. Deploy

- **Render** — `render.yaml` included, free tier, set `TBX_API_KEY` / `TBX_API_SECRET` in
  the dashboard.
- **Railway / Koyeb / Fly.io** — `Dockerfile` included, no build command needed.
- **VPS** — `node server.js` behind nginx/Caddy. Set `TRUST_PROXY=1` so the rate limiter
  sees the real client IP, and set `PROXY_SECRET` to a long random string.

Set `PROXY_SECRET` in production. Without it a new random secret is generated on every
restart, which invalidates in-flight stream URLs (harmless, but wasteful).

---

## 6. Legal / house rules

- Only use this for files you own or that the owner shared with you.
- Respect TeraBox's terms — the commercial API at teraboxapi.com exists precisely so
  heavy users pay for the traffic instead of scraping it.
- If a rights holder asks you to remove a link, remove it. The reference app's own site
  advertises a DMCA takedown process; expect the same for yours.
- Stream, don't re-host. teraboxvd proxies HLS segments on the fly and never stores a
  file on disk.
- Put a "not affiliated with TeraBox" line in your footer (already in the template).
