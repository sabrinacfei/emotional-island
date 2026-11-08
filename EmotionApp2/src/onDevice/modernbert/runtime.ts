import { requireOptionalNativeModule } from 'expo';
import type { ClassifierTrace, PhoneClassifierReply, ClassifierAnalysis } from '../localFeedback';
import { validateScores, ruleRisk } from '../flow';
import { releasePhoneModel } from '../qwen/runtime';
import { beginModelTask } from '../modelExecution';
import { PHONE_CLASSIFIER } from './model';

type NativeResult = { analysis: ClassifierAnalysis & { scores: PhoneClassifierReply['scores'] }; trace: ClassifierTrace };
type NativeClassifier = { prepare(): Promise<Record<string, unknown>>; classify(text: string): Promise<NativeResult>; release(): Promise<void> };
const native = requireOptionalNativeModule<NativeClassifier>('ModernBERTClassifier');
function required() {
  if (!native) throw new Error('此版本尚未包含手機情緒分類模型，請使用更新後的 iPhone App。');
  return native;
}
export async function preparePhoneClassifier(): Promise<void> {
  const metadata = await required().prepare();
  if (metadata.model !== PHONE_CLASSIFIER.model || metadata.model_sha256 !== PHONE_CLASSIFIER.model_sha256
    || metadata.tokenizer_sha256 !== PHONE_CLASSIFIER.tokenizer_sha256) throw new Error('手機分類模型版本不一致。');
}
export async function classifyOnPhone(text: string): Promise<PhoneClassifierReply> {
  const endTask = beginModelTask('modernbert-classification');
  try {
    // The generation model is reloaded on the next Qwen request. No simultaneous model residency is required.
    await releasePhoneModel();
    const { analysis, trace } = await required().classify(text);
    if (trace.execution !== 'on-device' || trace.runtime !== 'coreml' || trace.model !== PHONE_CLASSIFIER.model
      || trace.model_sha256 !== PHONE_CLASSIFIER.model_sha256 || trace.tokenizer_sha256 !== PHONE_CLASSIFIER.tokenizer_sha256
      || !/^[a-f0-9]{64}$/.test(trace.input_sha256)) throw new Error('手機分類紀錄不完整。');
    const scores = validateScores(analysis.scores!);
    return { backend:'modernbert', classification_available:true, scores, analysis,
      receipt_token:null, risk_floor:ruleRisk(text), classifier_trace:trace };
  } finally { await native?.release().catch(() => undefined); endTask(); }
}
