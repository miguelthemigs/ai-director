/**
 * A word-level diff, so a difference between two descriptions is SHOWN rather than
 * asserted.
 *
 * The Compare screen's whole claim is that two prompts differ in exactly one place. Saying
 * so is worth nothing: the reader has to be able to see which words moved. This is the
 * smallest honest way to do that — a longest-common-subsequence over whitespace-separated
 * tokens, which is what `diff` itself does at line granularity.
 *
 * Whitespace is kept attached to its word so the two sides rejoin into the original text
 * exactly. A diff that silently renormalises spacing would be showing something other than
 * what is being sent, which on this screen is the one thing that must not happen.
 */

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/** Splits into words, each carrying the whitespace that followed it. */
function tokenise(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenise(before);
  const b = tokenise(after);

  // Standard LCS table. These are single descriptions, a few hundred words at most, so the
  // quadratic table is far cheaper than any dependency would be.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i]!.trim() === b[j]!.trim()
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string): void => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]!.trim() === b[j]!.trim()) {
      push("same", a[i]!);
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push("removed", a[i]!);
      i += 1;
    } else {
      push("added", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);

  return parts;
}
