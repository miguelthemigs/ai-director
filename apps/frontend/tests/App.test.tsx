import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { RunEvent, RunSummary, RunView, VersionCompare, VersionRow } from "@ai-director/contract";
import { App } from "../src/App.js";
import type { RunClient } from "../src/data/RunClient.js";
import { FixtureRunClient } from "../src/data/FixtureRunClient.js";

/**
 * A stub of a future `HttpRunClient`: `isFixture` is the only thing under test here, so every
 * method beyond that is an unreached no-op — `App`'s default Run screen at `runId === null` never
 * calls any of them. Proves the sample-data marker (fix round 1, task 16) is driven off the
 * client's own flag, not a build-time constant that would keep showing it after Phase C's swap.
 */
class NonFixtureStubClient implements RunClient {
  readonly isFixture = false;

  async startRun(): Promise<{ runId: string }> {
    throw new Error("NonFixtureStubClient: not exercised by this test");
  }
  async getRun(): Promise<RunView> {
    throw new Error("NonFixtureStubClient: not exercised by this test");
  }
  async listRuns(): Promise<RunSummary[]> {
    return [];
  }
  subscribe(_runId: string, _from: string | undefined, _sink: (event: RunEvent) => void): () => void {
    return () => {};
  }
  async listVersions(): Promise<VersionRow[]> {
    return [];
  }
  async compareVersions(): Promise<VersionCompare> {
    throw new Error("NonFixtureStubClient: not exercised by this test");
  }
}

// `App` reads its initial screen from `window.location.pathname`, and jsdom does not reset
// `window.location`/`window.history` between tests in the same file — an earlier test's
// navigation (e.g. to `/versions`) otherwise bleeds into the next test's initial render. Reset
// before every test in this file, not just the ones that happened to need it first.
beforeEach(() => {
  window.history.pushState({}, "", "/");
});

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

  // Task 15 built `ArchitectureScreen` as its own file; wiring it into `App` (replacing the Task 12
  // stub) is a separate change a future refactor could silently revert. Assert on something only
  // the real screen renders — a pipeline node — not just the heading text the stub also carried.
  it("renders the real Architecture screen, not the Task 12 stub", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /architecture/i }));
    expect(screen.getByTestId("node-evaluator")).toBeInTheDocument();
    expect(screen.getByTestId("node-interrogator")).toHaveTextContent(/planned/i);
  });

  // Task 16's `VersionsScreen` replaces the Task 12 stub (`<h1 className="screen-title">Versions</h1>`
  // and nothing else). Assert on a version row's required note — something only the real screen
  // renders — rather than the heading text the stub also carried, for the same reason the
  // Architecture test above does.
  it("renders the real Versions screen, not the Task 12 stub", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(await screen.findByText(/first frozen rubric/i)).toBeInTheDocument();
  });

  // Fix round 1 (task 16): a screenshot of this product's own invented version history could read
  // as evidence of a research feedback cycle that never happened, so every screen carries a
  // sample-data marker whenever the client behind it is a fixture.
  it("shows a sample-data marker when running against FixtureRunClient", () => {
    render(<App client={new FixtureRunClient()} />);
    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });

  // The half of the contract that actually matters: the marker must vanish on its own once
  // `main.tsx` swaps in a real (non-fixture) client in Phase C, with nobody having to remember to
  // remove it by hand.
  it("shows no sample-data marker when the client is not a fixture", () => {
    render(<App client={new NonFixtureStubClient()} />);
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
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
    // The file-level `beforeEach` above already starts every test on `/`.
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
