/**
 * Fixed strings of the text-only Assembler (the architecture lab), version v2.
 * Append-only: a change ships as v3.ts. v1 is untouched and still serves the Director app.
 *
 * v1 names the product and the location as reference images. The lab sends no image, so
 * v2 names them in words instead; every other string is v1's, re-exported unchanged.
 */
export {
  CLOSING_LINE,
  LINE_SEPARATOR,
  PART_SEPARATOR,
  heroLine,
  sceneLine,
  shotLine,
} from "./v1.js";

export const ASSEMBLE_PROMPT_VERSION_V2 = "v2";

/** Text that ends a sentence the template closes with "." loses its own one trailing "." first (as in v1). */
const withoutFinalPeriod = (text: string): string => text.trimEnd().replace(/\.$/, "");

export const productLine = (handle: string, description: string): string =>
  `Product (${handle}): ${withoutFinalPeriod(description)}.`;
export const locationLine = (handle: string, description: string): string =>
  `Location (${handle}): ${withoutFinalPeriod(description)}.`;
