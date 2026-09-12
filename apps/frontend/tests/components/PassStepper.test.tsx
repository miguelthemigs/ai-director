import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PassStepper } from "../../src/components/PassStepper.js";

describe("PassStepper", () => {
  it("always shows three steps, marking the unreached ones as not yet run", () => {
    render(
      <PassStepper
        passes={[{ pass: 1, changedCount: 2 }]}
        selected={1}
        onSelect={vi.fn()}
        terminal={null}
        streaming
      />,
    );

    expect(screen.getByTestId("pass-step-1")).toBeInTheDocument();
    expect(screen.getByTestId("pass-step-2")).toHaveAttribute("data-state", "empty");
    expect(screen.getByTestId("pass-step-3")).toHaveAttribute("data-state", "empty");
    expect(screen.getAllByText("not yet run")).toHaveLength(2);
  });

  it("marks the currently viewed step with aria-current=step", () => {
    render(
      <PassStepper
        passes={[
          { pass: 1, changedCount: 2 },
          { pass: 2, changedCount: 1 },
        ]}
        selected={2}
        onSelect={vi.fn()}
        terminal={null}
        streaming
      />,
    );

    expect(screen.getByTestId("pass-step-2")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("pass-step-1")).not.toHaveAttribute("aria-current");
  });

  it("moves the selection with the arrow keys", () => {
    const onSelect = vi.fn();
    render(
      <PassStepper
        passes={[
          { pass: 1, changedCount: 2 },
          { pass: 2, changedCount: 1 },
        ]}
        selected={1}
        onSelect={onSelect}
        terminal={null}
        streaming
      />,
    );

    fireEvent.keyDown(screen.getByRole("navigation", { name: /repair passes/i }), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(2);

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("navigation", { name: /repair passes/i }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("renders the cross-bar terminator on the final step of a failed run, not a closed frame", () => {
    render(
      <PassStepper
        passes={[
          { pass: 1, changedCount: 2 },
          { pass: 2, changedCount: 1 },
        ]}
        selected={2}
        onSelect={vi.fn()}
        terminal="improved_still_failing"
        streaming={false}
      />,
    );

    expect(screen.getByTestId("pass-step-2")).toHaveAttribute("data-state", "terminated");
    expect(screen.getByTestId("pass-step-1")).toHaveAttribute("data-state", "done");
  });

  it("closes the final frame plainly when the run passed", () => {
    render(
      <PassStepper
        passes={[{ pass: 1, changedCount: 0 }]}
        selected={1}
        onSelect={vi.fn()}
        terminal="passed"
        streaming={false}
      />,
    );

    expect(screen.getByTestId("pass-step-1")).toHaveAttribute("data-state", "done");
  });
});
