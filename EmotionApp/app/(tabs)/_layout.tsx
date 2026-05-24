import { Tabs } from 'expo-router';
import { TouchableOpacity, Text } from 'react-native';
import { useAuthStore } from '../../store/auth';

export default function TabsLayout() {
  const { user, logout } = useAuthStore();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#7F77DD',
        tabBarInactiveTintColor: '#bbb',
        tabBarStyle: {
          borderTopWidth: 0.5,
          borderTopColor: '#eee',
          paddingBottom: 8,
          height: 60,
        },
        headerStyle: { backgroundColor: '#fff' },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        headerRight: () => (
          <TouchableOpacity onPress={logout} style={{ marginRight: 16 }}>
            <Text style={{ color: '#aaa', fontSize: 14 }}>登出</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: '當天情緒',
          tabBarLabel: '今天',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>🌤</Text>,
          headerTitle: user ? `${user.username} 的情緒日記` : '情緒日記',
        }}
      />
      <Tabs.Screen
        name="trend"
        options={{
          title: '七天趨勢',
          tabBarLabel: '趨勢',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>📈</Text>,
        }}
      />
      <Tabs.Screen
        name="diary"
        options={{
          title: '寫日記',
          tabBarLabel: '日記',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>✍️</Text>,
        }}
      />
    </Tabs>
  );
}
