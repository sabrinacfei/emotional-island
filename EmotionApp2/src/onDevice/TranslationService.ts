import { translateClassificationDiary, type ClassificationTranslation } from './classificationTranslation';
import { PHONE_MODELS } from './qwen/config';

type Generation = { output: unknown; trace: { model: keyof typeof PHONE_MODELS; sha256: string } };
type Generator = (system: string, payload: unknown, schema: object) => Promise<Generation>;

/** Translation is an independently replaceable boundary; it never assigns scores. */
export class TranslationService {
  constructor(private readonly generate: Generator, private readonly isBudgetError: (error: unknown) => boolean) {}

  async translate(diary: string): Promise<ClassificationTranslation> {
    let model: keyof typeof PHONE_MODELS | undefined;
    let model_sha256 = '';
    const translated = await translateClassificationDiary(diary, async (system, payload, schema) => {
      const result = await this.generate(system, payload, schema);
      const expected = PHONE_MODELS[result.trace.model];
      if (!expected || result.trace.sha256 !== expected.sha256 || (model && model !== result.trace.model)) {
        throw new Error('Translation model provenance changed');
      }
      model = result.trace.model; model_sha256 = result.trace.sha256;
      return result;
    }, this.isBudgetError);
    if (!model) throw new Error('Missing translation model');
    return { ...translated, version: 'zh-en-faithful-v1', target_language: 'en', model, model_sha256 };
  }
}
