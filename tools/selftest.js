#!/usr/bin/env node
/**
 * Self test — checks the wiring without needing a real share link.
 *
 *   node tools/selftest.js                     → config + provider checks
 *   node tools/selftest.js <share-link>        → full end-to-end resolve
 */

const { config } = require('../site.config');
const { Providers } = require('../server/providers');
const { parseShareLink } = require('../server/terabox/parse');
const hls = require('../server/terabox/hls');

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => console.log(`  ✖ ${m}`);
const info = (m) => console.log(`  · ${m}`);

async function main() {
  const providers = new Providers();

  console.log('\n teraboxvd self test\n');

  console.log(' Config');
  info(`brand        ${config.brand.name}`);
  info(`port         ${config.server.port}`);
  info(`provider     ${config.server.provider}`);
  info(`hls proxy    ${config.player.hlsProxy ? 'on' : 'off'}`);
  console.log('');

  console.log(' Providers');
  const available = providers.available();
  if (available.length) ok(`available: ${available.join(', ')}`);
  else bad('no provider is enabled');
  info(`commercial   ${providers.commercial.enabled ? 'configured' : 'not configured'}`);
  info(`diskwala     ${providers.diskwala.enabled ? 'configured' : 'not configured'}`);
  info(`openplatform ${providers.openplatform.enabled ? 'configured' : 'not configured'}`);
  info(`web (free)   ${providers.web.enabled ? 'available' : 'disabled'}`);
  console.log('');

  console.log(' Link parsing');
  const samples = [
    'https://www.terabox.com/s/1AbCdEfGh',
    'https://terabox.com/sharing/link?surl=1AbCdEfGh',
    'https://1024terabox.com/s/1AbCdEfGh?pwd=1234',
    'https://mirrobox.com/s/1AbCdEfGh#abcd',
    'https://terabox.app/s/1AbCdEfGh',
  ];
  for (const s of samples) {
    try {
      const p = parseShareLink(s);
      ok(`${s}  →  code=${p.code} pwd=${p.pwd || '-'}`);
    } catch (err) {
      bad(`${s}  →  ${err.message}`);
    }
  }
  console.log('');

  console.log(' HLS signing');
  const u = 'https://v.freeterabox.com/file/abc/playlist.m3u8';
  const sig = hls.sign(u);
  if (hls.verify(u, sig)) ok('sign / verify round trip works');
  else bad('sign / verify failed');
  if (!hls.verify(u, 'tampered.token')) ok('tampered token rejected');
  else bad('tampered token accepted');
  console.log('');

  const link = process.argv[2];
  if (!link) {
    console.log(' Live check skipped — pass a share link to test it:\n');
    console.log('   node tools/selftest.js "https://www.terabox.com/s/1xxxxxxx"\n');
    return 0;
  }

  console.log(' Live resolve');
  try {
    const t0 = Date.now();
    const res = await providers.resolve(link);
    ok(`resolved in ${Date.now() - t0}ms via ${res.provider}`);
    ok(`${res.total} file(s) · title "${res.title}"`);
    for (const f of res.files.slice(0, 10)) {
      info(`${f.isDir ? '📁' : '📄'} ${f.name}  ${f.sizeText}`);
    }
    const playable = res.files.find((f) => f.kind === 'video' || f.kind === 'audio');
    if (playable) {
      try {
        const s = await providers.streamUrl(res, playable);
        ok(`stream url ok (${s.type}) → ${s.url.slice(0, 90)}…`);
      } catch (err) {
        bad(`stream failed: ${err.message}`);
      }
    } else {
      info('no video/audio file to test streaming with');
    }
    const dl = res.files.find((f) => !f.isDir);
    if (dl) {
      const link2 = await providers.directLink(res, dl);
      if (link2) ok(`direct link ok → ${link2.slice(0, 90)}…`);
      else info('no direct link (expected without an API key / own account)');
    }
  } catch (err) {
    bad(`${err.code || 'ERROR'}: ${err.message}`);
    return 1;
  }

  console.log('');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n✖ ${err.stack}\n`);
    process.exit(1);
  });
