import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_BASE, health } from '../../lib/api';
import { loadSettings, saveSettings } from '../../lib/store';

export default function SettingsScreen() {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setApiBase(s.apiBase || API_BASE);
    });
    health()
      .then(setStatus)
      .catch(() => setStatus({ ok: false, error: 'Cannot reach the server.' }));
  }, []);

  async function update(patch) {
    const next = await saveSettings(patch);
    setSettings(next);
  }

  if (!settings) return <View style={styles.root} />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 40, gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.title}>Server</Text>
        <Text style={styles.hint}>
          Point the app at your own teraboxvd instance. Default: {API_BASE}
        </Text>
        <TextInput
          style={styles.input}
          value={apiBase}
          onChangeText={setApiBase}
          autoCapitalize="none"
          placeholder="https://teraboxvd.com"
          placeholderTextColor="#64748B"
        />
        <Pressable style={styles.button} onPress={() => update({ apiBase: apiBase.trim() })}>
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Connection</Text>
        {status?.ok ? (
          <>
            <Text style={styles.good}>● Connected</Text>
            <Text style={styles.hint}>
              Providers: {(status.providers?.configured || []).join(', ') || 'none'}
            </Text>
            <Text style={styles.hint}>Brand: {status.brand} · v{status.version}</Text>
          </>
        ) : (
          <Text style={styles.bad}>● {status?.error || 'Not connected'}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Playback</Text>
        <Toggle
          label="Autoplay when a file is opened"
          value={settings.autoPlay}
          onChange={(v) => update({ autoPlay: v })}
        />
        <Toggle
          label="Save downloads to the gallery"
          value={settings.saveToGallery}
          onChange={(v) => update({ saveToGallery: v })}
        />
        <Text style={styles.hint}>
          Stream quality: {settings.quality} (480p is the only one TeraBox always has ready)
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>About</Text>
        <Text style={styles.hint}>
          TeraBoxVD — an independent tool, not affiliated with TeraBox. Only download files you
          own or are authorised to access.
        </Text>
      </View>
    </ScrollView>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <Pressable style={styles.toggle} onPress={() => onChange(!value)}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.switch, value && { backgroundColor: '#22C55E' }]}>
        <View style={[styles.knob, value && { alignSelf: 'flex-end' }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    padding: 16,
    gap: 10,
  },
  title: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' },
  hint: { color: '#64748B', fontSize: 12.5, lineHeight: 18 },
  good: { color: '#4ADE80', fontSize: 13.5, fontWeight: '600' },
  bad: { color: '#FCA5A5', fontSize: 13.5, fontWeight: '600' },
  input: {
    height: 46,
    borderRadius: 10,
    backgroundColor: '#111C31',
    paddingHorizontal: 14,
    color: '#E2E8F0',
  },
  button: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#052E16', fontWeight: '700' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { color: '#CBD5E1', fontSize: 13.5, flex: 1, paddingRight: 12 },
  switch: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1E293B',
    padding: 3,
    justifyContent: 'center',
  },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#94A3B8' },
});
