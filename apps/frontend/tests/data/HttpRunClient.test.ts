import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRunClient } from "../../src/data/HttpRunClient.js";

/**
 * A minimal fake of the browser's `EventSource`: enough to open a connection, dispatch named
 * frames the way the server's `event:`/`data:` lines do, and record whether `close()` was called.
 * jsdom does not implement `EventSource` at all, so every test that needs one stubs this in via
 * `vi.stubGlobal` rather than touching the network.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, handler: (event: MessageEvent<string>) => void): void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(handler);
    this.listeners.set(name, set);
  }

  removeEventListener(name: string, handler: (event: MessageEvent<string>) => void): void {
    this.listeners.get(name)?.delete(handler);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: deliver one frame under `name`, exactly as the server's `event: name` would. */
  emit(name: string, data: string): void {
    const event = { data } as MessageEvent<string>;
    for (const handler of this.listeners.get(name) ?? []) handler(event);
  }
}

function stubFetchOnce(response: { ok: boolean; status: number; body: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HttpRunClient", () => {
  it("marks itself as not a fixture", () => {
    stubFetchOnce({ ok: true, status: 202, body: {} });
    expect(new HttpRunClient("").isFixture).toBe(false);
  });

  it("POSTs a new run to /runs and returns the runId", async () => {
    const fetchMock = stubFetchOnce({ ok: true, status: 202, body: { runId: "run-1", status: "running" } });
    const client = new HttpRunClient("");

    await expect(client.startRun("a weak description")).resolves.toEqual({ runId: "run-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ description: "a weak description" }),
      }),
    );
  });

  it("rejects with the server's own error string on a non-2xx response", async () => {
    stubFetchOnce({ ok: false, status: 400, body: { error: "description must not be empty" } });
    const client = new HttpRunClient("");

    await expect(client.startRun("")).rejects.toThrow("description must not be empty");
  });

  it("opens an EventSource at /runs/:id/events", () => {
    stubFetchOnce({ ok: true, status: 200, body: {} });
    const client = new HttpRunClient("");

    client.subscribe("run-1", undefined, () => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("/runs/run-1/events");
  });

  it("parses a named event/data frame into a typed RunEvent and hands it to the sink", () => {
    const client = new HttpRunClient("");
    const seen: unknown[] = [];
    client.subscribe("run-1", undefined, (event) => seen.push(event));

    const source = FakeEventSource.instances[0];
    const frame = { id: "0-0", name: "run.started", at: "2026-01-01T00:00:00.000Z", runId: "run-1", rubricVersion: "v1", model: "m", description: "d" };
    source?.emit("run.started", JSON.stringify(frame));

    expect(seen).toEqual([frame]);
  });

  it("reports an unparseable frame through the error channel instead of throwing into the stream", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new HttpRunClient("");
    const seen: unknown[] = [];
    client.subscribe("run-1", undefined, (event) => seen.push(event));
    const source = FakeEventSource.instances[0];

    expect(() => source?.emit("run.started", "not json")).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    expect(seen).toEqual([]);

    // The connection is still alive: the next, well-formed frame still reaches the sink.
    const frame = { id: "0-1", name: "pass.started", at: "2026-01-01T00:00:01.000Z", pass: 1, description: "d" };
    source?.emit("pass.started", JSON.stringify(frame));
    expect(seen).toEqual([frame]);
  });

  it("closes the EventSource when the returned unsubscribe is called", () => {
    const client = new HttpRunClient("");
    const unsubscribe = client.subscribe("run-1", undefined, () => {});
    const source = FakeEventSource.instances[0];

    expect(source?.closed).toBe(false);
    unsubscribe();
    expect(source?.closed).toBe(true);
  });

  it("fetches a run snapshot from GET /runs/:id", async () => {
    const run = { runId: "run-1", status: "passed" };
    stubFetchOnce({ ok: true, status: 200, body: run });
    const client = new HttpRunClient("");

    await expect(client.getRun("run-1")).resolves.toEqual(run);
  });

  it("fetches the run list from GET /runs", async () => {
    const runs = [{ runId: "run-1" }];
    stubFetchOnce({ ok: true, status: 200, body: runs });
    const client = new HttpRunClient("");

    await expect(client.listRuns()).resolves.toEqual(runs);
  });

  it("fetches versions from GET /versions", async () => {
    const versions = [{ id: "v1" }];
    stubFetchOnce({ ok: true, status: 200, body: versions });
    const client = new HttpRunClient("");

    await expect(client.listVersions()).resolves.toEqual(versions);
  });

  it("fetches a version comparison from GET /versions/compare", async () => {
    const fetchMock = stubFetchOnce({ ok: true, status: 200, body: { a: {}, b: {} } });
    const client = new HttpRunClient("");

    await client.compareVersions("v1", "v2");

    expect(fetchMock).toHaveBeenCalledWith("/versions/compare?a=v1&b=v2", undefined);
  });
});
