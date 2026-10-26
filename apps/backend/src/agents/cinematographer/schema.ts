import { CAMERA_MOVES } from "@ai-director/contract";
import { z } from "zod";

// The contract's `Camera`, wrapped in an object because a structured output's root
// must be one. `move` is the closed list itself: "push-in while panning left" cannot
// parse, which is the design's point of making the move one slot with fixed values.
// Whether there is exactly one camera per shot, and whether the light names a
// direction, are the prompt checks (`orchestrate/director/checks.ts`), which route a
// failure back to the Cinematographer instead of failing the run.
export const CinematographerOutputSchema = z.object({
  cameras: z.array(
    z.object({
      shot: z.number().int(),
      framing: z.string(),
      lensMm: z.number(),
      move: z.enum(CAMERA_MOVES),
      light: z.string(),
    }),
  ),
});
