/** One native inference task at a time across the encoder and generation model. */
let active: string | null = null;
export function beginModelTask(name: string): () => void {
  if (active) throw new Error('手機 AI 正在處理另一項工作，請稍後重試。');
  active = name;
  let released = false;
  return () => { if (!released) { released = true; active = null; } };
}
