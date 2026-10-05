import { expect, test } from "@playwright/test";
import { gotoFixture, SAMPLE_DESCRIPTION } from "./helpers.js";

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

  test("has no paste box, and names the whole flow", async ({ page }) => {
    // Every run starts from an avatar. A pasted description belongs to none, so the Repairer
    // would have nothing to look at and would run blind.
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByPlaceholder("Paste the character description.")).toHaveCount(0);
    await expect(
      page.getByText(/render the avatar, then grade the description the model writes back/i),
    ).toBeVisible();
  });

  /**
   * The misreading this whole tab is arranged to prevent: the guided fields assemble the
   * prompt that GENERATES the avatar, and the graded artefact is what a vision model writes
   * after looking at the generated avatar. Two different strings about two different things.
   */
  test("labels the assembled sentence as the render prompt, and refuses Run until something is described", async ({ page }) => {
    await page.getByLabel("Gender", { exact: true }).fill("woman");

    await expect(page.getByText("The prompt that will generate the avatar")).toBeVisible();
    await expect(page.getByText("This is what gets rendered, not what gets graded.")).toBeVisible();
    await expect(page.getByText("What will be graded")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  });

  test("a real click on Surprise me fills the form", async ({ page }) => {
    // A REAL click, not `dispatchEvent`: the whole reason this suite exists is that an invisible
    // element once intercepted every pointer event on the page, and nothing but a real click
    // catches that.
    await page.getByRole("button", { name: "Surprise me" }).click();

    await expect(page.getByLabel("Wardrobe, head to toe", { exact: true })).not.toHaveValue("");
    // Still disabled: a full form is a full PROMPT, and nothing has been rendered or
    // described yet, so there is nothing to grade.
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  });

  test("the preview shows the exact prompt the fields assemble", async ({ page }) => {
    await page.getByLabel("Gender", { exact: true }).fill("woman");
    await page.getByLabel("Eyes", { exact: true }).fill("hazel");

    await expect(page.locator(".avatar-preview__text")).toHaveText("A woman, hazel eyes");
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

  test("the pipeline steps sit right under the fields, so it reads as one flow", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Generate sheet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Describe this person" })).toBeVisible();
  });

  test("reopening a described avatar puts its description up for grading and enables Run", async ({ page }) => {
    await page.getByRole("button", { name: /Test avatar/ }).click();

    await expect(page.locator(".sheet-pipeline__description")).toHaveText(SAMPLE_DESCRIPTION);
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  });
});

/**
 * The Pipeline tab reproduces Mentic end to end: doctrine call, sheet layout, Nano Banana
 * Pro, then Mentic's describe prompt over the rendered sheet. Both steps spend real money,
 * and this suite has no backend, so it checks only the layout and that neither step can be
 * pressed before there is something to act on. The steps themselves are covered in jsdom
 * against a stubbed fetch, in `tests/components/SheetPipeline.test.tsx`.
 */
test.describe("the pipeline steps", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "passed");
  });

  test("cannot be pressed before there is a prompt or a sheet to act on", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Generate sheet" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Describe this person" })).toBeDisabled();
  });

  test("name the price of each step next to the button that spends it", async ({ page }) => {
    await expect(page.getByText("paid image call")).toBeVisible();
    await expect(page.getByText("paid vision call")).toBeVisible();
  });

  test("stay inside the description column", async ({ page }) => {
    const composer = page.locator(".avatar-composer");
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    if (!composerBox) return;

    for (const step of await page.locator(".sheet-pipeline__step").all()) {
      const box = await step.boundingBox();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(composerBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(composerBox.x + composerBox.width + 1);
    }
  });
});
