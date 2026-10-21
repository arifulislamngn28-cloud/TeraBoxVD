# TeraBoxVD — Android app

An Expo (React Native) client for your **teraboxvd** server. Same four tabs as the
reference app's core loop: paste a link → browse → play → download.

```
android/
├─ app.json               expo config (package name, permissions, deep links)
├─ lib/api.js             API client (resolve / stream / download / health)
├─ lib/store.js           AsyncStorage: history + settings
└─ app/
   ├─ _layout.js          root stack
   ├─ player.js           expo-video player screen
   └─ (tabs)/
      ├─ index.js         paste link, browse, play, download
      ├─ downloads.js     local download list
      ├─ history.js       recent links
      └─ settings.js      server URL, connection check, toggles
```

## Run it

```bash
cd android
npm install

# point the app at your server (defaults to http://10.0.2.2:8080 = host from the emulator)
EXPO_PUBLIC_API_BASE=http://10.0.2.2:8080 npx expo start
```

Then press **a** for the Android emulator, or scan the QR with Expo Go.

On a **physical device** on the same wifi, use your machine's LAN IP:
`EXPO_PUBLIC_API_BASE=http://192.168.1.10:8080`.

## Build an APK

```bash
npx eas login
npx eas build -p android --profile preview     # → a shareable .apk
npx eas build -p android --profile production  # → .aab for the Play Store
```

`eas.json` is not included — run `eas build:configure` once to generate it.

## Before you ship it

See `../docs/REQUIREMENTS.md` §2 for the full list. The short version:

- [ ] `package` name in `app.json` → your own (e.g. `site.yourname.teraboxvd`)
- [ ] `icon` / `splash` assets in `assets/`
- [ ] signing keystore — `eas credentials`
- [ ] **AdMob** (optional): `expo install react-native-google-mobile-ads`, add the app id
      and the ad unit ids in `app.json` → `extra.adMob`
- [ ] **Firebase / analytics** (optional): `expo install @react-native-firebase/app`,
      drop `google-services.json` in the project root
- [ ] **Payments** for a VIP tier (optional): Razorpay (India) or Paddle (global) —
      **never** trust a "I am VIP" flag from the client, verify the order on your server
- [ ] **Play Integrity** (optional): anti-tamper for a paid app
- [ ] deep-link handling so `https://terabox.com/s/1…` opens the app (the `intentFilters`
      in `app.json` cover this)

## Notes

- The app never talks to TeraBox directly — everything goes through your own server, so
  one place to rotate keys, add caching, or block a domain.
- Downloads are resumable via `expo-file-system`'s `createDownloadResumable` and are saved
  to the gallery through `expo-media-library`.
- Stream quality: TeraBox only guarantees a 480p transcode. 720p/1080p often fail with
  errno 130 — the app falls back automatically.
