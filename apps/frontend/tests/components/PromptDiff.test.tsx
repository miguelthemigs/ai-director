import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromptDiff } from "../../src/components/PromptDiff.js";

describe("PromptDiff", () => {
  it("renders explicit text, not a blank panel, when there is no prior version to compare against", () => {
    render(<PromptDiff lines={[]} title="rubric: v1 → v1" sameVersion />);
    expect(screen.getByText(/no prior version to compare against/i)).toBeInTheDocument();
  });

  it("renders different explicit text when two distinct versions were compared and matched exactly", () => {
    render(<PromptDiff lines={[]} title="rubric: v1 → v2" sameVersion={false} />);
    expect(screen.getByText(/no differences between these versions/i)).toBeInTheDocument();
    expect(screen.queryByText(/no prior version to compare against/i)).not.toBeInTheDocument();
  });

  it("defaults to the 'no differences' reading when the caller does not say the versions are the same", () => {
    render(<PromptDiff lines={[]} title="rubric: v1 → v2" />);
    expect(screen.getByText(/no differences between these versions/i)).toBeInTheDocument();
  });

  it("renders the real diff lines, not an empty-state message, when there is a difference", () => {
    render(
      <PromptDiff
        lines={[
          { kind: "same", text: "unchanged line" },
          { kind: "removed", text: "old line" },
          { kind: "added", text: "new line" },
        ]}
        title="rubric: v1 → v2"
      />,
    );
    expect(screen.getByText("old line")).toBeInTheDocument();
    expect(screen.getByText("new line")).toBeInTheDocument();
    expect(screen.queryByText(/no differences between these versions/i)).not.toBeInTheDocument();
  });
});
