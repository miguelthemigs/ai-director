import type {
  ComparisonSummary,
  ComparisonView,
  VideoSize,
} from "@ai-director/contract";
import type { ComparisonPreview } from "../components/PromptPreview.js";

/**
 * The five `/compare` endpoints.
 *
 * Deliberately NOT on `RunClient`, for the reason `avatarApi.ts` states in its own header:
 * that interface has a fixture implementation so every screen can be built with no backend
 * at all, and a fake comparison would mean inventing two plausible-looking video clips. A
 * plausible-looking fake artefact is exactly what this product refuses to produce. So these
 * are plain functions, the Compare screen calls them directly, and in fixture mode it says
 * it needs the real backend instead of pretending.
 *
 * `startComparison` SPENDS MONEY. Nothing calls it unless a person presses the button that
 * does, with the estimate on screen beside it.
 */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const message =
      parsed !== null && typeof parsed === "object" && parsed !== undefined && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `request to ${url} failed with status ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export type StartComparisonArgs = {
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
};

export function startComparison(args: StartComparisonArgs): Promise<ComparisonView> {
  return request<ComparisonView>("/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

/**
 * What WOULD be sent, without sending it. Free: no row, no claim, no vendor call.
 *
 * The prompts come back built by the same function the submit path uses, so this is the
 * request rather than a rendering of it.
 */
export function previewComparison(
  avatarId: string,
  runId: string,
): Promise<ComparisonPreview> {
  const query = new URLSearchParams({ avatarId, runId });
  return request<ComparisonPreview>(`/compare/preview?${query.toString()}`);
}

export function getComparison(comparisonId: string): Promise<ComparisonView> {
  return request<ComparisonView>(`/compare/${comparisonId}`);
}

export function listComparisons(): Promise<ComparisonSummary[]> {
  return request<ComparisonSummary[]>("/compare");
}

/** One status read per unfinished side, for a pair this browser lost track of. */
export function refreshComparison(comparisonId: string): Promise<ComparisonView> {
  return request<ComparisonView>(`/compare/${comparisonId}/refresh`, { method: "POST" });
}

/**
 * Micro-USD as dollars, or the words "not measured".
 *
 * Null and zero are different facts and are rendered differently. Null is "OpenRouter
 * reported no cost on this task"; `$0.00` would be a measurement of free, which is the
 * exact fabrication `StepCost`'s all-optional shape exists to prevent elsewhere in this app.
 */
export function formatMicroUsd(microUsd: number | null): string {
  if (microUsd === null) return "not measured";
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}
