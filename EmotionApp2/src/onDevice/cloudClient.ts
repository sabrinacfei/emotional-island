import type { ClassifierReply, LocalFeedback } from './localFeedback';

export const CLOUD_API_URL = 'https://emotional-island-api.onrender.com';
export async function post(base: string, path: string, token: string, body: unknown) {
  if (!token) throw new Error('請先登入帳號。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
    if (!response.ok) {
      if (__DEV__) {
        console.error('[Cloud API Error]', {
          path,
          status: response.status,
        });
      }
      throw new Error(response.status === 404 ? '雲端尚未部署手機版分類 API。' : '雲端分析或同步未完成，請稍後重試。');
    }
    return await response.json();
  } finally { clearTimeout(timeout); }
}
export const classifyOnCloud = (base: string, token: string, content: string, date: string): Promise<ClassifierReply> => post(base, '/mobile/emotions', token, { content, date_label: date });
export async function syncPhoneFeedback(base: string, token: string, entry: { id: string; content: string; kind: 'fragment' | 'daily'; date?: string }, result: LocalFeedback) {
  if (result.status === 'unavailable') throw new Error('分析未完成，不能同步為完成結果。');
  let receipt = result.receipt_token;
  if (entry.kind === 'daily' && result.status === 'completed' && result.classifier_trace) {
    const registered = await post(base, '/mobile/emotions/on-device', token, { content: entry.content, date_label: entry.date,
      classification: { trace: result.classifier_trace, analysis: result.classifier_analysis } });
    if (!registered.classification_available || !registered.receipt_token) throw new Error('本機結果已保留，雲端尚未接受本次同步。');
    if (Object.entries(result.scores ?? {}).some(([key,value]) => registered.scores?.[key] !== value)) throw new Error('本機與同步紀錄不一致，結果已保留供重試。');
    receipt = registered.receipt_token;
  }
  return post(base, '/mobile/diaries', token, { entry_id: entry.id, content: entry.content, kind: entry.kind, date_label: entry.date ?? null,
    receipt_token: receipt,
    support: { status: result.status, comfort: result.comfort, suggestions: result.suggestions, blessing: result.blessing,
      risk_level: result.risk_level, response_mode: result.response_mode, safety_action: result.safety_action, context: result.context,
      generation: result.generation, causes: result.causes ?? [], emotion_sources: result.emotion_sources } });
}

export const saveFragmentOriginal = (base: string, token: string, entry: { id: string; content: string; createdAt: string }) =>
  post(base, '/mobile/fragments', token, { entry_id: entry.id, content: entry.content, created_at: entry.createdAt });
export async function getMobile(base: string, token: string, path: string) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('資料尚未讀取，請稍後重試。');
  return response.json();
}
