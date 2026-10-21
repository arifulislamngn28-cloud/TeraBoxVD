import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { resolveShare, streamFile, absolute, API_BASE } from '../../lib/api';
import { addHistory } from '../../lib/store';

const ICONS = {
  folder: '📁',
  video: '🎬',
  audio: '🎵',
  image: '🖼️',
  archive: '🗜️',
  file: '📄',
};

export default function HomeScreen() {
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(null);
  const [dir, setDir] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [downloadPct, setDownloadPct] = useState(-1);

  const load = useCallback(
    async (targetDir = '') => {
      setBusy(true);
      setError('');
      try {
        const data = await resolveShare(url, { pwd: pwd.trim() || undefined, dir: targetDir });
        setShare(data);
        setFiles(data.files || []);
        setDir(targetDir);
        if (!targetDir) {
          await addHistory({ url, pwd: pwd.trim(), title: data.title, total: data.total });
        }
      } catch (err) {
        if (err.code === 'NEEDS_PASSWORD') setShowPwd(true);
        setError(err.message);
        if (!targetDir) {
          setShare(null);
          setFiles([]);
        }
      } finally {
        setBusy(false);
      }
    },
    [url, pwd]
  );

  async function onPlay(file) {
    try {
      const { src } = await streamFile(url, file.fs_id, { pwd: pwd.trim() || undefined, dir });
      router.push({
        pathname: '/player',
        params: { src: absolute(src), name: file.name, size: file.sizeText },
      });
    } catch (err) {
      Alert.alert('Cannot play', err.message);
    }
  }

  async function onDownload(file) {
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const MediaLibrary = await import('expo-media-library');

      const name = (file.name || 'file').split('/').pop();
      const target = `${FileSystem.cacheDirectory}${name}`;

      const u = new URL(`${API_BASE}/api/download`);
      u.searchParams.set('url', url);
      if (pwd.trim()) u.searchParams.set('pwd', pwd.trim());
      if (dir) u.searchParams.set('dir', dir);
      u.searchParams.set('fs_id', file.fs_id);

      const resumable = FileSystem.createDownloadResumable(
        u.toString(),
        target,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          const pct = totalBytesExpectedToWrite
            ? Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
            : 0;
          setDownloadPct(pct);
        }
      );

      const result = await resumable.downloadAsync();
      if (!result) throw new Error('Download was cancelled.');

      setDownloadPct(-1);

      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.granted) {
        await MediaLibrary.saveToLibraryAsync(target);
        Alert.alert('Saved', `Saved to your gallery: ${name}`);
      } else {
        Alert.alert('Saved to app storage', target);
      }
    } catch (err) {
      setDownloadPct(-1);
      Alert.alert('Download failed', err.message);
    }
  }

  function openFolder(file) {
    load(file.path);
  }

  const crumbs = dir ? dir.split('/').filter(Boolean) : [];

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="Paste a TeraBox share link"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
        />
        {showPwd && (
          <TextInput
            style={styles.input}
            value={pwd}
            onChangeText={setPwd}
            placeholder="Extraction code (4 characters)"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            maxLength={8}
          />
        )}
        <Pressable
          style={[styles.button, busy && { opacity: 0.6 }]}
          onPress={() => load('')}
          disabled={busy || !url.trim()}
        >
          {busy ? <ActivityIndicator color="#052E16" /> : <Text style={styles.buttonText}>Resolve</Text>}
        </Pressable>
        {share && (
          <Pressable onPress={() => setShowPwd((v) => !v)}>
            <Text style={styles.linkish}>
              {showPwd ? 'Hide extraction code' : 'Link needs a code?'}
            </Text>
          </Pressable>
        )}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {!!share && (
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {share.total} item(s) · {share.provider}
          </Text>
          {!!dir && (
            <Pressable onPress={() => load('')}>
              <Text style={styles.linkish}>← root</Text>
            </Pressable>
          )}
        </View>
      )}

      {crumbs.length > 0 && (
        <Text style={styles.crumbs} numberOfLines={1}>
          /{crumbs.join(' / ')}
        </Text>
      )}

      <FlatList
        data={files}
        keyExtractor={(f) => f.fs_id || f.path}
        contentContainerStyle={{ paddingBottom: 30 }}
        ListEmptyComponent={
          busy ? null : <Text style={styles.empty}>Paste a link and tap Resolve.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => (item.isDir ? openFolder(item) : onPlay(item))}
          >
            <Text style={styles.icon}>{ICONS[item.kind] || ICONS.file}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.sub}>
                {item.isDir ? 'Folder' : `${item.sizeText} · ${item.kind.toUpperCase()}`}
              </Text>
            </View>
            {!item.isDir && (
              <Pressable style={styles.chip} onPress={() => onDownload(item)}>
                <Text style={styles.chipText}>
                  {downloadPct >= 0 ? `${downloadPct}%` : 'Get'}
                </Text>
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 10 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    padding: 12,
    gap: 10,
  },
  input: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#111C31',
    paddingHorizontal: 14,
    color: '#E2E8F0',
    fontSize: 15,
  },
  button: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#052E16', fontSize: 15, fontWeight: '700' },
  linkish: { color: '#38BDF8', fontSize: 13, textAlign: 'center' },
  error: { color: '#FCA5A5', fontSize: 13.5, paddingHorizontal: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { color: '#64748B', fontSize: 12.5, flex: 1 },
  crumbs: { color: '#38BDF8', fontSize: 12.5 },
  empty: { color: '#64748B', textAlign: 'center', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    marginBottom: 8,
  },
  icon: { fontSize: 20 },
  rowMain: { flex: 1, minWidth: 0 },
  name: { color: '#E2E8F0', fontSize: 14.5 },
  sub: { color: '#64748B', fontSize: 12, marginTop: 2 },
  chip: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: '#94A3B8', fontSize: 12.5, fontWeight: '600' },
});
