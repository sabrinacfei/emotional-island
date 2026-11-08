/** Portable phone workflow. Native model adapters are required before app use. */
export const EMOTIONS = ['Joy', 'Sadness', 'Anger', 'Fear', 'Anticipation', 'Surprise', 'Disgust', 'Trust'] as const;
export type Scores = Record<typeof EMOTIONS[number], number>;
export type Risk = 'none' | 'low' | 'moderate' | 'high';
export type Mode = 'SUPPORT_MODE' | 'SAFE_MODE';
export type Context = {
  event_context: string; emotional_context: string; main_concern: string;
  coping_already_tried: string; support_preference: string;
};
export type Decision = { risk_level: Risk; response_mode: Mode; safety_action: 'none' | 'encourage_support' | 'urgent_help' };
const rank: Record<Risk, number> = { none: 0, low: 1, moderate: 2, high: 3 };
const high = ['自殺', '結束生命', '結束這一切', '不想活', '不想再活', '想死', '去死', '遺書', '寫好信', '割腕', '跳樓', '吞藥', '上吊', '傷害自己', '傷害別人', '殺了', '同歸於盡'];
const moderate = ['想消失', '消失算了', '活著好累', '撐不下去', '撐不住', '沒有意義', '好絕望', '快崩潰', '不想醒來'];
const low = ['我很沒用', '討厭自己', '一無是處', '沒有人在乎', '好痛苦'];

export function decision(...signals: Risk[]): Decision {
  if (!signals.length || signals.some(x => !Object.prototype.hasOwnProperty.call(rank, x))) throw new Error('Incomplete safety decision');
  const risk = signals.reduce((a, b) => rank[a] >= rank[b] ? a : b);
  return { risk_level: risk, response_mode: risk === 'none' ? 'SUPPORT_MODE' : 'SAFE_MODE',
    safety_action: risk === 'high' ? 'urgent_help' : risk === 'none' ? 'none' : 'encourage_support' };
}
export function ruleRisk(text: string): Risk {
  const compact = text.replace(/\s/g, '');
  return high.some(x => compact.includes(x)) ? 'high' : moderate.some(x => compact.includes(x)) ? 'moderate' : low.some(x => compact.includes(x)) ? 'low' : 'none';
}
export function validateScores(input: Scores): Scores {
  if (!input || Object.keys(input).length !== 8 || EMOTIONS.some(k => !Number.isInteger(input[k]) || input[k] < 0 || input[k] > 100)
      || EMOTIONS.reduce((total, k) => total + input[k], 0) !== 100) throw new Error('Invalid classifier scores');
  return Object.fromEntries(EMOTIONS.map(k => [k, input[k]])) as Scores;
}
