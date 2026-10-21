import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export default function DownloadsScreen() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const dir = `${FileSystem.cacheDirectory}TBVD/`;
        const info = await FileSystem.getInfoAsync(dir);
        if (!info.exists) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          return;
        }
        const names = await FileSystem.readDirectoryAsync(dir);
        const files = await Promise.all(
          names.map(async (n) => {
            const f = `${dir}${n}`;
            const i = await FileSystem.getInfoAsync(f);
            return { name: n, uri: f, size: i.size || 0, mtime: i.mtime || 0 };
          })
        );
        files.sort((a, b) => b.mtime - a.mtime);
        setItems(files);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.uri}
        ListEmptyComponent={
          <Text style={styles.empty}>Downloads you make from the Home tab land here.</Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.sub}>{(item.size / 1048576).toFixed(2)} MB</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  empty: { color: '#64748B', textAlign: 'center', marginTop: 40, lineHeight: 20 },
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
});
