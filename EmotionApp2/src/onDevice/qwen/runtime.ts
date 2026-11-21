import { initLlama, type LlamaContext, type RNLlamaOAICompatibleMessage } from 'llama.rn';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS, RUNTIME_VERSION } from './config';
import { PHONE_MODEL, verifyModel } from './storage';
import { assertPromptFits, selectStructuredContent } from './policy';
import type { PhoneSLM, SLMRun } from '../localFeedback';
import { parseAssessment } from '../localFeedback';
import { decision, ruleRisk, EMOTIONS } from '../flow';
import { composeDaily, DAILY_COMPOSE_SYSTEM, type DailySource } from '../dailyComposition';
import { beginModelTask } from '../modelExecution';
import {DAILY_ANALYSIS_SYSTEM,dailyAnalysisInput,dailyAnalysisSchema,parseDailyAnalysis} from './dailyAnalysis';
import { TranslationService } from '../TranslationService';
import { ASSESS_SYSTEM, SUPPORT_SYSTEM } from './feedbackPrompts';
import { stopNativeCompletion } from './cancellation';

let context: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let busy = false;
let cancelled = false;
class PromptBudgetError extends Error {}
AppState.addEventListener('change', state => {
  if (state !== 'active' && busy) { cancelled = true; void stopNativeCompletion(context); }
});

async function load() {
  if (context) return context;
  if (!loading) loading = (async () => {
    const model = await verifyModel();
    context = await initLlama({ model, n_ctx: SETTINGS.n_ctx, n_batch: SETTINGS.n_batch, n_ubatch: SETTINGS.n_ubatch,
      n_parallel: 1, n_gpu_layers: SETTINGS.n_gpu_layers, n_threads: SETTINGS.n_threads,
      use_mmap: true, use_mlock: false, flash_attn_type: 'auto' });
    return context;
  })().finally(() => { loading = null; });
  return loading;
}
export async function preparePhoneModel(): Promise<void> {
  await load();
}

export async function releasePhoneModel() {
  if (busy || loading) throw new Error('請等待目前分析完成後再卸載模型。');
  if (context) { await context.release(); context = null; }
}

async function json(system: string, payload: unknown, schema: object, temperature: number = SETTINGS.temperature, maxOutput: number = SETTINGS.n_predict, enableThinking: boolean = SETTINGS.enable_thinking): Promise<SLMRun> {
  if (busy) throw new Error('已有本機推論正在執行。');
  const endTask = beginModelTask('qwen-generation');
  busy = true; cancelled = false;
  try {
    const ctx = await load();
    if (cancelled || AppState.currentState !== 'active') throw new Error('App 已離開前景。');
    await ctx.clearCache(true);
    const messages: RNLlamaOAICompatibleMessage[] = [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }];
    const thinkingBudget = enableThinking ? SETTINGS.thinking_budget_tokens : 0;
    const template = { jinja: true, enable_thinking: enableThinking, chat_template_kwargs: { enable_thinking: enableThinking }, reasoning_format: 'deepseek' as const,
      response_format: { type: 'json_schema' as const, json_schema: { strict: true, schema } } };
    const formatted = await ctx.getFormattedChat(messages, undefined, template);
    if (formatted.type !== 'jinja') throw new Error('本機模型未使用已驗證的 Jinja 模板。');
    const tokens = await ctx.tokenize(formatted.prompt);
    try { assertPromptFits(tokens.tokens.length, SETTINGS.n_ctx, maxOutput + thinkingBudget); }
    catch { throw new PromptBudgetError('完整語境超出單次上下文，需分段處理。'); }
    const started = performance.now();
    const result = await ctx.completion({ messages, ...template, n_predict: maxOutput + thinkingBudget,
      thinking_budget_tokens: thinkingBudget,
      temperature, top_p: SETTINGS.top_p, top_k: SETTINGS.top_k, seed: SETTINGS.seed });
    await AsyncStorage.setItem('lastQwenCompletion', JSON.stringify({
      captured_at: new Date().toISOString(), thinking_enabled: enableThinking,
      model: PHONE_MODEL.id, model_sha256: PHONE_MODEL.sha256, request_input: payload,
      schema_fields: Object.keys((schema as any).properties || {}), prompt_tokens: tokens.tokens.length,
      template: { chat_format: (formatted as any).chat_format, generation_prompt: (formatted as any).generation_prompt, thinking_start_tag: (formatted as any).thinking_start_tag, thinking_end_tag: (formatted as any).thinking_end_tag, grammar_lazy: (formatted as any).grammar_lazy },
      thinking_forced_open: 'thinking_forced_open' in formatted && formatted.thinking_forced_open === true,
      content: result.content, text: result.text, reasoning_content: result.reasoning_content,
      tokens_predicted: result.tokens_predicted, stopped_eos: result.stopped_eos,
      stopped_limit: result.stopped_limit, interrupted: result.interrupted,
    })).catch(() => undefined);
    if (__DEV__) {
      console.log('[Qwen Diagnostics]', {
        phase: schema === assessmentSchema ? 'assessment' : 'support',
        tokens_predicted: result.tokens_predicted,
        stopped_eos: result.stopped_eos,
        stopped_limit: result.stopped_limit,
        interrupted: result.interrupted,
        content_length: typeof result.content === 'string' ? result.content.length : 0,
        text_length: typeof result.text === 'string' ? result.text.length : 0,
        reasoning_length: typeof result.reasoning_content === 'string' ? result.reasoning_content.length : 0,
        text_starts_with_think: typeof result.text === 'string' && /^\\s*<think>/.test(result.text),
        text_contains_special_tokens: typeof result.text === 'string' && /<\\|[^>]*\\|>/.test(result.text),
        special_token_types: typeof result.text === 'string'
          ? [...new Set(result.text.match(/<[^<>]+>/g) ?? [])]
          : [],
        has_think_tags: typeof result.text === 'string' && /<\/?think>/.test(result.text),
        message_marker_positions: typeof result.text === 'string'
          ? ['<|im_start|>', '<|im_end|>', '<|endoftext|>']
              .map(marker => ({
                marker,
                position: result.text.indexOf(marker),
                total_length: result.text.length,
              }))
              .filter(item => item.position >= 0)
          : [],
        output_structure: typeof result.text === 'string'
          ? (() => {
              const raw = result.text;
              const firstBrace = raw.indexOf('{');
              const lastBrace = raw.lastIndexOf('}');
              let jsonValid = false;
              let jsonIsObject = false;

              if (firstBrace >= 0 && lastBrace > firstBrace) {
                try {
                  const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
                  jsonValid = true;
                  jsonIsObject = parsed !== null
                    && typeof parsed === 'object'
                    && !Array.isArray(parsed);
                } catch {
                  jsonValid = false;
                }
              }

              return {
                starts_with_im_start: raw.startsWith('<|im_start|>'),
                first_json_brace: firstBrace,
                last_json_brace: lastBrace,
                json_valid: jsonValid,
                json_is_object: jsonIsObject,
                prefix_length: firstBrace,
                prefix_char_codes: firstBrace >= 0
                  ? Array.from(raw.slice(0, firstBrace)).map(c => c.charCodeAt(0))
                  : [],

                prefix_is_assistant: raw.slice(0, firstBrace) === '<|im_start|>assistant\\n',
                prefix_is_assistant_final: raw.slice(0, firstBrace) === '<|im_start|>assistant\\n\\n',
                prefix_has_channel: raw.slice(0, firstBrace).includes('meta_sep'),

                suffix_length: lastBrace >= 0 ? raw.length - lastBrace - 1 : null,
              };
            })()
          : null,
        thinking_forced_open: 'thinking_forced_open' in formatted && formatted.thinking_forced_open === true,
      });
    }
    if (cancelled) throw new Error('本機輸出中止。');
    if (result.stopped_limit) throw new PromptBudgetError('完整輸出超過長度上限，需分段處理。');
    const selected = selectStructuredContent(result, schema, { thinkingForcedOpen: 'thinking_forced_open' in formatted && formatted.thinking_forced_open === true });
    return { output: JSON.parse(selected.content), trace: { execution: 'on-device', runtime: RUNTIME_VERSION, model: PHONE_MODEL.id, sha256: PHONE_MODEL.sha256,
      tokens_predicted: result.tokens_predicted, duration_ms: performance.now() - started, tokens_per_second: result.timings?.predicted_per_second ?? null,
      stopped_eos: result.stopped_eos, thinking_enabled: enableThinking, raw_text: selected.content } };
  } finally { busy = false; endTask(); }
}

const str = { type: 'string' };
const contextKeys = ['event_context', 'emotional_context', 'main_concern', 'coping_already_tried', 'support_preference'];
const contextSchema = { type: 'object', additionalProperties: false, required: contextKeys,
  properties: Object.fromEntries(contextKeys.map(k => [k, str])) };
const assessmentSchema = { type: 'object', additionalProperties: false,
  required: ['risk_level', 'risk_evidence', 'context', 'support_style'], properties: {
    risk_level: { type: 'string', enum: ['none', 'low', 'moderate', 'high'] }, risk_evidence: { type: 'array', items: str, maxItems: 3 },
    context: contextSchema, support_style: { type: 'string', enum: ['listening', 'suggestions', 'unspecified'] },
  } };
const supportSchema = { type: 'object', additionalProperties: false, required: ['comfort', 'suggestions', 'blessing'],
  properties: { comfort: str, suggestions: { type: 'array', items: str, maxItems: 0 }, blessing: { type: 'string', enum: [''] } } };


async function assessAll(input: Parameters<PhoneSLM['assess']>[0]): Promise<SLMRun> {
  try { return await json(ASSESS_SYSTEM, input, assessmentSchema); }
  catch (error) { if (!(error instanceof PromptBudgetError)) throw error; }
  // Split only after measuring the actual Qwen prompt. Every code point is covered.
  const characters = Array.from(input.diary);
  if (characters.length < 2) throw new Error('安全判斷提示超出上下文上限。');
  const midpoint = Math.floor(characters.length / 2);
  const parts = [characters.slice(0, midpoint).join(''), characters.slice(midpoint).join('')];
  const first = await assessAll({ ...input, diary: parts[0] });
  const a = parseAssessment(first.output, parts[0]);
  if (a.risk_level === 'high') return first;
  const second = await assessAll({ ...input, diary: parts[1] });
  const b = parseAssessment(second.output, parts[1]);
  if (b.risk_level === 'high') return second;
  const merged = await json(`將兩段已完成的日記語境判讀整合為 schema 的五欄語境，每欄最多八十字。只輸出 JSON。
必須保留已提及的關切、已做過的調適與支持偏好；不可補造事件。risk_evidence 只能使用輸入中既有的逐字短句，無風險則空陣列。
原文已提供的姓名與稱呼不需匿名化，保留人物對應關係，不猜測未知身分。
不能降低任一段已辨識的風險；任一段明確只想被傾聽時，support_style=listening。`,
  { context_segments: [a, b], emotion_probabilities: input.emotion_probabilities }, assessmentSchema);
  const value = parseAssessment(merged.output, input.diary);
  const floor = decision(a.risk_level, b.risk_level, value.risk_level).risk_level;
  const evidence = [value, a, b].find(v => v.risk_level === floor)?.risk_evidence ?? [];
  return { ...merged, output: { ...value, risk_level: floor, risk_evidence: floor === 'none' ? [] : evidence,
    support_style: [a, b].some(v => v.support_style === 'listening') ? 'listening' : value.support_style } };
}

const translationCacheKey=(diary:string)=>`classificationTranslation:one-pass-v1:${PHONE_MODEL.sha256}:${diary}`;
export const translationService = new TranslationService((system,payload,schema)=>json(system,payload,schema,0.1,2048),error=>error instanceof PromptBudgetError,{
  get:async diary=>{const raw=await AsyncStorage.getItem(translationCacheKey(diary));return raw?JSON.parse(raw):null;},
  set:async(diary,result)=>{await AsyncStorage.setItem(translationCacheKey(diary),JSON.stringify(result));},
});

export async function generateDailySources(diary: string, displayScores?: Record<string, number>) {
  const result=await phoneSLM.analyzeDaily!({diary,emotion_scores:displayScores as any,safety:decision(ruleRisk(diary))});
  const details=parseDailyAnalysis(result.output,diary).sources;
  await AsyncStorage.setItem('lastDailySourceAnalysis',JSON.stringify({diary,output:result.output,generation:result.trace,sources:details}));
  return details;
}

export async function composePhoneDaily(sources: DailySource[]): Promise<string> {
  return composeDaily(sources, async segments => (await json(DAILY_COMPOSE_SYSTEM, { chronological_fragments: segments },
    { type: 'object', additionalProperties: false, required: ['diary'], properties: { diary: str } }, 0.1,2048)).output,
    error => error instanceof PromptBudgetError);
}

export const phoneSLM: PhoneSLM = {
  analyzeDaily: input => json(DAILY_ANALYSIS_SYSTEM,dailyAnalysisInput(input.diary,input.emotion_scores),dailyAnalysisSchema(input.diary),0.1,2048),
  causes: async input => ({ output: await generateDailySources(input.diary, input.emotion_scores) }),
  assess: assessAll,
  respond: async input => {
    try { return await json(SUPPORT_SYSTEM, input, supportSchema); }
    catch (error) { if (!(error instanceof PromptBudgetError)) throw error; }
    // The assessment covers the whole diary. Send its context once to fit the prompt budget.
    const { safety, emotion_scores, assessment } = input;
    return json(SUPPORT_SYSTEM, { safety, emotion_scores, support_style: assessment.support_style,
      diary_context: assessment.context }, supportSchema);
  },
};
