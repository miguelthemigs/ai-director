import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenRouterVideoTransport,
  OpenRouterConfigError,
  OpenRouterHttpError,
  openrouterContentUrl,
  OPENROUTER_VIDEOS_ENDPOINT,
  submitProvablyUnbilled,
} from "../../src/video/openrouterClient.js";

const REQUEST = {
  model: "bytedance/seedance-2.5",
  prompt: "A single locked-off medium shot.",
  duration: 4,
  size: "480x854",
  generate_audio: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe("submit", () => {
  it("posts to the videos endpoint with a bearer token and returns the task id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1" }));

    const result = await createOpenRouterVideoTransport().submit(REQUEST);

    expect(result).toEqual({ taskId: "task-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_VIDEOS_ENDPOINT);
    expect(url).toBe("https://openrouter.ai/api/v1/videos");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it("never sends an image reference, whatever the caller passed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1" }));
    await createOpenRouterVideoTransport().submit(REQUEST);
    const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string;
    expect(body).not.toContain("input_references");
    expect(body).not.toContain("frame_images");
  });

  it("throws a typed HTTP error carrying the upstream message and the status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "size not supported" } }, 400),
    );

    const error = await createOpenRouterVideoTransport()
      .submit(REQUEST)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OpenRouterHttpError);
    expect((error as OpenRouterHttpError).status).toBe(400);
    expect((error as Error).message).toContain("size not supported");
  });

  it("quotes a truncated snippet when the error body is not the documented shape", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway timeout</html>", { status: 504 }));

    const error = await createOpenRouterVideoTransport()
      .submit(REQUEST)
      .catch((err: unknown) => err);

    expect((error as Error).message).toContain("504");
    expect((error as Error).message).toContain("gateway timeout");
  });

  it("refuses a 2xx whose body has no id rather than returning an undefined task id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(createOpenRouterVideoTransport().submit(REQUEST)).rejects.toThrow(/id/i);
  });
});

describe("status map", () => {
  const cases: Array<[string, string]> = [
    ["pending", "queued"],
    ["in_progress", "running"],
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["expired", "failed"],
  ];

  for (const [upstream, expected] of cases) {
    it(`maps "${upstream}" to "${expected}"`, async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: upstream }));
      const result = await createOpenRouterVideoTransport().check("task-1");
      expect(result.status).toBe(expected);
    });
  }

  it("maps an unrecognised status to failed rather than throwing or returning undefined", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: "reticulating" }));
    const result = await createOpenRouterVideoTransport().check("task-1");
    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("OPENROUTER_UNKNOWN_STATUS");
    expect(result.failure).toContain("reticulating");
  });

  it("carries the upstream failure code and message on a failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "task-1",
        status: "failed",
        error: { code: "CONTENT_POLICY", message: "refused" },
      }),
    );
    const result = await createOpenRouterVideoTransport().check("task-1");
    expect(result.failureCode).toBe("CONTENT_POLICY");
    expect(result.failure).toBe("refused");
  });

  it("falls back to OPENROUTER_FAILED when the vendor names no code", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: "failed" }));
    const result = await createOpenRouterVideoTransport().check("task-1");
    expect(result.failureCode).toBe("OPENROUTER_FAILED");
    expect(result.failure).toBeNull();
  });

  it("reads the vendor's cost into integer micro-USD, and null when it reports none", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "task-1", status: "completed", usage: { cost: 0.41 } }),
    );
    expect((await createOpenRouterVideoTransport().check("task-1")).actualMicroUsd).toBe(410_000);

    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: "completed" }));
    expect((await createOpenRouterVideoTransport().check("task-1")).actualMicroUsd).toBeNull();

    fetchMock.mockResolvedValue(
      jsonResponse({ id: "task-1", status: "completed", usage: { cost: null } }),
    );
    expect((await createOpenRouterVideoTransport().check("task-1")).actualMicroUsd).toBeNull();
  });
});

describe("fetchClip", () => {
  it("fetches the content URL with the bearer token and returns bytes", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      }),
    );

    const clip = await createOpenRouterVideoTransport().fetchClip("task-1");

    expect(clip.mediaType).toBe("video/mp4");
    expect([...clip.bytes]).toEqual([0, 1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/videos/task-1/content?index=0");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("defaults the media type when the vendor sends none, rather than storing an empty one", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));
    const clip = await createOpenRouterVideoTransport().fetchClip("task-1");
    expect(clip.mediaType).toBe("video/mp4");
  });

  it("normalises the header rather than replaying it, so the browser always gets a type it plays", async () => {
    // The stored type picks the file extension AND becomes the response Content-Type on
    // the clip route. Object storage behind a signed URL routinely answers a parameterised
    // or generic type, which used to be saved and replayed verbatim: the bytes were fine
    // and the <video> element refused them, inside a panel already marked a success.
    const cases: Array<[string, string]> = [
      ["video/mp4; charset=binary", "video/mp4"],
      ["VIDEO/MP4", "video/mp4"],
      ["application/octet-stream", "video/mp4"],
      ["video/webm", "video/webm"],
      ["video/webm; codecs=vp9", "video/webm"],
    ];
    for (const [header, expected] of cases) {
      fetchMock.mockResolvedValue(
        new Response(new Uint8Array([0]), { status: 200, headers: { "Content-Type": header } }),
      );
      const clip = await createOpenRouterVideoTransport().fetchClip("task-1");
      expect(clip.mediaType, header).toBe(expected);
    }
  });
});

describe("the key", () => {
  it("throws at call time, never at import", async () => {
    delete process.env.OPENROUTER_API_KEY;
    // Constructing the transport must not throw either: the server builds one only when
    // the key is present, but a test or a CLI may construct one to inspect it.
    const transport = createOpenRouterVideoTransport();
    await expect(transport.submit(REQUEST)).rejects.toBeInstanceOf(OpenRouterConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("submitProvablyUnbilled", () => {
  it("is true only when nothing left the process, or OpenRouter refused the request", () => {
    expect(submitProvablyUnbilled(new OpenRouterConfigError("no key"))).toBe(true);
    expect(submitProvablyUnbilled(new OpenRouterHttpError("bad size", 400))).toBe(true);
    expect(submitProvablyUnbilled(new OpenRouterHttpError("rate limited", 429))).toBe(true);
  });

  it("is false for a 5xx, a timeout and anything unrecognised", () => {
    expect(submitProvablyUnbilled(new OpenRouterHttpError("upstream", 500))).toBe(false);
    expect(submitProvablyUnbilled(new OpenRouterHttpError("gateway", 504))).toBe(false);
    expect(submitProvablyUnbilled(new DOMException("aborted", "TimeoutError"))).toBe(false);
    expect(submitProvablyUnbilled(new Error("unparseable 200 body"))).toBe(false);
    expect(submitProvablyUnbilled("not an error at all")).toBe(false);
  });
});

describe("openrouterContentUrl", () => {
  it("is the documented shape", () => {
    expect(openrouterContentUrl("abc")).toBe(
      "https://openrouter.ai/api/v1/videos/abc/content?index=0",
    );
  });
});
