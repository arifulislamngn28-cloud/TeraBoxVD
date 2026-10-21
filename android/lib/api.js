/**
 * API client — talks to your teraboxvd server.
 *
 * Set the base URL once:
 *   EXPO_PUBLIC_API_BASE=https://teraboxvd.com      (production)
 *   EXPO_PUBLIC_API_BASE=http://10.0.2.2:8080       (Android emulator → host)
 *   EXPO_PUBLIC_API_BASE=http://192.168.1.10:8080   (physical device on same wifi)
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

const fromEnv = process.env.EXPO_PUBLIC_API_BASE;
const fromExtra = Constants.expoConfig?.extra?.apiBase;

export const API_BASE = (fromEnv || fromExtra || 'http://10.0.2.2:8080').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: `Server returned ${res.status}.` };
  }
  if (!res.ok || body.ok === false) {
    throw new ApiError(body.error || `Request failed (${res.status}).`, body.code);
  }
  return body;
}

/** Resolve a share link into its file list. */
export function resolveShare(url, { pwd, dir = '', page = 1 } = {}) {
  return request('/api/resolve', {
    method: 'POST',
    body: JSON.stringify({ url, pwd: pwd || undefined, dir: dir || undefined, page }),
  });
}

/** Get a playable source url for one file. */
export function streamFile(url, fsId, { pwd, dir = '' } = {}) {
  return request('/api/stream', {
    method: 'POST',
    body: JSON.stringify({ url, pwd: pwd || undefined, fs_id: fsId, dir: dir || undefined }),
  });
}

/** Direct download url (302 → CDN). We resolve it ourselves so we can show a filename. */
export async function downloadFile(url, fsId, { pwd, dir = '' } = {}) {
  const u = new URL(`${API_BASE}/api/download`);
  u.searchParams.set('url', url);
  if (pwd) u.searchParams.set('pwd', pwd);
  if (dir) u.searchParams.set('dir', dir);
  u.searchParams.set('fs_id', fsId);

  const res = await fetch(u.toString(), { redirect: 'follow' });
  if (!res.ok) {
    let msg = `Download failed (${res.status}).`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* not json */
    }
    throw new ApiError(msg);
  }
  return res;
}

export function health() {
  return request('/api/health');
}

/** Absolute url for a relative /api/... path. */
export function absolute(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  return `${API_BASE}${pathOrUrl}`;
}

export const isAndroid = Platform.OS === 'android';
