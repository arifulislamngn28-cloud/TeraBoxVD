import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadHistory, clearHistory } from '../../lib/store';

export default function HistoryScreen() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    loadHistory().then(setItems);
  }, []);

  async function onClear() {
    Alert.alert('Clear history?', 'This removes every saved link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => setItems(await clearHistory()),
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(h, i) => `${h.url}-${i}`}
        ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              Alert.alert(item.title || item.url, item.url)
            }
          >
            <Text style={styles.name} numberOfLines={1}>
              {item.title || item.url}
            </Text>
            <Text style={styles.sub}>
              {item.total ?? 0} file(s) · {new Date(item.at).toLocaleString()}
            </Text>
          </Pressable>
        )}
      />
      {items.length > 0 && (
        <Pressable style={styles.clear} onPress={onClear}>
          <Text style={styles.clearText}>Clear history</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  empty: { color: '#64748B', textAlign: 'center', marginTop: 40 },
  row: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    marginBottom: 8,
  },
  name: { color: '#E2E8F0', fontSize: 14.5 },
  sub: { color: '#64748B', fontSize: 12, marginTop: 3 },
  clear: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    alignItems: 'center',
  },
  clearText: { color: '#FCA5A5', fontWeight: '600' },
});
