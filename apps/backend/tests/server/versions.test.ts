import { beforeEach, describe, expect, it } from "vitest";
import type { VersionCompare, VersionRow } from "@ai-director/contract";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { RunStore } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";

const rubricV1: VersionRow = {
  id: "rubric-v1",
  kind: "rubric",
  version: "v1",
  sealedAt: "2026-09-10T00:00:00.000Z",
  why: "First rubric.",
  meanPercent: null,
  deltaPercent: null,
  profile: null,
  kappa: null,
  perCheckKappa: null,
  goldSetSize: null,
};

const rubricV2: VersionRow = { ...rubricV1, id: "rubric-v2", version: "v2", sealedAt: "2026-09-11T00:00:00.000Z" };

function stubRunStore(): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id) => {
      throw new Error(`run ${id} not found`);
    },
    listRuns: async () => [],
  };
}

function stubVersionStore(rows: VersionRow[]): VersionStore {
  return {
    list: async () => rows,
    get: async (id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`version "${id}" not found`);
      return row;
    },
    compare: async (a, b) => {
      const rowA = rows.find((r) => r.id === a);
      const rowB = rows.find((r) => r.id === b);
      if (!rowA) throw new Error(`version "${a}" not found`);
      if (!rowB) throw new Error(`version "${b}" not found`);
      const compare: VersionCompare = { a: rowA, b: rowB, promptDiff: [], perCheck: [] };
      return compare;
    },
  };
}

describe("version routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp({
      store: stubRunStore(),
      rubric: await loadRubric("v1"),
      startRun: async () => {
        throw new Error("not used in this suite");
      },
      versionStore: stubVersionStore([rubricV1, rubricV2]),
    });
  });

  describe("GET /versions", () => {
    it("returns the rows from the store", async () => {
      const res = await app.inject({ method: "GET", url: "/versions" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([rubricV1, rubricV2]);
    });
  });

  describe("GET /versions/compare", () => {
    it("returns 400 when the 'a' query parameter is missing", async () => {
      const res = await app.inject({ method: "GET", url: "/versions/compare?b=rubric-v2" });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
    });

    it("returns 400 when the 'b' query parameter is missing", async () => {
      const res = await app.inject({ method: "GET", url: "/versions/compare?a=rubric-v1" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when both query parameters are missing", async () => {
      const res = await app.inject({ method: "GET", url: "/versions/compare" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when 'a' is unknown", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/versions/compare?a=does-not-exist&b=rubric-v2",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when 'b' is unknown", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/versions/compare?a=rubric-v1&b=does-not-exist",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns the compare payload when both ids are known", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/versions/compare?a=rubric-v1&b=rubric-v2",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ a: rubricV1, b: rubricV2, promptDiff: [], perCheck: [] });
    });
  });
});
