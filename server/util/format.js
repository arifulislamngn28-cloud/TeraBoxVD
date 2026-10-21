/** Formatting helpers shared by API responses. */

/** TeraBox sends booleans as "0"/"1" strings — Boolean("0") is true, so coerce. */
function toBool(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === undefined || value === null) return false;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`;
}

const VIDEO_EXT = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg',
  'ts', 'm3u8', '3gp', 'rmvb', 'rm', 'vob', 'ogv',
]);
const AUDIO_EXT = new Set(['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']);

function extOf(name = '') {
  const clean = String(name).split('?')[0];
  const idx = clean.lastIndexOf('.');
  return idx === -1 ? '' : clean.slice(idx + 1).toLowerCase();
}

function kindOf(name, isDir = false) {
  if (isDir) return 'folder';
  const e = extOf(name);
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (IMAGE_EXT.has(e)) return 'image';
  if (ARCHIVE_EXT.has(e)) return 'archive';
  return 'file';
}

function isPlayable(kind) {
  return kind === 'video' || kind === 'audio';
}

module.exports = { formatSize, kindOf, isPlayable, extOf, toBool, toNum, VIDEO_EXT, AUDIO_EXT, IMAGE_EXT };
