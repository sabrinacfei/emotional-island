import { EmotionClassificationService } from './EmotionClassificationService';
import { translationService } from './qwen/runtime';
import { classifyEnglishOnPhone } from './modernbert/runtime';

export const emotionClassificationService = new EmotionClassificationService(translationService, classifyEnglishOnPhone);
export const classifyOnPhone = (diary: string) => emotionClassificationService.classify(diary);
