import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RunSummary } from "@ai-director/contract";
import { RunHistory } from "../../src/components/RunHistory.js";
import type { RunClient } from "../../src/data/RunClient.js";

/**
 * Every run this tool has ever done is on disk. Until this list existed there was no way
 * back to one: the run id lived in React state and nowhere else, so closing the laptop --
 * or any reload -- left a finished run's results unreachable even though its files were
 * untouched. The point of the list is that the evidence is reachable, not that it is tidy.
 */

const summaries: RunSummary[] = [
  {
    runId: "run-newest",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "improved_still_failing",
    startedAt: "2026-09-12T09:12:58.800Z",
    finishedAt: "2026-09-12T09:13:31.270Z",
    passes: 3,
  },
  {
    runId: "run-older",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "passed",
    startedAt: "2026-09-11T20:47:00.985Z",
    finishedAt: "2026-09-11T20:47:43.168Z",
    passes: 3,
  },
];

function stubClient(overrides: Partial<RunClient> = {}): RunClient {
  return {
    isFixture: false,
    startRun: vi.fn(),
    getRun: vi.fn(),
    listRuns: vi.fn().mockResolvedValue(summaries),
    subscribe: vi.fn(),
    listVersions: vi.fn(),
    compareVersions: vi.fn(),
    ...overrides,
  } as unknown as RunClient;
}

describe("RunHistory", () => {
  it("lists past runs with the verdict each one actually reached", async () => {
    render(<RunHistory client={stubClient()} openRunId={null} onOpen={vi.fn()} />);

    expect(await screen.findByText("2 runs")).toBeInTheDocument();
    // The failing run must never borrow the passing run's word.
    expect(screen.getByText("STILL FAILING")).toBeInTheDocument();
    expect(screen.getByText("PASSED")).toBeInTheDocument();
  });

  it("hands up the run the user picked", async () => {
    const onOpen = vi.fn();
    render(<RunHistory client={stubClient()} openRunId={null} onOpen={onOpen} />);

    fireEvent.click(await screen.findByRole("button", { name: /STILL FAILING/ }));
    expect(onOpen).toHaveBeenCalledWith("run-newest");
  });

  it("says where runs are kept when there are none, rather than showing nothing", async () => {
    render(
      <RunHistory
        client={stubClient({ listRuns: vi.fn().mockResolvedValue([]) })}
        openRunId={null}
        onOpen={vi.fn()}
      />,
    );
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
  });

  it("says so when the list could not be loaded, instead of looking empty", async () => {
    render(
      <RunHistory
        client={stubClient({ listRuns: vi.fn().mockRejectedValue(new Error("backend is down")) })}
        openRunId={null}
        onOpen={vi.fn()}
      />,
    );
    // An empty list and an unreachable backend are different facts, and a history that
    // reports the second as the first is the same silent-loss bug this list exists to fix.
    expect(await screen.findByText(/backend is down/)).toBeInTheDocument();
  });

  it("marks which run is currently open", async () => {
    render(<RunHistory client={stubClient()} openRunId="run-older" onOpen={vi.fn()} />);
    const open = await screen.findByRole("button", { name: /PASSED/ });
    await waitFor(() => expect(open).toHaveAttribute("data-open", "true"));
  });
});
