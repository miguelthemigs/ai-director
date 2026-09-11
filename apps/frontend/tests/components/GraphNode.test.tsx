import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PipelineNode } from "@ai-director/contract";
import { GraphNode } from "../../src/components/GraphNode.js";

function node(overrides: Partial<PipelineNode>): PipelineNode {
  return {
    id: "evaluator",
    label: "Evaluator",
    kind: "agent",
    state: "queued",
    ...overrides,
  };
}

describe("GraphNode", () => {
  it("renders a planned node as a plain element with a visible 'planned' label and the dashed treatment class, never a Motion component", () => {
    render(
      <GraphNode
        node={node({ id: "interrogator", label: "Interrogator", state: "planned" })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );

    const el = screen.getByTestId("node-interrogator");
    expect(el).toHaveTextContent(/planned/i);
    expect(el).toHaveClass("node--planned");
    // A Motion component renders its `style` prop as an inline `transform`/`opacity` even when
    // idle; a plain element carries none of that, which is how we tell them apart from outside.
    expect(el).not.toHaveAttribute("style");
    expect(el.tagName).toBe("BUTTON");
  });

  it("renders a running node's elapsed-seconds counter and progress value as text", () => {
    render(
      <GraphNode
        node={node({
          state: "running",
          startedAt: new Date(Date.now() - 5000).toISOString(),
          progress: 2 / 3,
        })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );

    const el = screen.getByTestId("node-evaluator");
    expect(el).toHaveTextContent(/\d+s/);
    expect(el).toHaveTextContent("67%");
  });

  it("gives every state a visible text label, never colour alone", () => {
    for (const state of ["queued", "running", "done", "failed"] as const) {
      const { unmount } = render(
        <GraphNode node={node({ state, startedAt: new Date().toISOString() })} selected={false} onSelect={vi.fn()} />,
      );
      expect(screen.getByTestId("node-evaluator")).toHaveTextContent(state);
      unmount();
    }
  });

  it("calls onSelect with the node id when clicked, including a planned node", () => {
    const onSelect = vi.fn();
    render(<GraphNode node={node({ id: "director", state: "planned" })} selected={false} onSelect={onSelect} />);
    screen.getByTestId("node-director").click();
    expect(onSelect).toHaveBeenCalledWith("director");
  });
});
