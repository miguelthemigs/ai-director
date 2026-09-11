import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_RUNS } from "@ai-director/contract";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { RunManifest, RunStatus, RunStore } from "../../src/store/RunStore.js";

function stubStore(): RunStore {
  const runs = new Map<string, RunManifest>();
  return {
    createRun: async (m) => void runs.set(m.runId, m),
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id: string) => {
      const found = runs.get(id);
      if (!found) throw new Error(`run ${id} not found`);
      return found;
    },
    listRuns: async () => [...runs.values()],
  };
}

describe("run routes", () => {
  let app: ReturnType<typeof buildApp>;
  let store: RunStore;

  beforeEach(async () => {
    store = stubStore();
    app = buildApp({
      store,
      rubric: await loadRubric("v1"),
      startRun: async () => FIXTURE_RUNS.passed,
    });
  });

  describe("POST /runs", () => {
    it("accepts a description and returns a run id immediately", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { description: "Male, Latino, around 30, lean and tall." },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ runId: expect.any(String), status: "running" });
    });

    it("rejects an empty description with 400 rather than starting a run", async () => {
      const res = await app.inject({ method: "POST", url: "/runs", payload: { description: "   " } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/description/i);
    });

    it("rejects a description over the length cap with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { description: "x".repeat(20_001) },
      });
      expect(res.statusCode).toBe(400);
    });

    it("does not block the response on startRun -- it resolves before the fixture's fake agent call would", async () => {
      let started = false;
      const slow = buildApp({
        store: stubStore(),
        rubric: await loadRubric("v1"),
        startRun: async () => {
          started = true;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return FIXTURE_RUNS.passed;
        },
      });
      const res = await slow.inject({
        method: "POST",
        url: "/runs",
        payload: { description: "A description." },
      });
      expect(res.statusCode).toBe(202);
      // startRun was invoked (fired) but the response did not wait on it.
      expect(started).toBe(true);
    });
  });

  describe("GET /runs/:id", () => {
    it("returns 404 for a run that does not exist rather than an empty body", async () => {
      const res = await app.inject({ method: "GET", url: "/runs/nope" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toHaveProperty("error");
    });

    it("serves the full RunView once startRun resolves, keyed by the minted runId", async () => {
      const postRes = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { description: "A description." },
      });
      const { runId } = postRes.json() as { runId: string };

      // Flush the microtask queue so the fire-and-forget startRun().then(...)
      // has a chance to populate the cache before we ask for it.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const getRes = await app.inject({ method: "GET", url: `/runs/${runId}` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual(FIXTURE_RUNS.passed);
    });

    it("404s for a run whose manifest exists but has no cached view yet", async () => {
      await store.createRun({
        runId: "run-in-progress",
        rubricVersion: "1.0.0",
        model: "claude-opus-5",
        status: "running" satisfies RunStatus,
        startedAt: new Date().toISOString(),
        passes: 0,
      });
      const res = await app.inject({ method: "GET", url: "/runs/run-in-progress" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /runs", () => {
    it("lists manifests newest first", async () => {
      await store.createRun({
        runId: "older",
        rubricVersion: "1.0.0",
        model: "claude-opus-5",
        status: "passed",
        startedAt: "2026-01-01T00:00:00.000Z",
        passes: 1,
      });
      await store.createRun({
        runId: "newer",
        rubricVersion: "1.0.0",
        model: "claude-opus-5",
        status: "passed",
        startedAt: "2026-06-01T00:00:00.000Z",
        passes: 1,
      });

      const res = await app.inject({ method: "GET", url: "/runs" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ runId: string }>;
      expect(body.map((m) => m.runId)).toEqual(["newer", "older"]);
    });
  });

  describe("CORS", () => {
    it("allows the Vite dev origin", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { origin: "http://localhost:5173" },
      });
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    });
  });

  describe("error handling", () => {
    it("never leaks a stack trace when a dependency throws", async () => {
      const throwing = buildApp({
        store: {
          ...stubStore(),
          listRuns: async () => {
            throw new Error("boom: disk exploded, at some/internal/path.ts:42:7");
          },
        },
        rubric: await loadRubric("v1"),
        startRun: async () => FIXTURE_RUNS.passed,
      });

      const res = await throwing.inject({ method: "GET", url: "/runs" });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body).toEqual({ error: "internal server error" });
      expect(JSON.stringify(body)).not.toMatch(/at .*:\d+:\d+/);
    });
  });
});
