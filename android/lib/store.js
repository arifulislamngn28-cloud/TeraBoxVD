/** Local persistence: history + settings, on AsyncStorage. */

import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'tbvd.history';
const SETTINGS_KEY = 'tbvd.settings';

export const DEFAULT_SETTINGS = {
  apiBase: '',
  autoPlay: true,
  saveToGallery: true,
  quality: 'auto',
};

export async function loadHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addHistory(entry) {
  const list = await loadHistory();
  const next = [
    { ...entry, at: Date.now() },
    ...list.filter((h) => h.url !== entry.url),
  ].slice(0, 50);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearHistory() {
  await AsyncStorage.removeItem(HISTORY_KEY);
  return [];
}

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
