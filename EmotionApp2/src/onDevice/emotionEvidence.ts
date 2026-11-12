type Source = { explanation?: string; evidence?: string; emotion?: string; emotions?: string[] };

export function isSourceExplanation(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim()
    && !/略過|跳過|未找到|沒有(?:足夠|明確)|無(?:足夠|明確).*依據|不足以.*(?:判斷|支持)/u.test(value);
}

export function emotionEvidence(raw: any, emotion: string): Source[] {
  const checked = (Array.isArray(raw?.emotion_sources) ? raw.emotion_sources : [])
    .filter((source: Source) => source.emotion === emotion && isSourceExplanation(source.explanation));
  if (Array.isArray(raw?.emotion_sources)) return checked;
  return (Array.isArray(raw?.causes) ? raw.causes : [])
    .filter((source: Source) => source.emotions?.includes(emotion) && isSourceExplanation(source.explanation));
}

/** Keep complete sentences, including quotation marks and paragraph boundaries. */
export function diarySentenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const closing: string[] = [];
  const quotes: Record<string, string> = { '「': '」', '『': '』', '“': '”', '‘': '’', '（': '）', '(': ')' };
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quotes[character]) closing.push(quotes[character]);
    else if (character === closing[closing.length - 1]) closing.pop();
    if ((!closing.length && /[。！？!?]/u.test(character)) || character === '\n') {
      spans.push({ start, end: index + 1 });
      start = index + 1;
    }
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans.filter(span => text.slice(span.start, span.end).trim());
}

export function completeDiaryExcerpts(text: string, evidence: string[]): string[] {
  const spans = diarySentenceSpans(text);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const quote of evidence) {
    if (!quote.trim()) continue;
    const index = text.indexOf(quote);
    if (index < 0) continue;
    const matched = spans.filter(span => span.end > index && span.start < index + quote.length);
    if (matched.length) ranges.push({ start: matched[0].start, end: matched[matched.length - 1].end });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map(range => text.slice(range.start, range.end).trim());
}
