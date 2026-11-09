import type { PhoneModel } from './config';

export function assertModelIntegrity(model: PhoneModel, bytes: number, sha256: string): void {
  if (bytes !== model.bytes || sha256.toLowerCase() !== model.sha256) {
    throw new Error('模型大小或 SHA-256 不符；不載入此檔案，請刪除後重新下載。');
  }
}

export function assertPromptFits(promptTokens: number, context: number, output: number): void {
  if (!Number.isSafeInteger(promptTokens) || promptTokens < 1 || promptTokens + output + 16 > context) {
    throw new Error('測試文字超出這次的上下文上限，請縮短文字後再試。');
  }
}

// Conservative prototype guard only. Not a clinical screen or the final safety module.
// Phase one is deliberately limited to bundled fictional cases rather than arbitrary diaries.
export function assertSyntheticCaseAllowed(text: string): void {
  if (!text.trim() || /自殺|自伤|自傷|割腕|結束生命|结束生命|不想活|想死|殺死|杀死|自殘|自残/.test(text)) {
    throw new Error('此情境不進行生成；第一階段僅驗證內建的一般合成日記。完整安全分流須另外驗收。');
  }
}

type DisplayResult = {
  content?: string; text?: string; reasoning_content?: string; tool_calls?: unknown[];
  interrupted?: boolean; context_full?: boolean; truncated?: boolean;
};

export function selectDisplayContent(result: DisplayResult, options: { thinkingForcedOpen?: boolean } = {}): { content: string; source: 'content' | 'text'; cleaned: boolean } {
  if (result.interrupted || result.context_full || result.truncated) throw new Error('生成中斷或上下文不足，本次不列為成功結果。');
  if (result.tool_calls?.length) throw new Error('本次回傳工具呼叫，沒有直接呈現為文字回饋。');
  const parsed = typeof result.content === 'string' ? result.content.trim() : '';
  const source = parsed ? 'content' : 'text';
  // A parsed final answer may coexist with separately parsed reasoning. Never show the latter.
  if (!parsed && (result.reasoning_content?.trim() || options.thinkingForcedOpen)) {
    throw new Error('只有推理內容，尚無可呈現的最終文字；完整原始回傳已保存在診斷紀錄。');
  }
  const original = parsed || (typeof result.text === 'string' ? result.text.trim() : '');

  // Only unwrap the verified ChatML assistant prefix from raw text.
  // Never unwrap reasoning, tool calls, or other message roles.
  const assistantPrefix = '<|im_start|>assistant\n';
  const normalized = source === 'text' && original.startsWith(assistantPrefix)
    ? original.slice(assistantPrefix.length)
    : original;
  // Remove only an EMPTY thinking prefix and terminal EOS markers, not reasoning prose.
  const text = normalized.replace(/^(?:\s*<think>\s*<\/think>\s*)+/, '')
    .replace(/(?:\s*<\|(?:im_end|endoftext)\|>\s*)+$/, '').trim();
  if (!text || /<\/?think>|<\|[^>]*\|>/.test(text)) {
    throw new Error('未取得可呈現的回饋；原始輸出、completion 與模板診斷已保存。');
  }
  return { content: text, source, cleaned: text !== original };
}

export function finalContent(result: DisplayResult): string {
  return selectDisplayContent(result).content;
}
