import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView,
  Platform, ActivityIndicator
} from 'react-native';
import { router } from 'expo-router';
import { login } from '../../services/api';
import { useAuthStore } from '../../store/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('請填寫 Email 和密碼');
      return;
    }
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      await setAuth(res.data.user, res.data.token);
      router.replace('/(tabs)/today');
    } catch (err: any) {
      const msg = err.response?.data?.detail || '登入失敗，請確認帳號密碼';
      Alert.alert('登入失敗', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>情緒日記</Text>
        <Text style={styles.subtitle}>記錄每天的心情變化</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#bbb"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="密碼"
          placeholderTextColor="#bbb"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>登入</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.link}
          onPress={() => router.push('/(auth)/register')}
        >
          <Text style={styles.linkText}>還沒有帳號？ <Text style={styles.linkBold}>註冊</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  title: { fontSize: 32, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#888', marginBottom: 48 },
  input: {
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#1a1a1a', marginBottom: 12,
    backgroundColor: '#fafafa'
  },
  btn: {
    backgroundColor: '#7F77DD', borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginTop: 8
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 24, alignItems: 'center' },
  linkText: { fontSize: 14, color: '#888' },
  linkBold: { color: '#7F77DD', fontWeight: '600' },
});
