import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorActorPrompt, type TextTransport } from "../../avatar/authorPrompt.js";
import { generateSheet, type ImageTransport } from "../../avatar/generateSheet.js";
import { actorSheetBrief } from "../../avatar/sheetBrief.js";
import {
  describeImage,
  isSupportedMediaType,
  SUPPORTED_MEDIA_TYPES,
  type VisionTransport,
} from "../../describe/describeImage.js";
import type { AvatarStore } from "../../store/AvatarStore.js";

/**
 * The Mentic pipeline, reproduced end to end so it can be measured.
 *
 *   fields  ->  authorActorPrompt  ->  actorSheetBrief  ->  Nano Banana Pro  ->  SHEET
 *   SHEET   ->  Mentic's describe prompt                                     ->  DESCRIPTION
 *   DESCRIPTION  ->  the nine checks                                          ->  a score
 *
 * Two routes rather than one, and the split is the point. A description can lose a check
 * in three different places: the form never asked for the thing, the authoring step
 * dropped it, or the describe step could not read it back off the rendered sheet. One
 * route returning a score would collapse all three into a single number. Two routes let
 * the sheet and the description be looked at separately, which is what makes the failure
 * locatable.
 *
 * Every route here SPENDS MONEY. `/avatar/sheet` is a paid image. `/avatar/describe` is
 * a paid vision call. Neither is reachable unless the server was built with the
 * corresponding transport, and the server only builds those when the keys are present.
 */
export type AvatarRouteDeps = {
  /** Absent means no key was configured; the route then 503s rather than pretending. */
  text?: TextTransport;
  image?: ImageTransport;
  vision?: VisionTransport;
  /** Where rendered sheets are kept. Absent in tests that only check validation. */
  store?: AvatarStore;
};

/** Roughly 8MB of base64, which is about 6MB of image. Well above a 2K sheet and well
 *  below anything that would sit in memory uncomfortably. */
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024;

const SheetBodySchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "description must not be empty")
    .max(20_000, "description must be at most 20000 characters"),
  /** Mentic's own second argument to `authorActorPrompt`: four candidates are four calls
   *  with four different hints. Optional here, because one sheet is the common case. */
  variationHint: z.string().trim().max(500).optional(),
});

const DescribeBodySchema = z.object({
  /** When present, the describe step's output is written back onto this stored avatar, so
   *  the record holds the image and the paragraph read off it as one unit of evidence. */
  avatarId: z.string().min(1).max(200).optional(),
  imageBase64: z
    .string()
    .min(1, "imageBase64 must not be empty")
    .max(MAX_IMAGE_BASE64, "image is too large"),
  mediaType: z
    .string()
    .refine(isSupportedMediaType, `mediaType must be one of ${SUPPORTED_MEDIA_TYPES.join(", ")}`),
});

export function registerAvatarRoutes(app: FastifyInstance, deps: AvatarRouteDeps): void {
  app.post("/avatar/sheet", async (request, reply) => {
    if (!deps.text || !deps.image) {
      return reply
        .code(503)
        .send({ error: "avatar generation is not configured: ANTHROPIC_API_KEY and GOOGLE_AI_KEY are both required" });
    }

    const parsed = SheetBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }

    const authoredPrompt = await authorActorPrompt(deps.text, {
      description: parsed.data.description,
      ...(parsed.data.variationHint === undefined
        ? {}
        : { variationHint: parsed.data.variationHint }),
    });
    // The authoring step returning nothing is a real outcome, not an edge case: Mentic's
    // own authoring slots return "" on failure, and `withRealismTail` deliberately keeps
    // an empty prompt empty rather than shipping a bare tail that looks like a prompt.
    if (!authoredPrompt) {
      return reply.code(502).send({ error: "the authoring step returned no prompt" });
    }

    const sheetPrompt = actorSheetBrief(authoredPrompt);
    const sheet = await generateSheet(deps.image, { prompt: sheetPrompt });

    // Written to disk BEFORE replying. A paid image that only ever existed in the
    // response body is one a dropped connection or a browser reload destroys, and a
    // vanished sheet looks exactly like a render that never happened.
    const record = await deps.store?.save({
      imageBase64: sheet.imageBase64,
      mediaType: sheet.mediaType,
      source: "generated",
      imageModel: sheet.model,
      authoredPrompt,
      sheetPrompt,
      seedDescription: parsed.data.description,
    });

    return reply.code(200).send({
      id: record?.id ?? null,
      imageBase64: sheet.imageBase64,
      mediaType: sheet.mediaType,
      model: sheet.model,
      authoredPrompt,
      sheetPrompt,
    });
  });

  /** An avatar rendered elsewhere, kept alongside the generated ones so the gallery is the
   *  whole set rather than only the half this server made. */
  app.post("/avatar/upload", async (request, reply) => {
    if (!deps.store) return reply.code(503).send({ error: "no avatar store configured" });

    const parsed = DescribeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    const record = await deps.store.save({
      imageBase64: parsed.data.imageBase64,
      mediaType: parsed.data.mediaType,
      source: "uploaded",
    });
    return reply.code(200).send({ id: record.id, mediaType: record.mediaType });
  });

  /** The gallery. Records only, never the bytes: a list of twenty sheets as base64 would be
   *  tens of megabytes of JSON for a strip of thumbnails. */
  app.get("/avatar", async (_request, reply) => {
    if (!deps.store) return reply.code(200).send({ avatars: [] });
    return reply.code(200).send({ avatars: await deps.store.list() });
  });

  app.get("/avatar/:id/image", async (request, reply) => {
    if (!deps.store) return reply.code(404).send({ error: "not found" });
    const { id } = request.params as { id: string };
    const image = await deps.store.readImage(id);
    if (!image) return reply.code(404).send({ error: "not found" });
    return reply
      .code(200)
      .header("Content-Type", image.mediaType)
      // Immutable: an avatar's bytes never change once written, only its record does.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(image.bytes);
  });

  app.post("/avatar/describe", async (request, reply) => {
    if (!deps.vision) {
      return reply
        .code(503)
        .send({ error: "describe is not configured: ANTHROPIC_API_KEY is required" });
    }

    const parsed = DescribeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    // Narrowed by the schema's own refine; the cast keeps that guarantee at the type level.
    const mediaType = parsed.data.mediaType as (typeof SUPPORTED_MEDIA_TYPES)[number];

    const result = await describeImage(deps.vision, {
      imageBase64: parsed.data.imageBase64,
      mediaType,
    });

    // Best effort. The description has been paid for and is in hand; failing the response
    // because the record could not be updated would throw away the thing the caller asked
    // for in order to report a bookkeeping problem.
    if (deps.store && parsed.data.avatarId) {
      try {
        await deps.store.attachDescription(parsed.data.avatarId, {
          description: result.description,
          descriptionRaw: result.raw,
          descriptionTrimmed: result.trimmed,
          describeModel: result.model,
        });
      } catch (err) {
        request.log.error({ err }, "could not attach description to avatar record");
      }
    }

    return reply.code(200).send(result);
  });
}
