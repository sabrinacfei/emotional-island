import { View, Text, StyleSheet } from 'react-native';

// 之後換成真實 API 資料
export default function TodayScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>當天情緒分布</Text>
      <Text style={styles.sub}>（這裡之後會顯示柱狀圖）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  text: { fontSize: 20, fontWeight: '600', color: '#1a1a1a' },
  sub: { fontSize: 14, color: '#aaa', marginTop: 8 },
});
