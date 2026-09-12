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
   * FIXED DEFECT, originally found by this suite: a real (un-forced) click on a screen tab timed
   * out. Chromium's own actionability check reported why -- `<span aria-hidden="true"
   * class="pass-step__pill">` (motion/react's one `layoutId` shared element, in `PassStep.tsx`)
   * intercepted the pointer event at every point on the page, because it was absolutely
   * positioned with no positioned ancestor.
   *
   * Root cause, confirmed via `getComputedStyle`: `.pass-step` (`run-screen.css`) declared
   * `position: relative` and, a few lines later in the *same* rule, `all: unset` -- which resets
   * EVERY property, `position` included, back to its initial value. `all` reaches back over
   * earlier declarations in its own rule, not only the ones written after it, so the later
   * declaration won and `.pass-step` computed to `position: static`. `.pass-step__pill`'s
   * `position: absolute; inset: 0` then resolved against the viewport instead of the button:
   * measured at x:0, y:0, width:1280, height:720 -- covering the entire page, header included, at
   * all times (a pass is always "selected" from first paint, even before a run starts).
   *
   * Fix: `.pass-step` no longer uses `all: unset`; it resets only the specific button-chrome
   * properties it needs (`appearance`, `background`, `border`, `margin`, `font`, `text-align`),
   * so its own `position: relative` survives. This test is the regression guard for that fix: it
   * asserts real containment (the pill's box sits inside its own button's box, not merely "is
   * smaller than some arbitrary number"), then confirms the direct, user-facing consequence -- an
   * un-forced click on a real navigation tab now lands.
   */
  test("the pass-step pill stays inside its own button and a real tab click lands", async ({ page }) => {
    const passStep = page.locator('[data-testid="pass-step-1"]');
    const pill = passStep.locator(".pass-step__pill");
    await expect(pill).toBeVisible();

    const stepBox = await passStep.boundingBox();
    const pillBox = await pill.boundingBox();
    expect(stepBox).not.toBeNull();
    expect(pillBox).not.toBeNull();
    if (!stepBox || !pillBox) return; // narrowed for TypeScript; the two expects above already fail the test otherwise

    // Real containment: every edge of the pill's box lies within its own step button's box, not
    // merely "smaller than some arbitrary number" -- the shape of assertion that would have
    // caught the original defect (the pill measured the full 1280x720 viewport, nowhere near
    // "inside" a ~100px-tall rail button).
    const message = `pass-step ${JSON.stringify(stepBox)}, pill ${JSON.stringify(pillBox)}`;
    expect(pillBox.x, message).toBeGreaterThanOrEqual(stepBox.x);
    expect(pillBox.y, message).toBeGreaterThanOrEqual(stepBox.y);
    expect(pillBox.x + pillBox.width, message).toBeLessThanOrEqual(stepBox.x + stepBox.width);
    expect(pillBox.y + pillBox.height, message).toBeLessThanOrEqual(stepBox.y + stepBox.height);

    // The direct, user-facing consequence: an un-forced click on a real navigation tab lands.
    // Bounded to 3s (rather than the suite's 30s default): if the pill regresses to covering the
    // page, Chromium's actionability check will keep retrying and this fails on timeout rather
    // than hanging for the suite's full default.
    await page.getByRole("link", { name: "Architecture" }).click({ timeout: 3_000 });
    await expect(page.getByRole("heading", { name: "Architecture", level: 1 })).toBeVisible();
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

/**
 * FIXED DEFECT, found from a screenshot on 2026-09-12: the verdict banner was rendering inside the
 * pass rail, which is `--w-rail` (88px) wide, while `--fs-verdict` is 28px. `STILL FAILING` spilled
 * past the banner's border on both edges and the mandatory second line was clipped to
 * "asses used · me".
 *
 * That is not a cosmetic problem. Design doc §6.2 structural fact 2 requires the qualifying clause
 * "the description did not pass" to share a line with the improvement wording so that no truncation
 * can separate the two; a line clipped by its own container IS that truncation, arriving by a route
 * the rule did not anticipate. A reader seeing `rose 54 → 78` with the qualifier cut off reads a
 * failed run as a good one, which is the single thing this product may never do.
 *
 * Geometry, not screenshots: every child box must sit inside the banner's own box. jsdom cannot
 * answer this (no layout engine), and the 312 unit tests all run there.
 */
test.describe("the verdict banner never overflows its own border", () => {
  for (const scenario of ["passed", "improvedStillFailing", "noImprovement"] as const) {
    test(`${scenario}: word, numeral and second line all fit inside the banner`, async ({ page }) => {
      await gotoFixture(page, scenario);
      await page.getByLabel("Description").fill("A woman with short black hair and a grey wool coat.");
      await page.getByRole("button", { name: "Run", exact: true }).dispatchEvent("click");

      const banner = page.locator(".verdict-banner");
      await expect(banner).toBeVisible({ timeout: 15_000 });

      const bannerBox = await banner.boundingBox();
      expect(bannerBox).not.toBeNull();
      if (!bannerBox) return;

      for (const child of [".verdict-banner__word", ".verdict-banner__count", ".verdict-banner__detail"]) {
        const box = await banner.locator(child).boundingBox();
        expect(box, `${child} has no box`).not.toBeNull();
        if (!box) continue;
        // A one-pixel tolerance for sub-pixel rounding; a genuine overflow is tens of pixels.
        expect(box.x, `${child} overflows the banner's left edge`).toBeGreaterThanOrEqual(bannerBox.x - 1);
        expect(
          box.x + box.width,
          `${child} overflows the banner's right edge`,
        ).toBeLessThanOrEqual(bannerBox.x + bannerBox.width + 1);
      }
    });
  }

  /**
   * The other half of the same screenshot: `meanPercent` returns a raw float, so an unrounded mean
   * reached the line as `53.666666666666664`. §6.2's binding table writes every mean as a whole
   * number (`mean 88`, `mean rose 62 → 80`), and a 16-digit float is also what made the line long
   * enough to overflow in the first place.
   */
  test("the second line prints whole-number means, never raw floats", async ({ page }) => {
    await gotoFixture(page, "improvedStillFailing");
    await page.getByLabel("Description").fill("A woman with short black hair and a grey wool coat.");
    await page.getByRole("button", { name: "Run", exact: true }).dispatchEvent("click");

    const line = page.getByTestId("verdict-second-line");
    await expect(line).toBeVisible({ timeout: 15_000 });
    const text = await line.innerText();

    expect(text, `second line carried a fractional mean: ${text}`).not.toMatch(/\d\.\d/);
    expect(text).toMatch(/the description did not pass$/);
  });
});
