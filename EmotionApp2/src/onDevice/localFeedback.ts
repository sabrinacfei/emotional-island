import { decision, ruleRisk, validateScores, EMOTIONS, type Scores, type Risk, type Context, type Decision } from './flow';
import { PHONE_MODELS, type PhoneModel, type PhoneModelId } from './qwen/config';

export type ClassifierAnalysis = { probabilities: Scores; top_3: Array<{ emotion: string; probability: number; score: number }>;
  token_count: number; chunk_count: number; chunks: unknown[]; aggregation: { method: string }; labels: string[]; truncated: boolean };
export type ClassifierReply = { scores: Scores | null; receipt_token: string | null; risk_floor: Risk; backend: 'modernbert'; classification_available: boolean; analysis: ClassifierAnalysis | null };
export type ClassifierTrace = { execution: 'on-device'; runtime: 'coreml'; model: string; model_sha256: string;
  tokenizer_sha256: string; input_sha256: string; duration_ms: number; load_ms: number };
export type PhoneClassifierReply = ClassifierReply & { classifier_trace?: ClassifierTrace };
export type ContextAssessment = { risk_level: Risk; risk_evidence: string[]; context: Context; support_style: 'listening' | 'suggestions' | 'unspecified' };
export type Support = { comfort: string; suggestions: string[]; blessing: string };
export type EmotionCause = { type: 'stressor' | 'buffer' | 'joy'; topic: string; explanation: string; evidence: string; emotions: string[] };
export type GenerationTrace = { execution: 'on-device'; runtime: string; model: PhoneModelId; sha256: string;
  tokens_predicted: number; duration_ms: number; tokens_per_second: number | null; stopped_eos: boolean; raw_text: string };
export type SLMRun = { output: unknown; trace: GenerationTrace };
export type LocalFeedback = Support & Decision & {
  status: 'completed' | 'local_safety' | 'unavailable';
  scores: Scores | null; classification_available: boolean; receipt_token: string | null;
  safety_check_status: 'screened' | 'unavailable'; context: Context | null;
  inference_source: PhoneModel['inferenceSource'] | 'fixed-safety' | 'unavailable';
  generation: GenerationTrace | null;
  classifier_analysis: ClassifierAnalysis | null;
  classifier_trace?: ClassifierTrace;
  causes?: EmotionCause[];
  failure_stage?: 'classification' | 'assessment' | 'assessment_validation' | 'support' | 'support_validation' | 'causes' | 'causes_validation';
};
export interface PhoneSLM {
  assess(input: { diary: string; emotion_scores?: Scores; emotion_probabilities?: Scores; safety: Decision }): Promise<SLMRun>;
  respond(input: { diary: string; emotion_scores?: Scores; emotion_probabilities?: Scores; assessment: ContextAssessment; safety: Decision }): Promise<SLMRun>;
  causes?(input: { diary: string; emotion_probabilities: Scores }): Promise<SLMRun>;
}

export function parseCauses(input: unknown, diary: string): EmotionCause[] {
  const v = input as { causes: EmotionCause[] };
  if (!v || Object.keys(v).join() !== 'causes' || !Array.isArray(v.causes) || v.causes.length > 3) throw new Error('Invalid causes');
  return v.causes.map(c => {
    if (Object.keys(c).sort().join() !== 'emotions,evidence,explanation,topic,type' || !['stressor', 'buffer', 'joy'].includes(c.type)
      || !Array.isArray(c.emotions) || !c.emotions.length || c.emotions.length > 3 || c.emotions.some(k => !EMOTIONS.includes(k as any))
      || typeof c.evidence !== 'string' || c.evidence.length < 2 || !diary.includes(c.evidence)) throw new Error('Unverifiable cause');
    return { ...c, topic: text(c.topic, 40), explanation: text(c.explanation, 180), evidence: text(c.evidence, 160) };
  });
}

const contextKeys = ['event_context', 'emotional_context', 'main_concern', 'coping_already_tried', 'support_preference'] as const;
function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /<\/?think>|<\|[^>]*\|>/.test(input)) throw new Error('Invalid model text');
  return input.trim();
}
export function parseAssessment(input: unknown, diary: string): ContextAssessment {
  const v = input as ContextAssessment;
  if (!v || Object.keys(v).sort().join(',') !== 'context,risk_evidence,risk_level,support_style') throw new Error('Invalid assessment fields');
  decision(v.risk_level); // unknown/missing must fail closed
  if (!['listening', 'suggestions', 'unspecified'].includes(v.support_style)) throw new Error('Invalid support style');
  if (!Array.isArray(v.risk_evidence) || v.risk_evidence.length > 3 || v.risk_evidence.some(q => typeof q !== 'string' || q.length < 2 || q.length > 120 || !diary.includes(q))) throw new Error('Unverifiable risk evidence');
  if (v.risk_level !== 'none' && !v.risk_evidence.length) throw new Error('Missing risk evidence');
  if (!v.context || Object.keys(v.context).length !== 5) throw new Error('Invalid context');
  const context = Object.fromEntries(contextKeys.map(k => [k, text(v.context[k], 180)])) as Context;
  return { ...v, context };
}
export function parseSupport(input: unknown, assessment: ContextAssessment): Support {
  const v = input as Support;
  if (!v || Object.keys(v).sort().join(',') !== 'blessing,comfort,suggestions' || !Array.isArray(v.suggestions) || v.suggestions.length > 2) throw new Error('Invalid support');
  const suggestions = v.suggestions.map(s => text(s, 160));
  if (assessment.support_style === 'listening' && suggestions.length) throw new Error('Suggestions conflict with listening preference');
  const comfort = text(v.comfort, 700);
  const blessing = typeof v.blessing === 'string' && !v.blessing.trim() ? '' : text(v.blessing, 160);
  const followUp = /[?？]|(?:嗎|吗|好不好|你覺得呢)(?=[。！!\s]|$)|(?:告訴我|跟我說|和我說)(?:更多|一點)|(?:跟|和)我(?:再|多)?聊聊|請回覆|等你回覆|歡迎繼續分享/u;
  if ([comfort, ...suggestions, blessing].some(part => followUp.test(part))) throw new Error('Support must be a complete one-way response');
  return { comfort, suggestions, blessing };
}
export function fixedSafety(safety: Decision): Support {
  return safety.risk_level === 'high' ? {
    comfort: '謝謝你願意說出現在的感受。現在先以你的安全為優先；如果你可能立即傷害自己或他人，請立即聯絡當地緊急服務，或請身邊可信任的人陪你尋求協助。',
    suggestions: ['先遠離可能造成傷害的物品或危險環境，前往有人陪伴的安全地方。', '讓一位可信任的人知道你現在需要陪伴，並尋求專業協助。'], blessing: '',
  } : {
    comfort: '目前無法完成情緒分析與安全判斷，日記會保留在手機供你重試。若你現在感到不安全，請先找可信任的人陪伴；若有立即危險，請聯絡當地緊急服務。',
    suggestions: [], blessing: '',
  };
}

/** The classifier adapter supplies real scores; Qwen receives the unchanged diary on the phone. */
export async function runLocalFeedback(diary: string, classify: (text: string) => Promise<PhoneClassifierReply>, slm: PhoneSLM,
  progress: (stage: string) => void = () => undefined, immediate = false): Promise<LocalFeedback> {
  let scores: Scores | null = null, receipt: string | null = null;
  let analysis: ClassifierAnalysis | null = null;
  let classifierTrace: ClassifierTrace | undefined;
  let generation: GenerationTrace | null = null;
  let stage: NonNullable<LocalFeedback['failure_stage']> = 'classification';
  let safety: Decision = decision('none');
  const base = () => ({ ...safety, scores, receipt_token: receipt, classification_available: scores !== null, classifier_analysis: analysis, generation,
    ...(classifierTrace ? { classifier_trace: classifierTrace } : {}) });
  try {
    if (!diary.trim() || diary.length > 12000) throw new Error('Invalid diary');
    progress('正在檢查安全訊號');
    safety = decision(ruleRisk(diary));
    if (safety.risk_level === 'high') return { ...base(), ...fixedSafety(safety), inference_source: 'fixed-safety', status: 'local_safety', safety_check_status: 'screened', context: null };
    if (!immediate) {
    progress('正在分析日記情緒');
    const classified = await classify(diary);
    if (classified.backend !== 'modernbert') throw new Error('Unexpected classifier');
    safety = decision(safety.risk_level, classified.risk_floor);
    if (safety.risk_level === 'high') return { ...base(), ...fixedSafety(safety), inference_source: 'fixed-safety', status: 'local_safety', safety_check_status: 'screened', context: null };
    const trace = classified.classifier_trace;
    if (trace && (trace.execution !== 'on-device' || trace.runtime !== 'coreml' || !trace.model
      || ![trace.model_sha256,trace.tokenizer_sha256,trace.input_sha256].every(v => /^[a-f0-9]{64}$/.test(v))
      || !Number.isFinite(trace.duration_ms) || trace.duration_ms <= 0)) throw new Error('Invalid native classifier trace');
    if (!classified.classification_available || (!classified.receipt_token && !trace)) throw new Error('Classifier unavailable');
    classifierTrace = trace;
    scores = validateScores(classified.scores as Scores); receipt = classified.receipt_token;
    analysis = classified.analysis;
    const p = analysis?.probabilities;
    if (!analysis || !p || Object.keys(p).length !== 8 || EMOTIONS.some(k => !Number.isFinite(p[k]) || p[k] < 0 || p[k] > 1)
      || Math.abs(EMOTIONS.reduce((n, k) => n + p[k], 0) - 1) > 1e-4 || analysis.truncated || !analysis.chunk_count) throw new Error('Incomplete diary probabilities');
    }
    const emotionInput = scores && analysis ? { emotion_scores: scores, emotion_probabilities: analysis.probabilities } : {};
    progress('正在手機理解日記與判斷回應模式');
    stage = 'assessment';
    const assessed = await slm.assess({ diary, ...emotionInput, safety });
    stage = 'assessment_validation';
    const assessment = parseAssessment(assessed.output, diary);
    safety = decision(safety.risk_level, assessment.risk_level);
    if (safety.risk_level === 'high') return { ...base(), ...fixedSafety(safety), inference_source: 'fixed-safety', status: 'local_safety', safety_check_status: 'screened', context: assessment.context };
    progress('正在手機產生回饋');
    stage = 'support';
    const responded = await slm.respond({ diary, ...emotionInput, assessment, safety });
    stage = 'support_validation';
    generation = responded.trace;
    const support = parseSupport(responded.output, assessment);
    const model = PHONE_MODELS[generation.model];
    if (!model || generation.sha256 !== model.sha256 || generation.execution !== 'on-device'
      || generation.tokens_predicted <= 0 || !generation.raw_text) throw new Error('Invalid native generation result');
    let causes: EmotionCause[] = [];
    if (!immediate && slm.causes && analysis) {
      stage = 'causes';
      progress('正在手機整理情緒成因');
      const found = await slm.causes({ diary, emotion_probabilities: analysis.probabilities });
      stage = 'causes_validation';
      causes = parseCauses(found.output, diary);
    }
    return { ...base(), ...support, causes, inference_source: model.inferenceSource, status: 'completed', safety_check_status: 'screened', context: assessment.context };
  } catch (error) {
    if (__DEV__) {
      console.error('[AI Analysis Failed]', { stage: 'local-feedback', errorType: error instanceof Error ? error.name : 'UnknownError' });
    }
    // Failed checks never become SUPPORT_MODE. Keep valid scores without claiming the route was screened.
    return { ...base(), ...fixedSafety(safety), inference_source: 'unavailable', response_mode: 'SAFE_MODE', status: 'unavailable', safety_check_status: 'unavailable', context: null, failure_stage: stage };
  }
}

/** Fragment support is fully local and never has a classifier dependency or fabricated scores. */
export const runImmediateSupport = (diary: string, slm: PhoneSLM, progress?: (stage: string) => void) =>
  runLocalFeedback(diary, async () => { throw new Error('Fragment classification is forbidden'); }, slm, progress, true);
