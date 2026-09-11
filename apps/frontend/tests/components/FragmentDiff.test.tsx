import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplacementView } from "@ai-director/contract";
import { FragmentDiff } from "../../src/components/FragmentDiff.js";

const REPLACEMENTS: ReplacementView[] = [
  {
    spanId: "age_build-0",
    checkId: "age_build",
    oldText: "young man",
    newText: "man in his late twenties, lean and tall",
    rationale: "Adds the bracket and the build the check requires.",
  },
  {
    spanId: "no_brand_name-0",
    checkId: "no_brand_name",
    oldText: "Nike",
    newText: "plain grey",
    rationale: "Removes the brand name without changing the garment.",
  },
];

describe("FragmentDiff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders exactly one row per changed fragment, never the whole description", () => {
    render(<FragmentDiff pass={1} replacements={REPLACEMENTS} onSelectSpan={vi.fn()} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
  });

  it("keeps the replacement out of the DOM until the strike finishes, then shows <del>/<ins>", async () => {
    const { container } = render(
      <FragmentDiff pass={1} replacements={REPLACEMENTS} onSelectSpan={vi.fn()} />,
    );

    // The reflow-timing fix this test protects: an inline, non-`display:none` <ins> occupies
    // layout space from the instant it exists in the DOM, regardless of its opacity. So the old
    // (struck) text must be present immediately, but the new text must not enter the DOM at all
    // until the strike finishes — otherwise the paragraph reflows to its final width at mount,
    // underneath the still-running strike animation (motion spec §6.1/§6.2).
    expect(container.querySelectorAll("del")).toHaveLength(2);
    expect(container.querySelectorAll("ins")).toHaveLength(0);

    // Past both rows' strike completion (order 0 at 0.14s, order 1 staggered to 0.19s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const dels = container.querySelectorAll("del");
    const inss = container.querySelectorAll("ins");
    expect(dels).toHaveLength(2);
    expect(inss).toHaveLength(2);
    expect(dels[0]?.textContent).toContain("young man");
    expect(inss[0]?.textContent).toContain("man in his late twenties, lean and tall");

    expect(screen.getByText("Adds the bracket and the build the check requires.")).toBeInTheDocument();
    expect(
      screen.getByText("Removes the brand name without changing the garment."),
    ).toBeInTheDocument();
  });

  it('renders an explicit "no fragment changed" line when the pass has no replacements', () => {
    render(<FragmentDiff pass={2} replacements={[]} onSelectSpan={vi.fn()} />);
    expect(screen.getByText("No fragments changed in this pass.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
