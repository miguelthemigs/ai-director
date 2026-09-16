import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatMicroUsd,
  getComparison,
  listComparisons,
  refreshComparison,
  startComparison,
} from "../../src/data/compareApi.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("formatMicroUsd", () => {
  it("shows dollars to the cent", () => {
    expect(formatMicroUsd(411_201)).toBe("$0.41");
    expect(formatMicroUsd(822_402)).toBe("$0.82");
    expect(formatMicroUsd(1_848_960)).toBe("$1.85");
  });

  it("says not measured for null, and never renders it as zero", () => {
    expect(formatMicroUsd(null)).toBe("not measured");
    expect(formatMicroUsd(null)).not.toContain("0.00");
  });

  it("shows a real zero as a zero", () => {
    expect(formatMicroUsd(0)).toBe("$0.00");
  });
});

describe("startComparison", () => {
  it("posts the four controls and returns the row", async () => {
    fetchMock.mockResolvedValue(ok({ comparisonId: "cmp-1" }));

    const row = await startComparison({
      avatarId: "a",
      runId: "r",
      seconds: 4,
      size: "480x854",
    });

    expect(row.comparisonId).toBe("cmp-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/compare");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      avatarId: "a",
      runId: "r",
      seconds: 4,
      size: "480x854",
    });
  });

  it("throws with the server's own reason on a refusal", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "run repaired nothing" }), { status: 400 }),
    );
    await expect(
      startComparison({ avatarId: "a", runId: "r", seconds: 4, size: "480x854" }),
    ).rejects.toThrow("run repaired nothing");
  });
});

describe("the read endpoints", () => {
  it("fetches one row, the history, and a refresh", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await listComparisons();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/compare");

    fetchMock.mockResolvedValue(ok({ comparisonId: "cmp-1" }));
    await getComparison("cmp-1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/compare/cmp-1");

    fetchMock.mockResolvedValue(ok({ comparisonId: "cmp-1" }));
    await refreshComparison("cmp-1");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/compare/cmp-1/refresh");
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("POST");
  });
});
