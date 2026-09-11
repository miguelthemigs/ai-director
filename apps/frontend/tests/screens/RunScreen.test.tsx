import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunScreen } from "../../src/screens/RunScreen.js";
import { FixtureRunClient } from "../../src/data/FixtureRunClient.js";

/** Submits the composer and advances the fixture stream exactly through pass 1's completion
 *  (`pass.completed`, event index 10) — every check scored, nothing from pass 2 started yet. */
async function startAndFinishPass1(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("Paste the character description."), {
    target: { value: "a description long enough to submit" },
  });
  // Two separate `act` calls: the click's own promise chain (`handleSubmit` awaiting
  // `client.startRun`) must fully settle and commit — subscribing the stream — before any fake
  // timer advances, or the fixture's first events fire to zero listeners and are lost forever.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11);
  });
}

describe("RunScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows all nine checks with their own percentage once a run streams", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });
    render(<RunScreen client={client} />);

    await startAndFinishPass1();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(9);
    for (const option of options) {
      expect(within(option).getByText(/^(20|40|60|80|100)%$/)).toBeInTheDocument();
    }
  });

  it("shows no aggregate score anywhere in a group header", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });
    render(<RunScreen client={client} />);

    await startAndFinishPass1();

    const headers = document.querySelectorAll(".check-group-header__count");
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.textContent).not.toMatch(/%/);
    }
    // The group heading text itself (label + count) must never carry a percentage either.
    expect(screen.getByText("Re-renderable look").closest("h3")?.textContent).not.toMatch(/%/);
  });

  it("highlights the quoted fragment when its check is activated from the keyboard", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });
    render(<RunScreen client={client} />);

    await startAndFinishPass1();

    // hair_spec is rubric index 3 (its quote does not overlap another check's, unlike
    // age_build's "young man", which sits inside hair_spec's own wider quote and is dropped from
    // the specimen — see the task report's note on overlapping spans).
    const listbox = screen.getByRole("listbox", { name: /checks/i });
    fireEvent.keyDown(listbox, { key: "3" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    const fragment = screen.getByRole("button", { name: /hair specified three ways, band/i });
    expect(fragment).toHaveAttribute("aria-current", "true");
  });

  it("selects the check when its fragment in the text is activated", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });
    render(<RunScreen client={client} />);

    await startAndFinishPass1();

    const fragment = screen.getByRole("button", { name: /wardrobe head to toe, band/i });
    fireEvent.click(fragment);

    const row = screen.getByRole("option", { name: /wardrobe head to toe/i });
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("shows an explicit fragment-not-found notice for an unverified quote", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });
    render(<RunScreen client={client} />);

    await startAndFinishPass1();

    expect(
      screen.getByText(/this quote was not found in the description/i),
    ).toBeInTheDocument();
  });

  it("makes the description read-only once submitted", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });
    render(<RunScreen client={client} />);

    expect(screen.getByPlaceholderText("Paste the character description.")).toBeInTheDocument();

    await startAndFinishPass1();

    expect(screen.queryByPlaceholderText("Paste the character description.")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});
