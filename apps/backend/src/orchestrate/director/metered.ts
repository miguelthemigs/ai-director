import type { CallLog } from "@ai-director/contract";
import type { ParseTransport } from "../../api/client.js";
import { tokenMicroUsd } from "../../api/pricing.js";

/**
 * Wraps a transport so every call is logged with the model that actually served it,
 * its tokens, its cost and its latency. A call whose transport reports no model is
 * logged as "unknown" (the transport args carry no requested model).
 */
export function meter(
  transport: ParseTransport,
  promptVersion: string,
  now: () => number = Date.now,
): { transport: ParseTransport; calls: () => CallLog[] } {
  const log: CallLog[] = [];
  const wrapped: ParseTransport = async (args) => {
    const start = now();
    let result: Awaited<ReturnType<ParseTransport>>;
    try {
      result = await transport(args);
    } catch (error) {
      // A failed call may still have spent tokens; keep it in the log, with nothing invented.
      log.push({
        model: "unknown",
        promptVersion,
        inputTokens: null,
        outputTokens: null,
        microUsd: null,
        latencyMs: now() - start,
      });
      throw error;
    }
    const latencyMs = now() - start;
    const model = result.model ?? "unknown";
    const usage = result.usage;
    log.push({
      model,
      promptVersion,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      microUsd: usage ? tokenMicroUsd(model, usage) : null,
      latencyMs,
    });
    return result;
  };
  return { transport: wrapped, calls: () => [...log] };
}
