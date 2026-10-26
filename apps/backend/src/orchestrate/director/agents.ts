import { randomUUID } from "node:crypto";
import {
  plannedSeconds,
  type AssetKind,
  type Camera,
  type CharacterOutcome,
  type CheckOutcome,
  type FilledBrief,
  type Plan,
  type PlanAsset,
  type ReferenceImage,
} from "@ai-director/contract";
import { reshoot, shootAll } from "../../agents/cinematographer/run.js";
import { CINEMATOGRAPHER_PROMPT_VERSION } from "../../agents/cinematographer/prompt-v1.js";
import { direct, patchPlan, PlanPatchError } from "../../agents/director/run.js";
import { DIRECTOR_PROMPT_VERSION } from "../../agents/director/prompt-v1.js";
import { interrogate } from "../../agents/interrogator/run.js";
import { INTERROGATOR_PROMPT_VERSION } from "../../agents/interrogator/prompt-v1.js";
import type { ParseTransport } from "../../api/client.js";
import type { ImageTransport } from "../../avatar/generateSheet.js";
import { makeCharacter, type MakeCharacterDeps } from "../../avatar/makeCharacter.js";
import type { SupportedMediaType } from "../../describe/describeImage.js";
import { makeLocationPicture, makeProductPicture } from "../../images/makeReference.js";
import type { ReferenceHost } from "../../images/referenceHost.js";
import type { DirectorRunStore } from "../../store/DirectorRunStore.js";
import { coachDescription, type CoachDeps } from "../coach.js";
import { assembleSeedancePrompt } from "./assemble.js";
import { runPlanChecks, runPromptChecks } from "./checks.js";
import { meter } from "./metered.js";
import type { DirectorAgents, NodeResult } from "./recipe.js";

export type DirectorAgentDeps = {
  transport: ParseTransport;
  images: ImageTransport;
  host: ReferenceHost;
  store: DirectorRunStore;
  coach: CoachDeps;
  character: MakeCharacterDeps;
};

/** Gate A saves the product photo as `photo.<ext>`; the product node reads its type back from it. */
export const PHOTO_EXTENSION: Record<SupportedMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function photoMediaType(ref: string): SupportedMediaType {
  const ext = ref.slice(ref.lastIndexOf(".") + 1).toLowerCase();
  const found = (Object.keys(PHOTO_EXTENSION) as SupportedMediaType[]).find(
    (type) => PHOTO_EXTENSION[type] === ext || (type === "image/jpeg" && ext === "jpeg"),
  );
  if (!found) throw new Error(`the product photo ${ref} is not a png, jpg, gif or webp`);
  return found;
}

const assetOf = (plan: Plan, kind: AssetKind): PlanAsset | undefined =>
  plan.assets.find((asset) => asset.kind === kind);

function checksSummary(outcomes: CheckOutcome[]): string {
  const passed = outcomes.filter((outcome) => outcome.passed).length;
  return `${passed} of ${outcomes.length} checks passed`;
}

const listed = (shots: number[]): string => `${shots.length === 1 ? "shot" : "shots"} ${shots.join(", ")}`;

/**
 * The real body of every recipe node but `render`. Each model call goes through `meter`, so
 * the node's `calls` say which model served it, its tokens and its cost. The image, text and
 * vision transports are not `ParseTransport`s and are not metered here.
 */
export function buildDirectorAgents(deps: DirectorAgentDeps): DirectorAgents {
  const pictures = { images: deps.images, host: deps.host, store: deps.store };

  return {
    async interrogator(ctx): Promise<NodeResult> {
      const metered = meter(deps.transport, INTERROGATOR_PROMPT_VERSION);
      const brief = await interrogate({ transport: metered.transport }, { brief: ctx.view.brief });
      return { output: brief, summary: `brief filled for ${brief.productKind}`, calls: metered.calls() };
    },

    async director(ctx): Promise<NodeResult> {
      const metered = meter(deps.transport, DIRECTOR_PROMPT_VERSION);
      const brief = await ctx.read<FilledBrief>("interrogator");
      const answers = await ctx.answers();
      if (ctx.patch === null) {
        const plan = await direct({ transport: metered.transport }, { brief, answers });
        return {
          output: plan,
          summary: `${plan.shots.length} shots, ${plannedSeconds(plan)} s planned`,
          calls: metered.calls(),
        };
      }
      const previous = await ctx.read<Plan>("director");
      try {
        const plan = await patchPlan(
          { transport: metered.transport },
          { plan: previous, failures: ctx.patch.failures, brief, answers },
        );
        return {
          output: plan,
          summary: `patched for ${ctx.patch.checkIds.join(", ")}`,
          calls: metered.calls(),
        };
      } catch (error) {
        if (!(error instanceof PlanPatchError)) throw error;
        // The previous plan goes back to the checks unchanged, so they fail again and the
        // router counts the retry: a refused patch ends the run `stopped`, never `failed`.
        return {
          output: previous,
          summary: `patch refused (${error.message}); the previous plan is kept`,
          calls: metered.calls(),
        };
      }
    },

    async planChecks(ctx): Promise<NodeResult> {
      const plan = await ctx.read<Plan>("director");
      const answers = await ctx.answers();
      const outcomes = runPlanChecks(plan, answers.seconds, answers.mustNotAppear);
      return { output: outcomes, summary: checksSummary(outcomes), calls: [] };
    },

    async product(ctx): Promise<NodeResult> {
      const plan = await ctx.read<Plan>("director");
      const asset = assetOf(plan, "product");
      if (!asset) return { output: null, summary: "no product in the plan", calls: [] };
      const answers = await ctx.answers();
      const bytes = await deps.store.readAsset(ctx.runId, answers.productPhotoAsset);
      const picture = await makeProductPicture(pictures, {
        runId: ctx.runId,
        photo: { imageBase64: bytes.toString("base64"), mediaType: photoMediaType(answers.productPhotoAsset) },
        productKind: answers.productKind,
        handle: asset.handle,
      });
      return { output: picture, summary: `product picture for ${asset.handle}`, calls: [] };
    },

    async location(ctx): Promise<NodeResult> {
      const plan = await ctx.read<Plan>("director");
      const asset = assetOf(plan, "location");
      if (!asset) return { output: null, summary: "no location in the plan", calls: [] };
      const picture = await makeLocationPicture(pictures, {
        runId: ctx.runId,
        description: asset.description,
        styleLine: plan.styleLine,
        handle: asset.handle,
      });
      return { output: picture, summary: `location picture for ${asset.handle}`, calls: [] };
    },

    async character(ctx): Promise<NodeResult> {
      const answers = await ctx.answers();
      let avatarId: string;
      let made = "";
      if (answers.cast.kind === "avatar") {
        avatarId = answers.cast.avatarId;
      } else {
        const plan = await ctx.read<Plan>("director");
        const asset = assetOf(plan, "character");
        if (!asset) throw new Error("the plan has no character to cast");
        avatarId = (await makeCharacter(deps.character, { description: asset.description })).id;
        made = "new ";
      }
      const metered = meter(
        deps.coach.transport,
        `rubric-${deps.coach.rubric.version}/repairer-v2`,
      );
      const outcome: CharacterOutcome = await coachDescription(
        { ...deps.coach, transport: metered.transport },
        { avatarId, runId: randomUUID() },
      );
      return {
        output: outcome,
        summary: `${made}avatar ${avatarId}: coach ended ${outcome.status}`,
        calls: metered.calls(),
      };
    },

    async cinematographer(ctx): Promise<NodeResult> {
      const metered = meter(deps.transport, CINEMATOGRAPHER_PROMPT_VERSION);
      const plan = await ctx.read<Plan>("director");
      if (ctx.patch === null) {
        const answers = await ctx.answers();
        const cameras = await shootAll({ transport: metered.transport }, { plan, seconds: answers.seconds });
        return { output: cameras, summary: `${cameras.length} cameras`, calls: metered.calls() };
      }
      const previous = await ctx.read<Camera[]>("cinematographer");
      const cameras = await reshoot(
        { transport: metered.transport },
        { plan, cameras: previous, shots: ctx.patch.shots, failures: ctx.patch.failures },
      );
      return { output: cameras, summary: `reshot ${listed(ctx.patch.shots)}`, calls: metered.calls() };
    },

    async assembler(ctx): Promise<NodeResult> {
      const [plan, cameras, character, product, location] = await Promise.all([
        ctx.read<Plan>("director"),
        ctx.read<Camera[]>("cinematographer"),
        ctx.read<CharacterOutcome>("character"),
        ctx.read<ReferenceImage | null>("product"),
        ctx.read<ReferenceImage | null>("location"),
      ]);
      const references = [product, location].filter((ref): ref is ReferenceImage => ref !== null);
      const prompt = assembleSeedancePrompt({ plan, cameras, character, references });
      return {
        output: prompt,
        summary: `${prompt.text.length} characters, ${references.length} reference images`,
        calls: [],
      };
    },

    async promptChecks(ctx): Promise<NodeResult> {
      const plan = await ctx.read<Plan>("director");
      const cameras = await ctx.read<Camera[]>("cinematographer");
      const outcomes = runPromptChecks(plan, cameras);
      return { output: outcomes, summary: checksSummary(outcomes), calls: [] };
    },
  };
}
