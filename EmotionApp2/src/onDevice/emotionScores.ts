/** Accept stored 0–1 distributions and already converted 0–100 chart values.
 * A 1% entry alone must never cause a percentage distribution to scale again. */
export function percentageScores(scores: Record<string, number> = {}): Record<string, number> {
  const values = Object.values(scores);
  const total = values.reduce((sum, value) => sum + value, 0);
  const probabilities = values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && total > 0 && total <= 1.0001;
  if (!probabilities) return scores;
  const entries=Object.entries(scores);
  if(Math.abs(total-1)>0.0001)return Object.fromEntries(entries.map(([key,value])=>[key,Math.round(value*100)]));
  const rounded=Object.fromEntries(entries.map(([key,value])=>[key,Math.floor(value*100)]));
  const remaining=100-Object.values(rounded).reduce((sum,value)=>sum+value,0);
  const ranked=entries.map(([key,value],index)=>({key,remainder:value*100-rounded[key],index}))
    .sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
  for(const item of ranked.slice(0,remaining))rounded[item.key]++;
  return rounded;
}

/** Preserve native ordering when integer chart percentages round to a tie. */
export function rankedEmotionScores(scores: Record<string, number> = {}, probabilities: Record<string, number> = {}, limit = 3) {
  return Object.entries(percentageScores(scores))
    .filter(([, value]) => value > 0)
    .sort((a, b) => (probabilities[b[0]] ?? b[1]) - (probabilities[a[0]] ?? a[1]))
    .slice(0, limit);
}

/** Explicit owner-provided display values never replace saved model probabilities. */
export function reviewedDisplayScores(raw: any): Record<string, number> | null {
  const review = raw?.source_review;
  const keys = ['Joy','Sadness','Anger','Fear','Anticipation','Surprise','Disgust','Trust'];
  const scores = review?.display_scores;
  if (review?.origin !== 'human-reviewed' || review?.display_scores_origin !== 'owner-provided-estimate'
      || !scores || Object.keys(scores).length !== keys.length
      || !keys.every(key => Number.isInteger(scores[key]) && scores[key] >= 0 && scores[key] <= 100)
      || keys.reduce((sum, key) => sum + scores[key], 0) !== 100) return null;
  return scores;
}
