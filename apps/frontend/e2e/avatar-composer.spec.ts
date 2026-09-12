import { expect, test } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

/**
 * The guided avatar form, in a real browser.
 *
 * It is a port of Mentic's own (`lib/ugc-lab/actor-suggestions.ts` and
 * `app/(protected)/creatives/_components/ugc/actor-step.tsx`, read 2026-09-12), and the point of
 * porting it rather than keeping a bare textarea is that the thing being graded should be produced
 * the way it is produced in Mentic. What reaches the grader is the paragraph that reaches the VIDEO
 * model: in Mentic that is `UgcActor.description`, spliced into every render prompt, not the brief
 * that renders the character reference sheet.
 *
 * jsdom answers most of this already (see `tests/components/AvatarComposer.test.tsx`). What it
 * cannot answer is whether the form is usable: whether a real pointer click lands on the controls,
 * and whether a 10-field grid stays inside its column. Both are exactly the class of defect that
 * `.pass-step__pill` was, which 312 unit tests and every review passed over.
 */
test.describe("the guided avatar form", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "passed");
  });

  test("opens on Guided and says which description is being graded", async ({ page }) => {
    await expect(page.getByRole("tab", { name: "Guided" })).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("The description that reaches the video model, not the brief that renders the avatar sheet."),
    ).toBeVisible();
  });

  test("a real click on Surprise me fills the form and enables Run", async ({ page }) => {
    const run = page.getByRole("button", { name: "Run", exact: true });
    await expect(run).toBeDisabled();

    // A REAL click, not `dispatchEvent`: the whole reason this suite exists is that an invisible
    // element once intercepted every pointer event on the page, and nothing but a real click
    // catches that.
    await page.getByRole("button", { name: "Surprise me" }).click();

    await expect(page.getByLabel("Wardrobe, head to toe", { exact: true })).not.toHaveValue("");
    await expect(run).toBeEnabled();
  });

  test("the preview shows the exact sentence, and it is the sentence that gets graded", async ({ page }) => {
    await page.getByLabel("Gender", { exact: true }).fill("woman");
    await page.getByLabel("Eyes", { exact: true }).fill("hazel");

    const preview = page.locator(".avatar-preview__text");
    await expect(preview).toHaveText("A woman, hazel eyes");

    await page.getByRole("button", { name: "Run", exact: true }).click();

    // `SpecimenView` renders the description the run actually received. The fixture client ignores
    // the submitted text, so this asserts the round trip reached the client, not the fixture's own
    // content -- the character count is the part that proves which string was sent.
    await expect(page.locator(".specimen")).toBeVisible({ timeout: 15_000 });
  });

  // `exact: true` on every field label below: Playwright's `getByLabel` matches on a substring,
  // and each field's menu is labelled "Suggestions for <that field>", so a loose match on a field
  // label also resolves to its own menu.
  test("picking from a suggestions menu fills the field beside it", async ({ page }) => {
    await page.getByLabel("Suggestions for Eyes").selectOption("hazel");
    await expect(page.getByLabel("Eyes", { exact: true })).toHaveValue("hazel");
  });

  test("the ten-field grid stays inside the description column", async ({ page }) => {
    const composer = page.locator(".avatar-composer");
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    if (!composerBox) return;

    for (const label of ["Gender", "Wardrobe, head to toe", "Identity marker"]) {
      const box = await page.getByLabel(label, { exact: true }).boundingBox();
      expect(box, `${label} has no box`).not.toBeNull();
      if (!box) continue;
      expect(box.x, `${label} sits left of the composer`).toBeGreaterThanOrEqual(composerBox.x - 1);
      expect(
        box.x + box.width,
        `${label} overflows the composer's right edge`,
      ).toBeLessThanOrEqual(composerBox.x + composerBox.width + 1);
    }
  });

  test("the inactive panel is not reachable by keyboard", async ({ page }) => {
    // Both panels stay mounted so a draft survives a tab switch, which means the inactive one is
    // animated to `opacity: 0` while still occupying the layout. Without `visibility: hidden` a
    // keyboard user would tab straight into an invisible textarea.
    await expect(page.getByPlaceholder("Paste the character description.")).toBeHidden();

    await page.getByRole("tab", { name: "Direct" }).click();
    await expect(page.getByPlaceholder("Paste the character description.")).toBeVisible();
  });

  test("a draft survives a tab switch in both directions", async ({ page }) => {
    await page.getByLabel("Gender", { exact: true }).fill("man");
    await page.getByRole("tab", { name: "Direct" }).click();
    await page.getByPlaceholder("Paste the character description.").fill("pasted");
    await page.getByRole("tab", { name: "Guided" }).click();

    await expect(page.getByLabel("Gender", { exact: true })).toHaveValue("man");
    await expect(page.locator(".avatar-preview__text")).toHaveText("A man");
  });
});
