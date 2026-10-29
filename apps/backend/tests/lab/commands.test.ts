import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { labAvatars, labLog, labNew, labShow } from "../../src/lab/commands.js";
import { readJson, readTrace } from "../../src/lab/runStore.js";
import { AVATAR_DESCRIPTION, AVATAR_ID, cleanLabEnvs, newLabEnv } from "./labEnv.js";

afterEach(cleanLabEnvs);

const PAGE = readFileSync(path.join(import.meta.dirname, "fixtures", "product-page.html"), "utf8");

describe("labNew", () => {
  it("scrapes the website when one is given", async () => {
    const env = await newLabEnv();
    const fetchImpl = vi.fn(async () => new Response(PAGE, { status: 200 })) as unknown as typeof fetch;
    const { runId, scrape } = await labNew({ ...env, fetchImpl }, { arch: "sequential", brief: "an ad", url: "https://example.com" });

    expect(scrape?.ok).toBe(true);
    expect(await readJson(env.root, runId, "scrape.json")).toEqual(scrape);
    expect((await readTrace(env.root, runId)).map((line) => line.kind)).toEqual(["new", "scrape"]);
  });

  it("fetches nothing when there is no website", async () => {
    const env = await newLabEnv();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { scrape } = await labNew({ ...env, fetchImpl }, { arch: "swarm", brief: "an ad for Apple", url: null });
    expect(scrape).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("labAvatars", () => {
  it("lists described avatars", async () => {
    const env = await newLabEnv();
    expect(await labAvatars(env)).toEqual([{ avatarId: AVATAR_ID, description: AVATAR_DESCRIPTION }]);
  });
});

describe("labShow", () => {
  it("shows the run with no plan yet", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "coordinator", brief: "an ad", url: null });
    const shown = (await labShow(env, runId)) as { run: { id: string }; latestPlan: unknown };
    expect(shown.run.id).toBe(runId);
    expect(shown.latestPlan).toBeNull();
  });
});

describe("labLog", () => {
  it("records a message between agents", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "swarm", brief: "an ad", url: null });
    await labLog(env, runId, { from: "director", to: "cinematographer", text: "plan 1 passed, your turn" });
    const last = (await readTrace(env.root, runId)).at(-1)!;
    expect(last).toMatchObject({ kind: "message", actor: "director", to: "cinematographer", text: "plan 1 passed, your turn" });
  });
});
