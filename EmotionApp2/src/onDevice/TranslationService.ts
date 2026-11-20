import { translateClassificationDiary, type ClassificationTranslation } from './classificationTranslation';
import { PHONE_MODELS } from './qwen/config';

type Generation = { output: unknown; trace: { model: keyof typeof PHONE_MODELS; sha256: string } };
export interface TranslationCache { get(diary:string):Promise<ClassificationTranslation|null>; set(diary:string,value:ClassificationTranslation):Promise<void> }
type Generator = (system: string, payload: unknown, schema: object) => Promise<Generation>;

/** Translation is an independently replaceable boundary; it never assigns scores. */
export class TranslationService {
  constructor(private readonly generate: Generator, private readonly isBudgetError: (error: unknown) => boolean, private readonly cache?: TranslationCache) {}

  async translate(diary: string): Promise<ClassificationTranslation> {
    const cached=await this.cache?.get(diary).catch(()=>null);
    if(cached && cached.version==='zh-en-faithful-v1' && PHONE_MODELS[cached.model as keyof typeof PHONE_MODELS]?.sha256===cached.model_sha256
      && Array.isArray(cached.segments) && cached.segments.every(s=>s && typeof s.source==='string' && typeof s.english==='string') && typeof cached.text==='string' && /[A-Za-z]{2}/u.test(cached.text)
      && cached.segments.map(s=>s.source).join('')===diary && cached.segments.map(s=>s.english).join('\n\n')===cached.text)return cached;
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
    const result:ClassificationTranslation={...translated,version:'zh-en-faithful-v1',target_language:'en',model,model_sha256};
    await this.cache?.set(diary,result).catch(()=>undefined);
    return result;
  }
}
