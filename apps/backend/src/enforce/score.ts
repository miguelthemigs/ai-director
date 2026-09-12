export type Band = 1 | 2 | 3 | 4 | 5;

export const PASS_BAND = 4;

const PERCENT: Record<Band, number> = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };

export function bandToPercent(band: Band): number {
  const percent = PERCENT[band];
  if (percent === undefined) throw new Error(`band must be 1-5, got ${band}`);
  return percent;
}

export function isPass(band: number): boolean {
  return band >= PASS_BAND;
}
