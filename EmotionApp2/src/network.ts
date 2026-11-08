export async function fetchWithTimeout(url: string, init: RequestInit = {}, milliseconds = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('連線逾時，請確認網路後重試。');
    throw error;
  } finally { clearTimeout(timer); }
}
