import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = readFileSync(path.join(import.meta.dirname, "../../../../.claude/skills/direct/SKILL.md"), "utf8");

describe("/direct", () => {
  it("starts the Opus 5.5 leads at high effort", () => {
    expect(SKILL).toContain("claude --model claude-opus-5-5 --effort high");
    expect(SKILL).toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --model claude-opus-5-5 --effort high --teammate-mode tmux");
    expect(SKILL).toContain("/effort status");
    expect(SKILL.split("---")[1]).toContain("effort: high");
  });

  it("names the three agent types and the way to give up", () => {
    for (const name of ["lab-interrogator", "lab-director", "lab-cinematographer", "lab -- stop", "lab -- sequential finish"]) {
      expect(SKILL).toContain(name);
    }
  });

  it("never renders and never sets the effort variable", () => {
    expect(SKILL).not.toContain("gates/C");
    expect(SKILL).not.toMatch(/render\/again/);
    expect(SKILL).not.toMatch(/(export|set) CLAUDE_CODE_EFFORT_LEVEL/);
    expect(SKILL).toContain("Never call a generation API");
  });

  it("never calls a stopped or failed run a success", () => {
    expect(SKILL).toContain("never call it a success");
  });
});
