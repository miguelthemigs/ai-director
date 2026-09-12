import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AvatarComposer } from "../../src/components/AvatarComposer.js";

function renderComposer(onSubmit = vi.fn()) {
  render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={2000} />);
  return onSubmit;
}

describe("AvatarComposer", () => {
  it("opens on the Guided tab, with Run disabled until a field is filled", () => {
    renderComposer();
    expect(screen.getByRole("tab", { name: "Guided" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("says which description this is, so the image brief is never mistaken for it", () => {
    renderComposer();
    expect(
      screen.getByText(/reaches the video model, not the brief that renders the avatar sheet/i),
    ).toBeInTheDocument();
  });

  it("submits the assembled sentence when the Guided tab is active", () => {
    const onSubmit = renderComposer();

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
    fireEvent.change(screen.getByLabelText("Hair"), { target: { value: "blonde bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(onSubmit).toHaveBeenCalledWith("A woman, with blonde bob");
  });

  it("submits the pasted text when the Direct tab is active", () => {
    const onSubmit = renderComposer();

    fireEvent.click(screen.getByRole("tab", { name: "Direct" }));
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "A 29-year-old woman in a grey wool coat." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(onSubmit).toHaveBeenCalledWith("A 29-year-old woman in a grey wool coat.");
  });

  it("keeps each tab's draft when the other is used, and submits only the active one", () => {
    const onSubmit = renderComposer();

    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "man" } });
    fireEvent.click(screen.getByRole("tab", { name: "Direct" }));
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "pasted text" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Guided" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    // The guided draft survived the round trip, and the pasted text did not leak into the run.
    expect(onSubmit).toHaveBeenCalledWith("A man");
  });

  it("shows the exact string that will be graded before anything is spent", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
    fireEvent.change(screen.getByLabelText("Eyes"), { target: { value: "hazel" } });

    expect(screen.getByText("What will be graded")).toBeInTheDocument();
    expect(screen.getByText("A woman, hazel eyes")).toBeInTheDocument();
  });

  it("fills the form from the suggestions menu, then resets the menu to its placeholder", () => {
    renderComposer();
    const menu = screen.getByLabelText("Suggestions for Eyes") as HTMLSelectElement;

    fireEvent.change(menu, { target: { value: "hazel" } });

    expect(screen.getByLabelText("Eyes")).toHaveValue("hazel");
    // A pick-to-insert menu holds no value of its own; leaving one selected would make the next
    // pick of the same value a no-op.
    expect(menu.value).toBe("");
  });

  it("marks the two fields Mentic has no counterpart for, rather than blending them in", () => {
    renderComposer();
    expect(screen.getAllByText("not in Mentic")).toHaveLength(2);
  });

  it("names the checks a field feeds, so a blank field shows what it costs", () => {
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
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Gender")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("counts the characters of the text that will actually run, per tab", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "woman" } });
    // "A woman" is 7 characters.
    expect(screen.getByText("7 / 2000 char")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Direct" }));
    expect(screen.getByText("0 / 2000 char")).toBeInTheDocument();
  });

  it("blocks Run and flags the count once the text passes the cap", () => {
    const onSubmit = vi.fn();
    render(<AvatarComposer onSubmit={onSubmit} disabled={false} maxChars={5} />);

    fireEvent.click(screen.getByRole("tab", { name: "Direct" }));
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "far too long for the cap" },
    });

    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
