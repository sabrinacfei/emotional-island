import type { ClassificationTranslation } from './classificationTranslation';
import { isSourceExplanation } from './emotionEvidence';
import {parseDailyAnalysis} from './qwen/dailyAnalysis';
import { decision, ruleRisk, validateScores, EMOTIONS, type Scores, type Risk, type Context, type Decision } from './flow';
import { PHONE_MODELS, type PhoneModel, type PhoneModelId } from './qwen/config';

export type ClassifierAnalysis = { probabilities: Scores; top_3: Array<{ emotion: string; probability: number; score: number }>;
  token_count: number; chunk_count: number; chunks: unknown[]; aggregation: { method: string }; labels: string[]; truncated: boolean };
export type ClassifierReply = { scores: Scores | null; receipt_token: string | null; risk_floor: Risk; backend: 'modernbert'; classification_available: boolean; analysis: ClassifierAnalysis | null };
export type ClassifierTrace = { execution: 'on-device'; runtime: 'coreml'; model: string; model_sha256: string;
  tokenizer_sha256: string; input_sha256: string; duration_ms: number; load_ms: number };
export type PhoneClassifierReply = ClassifierReply & { classifier_trace?: ClassifierTrace; classification_translation?: ClassificationTranslation };
export type ContextAssessment = { risk_level: Risk; risk_evidence: string[]; context: Context; support_style: 'listening' | 'suggestions' | 'unspecified' };
export type Support = { comfort: string; suggestions: string[]; blessing: string };
export type EmotionCause = { type: 'stressor' | 'buffer' | 'joy'; topic: string; explanation: string; evidence: string; emotions: string[] };
export type EmotionSource = { emotion: string; explanation: string; evidence: string;
  coping_note?: string; additional_evidence?: string[] };
export type DailySources = { causes: EmotionCause[]; emotion_sources?: EmotionSource[]; source_analysis_version?: 'emotion-evidence-v2' | 'emotion-evidence-v3' | 'emotion-evidence-v4' | 'emotion-evidence-v5' };
export type GenerationTrace = { execution: 'on-device'; runtime: string; model: PhoneModelId; sha256: string;
  thinking_enabled?: boolean; tokens_predicted: number; duration_ms: number; tokens_per_second: number | null; stopped_eos: boolean; raw_text: string };
export type SLMRun = { output: unknown; trace: GenerationTrace };
export type LocalFeedback = Support & Decision & {
  status: 'completed' | 'local_safety' | 'unavailable';
  scores: Scores | null; classification_available: boolean; receipt_token: string | null;
  safety_check_status: 'screened' | 'unavailable'; context: Context | null;
  inference_source: PhoneModel['inferenceSource'] | 'fixed-safety' | 'unavailable';
  generation: GenerationTrace | null;
  classifier_analysis: ClassifierAnalysis | null;
  classifier_trace?: ClassifierTrace;
  classification_translation?: ClassificationTranslation;
  causes?: EmotionCause[];
  emotion_sources?: EmotionSource[];
  source_analysis_version?: 'emotion-evidence-v2' | 'emotion-evidence-v3' | 'emotion-evidence-v4' | 'emotion-evidence-v5';
  failure_reason?:string; failure_message?:string;
  failure_stage?: 'translation' | 'classification' | 'assessment' | 'assessment_validation' | 'support' | 'support_validation' | 'causes' | 'causes_validation';
};
export interface PhoneSLM {
  analyzeDaily?(input: {diary:string; emotion_scores?:Scores; emotion_probabilities?:Scores; safety:Decision}): Promise<SLMRun>;
  assess(input: { diary: string; emotion_scores?: Scores; emotion_probabilities?: Scores; safety: Decision }): Promise<SLMRun>;
  respond(input: { diary: string; emotion_scores?: Scores; emotion_probabilities?: Scores; assessment: ContextAssessment; safety: Decision }): Promise<SLMRun>;
  causes?(input: { diary: string; emotion_probabilities: Scores; emotion_scores?: Scores }): Promise<{ output: unknown }>;
}

export function causeCategoryMatches(type: EmotionCause['type'], emotions: string[]): boolean {
  return type === 'stressor' ? emotions.some(emotion => ['Anger', 'Disgust', 'Fear', 'Sadness'].includes(emotion))
    : type === 'joy' ? emotions.some(emotion => ['Joy', 'Anticipation'].includes(emotion)) : true;
}

export function parseCauses(input: unknown, diary: string): EmotionCause[] {
  const v = input as { causes: EmotionCause[] };
  if (!v || Object.keys(v).join() !== 'causes' || !Array.isArray(v.causes) || v.causes.length > 6) throw new Error('Invalid causes');
  return v.causes.map(c => {
    if (Object.keys(c).sort().join() !== 'emotions,evidence,explanation,topic,type' || !['stressor', 'buffer', 'joy'].includes(c.type)
      || !Array.isArray(c.emotions) || (!c.emotions.length && c.type !== 'buffer') || c.emotions.length > 3 || c.emotions.some(k => !EMOTIONS.includes(k as any))
      || !causeCategoryMatches(c.type, c.emotions)
      || !isSourceExplanation(c.explanation) || typeof c.evidence !== 'string' || c.evidence.length < 2 || !diary.includes(c.evidence)) throw new Error('Unverifiable cause');
    return { ...c, topic: text(c.topic, 40), explanation: text(c.explanation, 180), evidence: text(c.evidence, 600) };
  });
}

export function parseDailySources(input: unknown, diary: string): DailySources {
  const value = input as DailySources;
  const causes = parseCauses({ causes: value?.causes }, diary);
  if (value.emotion_sources === undefined) return { causes };
  if (!Array.isArray(value.emotion_sources) || value.emotion_sources.length > EMOTIONS.length) throw new Error('Invalid emotion sources');
  const seen = new Set<string>();
  const emotion_sources = value.emotion_sources.map(source => {
    const evidence = text(source?.evidence, 600);
    if (!EMOTIONS.some(emotion => emotion === source.emotion)
      || !isSourceExplanation(source.explanation) || seen.has(source.emotion) || evidence.length < 2 || !diary.includes(evidence)) throw new Error('Unverifiable emotion source');
    seen.add(source.emotion);
    const note = source.coping_note === undefined ? undefined : text(source.coping_note, 180);
    if (note && !isSourceExplanation(note)) throw new Error('Invalid coping note');
    if (source.additional_evidence !== undefined && (!Array.isArray(source.additional_evidence) || source.additional_evidence.length > 2
      || source.additional_evidence.some(quote => typeof quote !== 'string' || quote.trim().length < 2 || quote.length > 600 || !diary.includes(quote)))) throw new Error('Unverifiable related evidence');
    if (note && !source.additional_evidence?.length) throw new Error('Missing coping outcome evidence');
    return { emotion: source.emotion, explanation: text(source.explanation, 180), evidence,
      ...(note ? { coping_note: note } : {}), ...(source.additional_evidence?.length ? { additional_evidence: source.additional_evidence } : {}) };
  });
  return { causes, emotion_sources, ...(['emotion-evidence-v2', 'emotion-evidence-v3', 'emotion-evidence-v4', 'emotion-evidence-v5'].includes(value.source_analysis_version ?? '') ? { source_analysis_version: value.source_analysis_version } : {}) };
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
  let classificationTranslation: ClassificationTranslation | undefined;
  let generation: GenerationTrace | null = null;
  let stage: NonNullable<LocalFeedback['failure_stage']> = 'classification';
  let safety: Decision = decision('none');
  const base = () => ({ ...safety, scores, receipt_token: receipt, classification_available: scores !== null, classifier_analysis: analysis, generation,
    ...(classifierTrace ? { classifier_trace: classifierTrace } : {}),
    ...(classificationTranslation ? { classification_translation: classificationTranslation } : {}) });
  try {
    if (!diary.trim() || diary.length > 12000) throw new Error('Invalid diary');
    progress('正在檢查安全訊號');
    safety = decision(ruleRisk(diary));
    if (safety.risk_level === 'high') return { ...base(), ...fixedSafety(safety), inference_source: 'fixed-safety', status: 'local_safety', safety_check_status: 'screened', context: null };
    if (!immediate) {
    progress('正在翻譯英文分類輸入並分析情緒');
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
    classificationTranslation = classified.classification_translation;
    scores = validateScores(classified.scores as Scores); receipt = classified.receipt_token;
    analysis = classified.analysis;
    const p = analysis?.probabilities;
    if (!analysis || !p || Object.keys(p).length !== 8 || EMOTIONS.some(k => !Number.isFinite(p[k]) || p[k] < 0 || p[k] > 1)
      || Math.abs(EMOTIONS.reduce((n, k) => n + p[k], 0) - 1) > 1e-4 || analysis.truncated || !analysis.chunk_count) throw new Error('Incomplete diary probabilities');
    }
    const emotionInput = scores && analysis ? { emotion_scores: scores, emotion_probabilities: analysis.probabilities } : {};
    let assessment:ContextAssessment, support:Support;
    let sources:DailySources={causes:[]};
    if(!immediate && slm.analyzeDaily){
      progress('正在手機分析事件、情緒變化與來源');
      stage='assessment';
      const generated=await slm.analyzeDaily({diary,...emotionInput,safety});
      stage='causes_validation';
      const parsed=parseDailyAnalysis(generated.output,diary);
      assessment=parsed.assessment;support=parsed.support;sources=parsed.sources;generation=generated.trace;
      safety=decision(safety.risk_level,assessment.risk_level);
      if(safety.risk_level==='high')return {...base(),...fixedSafety(safety),inference_source:'fixed-safety',status:'local_safety',safety_check_status:'screened',context:assessment.context};
    } else {
    progress('正在手機理解日記與判斷回應模式');
    stage = 'assessment';
    const assessed = await slm.assess({ diary, ...emotionInput, safety });
    stage = 'assessment_validation';
    assessment = parseAssessment(assessed.output, diary);
    safety = decision(safety.risk_level, assessment.risk_level);
    if (safety.risk_level === 'high') return { ...base(), ...fixedSafety(safety), inference_source: 'fixed-safety', status: 'local_safety', safety_check_status: 'screened', context: assessment.context };
    progress('正在手機產生回饋');
    stage = 'support';
    const responded = await slm.respond({ diary, ...emotionInput, assessment, safety });
    stage = 'support_validation';
    generation = responded.trace;
    support = parseSupport(responded.output, assessment);
    const model = PHONE_MODELS[generation.model];
    if (!model || generation.sha256 !== model.sha256 || generation.execution !== 'on-device'
      || generation.tokens_predicted <= 0 || !generation.raw_text) throw new Error('Invalid native generation result');
    if (!immediate && slm.causes && analysis) {
      stage = 'causes';
      progress('正在手機整理情緒成因');
      const found = await slm.causes({ diary, emotion_probabilities: analysis.probabilities, emotion_scores: scores! });
      stage = 'causes_validation';
      sources = parseDailySources(found.output, diary);
    }
    }
    const model=PHONE_MODELS[generation!.model];
    if(!model || generation!.sha256!==model.sha256 || generation!.execution!=='on-device' || generation!.tokens_predicted<=0 || !generation!.raw_text)throw Error('Invalid native generation result');
    if (classificationTranslation && analysis) {
      stage = 'causes_validation';
      const dominant = analysis.top_3?.[0]?.emotion
        ?? EMOTIONS.reduce((best, emotion) => analysis!.probabilities[emotion] > analysis!.probabilities[best] ? emotion : best);
      if (!['emotion-evidence-v4','emotion-evidence-v5'].includes(sources.source_analysis_version ?? '')
        || !sources.emotion_sources?.some(source => source.emotion === dominant)) {
        throw new Error('Dominant classification lacks supporting Chinese evidence');
      }
    }
    return { ...base(), ...support, ...sources, inference_source: model.inferenceSource, status: 'completed', safety_check_status: 'screened', context: assessment.context };
  } catch (error) {
    if(error instanceof Error && error.name==='TranslationStageError')stage='translation';
    const reason=error instanceof Error?error.message:'Unknown local failure';
    const message=/離開前景|輸出中止/.test(reason)?'分析已中斷，請保持 App 開啟後繼續。':/已有本機|正在執行/.test(reason)?'已有分析處理中，請等待目前作業完成。':/上下文|長度上限|超出/.test(reason)?'這次內容超出處理容量，定稿已保留。':stage==='translation'?'英文整理中斷，定稿已保留，可繼續分析。':'分析中斷，已完成的內容會保留，可繼續分析。';
    if (__DEV__) {
      console.error('[AI Analysis Failed]', { stage: 'local-feedback', errorType: error instanceof Error ? error.name : 'UnknownError' });
    }
    // Failed checks never become SUPPORT_MODE. Keep valid scores without claiming the route was screened.
    return { ...base(), ...fixedSafety(safety), inference_source: 'unavailable', response_mode: 'SAFE_MODE', status: 'unavailable', safety_check_status: 'unavailable', context: null, failure_stage: stage,failure_reason:reason.slice(0,240),failure_message:message };
  }
}

/** Fragment support is fully local and never has a classifier dependency or fabricated scores. */
export const runImmediateSupport = (diary: string, slm: PhoneSLM, progress?: (stage: string) => void) =>
  runLocalFeedback(diary, async () => { throw new Error('Fragment classification is forbidden'); }, slm, progress, true);
