import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocalFeedback } from './localFeedback';

export type PhoneDiary = { id: string; owner: string; content: string; kind: 'fragment' | 'daily'; date?: string;
  createdAt: string; result?: LocalFeedback; syncStatus: 'draft' | 'pending' | 'synced' };
const key = (owner: string, id: string) => `phoneDiary:v1:${encodeURIComponent(owner)}:${id}`;
export function newPhoneDiary(owner: string, content: string, kind: PhoneDiary['kind'], date?: string): PhoneDiary {
  if (!owner || !content.trim()) throw new Error('Missing diary owner or content');
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`, owner, content: content.trim(), kind, date,
    createdAt: new Date().toISOString(), syncStatus: 'draft' };
}
export async function savePhoneDiary(entry: PhoneDiary) { await AsyncStorage.setItem(key(entry.owner, entry.id), JSON.stringify(entry)); }
async function phoneDiaries(owner: string): Promise<PhoneDiary[]> {
  const prefix = `phoneDiary:v1:${encodeURIComponent(owner)}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  return rows.map(([, value]) => {
    try { return value ? JSON.parse(value) as PhoneDiary : null; } catch { return null; }
  })
    .filter((entry): entry is PhoneDiary => !!entry && entry.owner === owner && typeof entry.content === 'string' && typeof entry.createdAt === 'string')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function pendingPhoneDiaries(owner: string): Promise<PhoneDiary[]> {
  return (await phoneDiaries(owner)).filter(entry => entry.syncStatus !== 'synced');
}

export async function latestRecoverableFragment(owner: string): Promise<PhoneDiary | null> {
  // Inspect the latest fragment INCLUDING completed ones: an older failure must
  // never reappear after a more recent diary has already succeeded.
  const latest = (await phoneDiaries(owner)).find(entry => entry.kind === 'fragment');
  return latest && (!latest.result || latest.result.status === 'unavailable') ? latest : null;
}

export async function todaysPhoneFragmentCount(owner: string, timezone: string): Promise<number> {
  const prefix = `phoneDiary:v1:${encodeURIComponent(owner)}:`;
  const rows = await AsyncStorage.multiGet((await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix)));
  const localDate = (value: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const today = localDate(new Date());
  return rows.filter(([, raw]) => { if (!raw) return false; const entry: PhoneDiary = JSON.parse(raw); return entry.kind === 'fragment' && localDate(entry.createdAt) === today; }).length;
}
