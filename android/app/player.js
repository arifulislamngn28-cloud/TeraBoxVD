import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

export default function PlayerScreen() {
  const { src, name, size } = useLocalSearchParams();
  const navigation = useNavigation();
  const player = useVideoPlayer(src || '', (p) => {
    p.loop = false;
    p.play();
  });
  const started = useRef(false);

  useEffect(() => {
    navigation.setOptions({ title: name || 'Player' });
  }, [navigation, name]);

  useEffect(() => {
    if (player && !started.current) {
      started.current = true;
      player.play();
    }
  }, [player]);

  return (
    <View style={styles.root}>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        {!!size && <Text style={styles.size}>{size}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020617' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  meta: { padding: 16, gap: 4 },
  name: { color: '#E2E8F0', fontSize: 15, fontWeight: '600' },
  size: { color: '#64748B', fontSize: 13 },
});
