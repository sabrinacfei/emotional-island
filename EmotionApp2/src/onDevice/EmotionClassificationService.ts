import type { ClassificationTranslation } from './classificationTranslation';
import type { PhoneClassifierReply } from './localFeedback';
import { decision, ruleRisk } from './flow';

export interface DiaryTranslationService { translate(diary: string): Promise<ClassificationTranslation> }

/** Native classifier owns English tokenization, window inference and aggregation. */
export class EmotionClassificationService {
  constructor(private readonly translation: DiaryTranslationService,
    private readonly classifyEnglish: (text: string) => Promise<PhoneClassifierReply>) {}

  async classify(chineseDiary: string,progress:(message:string)=>void=()=>{}): Promise<PhoneClassifierReply> {
    progress('正在手機翻譯正式日記');
    let translated:ClassificationTranslation;
    try{translated=await this.translation.translate(chineseDiary);}catch(error){
      const failure=new Error(error instanceof Error?error.message:'Translation failed');failure.name='TranslationStageError';throw failure;
    }
    progress('英文已保留，正在手機進行情緒分類');
    if (translated.segments.map(segment => segment.source).join('') !== chineseDiary
      || translated.segments.map(segment => segment.english).join('\n\n') !== translated.text) {
      throw new Error('Classification translation differs from confirmed diary');
    }
    const result = await this.classifyEnglish(translated.text);
    return { ...result, risk_floor: decision(ruleRisk(chineseDiary), result.risk_floor).risk_level,
      classification_translation: translated };
  }
}
