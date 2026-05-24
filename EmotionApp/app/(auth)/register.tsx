import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView
} from 'react-native';
import { router } from 'expo-router';
import { register } from '../../services/api';
import { useAuthStore } from '../../store/auth';

export default function RegisterScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      Alert.alert('請填寫所有欄位');
      return;
    }
    if (password !== confirm) {
      Alert.alert('密碼不一致', '請確認兩次輸入的密碼相同');
      return;
    }
    if (password.length < 6) {
      Alert.alert('密碼太短', '密碼至少需要 6 個字元');
      return;
    }

    setLoading(true);
    try {
      const res = await register(username.trim(), email.trim(), password);
      await setAuth(res.data.user, res.data.token);
      router.replace('/(tabs)/today');
    } catch (err: any) {
      const msg = err.response?.data?.detail || '註冊失敗，請稍後再試';
      Alert.alert('註冊失敗', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>建立帳號</Text>
        <Text style={styles.subtitle}>開始記錄你的情緒旅程</Text>

        <Text style={styles.label}>暱稱</Text>
        <TextInput
          style={styles.input}
          placeholder="你想被怎麼稱呼？"
          placeholderTextColor="#bbb"
          value={username}
          onChangeText={setUsername}
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="your@email.com"
          placeholderTextColor="#bbb"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>密碼</Text>
        <TextInput
          style={styles.input}
          placeholder="至少 6 個字元"
          placeholderTextColor="#bbb"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Text style={styles.label}>確認密碼</Text>
        <TextInput
          style={styles.input}
          placeholder="再輸入一次密碼"
          placeholderTextColor="#bbb"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>建立帳號</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.link}
          onPress={() => router.back()}
        >
          <Text style={styles.linkText}>已有帳號？ <Text style={styles.linkBold}>登入</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#888', marginBottom: 36 },
  label: { fontSize: 13, fontWeight: '500', color: '#555', marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#1a1a1a', marginBottom: 12,
    backgroundColor: '#fafafa'
  },
  btn: {
    backgroundColor: '#7F77DD', borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginTop: 12
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 24, alignItems: 'center' },
  linkText: { fontSize: 14, color: '#888' },
  linkBold: { color: '#7F77DD', fontWeight: '600' },
});
