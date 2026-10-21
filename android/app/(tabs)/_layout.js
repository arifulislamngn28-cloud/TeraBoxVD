import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function TabIcon({ glyph, focused }) {
  return <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.45 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: '#22C55E',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'TeraBoxVD',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🔗" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Downloads',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⬇" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🕘" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
