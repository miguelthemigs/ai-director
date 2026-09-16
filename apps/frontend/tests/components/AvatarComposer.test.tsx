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

function renderComposer(live = false) {
  const onSubmit = vi.fn();
  render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={2000} live={live} />);
  return onSubmit;
}

describe("AvatarComposer", () => {
  it("offers two tabs and opens on Build an avatar", () => {
    renderComposer();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Build an avatar",
      "Paste a description",
    ]);
    expect(screen.getByRole("tab", { name: "Build an avatar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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

  it("submits the pasted text on the other tab", () => {
    const onSubmit = renderComposer();

    fireEvent.click(screen.getByRole("tab", { name: "Paste a description" }));
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "A 29-year-old woman in a grey wool coat." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    // Null avatar: this description was typed, so it belongs to no stored sheet and the
    // run is honestly a blind v1 one.
    expect(onSubmit).toHaveBeenCalledWith("A 29-year-old woman in a grey wool coat.", null);
  });

  it("keeps each tab's draft, and the fields never leak into the pasted run", () => {
    const onSubmit = renderComposer();

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "man" } });
    fireEvent.click(screen.getByRole("tab", { name: "Paste a description" }));
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "pasted text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(onSubmit).toHaveBeenCalledWith("pasted text", null);
    fireEvent.click(screen.getByRole("tab", { name: "Build an avatar" }));
    expect(screen.getByLabelText("Gender")).toHaveValue("man");
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

  it("blocks Run and flags the count once the pasted text passes the cap", () => {
    const onSubmit = vi.fn();
    render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={5} live={false} />);

    fireEvent.click(screen.getByRole("tab", { name: "Paste a description" }));
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "far too long for the cap" },
    });

    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("AvatarComposer, the full build flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={2000} live={true} />);

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

    render(<AvatarComposer onSubmit={vi.fn()} disabled={false} maxChars={2000} live={true} />);
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
