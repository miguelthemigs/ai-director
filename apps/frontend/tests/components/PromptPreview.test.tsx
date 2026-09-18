import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PromptPreview, type ComparisonPreview } from "../../src/components/PromptPreview.js";

const BEFORE = "A young man with wavy brown hair.";
const AFTER = "A young man with medium-length wavy brown hair.";
const WRAP = (d: string) => `SHOT WRAPPER\n\nThe person:\n${d}\n\nThe camera does not move.`;

function preview(over: Partial<ComparisonPreview> = {}): ComparisonPreview {
  return {
    sources: {
      before: { description: BEFORE, descriptionSha256: "a".repeat(64), prompt: WRAP(BEFORE) },
      after: { description: AFTER, descriptionSha256: "b".repeat(64), prompt: WRAP(AFTER) },
    },
    rubricVersion: "v1",
    repairerPromptVersion: "v2",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    ...over,
  };
}

describe("PromptPreview", () => {
  it("prints both prompts in full, so the claim can be checked by reading", () => {
    render(<PromptPreview preview={preview()} />);
    const before = screen.getByTestId("preview-before");
    const after = screen.getByTestId("preview-after");

    expect(within(before).getByText(/SHOT WRAPPER/)).toBeInTheDocument();
    expect(within(after).getByText(/SHOT WRAPPER/)).toBeInTheDocument();
    expect(within(before).getByText(BEFORE)).toBeInTheDocument();
    expect(within(after).getByText(AFTER)).toBeInTheDocument();
  });

  it("marks the one variable inside each prompt", () => {
    const { container } = render(<PromptPreview preview={preview()} />);
    const marks = container.querySelectorAll("mark.preview__inserted");
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe(BEFORE);
    expect(marks[1]?.textContent).toBe(AFTER);
  });

  it("says the two requests match apart from the description when they do", () => {
    render(<PromptPreview preview={preview()} />);
    expect(screen.getByText(/same text apart from the description/i)).toBeInTheDocument();
  });

  it("warns loudly when the wrapper differs, because then it compares two variables", () => {
    render(
      <PromptPreview
        preview={preview({
          sources: {
            before: { description: BEFORE, descriptionSha256: "a".repeat(64), prompt: WRAP(BEFORE) },
            after: {
              description: AFTER,
              descriptionSha256: "b".repeat(64),
              prompt: `A DIFFERENT WRAPPER\n\n${AFTER}`,
            },
          },
        })}
      />,
    );
    expect(screen.getByText(/would not compare one variable/i)).toBeInTheDocument();
  });

  it("shows which words the Repairer changed rather than asserting that it did", () => {
    const { container } = render(<PromptPreview preview={preview()} />);
    const diff = screen.getByTestId("description-diff");
    expect(within(diff).getByText(/repairer v2/i)).toBeInTheDocument();
    const added = [...container.querySelectorAll('[data-testid="description-diff"] [data-kind="added"]')]
      .map((s) => s.textContent?.trim())
      .filter(Boolean);
    expect(added).toContain("medium-length");
  });

  it("refuses to imply a comparison when the repairer changed nothing", () => {
    render(
      <PromptPreview
        preview={preview({
          sources: {
            before: { description: BEFORE, descriptionSha256: "a".repeat(64), prompt: WRAP(BEFORE) },
            after: { description: BEFORE, descriptionSha256: "a".repeat(64), prompt: WRAP(BEFORE) },
          },
        })}
      />,
    );
    expect(screen.getByText(/pay twice for one clip/i)).toBeInTheDocument();
  });

  it("says the version is not recorded rather than guessing v1", () => {
    render(<PromptPreview preview={preview({ repairerPromptVersion: null })} />);
    expect(screen.getByText(/repairer version not recorded/i)).toBeInTheDocument();
  });
});
