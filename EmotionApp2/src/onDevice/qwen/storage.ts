import * as FS from 'expo-file-system/legacy';
import { totalMemory } from 'expo-device';
import Diagnostics from './diagnostics';
import { selectPhoneModel } from './config';
import { assertModelIntegrity } from './policy';

export const PHONE_MODEL = selectPhoneModel(totalMemory);
const REQUIRED_DISK_BYTES = PHONE_MODEL.bytes + 512 * 1024 ** 2;
let downloadInProgress: Promise<void> | undefined;

function modelDirectory(): string {
  if (!FS.documentDirectory) throw new Error('無法取得 App 儲存目錄。');
  return `${FS.documentDirectory}models/`;
}

export function modelUri(): string { return `${modelDirectory()}${PHONE_MODEL.filename}`; }

export async function modelExists(): Promise<boolean> {
  return (await FS.getInfoAsync(modelUri())).exists;
}

export async function verifyModel(): Promise<string> {
  const uri = modelUri();
  const info = await FS.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || info.size !== PHONE_MODEL.bytes) {
    throw new Error('模型不存在或檔案不完整，請先下載模型。');
  }
  const digest = await Diagnostics.fileDigest(uri);
  assertModelIntegrity(PHONE_MODEL, digest.bytes, digest.sha256);
  await Diagnostics.excludeFromBackup(uri);
  return uri;
}

export function downloadModel(progress: (ratio: number) => void): Promise<void> {
  downloadInProgress ??= download(progress).finally(() => { downloadInProgress = undefined; });
  return downloadInProgress;
}

async function download(progress: (ratio: number) => void): Promise<void> {
  await FS.makeDirectoryAsync(modelDirectory(), { intermediates: true });
  await Diagnostics.excludeFromBackup(modelDirectory());
  if (await Diagnostics.freeDiskBytes() < REQUIRED_DISK_BYTES) {
    const requiredGiB = Math.ceil(REQUIRED_DISK_BYTES / 1024 ** 3 * 10) / 10;
    throw new Error(`手機可用空間不足，${PHONE_MODEL.label} 需要至少 ${requiredGiB} GiB 的可用空間。`);
  }
  if (await modelExists()) throw new Error('已有模型檔案，請先載入驗證；若損毀，再使用刪除模型。');
  const partial = `${modelUri()}.part`;
  await FS.deleteAsync(partial, { idempotent: true });
  const task = FS.createDownloadResumable(PHONE_MODEL.url, partial, {}, (event) => {
    progress(Math.min(1, event.totalBytesWritten / PHONE_MODEL.bytes));
  });
  try {
    const result = await task.downloadAsync();
    if (!result || result.status !== 200) throw new Error('模型下載失敗，請確認網路後重試。');
    const digest = await Diagnostics.fileDigest(partial);
    assertModelIntegrity(PHONE_MODEL, digest.bytes, digest.sha256);
    await FS.moveAsync({ from: partial, to: modelUri() });
    await Diagnostics.excludeFromBackup(modelUri());
  } catch (error) {
    await FS.deleteAsync(partial, { idempotent: true });
    throw error;
  }
}

export async function deleteModel(): Promise<void> {
  await FS.deleteAsync(modelUri(), { idempotent: true });
  await FS.deleteAsync(`${modelUri()}.part`, { idempotent: true });
}
