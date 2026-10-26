/** Fixed strings of the Assembler, version v1. Append-only: a change ships as v2.ts. */
export const ASSEMBLE_PROMPT_VERSION = "v1";
export const ORDINALS = ["first", "second", "third", "fourth", "fifth"] as const;
export const CLOSING_LINE = "Keep it subtitle-free, do not generate a logo or watermark.";
/** Parts are joined by a blank line; reference sentences and shot lines by a single newline. */
export const PART_SEPARATOR = "\n\n";
export const LINE_SEPARATOR = "\n";

export const productSentence = (ordinal: string, handle: string): string =>
  `The ${ordinal} reference image is the product (${handle}).`;
export const locationSentence = (ordinal: string, description: string, handle: string): string =>
  `The ${ordinal} reference image is the ${description} (${handle}).`;
export const heroLine = (handle: string, description: string): string =>
  `HERO (${handle}): ${description}`;
export const sceneLine = (scene: string): string => `Scene: ${scene}`;
export const shotLine = (
  n: number,
  c: { framing: string; lensMm: number; move: string; light: string },
  action: string,
  sound: string,
): string => `Shot ${n}: ${c.framing}, ${c.lensMm}mm, ${c.move}, ${c.light}. ${action} ${sound}`;
