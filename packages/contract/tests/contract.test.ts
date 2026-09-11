import { describe, expect, it } from "vitest";
import {
  CHECK_IDS,
  CHECKS_BY_GROUP,
  CHECK_GROUPS,
  EVENT_NAMES,
  TERMINAL_STATUSES,
  PIPELINE_NODES,
  PIPELINE_EDGES,
  eventId,
  isTerminal,
  isSuccess,
  type VersionRow,
} from "../src/index.js";

describe("check identity", () => {
  it("names exactly nine checks", () => {
    expect(CHECK_IDS).toHaveLength(9);
    expect(new Set(CHECK_IDS).size).toBe(9);
  });

  it("splits them 5 / 2 / 2 across the three groups in spec order", () => {
    expect(CHECK_GROUPS).toEqual(["look", "safety", "drawable"]);
    expect(CHECKS_BY_GROUP.look).toEqual([
      "age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker",
    ]);
    expect(CHECKS_BY_GROUP.safety).toEqual(["no_real_person", "no_brand_name"]);
    expect(CHECKS_BY_GROUP.drawable).toEqual(["drawable_only", "no_cross_slot"]);
  });

  it("puts every check in exactly one group", () => {
    const flattened = CHECK_GROUPS.flatMap((g) => CHECKS_BY_GROUP[g]);
    expect(flattened.slice().sort()).toEqual(CHECK_IDS.slice().sort());
  });
});

describe("events", () => {
  it("names the nine spec events", () => {
    expect(EVENT_NAMES).toEqual([
      "run.started",
      "pass.started",
      "evaluator.group.started",
      "evaluator.group.completed",
      "repairer.started",
      "repairer.completed",
      "pass.completed",
      "run.completed",
      "run.failed",
    ]);
  });

  it("builds a resumable id of the form <pass>-<step>", () => {
    expect(eventId(1, 0)).toBe("1-0");
    expect(eventId(3, 7)).toBe("3-7");
  });
});

describe("terminal status", () => {
  it("names the three terminal states", () => {
    expect(TERMINAL_STATUSES).toEqual(["passed", "improved_still_failing", "no_improvement"]);
  });

  it("treats running as not terminal", () => {
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("passed")).toBe(true);
    expect(isTerminal("no_improvement")).toBe(true);
  });

  it("counts only passed as success, which is what stops the UI celebrating a failure", () => {
    expect(isSuccess("passed")).toBe(true);
    expect(isSuccess("improved_still_failing")).toBe(false);
    expect(isSuccess("no_improvement")).toBe(false);
    expect(isSuccess("failed")).toBe(false);
    expect(isSuccess("running")).toBe(false);
  });
});

describe("pipeline", () => {
  it("marks exactly the three unbuilt agents as planned", () => {
    const planned = PIPELINE_NODES.filter((n) => n.state === "planned");
    expect(planned.map((n) => n.id).sort()).toEqual(["director", "identity", "interrogator"]);
  });

  it("has every edge name a real node id", () => {
    const ids = new Set(PIPELINE_NODES.map((n) => n.id));
    for (const edge of PIPELINE_EDGES) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });
});

describe("versions", () => {
  it("allows kappa and profile to be null", () => {
    const row: VersionRow = {
      id: "v1",
      kind: "rubric",
      version: "1.0.0",
      sealedAt: new Date(0).toISOString(),
      why: "initial seal",
      meanPercent: null,
      deltaPercent: null,
      profile: null,
      kappa: null,
      perCheckKappa: null,
      goldSetSize: null,
    };
    expect(row.kappa).toBeNull();
    expect(row.profile).toBeNull();
  });
});
