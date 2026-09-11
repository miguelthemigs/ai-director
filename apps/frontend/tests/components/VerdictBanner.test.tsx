import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictBanner } from "../../src/components/VerdictBanner.js";

const FORBIDDEN = [/\bcomplete\b/i, /\bsuccess\b/i, /\bdone\b/i, /\bfinished\b/i, /✓/, /✔/];

describe("VerdictBanner", () => {
  it("says PASSED and counts the checks at band 4 or above when the run passed", () => {
    render(<VerdictBanner status="passed" failingCount={0} passesUsed={1} meanBefore={88} meanAfter={88} />);
    expect(screen.getByText("PASSED")).toBeInTheDocument();
    expect(screen.getByText(/of 9 checks at band 4 or above/i)).toBeInTheDocument();
  });

  it.each(["improved_still_failing", "no_improvement"] as const)(
    "never uses a success word or glyph for %s",
    (status) => {
      const { container } = render(
        <VerdictBanner status={status} failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />,
      );
      for (const pattern of FORBIDDEN) {
        expect(container.textContent ?? "").not.toMatch(pattern);
      }
    },
  );

  it("makes the failing count the headline numeral, not the score", () => {
    render(<VerdictBanner status="improved_still_failing" failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />);
    expect(screen.getByTestId("verdict-numeral")).toHaveTextContent("3");
  });

  it("never renders the word improved without its qualifier on the same line", () => {
    render(<VerdictBanner status="improved_still_failing" failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />);
    const line = screen.getByTestId("verdict-second-line").textContent ?? "";
    if (/improved|rose/i.test(line)) {
      expect(line).toMatch(/did not pass/i);
    }
  });

  it("says STILL FAILING and NO IMPROVEMENT in the words the design table fixes", () => {
    const { rerender } = render(<VerdictBanner status="improved_still_failing" failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />);
    expect(screen.getByText("STILL FAILING")).toBeInTheDocument();
    rerender(<VerdictBanner status="no_improvement" failingCount={5} passesUsed={3} meanBefore={62} meanAfter={62} />);
    expect(screen.getByText("NO IMPROVEMENT")).toBeInTheDocument();
  });

  it("uses no band-4 or band-5 token on either failing state", () => {
    const { container } = render(<VerdictBanner status="no_improvement" failingCount={5} passesUsed={3} meanBefore={62} meanAfter={62} />);
    expect(container.innerHTML).not.toMatch(/--band-4|--band-5|--diff-add/);
  });
});
