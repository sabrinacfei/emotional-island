import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export function notificationAccess(permission: Notifications.NotificationPermissionsStatus) {
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    || permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
}

export async function notificationStatus() {
  if (Platform.OS === 'web') return '此裝置不支援手機通知';
  const permission = await Notifications.getPermissionsAsync();
  if (permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return '已允許安靜通知，請查看通知中心';
  if (notificationAccess(permission)) return '已允許通知';
  return permission.canAskAgain ? '尚未允許，傳送測試時可開啟' : '通知已關閉，請到系統設定開啟';
}

export async function ensureNotificationPermission() {
  if (Platform.OS === 'web') throw new Error('請使用手機安裝版測試通知。');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', {
    name: '小島精靈通知', importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180], lightColor: '#7A9E6A',
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!notificationAccess(permission) && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  if (!notificationAccess(permission)) throw new Error('請在系統設定中允許 Emotional Island 傳送通知，再回來重試。');
}

export async function sendLocalTestNotification() {
  await ensureNotificationPermission();
  // Local delivery works even when this build has no APNs entitlement or network.
  return Notifications.scheduleNotificationAsync({
    content: { title: '小島精靈來打招呼 🌱', body: '手機通知已準備好，隨時回到小島記下一點心情。', sound: 'default', data: { targetScreen: 'HomeScreen', type: 'local_test' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: 'default' },
  });
}
