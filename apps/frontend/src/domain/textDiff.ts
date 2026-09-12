export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * Longest-common-subsequence line diff, the classic O(n·m) dynamic-programming form. What this
 * compares — a rubric or prompt file — is a handful of lines, never a real document, so the naive
 * table is the right amount of code for what it buys: no dependency, no heuristics, an exact
 * minimal edit script every time.
 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffLine[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i--) {
    const row = dp[i];
    const nextRow = dp[i + 1];
    if (row === undefined || nextRow === undefined) continue;
    for (let j = b.length - 1; j >= 0; j--) {
      const ai = a[i];
      const bj = b[j];
      const matchScore = (nextRow[j + 1] ?? 0) + 1;
      const skipScore = Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
      row[j] = ai !== undefined && bj !== undefined && ai === bj ? matchScore : skipScore;
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const ai = a[i];
    const bj = b[j];
    if (ai === undefined || bj === undefined) break;

    if (ai === bj) {
      result.push({ kind: "same", text: ai });
      i += 1;
      j += 1;
      continue;
    }

    const rowI = dp[i];
    const rowI1 = dp[i + 1];
    const takeRemoved = (rowI1?.[j] ?? 0) >= (rowI?.[j + 1] ?? 0);
    if (takeRemoved) {
      result.push({ kind: "removed", text: ai });
      i += 1;
    } else {
      result.push({ kind: "added", text: bj });
      j += 1;
    }
  }
  while (i < a.length) {
    const ai = a[i];
    if (ai !== undefined) result.push({ kind: "removed", text: ai });
    i += 1;
  }
  while (j < b.length) {
    const bj = b[j];
    if (bj !== undefined) result.push({ kind: "added", text: bj });
    j += 1;
  }

  return result;
}
