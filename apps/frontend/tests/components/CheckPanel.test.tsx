import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CheckResultView } from "@ai-director/contract";
import { CheckPanel } from "../../src/components/CheckPanel.js";

/** `CheckPanel` is controlled: `n`/`p` compute the next span from the `activeSpanId` prop it is
 *  given, so exercising two presses in a row needs a harness that actually feeds the callback's
 *  spanId back in as the next prop — a bare mock would leave `activeSpanId` frozen at `null`. */
function ControlledCheckPanel({
  results,
  selectedCheckId,
  onSelectSpan,
}: {
  results: CheckResultView[];
  selectedCheckId: CheckResultView["checkId"];
  onSelectSpan: (spanId: string) => void;
}): React.JSX.Element {
  const [activeSpanId, setActiveSpanId] = useState<string | null>(null);
  return (
    <CheckPanel
      results={results}
      selectedCheckId={selectedCheckId}
      onSelectCheck={() => {}}
      streaming={false}
      activeSpanId={activeSpanId}
      onSelectSpan={(spanId) => {
        setActiveSpanId(spanId);
        onSelectSpan(spanId);
      }}
    />
  );
}

const RESULTS: CheckResultView[] = [
  {
    status: "scored",
    checkId: "age_build",
    group: "look",
    band: 1,
    percent: 20,
    passed: false,
    reason: "No bracket and no build.",
    spans: [
      { spanId: "age_build-0", checkId: "age_build", quote: "young", start: 0, end: 5 },
      { spanId: "age_build-1", checkId: "age_build", quote: "man", start: 6, end: 9 },
    ],
    unverified: [],
    missingEvidence: false,
  },
];

describe("CheckPanel keyboard: n/p cycles a check's own fragments", () => {
  it("moves the active span forward with n and back with p, wrapping at the ends", () => {
    const onSelectSpan = vi.fn();
    render(<ControlledCheckPanel results={RESULTS} selectedCheckId="age_build" onSelectSpan={onSelectSpan} />);

    const listbox = screen.getByRole("listbox", { name: /checks/i });

    fireEvent.keyDown(listbox, { key: "n" });
    expect(onSelectSpan).toHaveBeenLastCalledWith("age_build-0");

    fireEvent.keyDown(listbox, { key: "p" });
    expect(onSelectSpan).toHaveBeenLastCalledWith("age_build-1");
  });

  it("does nothing for a check with no spans", () => {
    const onSelectSpan = vi.fn();
    const noSpanResults: CheckResultView[] = [
      {
        status: "scored",
        checkId: "no_brand_name",
        group: "safety",
        band: 1,
        percent: 20,
        passed: false,
        reason: "Names a brand.",
        spans: [],
        unverified: [],
        missingEvidence: false,
      },
    ];
    render(
      <CheckPanel
        results={noSpanResults}
        selectedCheckId="no_brand_name"
        onSelectCheck={vi.fn()}
        streaming={false}
        activeSpanId={null}
        onSelectSpan={onSelectSpan}
      />,
    );

    fireEvent.keyDown(screen.getByRole("listbox", { name: /checks/i }), { key: "n" });
    expect(onSelectSpan).not.toHaveBeenCalled();
  });
});
