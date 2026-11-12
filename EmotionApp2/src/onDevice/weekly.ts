export type WeekDay = { date: string; status: 'analyzed' | 'missing'; analysis: any | null };
export type WeekReview = { days: WeekDay[]; analyzed_days: number; week_closed: boolean; week_ready: boolean };
/** Split paths at missing days; missing never becomes zero or a line across an unobserved date. */
export function trendPaths(days: WeekDay[], score: string | ((analysis: any) => number), width = 280, height = 150): string[] {
  const paths: string[] = []; let current = '';
  days.forEach((day, index) => {
    const value = day.status !== 'analyzed' ? null
      : typeof score === 'function' ? score(day.analysis) : day.analysis?.scores?.[score];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      if (current) paths.push(current); current = ''; return;
    }
    current += `${current ? ' L' : 'M'}${index * width / 6},${height * (1 - value)}`;
  });
  if (current) paths.push(current);
  return paths;
}
