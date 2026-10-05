import type { Page } from "@playwright/test";

/** Any description works: `FixtureRunClient` ignores the submitted text and always replays the
 *  scenario baked into the `?fixture=` query param (see `main.tsx`). It is `TEST_AVATAR`'s
 *  description, which is what picking that avatar puts in the composer. */
export const SAMPLE_DESCRIPTION =
  "A woman with short black hair, blue eyes, and a small mole on her left cheek, wearing a grey wool coat.";

export type FixtureScenario = "passed" | "improvedStillFailing" | "noImprovement" | "failed";

/** Loads the app pinned to one fixture scenario, replayed fast (`fixtureSpeed` ms/event, default
 *  15) so a full 3-pass run settles in well under a second of wall time instead of the app's own
 *  320ms/event default -- see `main.tsx`'s `readFixtureClient`. Makes no network call: the fixture
 *  client is entirely in-memory.
 *
 * Always `/` (the Run screen): `vite.config.ts`'s dev proxy forwards any request path starting
 * `/versions` (and `/runs`) to the backend origin, including the top-level navigation request a
 * direct `page.goto("/versions")` would make -- there is no backend listening in this suite by
 * design, so that request 502s before the app ever loads. Reach the other two screens with
 * `navigateToScreen` below instead, which is also how a real user gets there after the first
 * load. */
export async function gotoFixture(page: Page, scenario: FixtureScenario, speedMs = 15): Promise<void> {
  await stubAvatarGallery(page);
  await page.goto(`/?fixture=${scenario}&fixtureSpeed=${speedMs}`);
}

/** One saved, already-described avatar, served by `stubAvatarGallery`. */
export const TEST_AVATAR = {
  id: "avatar-1",
  createdAt: "2026-10-05T00:00:00.000Z",
  source: "generated",
  mediaType: "image/png",
  seedDescription: "Test avatar",
  description: SAMPLE_DESCRIPTION,
  describeModel: "m",
};

/** A 1x1 transparent PNG, so the gallery thumbnail and the reopened sheet are real images. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Every run starts from an avatar, and there is no backend in this suite, so the avatar
 *  gallery's two requests are answered here: the list, and `TEST_AVATAR`'s image. Run requests
 *  never reach the network either way: the fixture client replays them in memory. */
export async function stubAvatarGallery(page: Page): Promise<void> {
  await page.route("**/avatar", (route) =>
    route.fulfill({ json: { avatars: [TEST_AVATAR] } }),
  );
  await page.route(`**/avatar/${TEST_AVATAR.id}/image`, (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL_PNG }),
  );
}

/** Switches screens by dispatching a "click" DOM event on the tab link directly, rather than a
 *  real `.click()`: `.pass-step__pill` (see `render-layout.spec.ts`'s dedicated defect test and
 *  the task report) covers the whole page, the header's own tabs included, so a real pointer
 *  click on a tab times out. This still exercises `App`'s real client-side router (`ScreenTabs`'s
 *  `onClick` -> `navigate` -> `setScreen` + `history.pushState`) -- no page reload, so it does not
 *  run into the dev-proxy 502 a direct URL navigation would (see `gotoFixture`). */
export async function navigateToScreen(
  page: Page,
  tab: "Run" | "Architecture" | "Versions" | "Compare",
): Promise<void> {
  await page.getByRole("link", { name: tab }).dispatchEvent("click");
}

/** Fills the composer and submits, starting a run against whichever scenario the page was loaded
 *  with. Resolves once the submit click has landed; callers wait for their own terminal signal
 *  (the verdict banner's word, a specific check's band, etc.) rather than a fixed sleep. */
export async function startRun(page: Page): Promise<void> {
  // Every run starts from an avatar. Reopening the described one in the gallery hands its
  // description and id to the composer, which is what enables Run. `dispatchEvent` for the same
  // reason as the Run button below: `.pass-step__pill` sits on top of everything.
  await page.getByRole("button", { name: /Test avatar/ }).dispatchEvent("click");
  await page.getByText(SAMPLE_DESCRIPTION).first().waitFor();
  // `exact: true`: a non-exact match on "Run" also matches every pass-step button, whose
  // accessible name includes its "not yet run" status text.
  //
  // Not `.click()`, not even `.click({ force: true })`: `.pass-step__pill` (see
  // `render-layout.spec.ts`'s dedicated test and the task report) is a real layout defect that
  // makes it, not this button, the actual topmost element at literally every point on the page --
  // `force: true` skips Playwright's own actionability checks but still dispatches a real pointer
  // click at the button's on-screen coordinates, which a real mouse click of course cannot avoid
  // either, so it lands on the pill, not the button, and nothing happens. `dispatchEvent` fires
  // the "click" DOM event directly on the button node, bypassing hit-testing altogether -- the
  // only way left to reach and verify the run/check/verdict behaviour this suite exists to check.
  // It does not hide the defect, which is reported and asserted on separately and would still
  // block a real mouse user.
  await page.getByRole("button", { name: "Run", exact: true }).dispatchEvent("click");
}
