import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgreementReadout } from "../../src/components/AgreementReadout.js";

describe("AgreementReadout", () => {
  it("says the number is not measured when kappa is null, rather than showing a zero", () => {
    const { container } = render(<AgreementReadout kappa={null} goldSetSize={null} />);
    expect(screen.getByText(/not measured/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b0(\.0+)?\b/);
  });

  it("shows the kappa and the sample size it came from when it is measured", () => {
    render(<AgreementReadout kappa={0.62} goldSetSize={40} />);
    expect(screen.getByText(/0\.62/)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
  });

  it("never shows a kappa without the sample size it was computed from", () => {
    render(<AgreementReadout kappa={0.62} goldSetSize={null} />);
    expect(screen.getByText(/sample size not recorded/i)).toBeInTheDocument();
  });
});
