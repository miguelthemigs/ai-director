import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CINEMATOGRAPHER_PROMPTS_V2 } from "../../src/agents/cinematographer/prompt-v2.js";
import { buildDirectorSystemPromptV2 } from "../../src/agents/director/prompt-v2.js";
import { buildInterrogatorAskSystemPrompt, buildInterrogatorFillSystemPrompt } from "../../src/agents/interrogator/prompt-v2.js";
import { renderAgentFiles } from "../../src/lab/agentFiles.js";

const files = renderAgentFiles();
const REPO = path.join(import.meta.dirname, "../../../..");

describe("the generated agent files", () => {
  it.each(Object.entries(files))("%s runs on Sonnet 5.5 at high effort with Bash, Read and SendMessage only", (name, text) => {
    const front = text.split("---")[1]!;
    expect(front).toContain(`name: ${name}`);
    expect(front).toContain("model: claude-sonnet-5-5");
    expect(front).toContain("effort: high");
    expect(front).toContain("tools: Bash, Read, SendMessage");
  });

  it("carry the v2 prompts byte-identical", () => {
    expect(files["lab-interrogator"]).toContain(buildInterrogatorAskSystemPrompt());
    expect(files["lab-interrogator"]).toContain(buildInterrogatorFillSystemPrompt());
    expect(files["lab-director"]).toContain(buildDirectorSystemPromptV2());
    expect(files["lab-cinematographer"]).toContain(CINEMATOGRAPHER_PROMPTS_V2.system);
  });

  it("tell every agent to save through the lab and never generate media", () => {
    for (const text of Object.values(files)) {
      expect(text).toContain("npm run -s lab -- save");
      expect(text).toContain("Never generate, render or request an image or a video");
    }
  });

  it("tell swarm teammates to message the lead by the name in their spawn prompt", () => {
    for (const text of Object.values(files)) {
      expect(text).toContain("The lead's name is in your spawn prompt");
    }
  });

  it.each(Object.keys(files))("%s on disk matches what the prompts generate (run npm run -s lab -- export-agents)", (name) => {
    const onDisk = readFileSync(path.join(REPO, ".claude", "agents", `${name}.md`), "utf8");
    expect(onDisk).toBe(files[name as keyof typeof files]);
  });
});
