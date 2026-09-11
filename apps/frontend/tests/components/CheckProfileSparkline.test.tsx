import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CHECK_IDS, type CheckId, type Percent } from "@ai-director/contract";
import { CHECK_TITLES } from "../../src/domain/labels.js";
import { CheckProfileSparkline } from "../../src/components/CheckProfileSparkline.js";

const PROFILE: Record<CheckId, Percent> = {
  age_build: 80,
  face_skin: 80,
  hair_spec: 40,
  wardrobe: 60,
  anchor_marker: 100,
  no_real_person: 80,
  no_brand_name: 80,
  drawable_only: 60,
  no_cross_slot: 40,
};

describe("CheckProfileSparkline", () => {
  it("renders nine points in CHECK_IDS (rubric) order", () => {
    const { container } = render(<CheckProfileSparkline profile={PROFILE} />);
    const polyline = container.querySelector(".check-profile-sparkline__line");
    expect(polyline).not.toBeNull();
    const points = polyline?.getAttribute("points")?.trim().split(/\s+/) ?? [];
    expect(points).toHaveLength(CHECK_IDS.length);
  });

  it("draws the band-4 pass threshold as its own line", () => {
    const { container } = render(<CheckProfileSparkline profile={PROFILE} />);
    expect(container.querySelector(".check-profile-sparkline__threshold")).not.toBeNull();
  });

  it("renders an explicit 'not scored yet' state for a null profile, not a flat line at zero", () => {
    render(<CheckProfileSparkline profile={null} />);
    expect(screen.getByText(/not scored yet/i)).toBeInTheDocument();
  });

  it("exposes all nine values as accessible text, not only as an SVG shape", () => {
    const { container } = render(<CheckProfileSparkline profile={PROFILE} />);
    // Every check in rubric order must be readable as real text somewhere in the component, each
    // paired with its own percent — not conveyed by point position alone.
    for (const checkId of CHECK_IDS) {
      expect(container.textContent).toContain(`${CHECK_TITLES[checkId]} ${PROFILE[checkId]} percent`);
    }
  });
});
