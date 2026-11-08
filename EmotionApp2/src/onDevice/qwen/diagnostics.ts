import { requireOptionalNativeModule } from 'expo';

export type Measurement = {
  durationMs: number;
  baselineBytes: number;
  sampledPeakBytes: number;
  sampleCount: number;
  sampleIntervalMs: number;
  memoryWarnings: number;
  thermalStart: string;
  thermalEnd: string;
};

type NativeDiagnostics = {
  selectionHaptic?(): Promise<void>;
  fileDigest(uri: string): Promise<{ bytes: number; sha256: string }>;
  excludeFromBackup(uri: string): Promise<void>;
  freeDiskBytes(): Promise<number>;
  startMeasurement(): Promise<void>;
  stopMeasurement(): Promise<Measurement>;
};
const native = requireOptionalNativeModule<NativeDiagnostics>('OnDeviceDiagnostics');
export const nativeModelsAvailable = native !== null;
function required(): NativeDiagnostics {
  if (!native) throw new Error('請使用包含本機模型的原生 App，Expo Go 無法執行此功能。');
  return native;
}
export default {
  selectionHaptic: () => native?.selectionHaptic?.().catch(() => undefined),
  fileDigest: (uri: string) => required().fileDigest(uri),
  excludeFromBackup: (uri: string) => required().excludeFromBackup(uri),
  freeDiskBytes: () => required().freeDiskBytes(),
  startMeasurement: () => required().startMeasurement(),
  stopMeasurement: () => required().stopMeasurement(),
};
