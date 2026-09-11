import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { VersionsScreen } from "../../src/screens/VersionsScreen.js";
import { FixtureRunClient } from "../../src/data/FixtureRunClient.js";
import { FIXTURE_VERSIONS } from "../../src/data/versionFixtures.js";

function selectCheckbox(id: string): HTMLElement {
  return screen.getByRole("checkbox", { name: new RegExp(`select ${id}\\b`, "i") });
}

describe("VersionsScreen", () => {
  it("renders one row per version, each carrying its required why note", async () => {
    render(<VersionsScreen client={new FixtureRunClient()} />);

    for (const version of FIXTURE_VERSIONS) {
      // A row whose `why` is empty would be a test failure here, not a blank cell: this asserts
      // the real note text, not merely that some row exists.
      expect(version.why.trim().length).toBeGreaterThan(0);
      expect(await screen.findByText(version.why)).toBeInTheDocument();
    }

    const grid = screen.getByRole("grid", { name: /version history/i });
    expect(within(grid).getAllByRole("row")).toHaveLength(FIXTURE_VERSIONS.length + 1); // +1 head row
  });

  it("gives the version rows the revision-paper colour order (white, blue, pink, ...)", async () => {
    render(<VersionsScreen client={new FixtureRunClient()} />);
    await screen.findByText(FIXTURE_VERSIONS[0]?.why ?? "");

    const swatches = document.querySelectorAll(".revision-chip__swatch");
    expect(swatches).toHaveLength(FIXTURE_VERSIONS.length);
    swatches.forEach((swatch, index) => {
      expect(swatch.getAttribute("data-rev")).toBe(String(index + 1));
    });
  });

  it("opens the compare view with a prompt diff and a per-check delta table when two versions are selected", async () => {
    render(<VersionsScreen client={new FixtureRunClient()} />);
    await screen.findByText(/first frozen rubric/i);

    fireEvent.click(selectCheckbox("v1"));
    fireEvent.click(selectCheckbox("v2"));

    expect(await screen.findByRole("region", { name: /comparing v1 and v2/i })).toBeInTheDocument();
    // The rubric split described in v2's own note is visible as an added diff line.
    expect(
      screen.getByText(/state colour, texture, and style as three separate cues/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /per-check score change/i })).toBeInTheDocument();
  });

  it("renders 'not comparable' rather than a number when one selected version has no profile yet", async () => {
    render(<VersionsScreen client={new FixtureRunClient()} />);
    await screen.findByText(/first frozen rubric/i);

    // v1 is fully scored; r1 was just sealed and has not been run against anything yet.
    fireEvent.click(selectCheckbox("v1"));
    fireEvent.click(selectCheckbox("r1"));

    await screen.findByRole("region", { name: /comparing v1 and r1/i });
    const table = screen.getByRole("table", { name: /per-check score change/i });
    const notComparableCells = within(table).getAllByText(/not comparable/i);
    expect(notComparableCells).toHaveLength(9);
    // Never a fabricated number standing in for the nine unmeasured deltas.
    expect(within(table).queryByText(/[-+]?\d+\.\d pt/)).not.toBeInTheDocument();
  });
});
