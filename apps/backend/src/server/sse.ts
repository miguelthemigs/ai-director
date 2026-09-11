import type { RunEvent } from "@ai-director/contract";

/**
 * One SSE frame for `event`. `JSON.stringify` already escapes any newline
 * inside a field (an error message, say) as `\n` -- it never emits a raw
 * newline -- which is exactly what keeps the `data:` line to one physical
 * line. A raw newline there would split the frame and corrupt the stream, so
 * this deliberately does not hand-roll the serialisation.
 */
export function formatSse(event: RunEvent): string {
  return `id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`;
}
