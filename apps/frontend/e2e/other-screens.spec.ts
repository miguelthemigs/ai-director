import { expect, test } from "@playwright/test";
import { gotoFixture, navigateToScreen } from "./helpers.js";

test.describe("Architecture screen", () => {
  test("shows the pipeline nodes, including the three drawn as planned", async ({ page }) => {
    await gotoFixture(page, "passed");
    await navigateToScreen(page, "Architecture");
    await expect(page.getByRole("heading", { name: "Architecture", level: 1 })).toBeAttached();

    // Nine nodes total (design doc §4.2's fixed pipeline lattice).
    await expect(page.locator(".arch__graph [data-testid^='node-']")).toHaveCount(9);

    // The three designed-but-unbuilt agents: `.node--planned`, visually distinguishable, and
    // labelled "planned" -- never any other state.
    for (const id of ["interrogator", "director", "identity"]) {
      const node = page.locator(`[data-testid="node-${id}"]`);
      await expect(node).toBeVisible();
      await expect(node).toHaveClass(/node--planned/);
      await expect(node.locator(".node__state")).toHaveText("planned");
    }

    // A built node (never touched by the "planned" guard) must NOT read "planned".
    const intakeNode = page.locator('[data-testid="node-intake"]');
    await expect(intakeNode).toBeVisible();
    await expect(intakeNode).not.toHaveClass(/node--planned/);
  });
});

test.describe("Versions screen", () => {
  test("shows version rows with their required notes -- something only this screen renders", async ({ page }) => {
    await gotoFixture(page, "passed");
    await navigateToScreen(page, "Versions");
    await expect(page.getByRole("heading", { name: "Versions", level: 1 })).toBeAttached();

    // The real screen's own grid, labelled exactly as `VersionTable` labels it -- a stub heading
    // could share "Versions"; this aria-label is the real component's own text.
    const grid = page.getByRole("grid", { name: "Rubric and prompt version history" });
    await expect(grid).toBeVisible();

    // Five sealed versions ship in the fixture history (v1, v2, e1, e2, r1), each with a required note.
    const rows = page.locator(".vtable__row:not(.vtable__row--head)");
    await expect(rows).toHaveCount(5);

    const notes = page.locator(".vtable__cell--note");
    await expect(notes).toHaveCount(5);
    const noteTexts = await notes.allTextContents();
    for (const text of noteTexts) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toBe("note required, not recorded");
    }
  });
});
