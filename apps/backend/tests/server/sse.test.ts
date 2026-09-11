import { describe, expect, it } from "vitest";
import { formatSse } from "../../src/server/sse.js";

describe("formatSse", () => {
  it("writes id, event and data lines ending in a blank line", () => {
    const out = formatSse({
      id: "1-0", name: "pass.started", at: "2026-09-11T10:00:00.000Z", pass: 1, description: "x",
    } as never);
    expect(out).toBe(
      'id: 1-0\nevent: pass.started\ndata: {"id":"1-0","name":"pass.started","at":"2026-09-11T10:00:00.000Z","pass":1,"description":"x"}\n\n',
    );
  });

  it("never emits a raw newline inside the data line, which would split the frame", () => {
    const out = formatSse({
      id: "1-1", name: "run.failed", at: "2026-09-11T10:00:00.000Z", error: "line one\nline two",
    } as never);
    const dataLines = out.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines).toHaveLength(1);
    expect(out).toContain("line one\\nline two");
  });
});
