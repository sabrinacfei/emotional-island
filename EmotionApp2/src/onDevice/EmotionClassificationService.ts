import type { ClassificationTranslation } from './classificationTranslation';
import type { PhoneClassifierReply } from './localFeedback';
import { decision, ruleRisk } from './flow';

export interface DiaryTranslationService { translate(diary: string): Promise<ClassificationTranslation> }

/** Native classifier owns English tokenization, window inference and aggregation. */
export class EmotionClassificationService {
  constructor(private readonly translation: DiaryTranslationService,
    private readonly classifyEnglish: (text: string) => Promise<PhoneClassifierReply>) {}

  async classify(chineseDiary: string): Promise<PhoneClassifierReply> {
    const translated = await this.translation.translate(chineseDiary);
    if (translated.segments.map(segment => segment.source).join('') !== chineseDiary
      || translated.segments.map(segment => segment.english).join('\n\n') !== translated.text) {
      throw new Error('Classification translation differs from confirmed diary');
    }
    const result = await this.classifyEnglish(translated.text);
    return { ...result, risk_floor: decision(ruleRisk(chineseDiary), result.risk_floor).risk_level,
      classification_translation: translated };
  }
}
