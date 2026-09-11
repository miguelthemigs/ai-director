/**
 * Shown in the shared chrome, on all three screens, only while `RunClient.isFixture` is true (fix
 * round 1, task 16). A screenshot of this product's own version history could otherwise be read as
 * evidence of a research feedback cycle that has not happened — the `kappa` fields are honestly
 * null, but a synthesized `why` narrative is not itself a number a reader can spot as invented. A
 * code comment only protects a reader of the source; this protects a reader of a screenshot.
 *
 * Not a live region: design doc §7 reserves `role="status"`/`role="alert"` for `LiveAnnouncer`
 * alone. Not the alarm palette either — this is a provenance notice, not a failure.
 */
export function FixtureNotice(): React.JSX.Element {
  return <span className="fixture-notice">Sample data — not a real run</span>;
}
