type Source = { explanation?: string; evidence?: string; emotion?: string; emotions?: string[];
  coping_note?: string; additional_evidence?: string[] };

export function isSourceExplanation(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim()
    && !/^(?:無|无|沒有|没有|不適用|不适用|略過|跳過|none|null|n\/?a)[。.!！\s]*$/iu.test(value.trim())
    && !/(?:略過|跳過)(?:此|該|這個)?(?:情緒|類別|分類)|(?:未找到|沒有|無)(?:足夠|明確|直接|相關|任何|對應)?的?(?:原文|日記|情緒|壓力|快樂|緩衝)?(?:線索|證據|依據|來源|相關事件)|無相關事件|無法建立(?:對應)?依據|不足以(?:判斷|支持)(?:該|此|這個)?情緒|(?:故|因此)(?:略過|跳過)[。.!！\s]*$/u.test(value);
}

export function emotionEvidence(raw: any, emotion: string): Source[] {
  const diary=raw?.final_content || raw?.daily_content || raw?.dailyContent || '';
  const hasOriginal=(source:Source)=>typeof source.evidence==='string' && source.evidence.trim().length>=2 && typeof diary==='string' && diary.includes(source.evidence);
  const checked = (Array.isArray(raw?.emotion_sources) ? raw.emotion_sources : [])
    .filter((source: Source) => source.emotion === emotion && isSourceExplanation(source.explanation) && hasOriginal(source));
  const related = (Array.isArray(raw?.causes) ? raw.causes : [])
    .filter((source: Source) => source.emotions?.includes(emotion) && isSourceExplanation(source.explanation) && hasOriginal(source));
  // An explicit unconfirmed emotion stays unconfirmed. Once confirmed, retain
  // all of its saved event associations rather than hiding every later event.
  if (Array.isArray(raw?.emotion_sources) && !checked.length) return [];
  const seen = new Set<string>();
  return [...checked, ...related].filter((source: Source) => {
    const key = `${source.evidence}\0${source.explanation}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Keep complete sentences, including quotation marks and paragraph boundaries. */
export function diarySentenceSpans(text: string, eventBoundaries = false): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const closing: string[] = [];
  const quotes: Record<string, string> = { '「': '」', '『': '』', '“': '”', '‘': '’', '（': '）', '(': ')' };
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quotes[character]) closing.push(quotes[character]);
    else if (character === closing[closing.length - 1]) closing.pop();
    if ((!closing.length && (/[。！？!?]/u.test(character) || (eventBoundaries && /[；;]/u.test(character)))) || character === '\n') {
      spans.push({ start, end: index + 1 });
      start = index + 1;
    }
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans.filter(span => text.slice(span.start, span.end).trim());
}

export function completeDiaryExcerpts(text: string, evidence: string[]): string[] {
  const spans = diarySentenceSpans(text, true);
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

/** Include a preceding sentence only when the feeling sentence depends on it;
 * avoid attaching later unrelated events merely because the selection is short. */
export function completeEmotionEvent(text: string, phrase: string, context: string = text): string {
  const contextIndex=text.indexOf(context), phraseIndex=context.indexOf(phrase);
  if(contextIndex<0 || phraseIndex<0 || !phrase.trim())return '';
  const index=contextIndex+phraseIndex;
  const spans=diarySentenceSpans(text,true);
  const at=spans.findIndex(span=>span.end>index && span.start<=index);
  const end=spans.find(span=>span.end>=index+phrase.length);
  if(at<0 || !end)return '';
  const excerpt=text.slice(spans[at].start,end.end).trim();
  const continuation=/^(?:雖然|但是|但|可是|不過|那種|那一|這種|這一|當下|原來|其實|最後|因此|所以|幸好|想到|我(?:真的|非常|有點|漸漸|慢慢|終於|覺得|感到|很|特別|也|才|更))/u.test(excerpt);
  return continuation && at>0 ? text.slice(spans[at-1].start,end.end).trim() : excerpt;
}
