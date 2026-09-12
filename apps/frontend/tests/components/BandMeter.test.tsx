import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BandMeter } from "../../src/components/BandMeter.js";

describe("BandMeter", () => {
  it("exposes the accessibility contract §7 requires: role, value range, and printed percentage", () => {
    render(<BandMeter band={4} percent={80} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "80");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("renders the band's stroke pattern via BandMark, not colour alone", () => {
    render(<BandMeter band={4} percent={80} />);
    expect(screen.getByRole("img", { name: /band 4 stroke pattern/i })).toBeInTheDocument();
  });

  it("distinguishes the pass threshold in the DOM: band 4 and band 3 differ in data-band", () => {
    const { rerender } = render(<BandMeter band={3} percent={60} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("data-band", "3");

    rerender(<BandMeter band={4} percent={80} />);
    expect(screen.getByRole("meter")).toHaveAttribute("data-band", "4");
  });
});
