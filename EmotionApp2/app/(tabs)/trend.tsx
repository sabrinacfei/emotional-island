import { View, Text, StyleSheet } from 'react-native';

export default function TrendScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>七天情緒走勢</Text>
      <Text style={styles.sub}>（這裡之後會顯示折線圖）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  text: { fontSize: 20, fontWeight: '600', color: '#1a1a1a' },
  sub: { fontSize: 14, color: '#aaa', marginTop: 8 },
});
