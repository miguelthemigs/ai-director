import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = readFileSync(path.join(import.meta.dirname, "../../../../.claude/skills/direct/SKILL.md"), "utf8");

describe("/direct", () => {
  it("needs no start command: the skill itself runs the lead on Opus 5.5 at high effort", () => {
    const frontmatter = SKILL.split("---")[1]!;
    expect(frontmatter).toContain("model: claude-opus-5-5");
    expect(frontmatter).toContain("effort: high");
    expect(SKILL).not.toContain("claude --model");
    expect(SKILL).not.toContain("--teammate-mode");
  });

  it("switches the swarm on in the project settings, so a plain session can run it", () => {
    const settings = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../../../.claude/settings.json"), "utf8"));
    expect(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
  });

  it("gives every swarm teammate the lead's real name instead of guessing it", () => {
    expect(SKILL).toContain("~/.claude/teams/session-");
    expect(SKILL).toContain("The lead's name is");
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
