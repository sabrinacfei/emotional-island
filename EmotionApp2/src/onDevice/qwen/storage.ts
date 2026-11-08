import * as FS from 'expo-file-system/legacy';
import Diagnostics from './diagnostics';
import { MODEL } from './config';
import { assertModelIntegrity } from './policy';

function modelDirectory(): string {
  if (!FS.documentDirectory) throw new Error('無法取得 App 儲存目錄。');
  return `${FS.documentDirectory}models/`;
}

export function modelUri(): string { return `${modelDirectory()}${MODEL.filename}`; }

export async function modelExists(): Promise<boolean> {
  return (await FS.getInfoAsync(modelUri())).exists;
}

export async function verifyModel(): Promise<string> {
  const uri = modelUri();
  const info = await FS.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || info.size !== MODEL.bytes) {
    throw new Error('模型不存在或檔案不完整，請先下載模型。');
  }
  const digest = await Diagnostics.fileDigest(uri);
  assertModelIntegrity(digest.bytes, digest.sha256);
  await Diagnostics.excludeFromBackup(uri);
  return uri;
}

export async function downloadModel(progress: (ratio: number) => void): Promise<void> {
  await FS.makeDirectoryAsync(modelDirectory(), { intermediates: true });
  await Diagnostics.excludeFromBackup(modelDirectory());
  // Storage headroom is an engineering reserve, not an adaptive-model threshold.
  if (await Diagnostics.freeDiskBytes() < MODEL.bytes + 512 * 1024 * 1024) {
    throw new Error('手機可用空間不足，請先保留至少約 3 GiB 的空間。');
  }
  if (await modelExists()) throw new Error('已有模型檔案，請先載入驗證；若損毀，再使用刪除模型。');
  const partial = `${modelUri()}.part`;
  await FS.deleteAsync(partial, { idempotent: true });
  const task = FS.createDownloadResumable(MODEL.url, partial, {}, (event) => {
    progress(Math.min(1, event.totalBytesWritten / MODEL.bytes));
  });
  try {
    const result = await task.downloadAsync();
    if (!result || result.status !== 200) throw new Error('模型下載失敗，請確認網路後重試。');
    const digest = await Diagnostics.fileDigest(partial);
    assertModelIntegrity(digest.bytes, digest.sha256);
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
