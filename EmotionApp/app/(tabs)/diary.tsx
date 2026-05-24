import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { submitDiary } from '../../services/api';

export default function DiaryScreen() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) {
      Alert.alert('請寫點什麼');
      return;
    }
    setLoading(true);
    try {
      const res = await submitDiary(content.trim());
      Alert.alert('已送出', '你的日記已儲存，AI 正在分析情緒...');
      setContent('');
    } catch (err: any) {
      Alert.alert('送出失敗', err.response?.data?.detail || '請稍後再試');
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
        <Text style={styles.label}>今天發生了什麼？</Text>
        <TextInput
          style={styles.textarea}
          placeholder="寫下你的心情、發生的事、任何想說的話..."
          placeholderTextColor="#ccc"
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
        />
        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>送出日記</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, padding: 20 },
  label: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  textarea: {
    flex: 1, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 12,
    padding: 16, fontSize: 15, color: '#1a1a1a',
    backgroundColor: '#fafafa', marginBottom: 16
  },
  btn: {
    backgroundColor: '#7F77DD', borderRadius: 12,
    paddingVertical: 15, alignItems: 'center'
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
