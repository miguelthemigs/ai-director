import { describe, expect, it } from "vitest";
import type { CheckOutcome, DirectorCheckId, CheckOwner } from "@ai-director/contract";
import { route } from "../../../src/orchestrate/director/router.js";

function outcome(id: DirectorCheckId, owner: CheckOwner, passed: boolean, shots: number[] = []): CheckOutcome {
  return { id, owner, passed, detail: passed ? null : "bad", shots };
}
const none = { director: 0, cinematographer: 0 };

describe("route", () => {
  it("passes when every check passes", () => {
    expect(route([outcome("length_fits", "director", true)], none)).toEqual({ kind: "pass" });
    expect(route([], none)).toEqual({ kind: "pass" });
  });

  it("sends a failure to its owner with the union of failing shots, sorted and unique", () => {
    const result = route(
      [
        outcome("no_timestamps", "director", false, [3, 1]),
        outcome("length_fits", "director", false),
        outcome("handles_match", "director", false, [3, 2]),
        outcome("nothing_ruled_out", "director", true),
      ],
      none,
    );
    expect(result).toEqual({
      kind: "redo",
      owner: "director",
      checkIds: ["length_fits", "handles_match", "no_timestamps"],
      shots: [1, 2, 3],
      retry: 1,
    });
  });

  it("takes the director before the cinematographer", () => {
    const result = route(
      [outcome("camera_per_shot", "cinematographer", false, [4]), outcome("length_fits", "director", false)],
      none,
    );
    expect(result).toMatchObject({ kind: "redo", owner: "director" });
  });

  it("sends a cinematographer failure to the cinematographer, counting its own retries", () => {
    const result = route([outcome("camera_per_shot", "cinematographer", false, [4])], {
      director: 2,
      cinematographer: 1,
    });
    expect(result).toEqual({
      kind: "redo",
      owner: "cinematographer",
      checkIds: ["camera_per_shot"],
      shots: [4],
      retry: 2,
    });
  });

  it("stops when the owner has used its retries", () => {
    const result = route([outcome("length_fits", "director", false)], { director: 2, cinematographer: 0 });
    expect(result).toEqual({
      kind: "stop",
      reason: "length_fits still failing after 2 retries (owner: director)",
    });
  });

  it("lists every failing id of the owner in the stop reason", () => {
    const result = route(
      [outcome("handles_match", "director", false), outcome("length_fits", "director", false)],
      { director: 2, cinematographer: 0 },
    );
    expect(result).toEqual({
      kind: "stop",
      reason: "length_fits, handles_match still failing after 2 retries (owner: director)",
    });
  });
});
