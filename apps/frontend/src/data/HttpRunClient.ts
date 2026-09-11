import {
  EVENT_NAMES,
  type RunEvent,
  type RunSummary,
  type RunView,
  type VersionCompare,
  type VersionRow,
} from "@ai-director/contract";
import type { RunClient } from "./RunClient.js";

/** Best-effort read of a response body as JSON. A body that isn't JSON (or is empty, as a
 *  keepalive-only 204 might be) is not itself an error worth throwing over -- the caller decides
 *  what a missing/unparsed body means for its own status code. */
async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function errorFromBody(body: unknown, res: Response): string {
  if (body !== null && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  // The server always sends `{ error }` JSON on a non-2xx (see `app.ts`'s error handler and every
  // route's own `reply.code(...).send({ error })`). This fallback only ever fires for a response
  // this client did not expect at all -- e.g. a proxy's own error page -- never for an ordinary
  // 4xx from this API.
  return `request to ${res.url} failed with status ${res.status}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await readJsonBody(res);
  if (!res.ok) throw new Error(errorFromBody(body, res));
  return body as T;
}

/**
 * The live counterpart to `FixtureRunClient`: request/response endpoints go through `fetch`, the
 * run's event stream through `EventSource`. Constructed only in `main.tsx` -- every screen, and
 * every test in this app other than this file's own, sees only the `RunClient` interface.
 */
export class HttpRunClient implements RunClient {
  readonly isFixture = false;

  constructor(private readonly baseUrl: string) {}

  async startRun(description: string): Promise<{ runId: string }> {
    const body = await requestJson<{ runId: string }>(`${this.baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    return { runId: body.runId };
  }

  async getRun(runId: string): Promise<RunView> {
    return requestJson<RunView>(`${this.baseUrl}/runs/${runId}`);
  }

  async listRuns(): Promise<RunSummary[]> {
    return requestJson<RunSummary[]>(`${this.baseUrl}/runs`);
  }

  async listVersions(): Promise<VersionRow[]> {
    return requestJson<VersionRow[]>(`${this.baseUrl}/versions`);
  }

  async compareVersions(a: string, b: string): Promise<VersionCompare> {
    const query = new URLSearchParams({ a, b });
    return requestJson<VersionCompare>(`${this.baseUrl}/versions/compare?${query}`);
  }

  /**
   * `from` is not threaded into the initial connection: a native `EventSource` cannot set a
   * custom `Last-Event-ID` header on its first request (only the browser's own automatic
   * reconnect after a drop sends one, which the server's bus already replays from -- see the
   * comment on `GET /runs/:id/events`), and the app's only caller (`useRunStream`) always
   * subscribes from the start of a run it just started. Reconnection is handled entirely by
   * `EventSource` itself; hand-rolling a retry loop here would fight it and double-subscribe.
   */
  subscribe(runId: string, _from: string | undefined, sink: (event: RunEvent) => void): () => void {
    const source = new EventSource(`${this.baseUrl}/runs/${runId}/events`);

    // One `addEventListener` per name in `EVENT_NAMES`, not the default `message` handler: the
    // server sets an `event:` line on every frame (see `formatSse`), so `message` never fires and
    // a client that only listens for it would silently see nothing.
    const bound = EVENT_NAMES.map((name) => {
      const handler = (raw: Event): void => {
        const message = raw as MessageEvent<string>;
        try {
          const parsed: unknown = JSON.parse(message.data);
          if (parsed === null || typeof parsed !== "object" || !("name" in parsed)) {
            throw new Error(`"${name}" frame did not parse into a RunEvent`);
          }
          sink(parsed as RunEvent);
        } catch (err) {
          // An unparseable frame must not throw into the stream and kill a run the user is
          // watching -- report it and keep listening for the next one.
          console.error(`HttpRunClient: could not parse "${name}" frame`, err);
        }
      };
      source.addEventListener(name, handler);
      return { name, handler };
    });

    return () => {
      for (const { name, handler } of bound) source.removeEventListener(name, handler);
      source.close();
    };
  }
}
