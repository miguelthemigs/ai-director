import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SheetPipeline } from "../../src/components/SheetPipeline.js";

const PIXEL = "aGk=";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, url: "/test", json: async () => body } as unknown as Response;
}

/**
 * Routes by URL rather than by call order.
 *
 * `SheetPipeline` fetches `/avatar` on mount to fill the gallery, so a queue of
 * `mockResolvedValueOnce` responses is consumed in an order the test did not choose and
 * every assertion after the first drifts. Routing by URL also means a test states which
 * endpoint it is stubbing, which is the thing a reader wants to know.
 */
function stubFetch(routes: { sheet?: Response; describe?: Response; list?: Response; upload?: Response }) {
  const queue = { sheet: [routes.sheet], describe: [routes.describe] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/avatar/sheet")) return queue.sheet.shift() ?? routes.sheet ?? jsonResponse({});
      if (url.startsWith("/avatar/describe")) return queue.describe.shift() ?? routes.describe ?? jsonResponse({});
      if (url.startsWith("/avatar/upload")) return routes.upload ?? jsonResponse({ id: "stored-1", mediaType: "image/png" });
      if (url === "/avatar") return routes.list ?? jsonResponse({ avatars: [] });
      // Reopening an avatar reads its bytes back from the store rather than from memory.
      if (/^\/avatar\/[^/]+\/image$/.test(url)) {
        return {
          ok: true,
          status: 200,
          url,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      }
      return jsonResponse({});
    }),
  );
}

function renderPipeline(overrides: Partial<Parameters<typeof SheetPipeline>[0]> = {}) {
  const onDescription = vi.fn();
  render(
    <SheetPipeline
      seedDescription="A 29-year-old woman."
      onDescription={onDescription}
      disabled={false}
      live={true}
      {...overrides}
    />,
  );
  return onDescription;
}

describe("SheetPipeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says it needs the real backend in fixture mode, and generates nothing", () => {
    stubFetch({});
    renderPipeline({ live: false });
    expect(screen.getByText(/needs the real backend/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate sheet" })).toBeDisabled();
  });

  it("names the price of each step next to the button that spends it", () => {
    stubFetch({});
    renderPipeline();
    expect(screen.getByText("paid image call")).toBeInTheDocument();
    expect(screen.getByText("paid vision call")).toBeInTheDocument();
  });

  it("cannot describe before a sheet exists", () => {
    stubFetch({});
    renderPipeline();
    expect(screen.getByRole("button", { name: "Describe this person" })).toBeDisabled();
  });

  it("will not generate from an empty description", () => {
    stubFetch({});
    renderPipeline({ seedDescription: "   " });
    expect(screen.getByRole("button", { name: "Generate sheet" })).toBeDisabled();
  });

  it("renders the sheet and shows both prompts that produced it", async () => {
    stubFetch({
      sheet: jsonResponse({
        id: "a1",
        imageBase64: PIXEL,
        mediaType: "image/png",
        model: "gemini-3-pro-image",
        authoredPrompt: "A 29-year-old woman.",
        sheetPrompt: "Cinematic character reference sheet...",
      }),
    });

    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));

    const image = await screen.findByAltText("The rendered character reference sheet");
    expect(image).toHaveAttribute("src", `data:image/png;base64,${PIXEL}`);
    // Both prompts, because a bad prompt and a bad render look identical without them.
    expect(screen.getByText("A 29-year-old woman.")).toBeInTheDocument();
    expect(screen.getByText("Cinematic character reference sheet...")).toBeInTheDocument();
  });

  it("hands up the DESCRIBE step's output, which is not the text that went in", async () => {
    stubFetch({
      sheet: jsonResponse({
        id: "a1",
        imageBase64: PIXEL,
        mediaType: "image/png",
        model: "gemini-3-pro-image",
        authoredPrompt: "authored",
        sheetPrompt: "sheet",
      }),
      describe: jsonResponse({
        description: "A woman in her late twenties, with a blonde bob.",
        raw: "A woman in her late twenties, with a blonde bob.",
        trimmed: false,
        model: "claude-sonnet-5",
      }),
    });

    const onDescription = renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");

    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));

    await waitFor(() =>
      expect(onDescription).toHaveBeenCalledWith(
        "A woman in her late twenties, with a blonde bob.",
        "a1",
      ),
    );
    // The whole point: what gets graded is what came back off the sheet, not the seed.
    expect(onDescription).not.toHaveBeenCalledWith("A 29-year-old woman.", "a1");
  });

  it("flags a description the cap had to cut, and explains what that means", async () => {
    stubFetch({
      sheet: jsonResponse({
        id: "a1",
        imageBase64: PIXEL,
        mediaType: "image/png",
        model: "gemini-3-pro-image",
        authoredPrompt: "a",
        sheetPrompt: "b",
      }),
      describe: jsonResponse({ description: "cut", raw: "cut and more", trimmed: true, model: "claude-sonnet-5" }),
    });

    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");
    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));

    expect(await screen.findByText(/900-character cap cut this/i)).toBeInTheDocument();
  });

  it("shows the server's own reason when a step fails", async () => {
    stubFetch({ sheet: jsonResponse({ error: "GOOGLE_AI_KEY missing" }, false, 503) });

    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("GOOGLE_AI_KEY missing");
  });

  it("clears the old description when a new sheet is rendered", async () => {
    stubFetch({
      sheet: jsonResponse({ id: "a1", imageBase64: PIXEL, mediaType: "image/png", model: "m", authoredPrompt: "a", sheetPrompt: "b" }),
      describe: jsonResponse({ description: "first description", raw: "first description", trimmed: false, model: "c" }),
    });

    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");
    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));
    expect(await screen.findByText("first description")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));

    // A description left on screen beside a sheet it was not written from is exactly the
    // mismatch this tool exists to catch.
    await waitFor(() => expect(screen.queryByText("first description")).not.toBeInTheDocument());
  });

  it("refuses a file past the size cap without reading or posting it", () => {
    stubFetch({});
    renderPipeline();
    const input = screen.getByLabelText("Upload a character sheet");
    const huge = new File(["x"], "sheet.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 7 * 1024 * 1024 });

    fireEvent.change(input, { target: { files: [huge] } });

    expect(screen.getByRole("alert")).toHaveTextContent(/limit is 6MB/);
    // The gallery's own mount fetch is the only call allowed; nothing was uploaded.
    expect(vi.mocked(fetch).mock.calls.map((call) => String(call[0]))).not.toContain("/avatar/upload");
  });

  /**
   * The section is rendered whether or not it has contents. Showing it only once it has an
   * avatar in it means there is no visible place for avatars to live until one exists, and
   * the first question after a failed render becomes "where do I even look?" instead of
   * "what went wrong?".
   */
  it("shows where avatars will live even when none have been saved", async () => {
    stubFetch({ list: jsonResponse({ avatars: [] }) });
    renderPipeline();

    expect(await screen.findByText("Your avatars")).toBeInTheDocument();
    expect(screen.getByText("none yet")).toBeInTheDocument();
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
  });

  it("lists what is on disk, marks which have been described, and reopens one", async () => {
    stubFetch({
      list: jsonResponse({
        avatars: [
          {
            id: "a1",
            createdAt: "2026-09-12T10:00:00.000Z",
            source: "generated",
            mediaType: "image/png",
            description: "A woman in her thirties.",
            describeModel: "claude-sonnet-5",
          },
          {
            id: "a2",
            createdAt: "2026-09-12T09:00:00.000Z",
            source: "uploaded",
            mediaType: "image/png",
          },
        ],
      }),
    });
    const onDescription = renderPipeline();

    expect(await screen.findByText("2 saved")).toBeInTheDocument();
    expect(screen.getByText("described")).toBeInTheDocument();
    expect(screen.getByText("not described")).toBeInTheDocument();

    // The thumbnail is served from the store, never carried in the list as base64.
    const thumbs = screen.getAllByRole("img");
    expect(thumbs[0]).toHaveAttribute("src", "/avatar/a1/image");

    // Reopening an already-described avatar brings its description back without paying for
    // a second vision call.
    fireEvent.click(thumbs[0]!.closest("button")!);
    await waitFor(() =>
      expect(onDescription).toHaveBeenCalledWith("A woman in her thirties.", "a1"),
    );
  });

  /* ── Why these two exist ──────────────────────────────────────────────────────────────
     The Run screen's field is a scroll container, and the rendered sheet is tall. A
     description that arrives lands roughly 200px below the fold, under an image that just
     pushed it there, so the only visible change after a 3-second paid vision call was the
     button's label going back to what it said before. It looked exactly like a call that
     had not happened, which is how the same avatar got described twice. */
  it("brings a new description into view instead of leaving it below the fold", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    stubFetch({
      sheet: jsonResponse({
        id: "a1",
        imageBase64: PIXEL,
        mediaType: "image/png",
        model: "gemini-3-pro-image",
        authoredPrompt: "authored",
        sheetPrompt: "sheet",
      }),
      describe: jsonResponse({
        description: "A woman in her late twenties, with a blonde bob.",
        raw: "A woman in her late twenties, with a blonde bob.",
        trimmed: false,
        model: "claude-sonnet-5",
      }),
    });

    renderPipeline();
    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));
    await screen.findByText("A woman in her late twenties, with a blonde bob.");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("says a second describe is a second charge once one description is on screen", async () => {
    stubFetch({
      list: jsonResponse({
        avatars: [
          {
            id: "a1",
            createdAt: "2026-09-12T10:00:00.000Z",
            source: "generated",
            mediaType: "image/png",
            description: "A woman in her thirties.",
            describeModel: "claude-sonnet-5",
          },
        ],
      }),
    });
    renderPipeline();

    const thumb = await screen.findByRole("img", { name: /Avatar rendered/ });
    expect(screen.getByRole("button", { name: "Describe this person" })).toBeInTheDocument();

    fireEvent.click(thumb.closest("button")!);

    // Reopened with a description already attached, so the button must not read as the
    // first, free-looking step: pressing it pays for a vision call the record already has.
    await screen.findByRole("button", { name: "Describe it again" });
    expect(
      screen.getByText(/already has a description|describing it again/i),
    ).toBeInTheDocument();
  });
});
