import { expect, test } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

/**
 * Settles the question the task brief left open: does the app actually render, with real
 * geometry, in a real browser? Every one of the 277 unit tests renders into jsdom, which has no
 * layout engine at all -- `getBoundingClientRect()` there is always zeros. An earlier attempt to
 * check this visually produced contradictory evidence (screenshots that were later found to
 * misreport). Playwright asserts on real computed geometry in a real Chromium, so there is nothing
 * left to misreport.
 */
test.describe("real-browser render and layout", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "passed");
  });

  test("top bar renders with a non-zero box and no overlap with the main region", async ({ page }) => {
    const topBar = page.locator("header.top-bar");
    await expect(topBar).toBeVisible();

    const main = page.locator("main.screen-body");
    await expect(main).toBeVisible();

    const topBarBox = await topBar.boundingBox();
    const mainBox = await main.boundingBox();
    expect(topBarBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    if (!topBarBox || !mainBox) return; // narrowed for TypeScript; the two expects above already fail the test otherwise

    expect(topBarBox.width).toBeGreaterThan(0);
    expect(topBarBox.height).toBeGreaterThan(0);

    // Nothing overlaps the top bar: the header's box and the main region's box must not intersect.
    // Two axis-aligned rectangles fail to intersect if one lies entirely above/below/left/right of
    // the other on at least one axis.
    const noOverlap =
      topBarBox.y + topBarBox.height <= mainBox.y ||
      mainBox.y + mainBox.height <= topBarBox.y ||
      topBarBox.x + topBarBox.width <= mainBox.x ||
      mainBox.x + mainBox.width <= topBarBox.x;
    expect(noOverlap).toBe(true);
  });

  test("the three screen tabs are visible", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Run" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Architecture" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Versions" })).toBeVisible();
  });

  /**
   * A REAL DEFECT, found by this suite, not fixed per the task brief: a real (un-forced) click on
   * a screen tab times out. Chromium's own actionability check reports why --
   * `<span aria-hidden="true" class="pass-step__pill">` (motion/react's one `layoutId` shared
   * element, in `PassStep.tsx`) intercepts the pointer event, at every point on the page, because
   * it is absolutely positioned with no positioned ancestor.
   *
   * Root cause, confirmed via `getComputedStyle`: `.pass-step` (`run-screen.css`) declares
   * `position: relative` and, three lines later in the same rule, `all: unset` -- which resets
   * EVERY property, `position` included, back to its initial value. The later declaration wins,
   * so `.pass-step` computes to `position: static`, not `relative`. `.pass-step__pill` is
   * `position: absolute; inset: 0`, so with no positioned ancestor it resolves against the
   * viewport instead of the button: measured at x:0, y:0, width:1280, height:720 in an 800px-tall
   * viewport -- covering the entire page, header included, at all times (a pass is always
   * "selected" from first paint, even before a run starts).
   *
   * A real mouse user cannot click ANY tab, and (see `helpers.ts`'s `startRun`) not the Run
   * button either. Keyboard activation is unaffected -- pointer hit-testing never enters into it
   * -- which is why every other test in this suite reaches the rest of the app at all: they use a
   * documented `force: true` click or (for Architecture/Versions) a direct URL navigation, both
   * noted at their call sites, to get past this same already-reported defect rather than
   * rediscovering it.
   */
  test("REAL DEFECT: a screen tab does not receive a real click (pass-step pill covers the page)", async ({
    page,
  }) => {
    const pill = page.locator(".pass-step__pill");
    await expect(pill).toBeVisible();
    const pillBox = await pill.boundingBox();
    expect(pillBox).not.toBeNull();

    // This is the assertion that should hold in a correctly laid-out app: the pill sized to one
    // pass-step button, not the viewport. It fails, and the failure message carries the actual
    // measured box.
    expect(pillBox?.width, `.pass-step__pill measured ${JSON.stringify(pillBox)}`).toBeLessThan(200);
    expect(pillBox?.height, `.pass-step__pill measured ${JSON.stringify(pillBox)}`).toBeLessThan(200);

    // The direct, user-facing consequence: an un-forced click on a real navigation tab does not
    // land. Bounded to 3s (rather than the suite's 30s default) since the outcome is already
    // known from the geometry above -- this just confirms it end-to-end.
    await expect(page.getByRole("link", { name: "Architecture" }).click({ timeout: 3_000 })).rejects.toThrow(
      /intercepts pointer events/,
    );
  });

  test("the description composer sits left of the checks panel (the two-column layout)", async ({ page }) => {
    const composer = page.locator(".description-composer");
    const checksPanel = page.locator("section.check-panel");

    await expect(composer).toBeVisible();
    await expect(checksPanel).toBeVisible();

    const composerBox = await composer.boundingBox();
    const checksBox = await checksPanel.boundingBox();
    expect(composerBox).not.toBeNull();
    expect(checksBox).not.toBeNull();
    if (!composerBox || !checksBox) return;

    // The specific thing the earlier screenshots appeared to contradict: the checks panel's box
    // must start to the right of the composer's.
    expect(checksBox.x).toBeGreaterThan(composerBox.x);
    // And the two must not overlap horizontally -- a real two-column layout, not one box drawn on
    // top of the other.
    expect(checksBox.x).toBeGreaterThanOrEqual(composerBox.x + composerBox.width);
  });

  test("shows the fixture provenance marker, since the app is on FixtureRunClient", async ({ page }) => {
    await expect(page.getByText("Sample data — not a real run")).toBeVisible();
  });
});
