import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FIXTURE_EVENT_LOG, PIPELINE_NODES, type RunEvent } from "@ai-director/contract";
import { ArchitectureScreen } from "../../src/screens/ArchitectureScreen.js";

const PLANNED_IDS = ["interrogator", "director", "identity"];

/** Every event through the end of pass 1 (index 10, `pass.completed`), leaving the run mid-flight
 *  rather than terminal — enough to exercise a `done` evaluator, a `done` verify with real span
 *  counts, and a `done` repairer with real cost, while intake has run.started's payload and gate
 *  has just made its first decision. */
const THROUGH_PASS_1: RunEvent[] = FIXTURE_EVENT_LOG.slice(0, 11);

function renderScreen(events: RunEvent[]) {
  return render(<ArchitectureScreen run={null} status="streaming" events={events} error={null} />);
}

describe("ArchitectureScreen", () => {
  it("renders all nine pipeline nodes", () => {
    renderScreen([]);
    for (const node of PIPELINE_NODES) {
      expect(screen.getByTestId(`node-${node.id}`)).toBeInTheDocument();
    }
  });

  it("labels the three planned nodes as planned and gives them the dashed treatment class", () => {
    renderScreen([]);
    for (const id of PLANNED_IDS) {
      const el = screen.getByTestId(`node-${id}`);
      expect(el).toHaveTextContent(/planned/i);
      expect(el).toHaveClass("node--planned");
    }
  });

  it("opens the inspector with a node's real payload, latency and cost when clicked", () => {
    renderScreen(THROUGH_PASS_1);
    fireEvent.click(screen.getByTestId("node-evaluator"));

    const dialog = screen.getByRole("dialog");
    // Real, measured tokens/cost from the fixture's `groupCompleted` cost, summed over the three
    // real group calls (3 x {inputTokens: 1100, outputTokens: 600, usd: 0.02}) — never a
    // fabricated number.
    expect(within(dialog).getByText("3,300 tok")).toBeInTheDocument();
    expect(within(dialog).getByText("1,800 tok")).toBeInTheDocument();
    expect(within(dialog).getByText(/\$0\.0[0-9]{3}/)).toBeInTheDocument();
    expect(within(dialog).getByText(/\d+\.\d\d s/)).toBeInTheDocument();
  });

  it("shows 'not measured' for a node with no cost yet, never a fabricated $0.00", () => {
    renderScreen(THROUGH_PASS_1);
    fireEvent.click(screen.getByTestId("node-intake"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("not measured").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("dismisses the inspector with Escape and returns focus to the node that opened it", () => {
    renderScreen(THROUGH_PASS_1);
    const trigger = screen.getByTestId("node-evaluator");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
