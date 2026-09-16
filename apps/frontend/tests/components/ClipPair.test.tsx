import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ComparisonView, RenderStatus, RenderView } from "@ai-director/contract";
import { ClipPair } from "../../src/components/ClipPair.js";

function renderView(side: "before" | "after", over: Partial<RenderView> = {}): RenderView {
  return {
    side,
    status: "succeeded",
    taskId: `task-${side}`,
    submittedAt: "2026-09-16T10:00:00.000Z",
    finishedAt: "2026-09-16T10:02:00.000Z",
    failureCode: null,
    failure: null,
    estimatedMicroUsd: 411_201,
    actualMicroUsd: 410_000,
    clipUrl: `/compare/cmp-1/${side}/clip`,
    description: side === "before" ? "The raw text." : "The repaired text.",
    prompt:
      side === "before"
        ? "SHOT WRAPPER\n\nThe raw text.\n\nTAIL"
        : "SHOT WRAPPER\n\nThe repaired text.\n\nTAIL",
    descriptionSha256: (side === "before" ? "a" : "b").repeat(64),
    rubricVersion: "v1",
    repairerPromptVersion: null,
    polls: 24,
    ...over,
  };
}

function comparison(over: Partial<ComparisonView> = {}): ComparisonView {
  return {
    comparisonId: "cmp-1",
    createdAt: "2026-09-16T10:00:00.000Z",
    finishedAt: "2026-09-16T10:02:00.000Z",
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    before: renderView("before"),
    after: renderView("after"),
    ...over,
  };
}

describe("ClipPair", () => {
  it("plays both clips from this server's own paths, never the vendor's", () => {
    render(<ClipPair comparison={comparison()} />);
    const players = screen.getAllByTestId("clip-player");
    expect(players).toHaveLength(2);
    expect(players[0]?.getAttribute("src")).toBe("/compare/cmp-1/before/clip");
    expect(players[1]?.getAttribute("src")).toBe("/compare/cmp-1/after/clip");
    for (const player of players) {
      expect(player.getAttribute("src")).not.toContain("openrouter.ai");
    }
  });

  it("shows each side's own description, and its hash, so the two are never confused", () => {
    render(<ClipPair comparison={comparison()} />);
    expect(screen.getByText("The raw text.")).toBeInTheDocument();
    expect(screen.getByText("The repaired text.")).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText(/bbbbbbbb/)).toBeInTheDocument();
  });

  it("states what is held identical between the two sides", () => {
    render(<ClipPair comparison={comparison()} />);
    const shared = screen.getByTestId("held-constant");
    expect(within(shared).getByText(/480x854/)).toBeInTheDocument();
    expect(within(shared).getByText(/4 s/)).toBeInTheDocument();
    expect(within(shared).getByText(/bytedance\/seedance-2\.5/)).toBeInTheDocument();
    expect(within(shared).getByText(/shot prompt v1/i)).toBeInTheDocument();
  });

  it("shows the estimate and the bill as two separate figures", () => {
    // Two different values on purpose: if the component ever rendered the estimate in the
    // billed slot, identical numbers would hide it.
    render(
      <ClipPair
        comparison={comparison({ before: renderView("before", { actualMicroUsd: 398_500 }) })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText(/estimated/i)).toBeInTheDocument();
    expect(within(before).getByText("$0.41")).toBeInTheDocument();
    expect(within(before).getByText(/billed/i)).toBeInTheDocument();
    expect(within(before).getByText("$0.40")).toBeInTheDocument();
  });

  it("says not measured rather than zero when the vendor reported no cost", () => {
    render(
      <ClipPair
        comparison={comparison({ before: renderView("before", { actualMicroUsd: null }) })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText("not measured")).toBeInTheDocument();
    expect(within(before).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("never shows a success state for a failed or cancelled render", () => {
    for (const status of ["failed", "cancelled"] as RenderStatus[]) {
      const { unmount } = render(
        <ClipPair
          comparison={comparison({
            before: renderView("before", {
              status,
              clipUrl: null,
              failure: "refused",
              failureCode: "CONTENT_POLICY",
            }),
          })}
        />,
      );
      const before = screen.getByTestId("render-before");
      expect(before.getAttribute("data-success")).toBeNull();
      expect(within(before).getByText(status)).toBeInTheDocument();
      expect(within(before).getByText(/refused/)).toBeInTheDocument();
      expect(within(before).queryByTestId("clip-player")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("reports a billed render whose clip could not be downloaded as both facts at once", () => {
    render(
      <ClipPair
        comparison={comparison({
          before: renderView("before", {
            status: "succeeded",
            clipUrl: null,
            failureCode: "CLIP_DOWNLOAD_FAILED",
            failure: "the render succeeded and was billed, but its clip could not be downloaded",
          }),
        })}
      />,
    );
    const before = screen.getByTestId("render-before");
    // Fact one: the money. The cost readout still reports a bill, because the render ran,
    // and it is a figure rather than "not measured".
    expect(within(before).getByText("Billed")).toBeInTheDocument();
    expect(within(before).queryByText("not measured")).not.toBeInTheDocument();
    // Fact two: the missing bytes, said plainly rather than folded into a failed status.
    expect(within(before).getByText(/could not be downloaded/)).toBeInTheDocument();
    expect(within(before).getByText("succeeded")).toBeInTheDocument();
    expect(within(before).queryByTestId("clip-player")).not.toBeInTheDocument();
  });

  it("reports progress as poll count, with no spinner and no progress bar", () => {
    const { container } = render(
      <ClipPair
        comparison={comparison({
          finishedAt: null,
          before: renderView("before", {
            status: "running",
            clipUrl: null,
            finishedAt: null,
            actualMicroUsd: null,
            polls: 7,
          }),
        })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText(/7 status reads/i)).toBeInTheDocument();
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(container.querySelector(".spinner")).toBeNull();
  });

  it("labels which prompt versions produced each side", () => {
    render(
      <ClipPair
        comparison={comparison({
          after: renderView("after", { repairerPromptVersion: "v2" }),
        })}
      />,
    );
    expect(within(screen.getByTestId("render-after")).getByText(/repairer v2/i)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("render-before")).getByText(/repairer version not recorded/i),
    ).toBeInTheDocument();
  });
});
