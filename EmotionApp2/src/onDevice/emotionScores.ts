/** Accept stored 0–1 distributions and already converted 0–100 chart values.
 * A 1% entry alone must never cause a percentage distribution to scale again. */
export function percentageScores(scores: Record<string, number> = {}): Record<string, number> {
  const values = Object.values(scores);
  const total = values.reduce((sum, value) => sum + value, 0);
  const probabilities = values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && total > 0 && total <= 1.0001;
  return probabilities ? Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Math.round(value * 100)])) : scores;
}
