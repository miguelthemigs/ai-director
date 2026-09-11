import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App.js";
import { FixtureRunClient } from "../src/data/FixtureRunClient.js";

describe("App shell", () => {
  it("opens on the Run screen", () => {
    render(<App client={new FixtureRunClient()} />);
    expect(screen.getByRole("heading", { name: /run/i, level: 1 })).toBeInTheDocument();
  });

  it("moves between the three screens from the navigation", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /architecture/i }));
    expect(screen.getByRole("heading", { name: /architecture/i, level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(screen.getByRole("heading", { name: /versions/i, level: 1 })).toBeInTheDocument();
  });

  it("marks the current screen for assistive technology, not only visually", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(screen.getByRole("link", { name: /versions/i })).toHaveAttribute("aria-current", "page");
  });
});

// `useRunStream` was lifted from `RunScreen` into `App` (Task 14) specifically so `ScreenTabs`'
// RUN badge could carry a real failing count instead of the Task 12 stub (`failingCount={0}`).
// Design doc §6.2 also binds the badge's tone to status: `no_improvement` is the only status
// that takes the solid alarm fill; every other failing status — here, `improved_still_failing` —
// gets the alarm outline. This is the test the brief asked for by name.
describe("App shell — RUN tab failing badge (design doc §6.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runToCompletion(
    scenario: "improvedStillFailing" | "noImprovement" | "passed",
  ): Promise<void> {
    // `App` reads its initial screen from `window.location.pathname`, which an earlier test's
    // navigation can leave on `/versions` — reset it so every scenario here starts on Run.
    window.history.pushState({}, "", "/");
    const client = new FixtureRunClient({ speedMs: 1, scenario });
    render(<App client={client} />);
    fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
      target: { value: "a description long enough to submit" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
    });
    await act(async () => {
      // Comfortably past either fixture's full event log (32 events for improvedStillFailing, 22
      // for noImprovement, 12 for passed, all at 1ms each); advancing further is harmless.
      await vi.advanceTimersByTimeAsync(60);
    });
  }

  it("shows the real failing count, in the alarm outline, for a still-failing run", async () => {
    await runToCompletion("improvedStillFailing");
    const badge = screen.getByLabelText("4 failing");
    expect(badge).toHaveTextContent("4");
    expect(badge).toHaveAttribute("data-tone", "outline");
  });

  it("shows the real failing count, in the solid alarm fill, only for no_improvement", async () => {
    await runToCompletion("noImprovement");
    const badge = screen.getByLabelText("2 failing");
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAttribute("data-tone", "fill");
  });

  it("shows no badge at all once the run has passed", async () => {
    await runToCompletion("passed");
    expect(screen.queryByLabelText(/failing/i)).not.toBeInTheDocument();
  });
});
