import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../store/auth';
import { View, ActivityIndicator } from 'react-native';

export default function RootLayout() {
  const { user, isLoading, loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        router.replace('/(tabs)/today');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#7F77DD" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
