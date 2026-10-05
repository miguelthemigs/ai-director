import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AvatarComposer } from "../../src/components/AvatarComposer.js";

const PIXEL = "aGk=";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, url: "/test", json: async () => body } as unknown as Response;
}

/** Routes by URL, not by call order: the gallery fetches `/avatar` on mount, so a queue of
 *  one-shot mocks is consumed in an order no test chose. */
function stubFetch(routes: { sheet?: Response; describe?: Response }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/avatar/sheet")) return routes.sheet ?? jsonResponse({});
      if (url.startsWith("/avatar/describe")) return routes.describe ?? jsonResponse({});
      if (url === "/avatar") return jsonResponse({ avatars: [] });
      return jsonResponse({});
    }),
  );
}

function renderComposer() {
  const onSubmit = vi.fn();
  render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={2000} />);
  return onSubmit;
}

/** Answers both pipeline steps: a rendered sheet stored as `a1`, then `description`. */
function stubBuildFlow(description: string) {
  stubFetch({
    sheet: jsonResponse({
      id: "a1",
      imageBase64: PIXEL,
      mediaType: "image/png",
      model: "m",
      authoredPrompt: "a",
      sheetPrompt: "b",
    }),
    describe: jsonResponse({ description, raw: description, trimmed: false, model: "c" }),
  });
}

async function renderAndDescribe(maxChars = 2000) {
  const onSubmit = vi.fn();
  render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={maxChars} />);
  fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
  await screen.findByAltText("The rendered character reference sheet");
  fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));
  return onSubmit;
}

beforeEach(() => {
  // The pipeline lists the saved avatars on mount.
  stubFetch({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AvatarComposer", () => {
  it("offers two ways to write the avatar's prompt, and opens on the fields", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "Fill in the fields" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Paste a description" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Gender")).toBeInTheDocument();
  });

  it("keeps the fields when switching to paste and back", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "man" } });
    fireEvent.click(screen.getByRole("button", { name: "Paste a description" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "pasted" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill in the fields" }));
    expect(screen.getByLabelText("Gender")).toHaveValue("man");
  });

  /**
   * The one thing this component must never get wrong.
   *
   * The guided fields assemble the prompt that GENERATES the avatar. The graded artefact is
   * what a vision model writes after LOOKING at the generated avatar, which in Mentic is
   * `UgcActor.description`. They are two different strings about two different things, and
   * grading the first would measure the prompt rather than the product of the prompt.
   */
  it("never submits the assembled prompt, however full the form is", () => {
    const onSubmit = renderComposer();

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
    fireEvent.change(screen.getByLabelText("Hair"), { target: { value: "blonde bob" } });

    // The assembled sentence is on screen, and Run is still refused: nothing has been
    // rendered, so nothing has been described, so there is nothing to grade.
    expect(screen.getByText("A woman, with blonde bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("labels the assembled sentence as the render prompt, not as the graded text", () => {
    renderComposer();
    expect(screen.getByText("The prompt that will generate the avatar")).toBeInTheDocument();
    expect(screen.getByText("This is what gets rendered, not what gets graded.")).toBeInTheDocument();
    expect(screen.queryByText("What will be graded")).not.toBeInTheDocument();
  });

  it("says the whole shape of the flow at the top", () => {
    renderComposer();
    expect(
      screen.getByText(/render the avatar, then grade the description the model writes back/i),
    ).toBeInTheDocument();
  });

  it("puts the pipeline on the same tab as the fields, so it reads as one flow", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "Generate sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Describe this person" })).toBeInTheDocument();
  });

  it("fills the form from the suggestions menu, then resets the menu to its placeholder", () => {
    renderComposer();
    const menu = screen.getByLabelText("Suggestions for Eyes") as HTMLSelectElement;

    fireEvent.change(menu, { target: { value: "hazel" } });

    expect(screen.getByLabelText("Eyes")).toHaveValue("hazel");
    expect(menu.value).toBe("");
  });

  it("marks the two fields Mentic has no counterpart for", () => {
    renderComposer();
    expect(screen.getAllByText("not in Mentic")).toHaveLength(2);
  });

  it("names the checks a field feeds", () => {
    renderComposer();
    expect(screen.getByText("anchor marker")).toBeInTheDocument();
    expect(screen.getByText("wardrobe · no brand name")).toBeInTheDocument();
  });

  it("hides makeup until gender is woman", () => {
    renderComposer();
    expect(screen.queryByLabelText("Makeup")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
    expect(screen.getByLabelText("Makeup")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "man" } });
    expect(screen.queryByLabelText("Makeup")).not.toBeInTheDocument();
  });

  it("fills the whole form from Surprise me, and Clear empties it again", () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Surprise me" }));
    expect(screen.getByLabelText("Gender")).not.toHaveValue("");
    expect(screen.getByLabelText("Wardrobe, head to toe")).not.toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Gender")).toHaveValue("");
  });

  it("blocks Run and flags the count once the described text passes the cap", async () => {
    stubBuildFlow("far too long for the cap");
    const onSubmit = await renderAndDescribe(5);

    await screen.findByText("far too long for the cap", { selector: "p" });
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("AvatarComposer, the full build flow", () => {
  /**
   * A pasted description is a way to write the avatar's prompt, like the fields. It renders
   * the sheet; it is never graded itself. Grading it directly is what used to send the
   * Repairer in blind.
   */
  it("renders the avatar from a pasted description, then grades what was described", async () => {
    stubBuildFlow("A man in his forties, short grey hair, navy suit.");
    const onSubmit = vi.fn();
    render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={2000} />);

    fireEvent.click(screen.getByRole("button", { name: "Paste a description" }));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Grey-haired man, forties, suit." },
    });
    // Pasted text alone is not something to grade: nothing has been rendered yet.
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");
    const sheetCall = vi
      .mocked(fetch)
      .mock.calls.find((call) => String(call[0]).startsWith("/avatar/sheet"));
    expect(JSON.parse(String((sheetCall![1] as RequestInit).body))).toMatchObject({
      description: "Grey-haired man, forties, suit.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(onSubmit).toHaveBeenCalledWith("A man in his forties, short grey hair, navy suit.", "a1");
  });

  it("grades the description written FROM the avatar, never the prompt that made it", async () => {
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
        description: "A woman in her late twenties, blonde bob, grey wool coat.",
        raw: "A woman in her late twenties, blonde bob, grey wool coat.",
        trimmed: false,
        model: "claude-sonnet-5",
      }),
    });

    const onSubmit = vi.fn();
    render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={2000} />);

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
    fireEvent.change(screen.getByLabelText("Hair"), { target: { value: "blonde bob" } });

    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");

    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    // The avatar id travels WITH the description. Without it the server cannot hand the
    // Repairer the sheet, and prompt v2 is unreachable however well it is written.
    expect(onSubmit).toHaveBeenCalledWith(
      "A woman in her late twenties, blonde bob, grey wool coat.",
      "a1",
    );
    // The assembled prompt is on screen throughout and is never what runs.
    expect(onSubmit).not.toHaveBeenCalledWith("A woman, with blonde bob", "a1");
  });

  it("counts the characters of the described text, not of the assembled prompt", async () => {
    stubFetch({
      sheet: jsonResponse({ id: "a1", imageBase64: PIXEL, mediaType: "image/png", model: "m", authoredPrompt: "a", sheetPrompt: "b" }),
      describe: jsonResponse({ description: "seven!!", raw: "seven!!", trimmed: false, model: "c" }),
    });

    render(<AvatarComposer onSubmit={vi.fn()} disabled={false} maxChars={2000} />);
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });

    // "A woman" is also 7 characters, so this asserts on the count only after the described
    // string has arrived, where the two lengths would otherwise be indistinguishable.
    expect(screen.getByText("0 / 2000 char")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate sheet" }));
    await screen.findByAltText("The rendered character reference sheet");
    fireEvent.click(screen.getByRole("button", { name: "Describe this person" }));

    await waitFor(() => expect(screen.getByText("7 / 2000 char")).toBeInTheDocument());
  });
});
