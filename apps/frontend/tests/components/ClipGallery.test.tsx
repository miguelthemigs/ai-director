import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClipSummary } from "@ai-director/contract";
import { ClipGallery } from "../../src/components/ClipGallery.js";

function clip(over: Partial<ClipSummary> = {}): ClipSummary {
  return {
    comparisonId: "803eadc3-f737-4d3c",
    side: "before",
    createdAt: "2026-09-18T14:51:01.200Z",
    clipUrl: "/compare/803eadc3-f737-4d3c/before/clip",
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    repairerPromptVersion: null,
    description: "A young man with wavy brown hair.",
    actualMicroUsd: 415_481,
    ...over,
  };
}

const PAIR = [
  clip(),
  clip({
    side: "after",
    clipUrl: "/compare/803eadc3-f737-4d3c/after/clip",
    repairerPromptVersion: "v2",
    description: "A young man with medium-length wavy brown hair.",
  }),
];

describe("ClipGallery", () => {
  it("plays every clip from this server's own path, never the vendor's", () => {
    render(<ClipGallery clips={PAIR} onOpenPair={vi.fn()} />);
    const players = screen.getAllByTestId("gallery-clip");
    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.getAttribute("src")).toContain("/compare/");
      expect(player.getAttribute("src")).not.toContain("openrouter.ai");
    }
  });

  it("never autoplays or loops, because a wall of moving video is ambient motion", () => {
    const { container } = render(<ClipGallery clips={PAIR} onOpenPair={vi.fn()} />);
    for (const video of container.querySelectorAll("video")) {
      expect(video.hasAttribute("autoplay")).toBe(false);
      expect(video.hasAttribute("loop")).toBe(false);
    }
  });

  it("labels which side and which repairer each clip came from", () => {
    render(<ClipGallery clips={PAIR} onOpenPair={vi.fn()} />);
    expect(screen.getByText(/before the passes/i)).toBeInTheDocument();
    expect(screen.getByText(/after the passes/i)).toBeInTheDocument();
    expect(screen.getByText("repairer v2")).toBeInTheDocument();
    // Never guessed as v1: the run predates the record and says so.
    expect(screen.getByText(/repairer not recorded/i)).toBeInTheDocument();
  });

  it("shows the text each clip was rendered from, so two faces can be checked against one prompt", () => {
    render(<ClipGallery clips={PAIR} onOpenPair={vi.fn()} />);
    expect(screen.getByText("A young man with wavy brown hair.")).toBeInTheDocument();
    expect(
      screen.getByText("A young man with medium-length wavy brown hair."),
    ).toBeInTheDocument();
  });

  it("filters to one side, which is how five renders of one prompt get read together", async () => {
    const user = userEvent.setup();
    const five = Array.from({ length: 5 }, (_, i) =>
      clip({ comparisonId: `pair-${i}`, clipUrl: `/compare/pair-${i}/before/clip` }),
    ).concat(
      Array.from({ length: 5 }, (_, i) =>
        clip({ comparisonId: `pair-${i}`, side: "after", clipUrl: `/compare/pair-${i}/after/clip` }),
      ),
    );
    render(<ClipGallery clips={five} onOpenPair={vi.fn()} />);
    expect(screen.getAllByTestId("gallery-clip")).toHaveLength(10);

    await user.click(screen.getByRole("button", { name: /before only/i }));
    expect(screen.getAllByTestId("gallery-clip")).toHaveLength(5);
    expect(screen.getByText(/5 of 10 clips/)).toBeInTheDocument();
  });

  it("totals what was billed, and says so when a clip reported nothing", () => {
    render(
      <ClipGallery clips={[clip(), clip({ side: "after", actualMicroUsd: null })]} onOpenPair={vi.fn()} />,
    );
    // Only the reporting clip is in the total, and the wording does not claim it is the
    // whole bill.
    // Scoped to the summary line: $0.42 also appears on the tile of the clip that reported
    // it, and matching either one would have passed for the wrong reason.
    const total = screen.getByText(/billed across the clips that reported one/i);
    expect(total).toHaveTextContent("$0.42");
    // The tile that reported nothing says not measured rather than showing a zero.
    expect(screen.getByText(/480x854 · 4s · not measured/)).toBeInTheDocument();
  });

  it("opens the pair a clip belongs to", async () => {
    const onOpenPair = vi.fn();
    const user = userEvent.setup();
    render(<ClipGallery clips={PAIR} onOpenPair={onOpenPair} />);
    await user.click(screen.getAllByRole("button", { name: /open pair/i })[0]!);
    expect(onOpenPair).toHaveBeenCalledWith("803eadc3-f737-4d3c");
  });

  it("says so plainly when nothing has been rendered", () => {
    render(<ClipGallery clips={[]} onOpenPair={vi.fn()} />);
    expect(screen.getByText(/no clips rendered yet/i)).toBeInTheDocument();
  });
});
