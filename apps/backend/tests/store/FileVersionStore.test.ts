import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileVersionStore } from "../../src/store/FileVersionStore.js";

const rubricV1 = {
  id: "rubric-v1",
  kind: "rubric" as const,
  version: "v1",
  sealedAt: "2026-09-10T00:00:00.000Z",
  why: "First rubric. Nine checks, five bands each, sourced to Higgsfield's published character pattern and to my own measured Runway refusals.",
  meanPercent: null,
  deltaPercent: null,
  profile: null,
  kappa: null,
  perCheckKappa: null,
  goldSetSize: null,
};

const rubricV2 = {
  id: "rubric-v2",
  kind: "rubric" as const,
  version: "v2",
  sealedAt: "2026-09-11T00:00:00.000Z",
  why: "Tightened wardrobe band 3 wording after three gold-set disagreements.",
  meanPercent: 72,
  deltaPercent: 6,
  profile: {
    age_build: 80,
    face_skin: 80,
    hair_spec: 60,
    wardrobe: 60,
    anchor_marker: 100,
    no_real_person: 100,
    no_brand_name: 100,
    drawable_only: 80,
    no_cross_slot: 60,
  },
  kappa: 0.71,
  perCheckKappa: {
    age_build: 0.8,
    face_skin: 0.75,
    hair_spec: 0.6,
    wardrobe: 0.65,
    anchor_marker: 0.9,
    no_real_person: 0.95,
    no_brand_name: 0.95,
    drawable_only: 0.7,
    no_cross_slot: 0.55,
  },
  goldSetSize: 40,
};

const roots: string[] = [];

async function newRoot(rows: unknown[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "versions-"));
  roots.push(root);
  await writeFile(path.join(root, "notes.json"), JSON.stringify({ versions: rows }), "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileVersionStore", () => {
  describe("list", () => {
    it("returns rows newest first", async () => {
      const root = await newRoot([rubricV1, rubricV2]);
      const store = new FileVersionStore(root);
      const rows = await store.list();
      expect(rows.map((r) => r.id)).toEqual(["rubric-v2", "rubric-v1"]);
    });

    it("rejects when a row has no why note", async () => {
      const root = await newRoot([{ ...rubricV1, why: "" }]);
      const store = new FileVersionStore(root);
      await expect(store.list()).rejects.toThrow(/why/);
    });

    it("rejects a whole file with one malformed row rather than skipping it", async () => {
      const root = await newRoot([rubricV1, { ...rubricV2, kind: "not_a_real_kind" }]);
      const store = new FileVersionStore(root);
      await expect(store.list()).rejects.toThrow();
    });

    it("rejects when notes.json is not valid JSON", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "versions-"));
      roots.push(root);
      await writeFile(path.join(root, "notes.json"), "{not json", "utf8");
      const store = new FileVersionStore(root);
      await expect(store.list()).rejects.toThrow();
    });
  });

  describe("get", () => {
    it("returns the row for a known id", async () => {
      const root = await newRoot([rubricV1]);
      const store = new FileVersionStore(root);
      const row = await store.get("rubric-v1");
      expect(row.id).toBe("rubric-v1");
    });

    it("rejects an unknown id with a 'not found' message", async () => {
      const root = await newRoot([rubricV1]);
      const store = new FileVersionStore(root);
      await expect(store.get("rubric-v9")).rejects.toThrow(/version .* not found/);
    });
  });

  describe("compare", () => {
    it("computes a per-check kappa delta only when both sides are measured", async () => {
      const root = await newRoot([rubricV1, rubricV2]);
      const store = new FileVersionStore(root);
      const cmp = await store.compare("rubric-v1", "rubric-v2");

      // rubric-v1 has no perCheckKappa at all -- every delta must be null,
      // never zero, even though rubric-v2 has real numbers.
      for (const check of cmp.perCheck) {
        expect(check.deltaPercent).toBeNull();
      }
    });

    it("computes a real delta when both versions have a measured kappa for a check", async () => {
      const v1WithKappa = {
        ...rubricV1,
        kappa: 0.5,
        perCheckKappa: { ...rubricV2.perCheckKappa, age_build: 0.6 },
      };
      const root = await newRoot([v1WithKappa, rubricV2]);
      const store = new FileVersionStore(root);
      const cmp = await store.compare("rubric-v1", "rubric-v2");
      const ageBuild = cmp.perCheck.find((c) => c.checkId === "age_build");
      // v2's age_build kappa (0.8) minus v1's (0.6), expressed in points.
      expect(ageBuild?.deltaPercent).toBeCloseTo((0.8 - 0.6) * 100);
    });

    it("never coerces an unmeasured band to a real one", async () => {
      const root = await newRoot([rubricV1, rubricV2]);
      const store = new FileVersionStore(root);
      const cmp = await store.compare("rubric-v1", "rubric-v2");
      const ageBuild = cmp.perCheck.find((c) => c.checkId === "age_build");
      expect(ageBuild?.bandA).toBeNull();
      expect(ageBuild?.bandB).toBe(4);
    });

    it("rejects when either side is unknown", async () => {
      const root = await newRoot([rubricV1]);
      const store = new FileVersionStore(root);
      await expect(store.compare("rubric-v1", "rubric-v9")).rejects.toThrow(/not found/);
    });
  });
});
