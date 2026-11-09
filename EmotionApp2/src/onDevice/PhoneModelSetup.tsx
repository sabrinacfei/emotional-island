import React, { useEffect, useState } from 'react';
import { Button, Linking, Text, View } from 'react-native';
import { PHONE_MODEL, downloadModel, modelExists } from './qwen/storage';
import { nativeModelsAvailable } from './qwen/diagnostics';

export function PhoneModelSetup() {
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('正在檢查手機模型');
  useEffect(() => { modelExists().then(value => {
    setExists(value);
    const sizeGB = (PHONE_MODEL.bytes / 1e9).toFixed(2);
    setStatus(value ? `${PHONE_MODEL.label} 已下載` : `首次使用需下載 ${PHONE_MODEL.label}（約 ${sizeGB} GB）`);
  }).catch(() => setStatus('尚無法取得手機模型，請使用原生 App。')); }, []);
  return <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 18, gap: 8 }}>
    <Text style={{ color: '#3D2B1F' }}>{nativeModelsAvailable ? status : '本機回饋需要原生 App，無法使用 Expo Go。'}</Text>
    {!exists && <Button title={busy ? '模型準備中…' : '準備手機回饋模型'} disabled={busy || !nativeModelsAvailable} onPress={() => {
      setBusy(true);
      downloadModel(ratio => setStatus(ratio < 1 ? `下載中 ${(ratio * 100).toFixed(1)}%` : '正在核對模型完整性'))
        .then(() => { setExists(true); setStatus('手機回饋模型已準備好'); })
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : '模型準備未完成，請稍後再試。'))
        .finally(() => setBusy(false));
    }} />}
  </View>;
}

export function SafetyResources() {
  return <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginTop: 12, gap: 8 }}>
    <Text style={{ color: '#3D2B1F' }}>台灣支持資源：需要有人陪你談談時，可聯絡安心專線；若有立即危險，請優先尋求當地緊急協助。</Text>
    <Button title="1925 安心專線" onPress={() => { void Linking.openURL('tel:+8861925?oai_link_source=model_response_hotline'); }} />
  </View>;
}
