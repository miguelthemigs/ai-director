import { act, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

/** One saved, already-described avatar. Picking it from the gallery is the cheapest way
 *  through the only flow a run can start from: avatar, then description, then Run. */
export const TEST_AVATAR = {
  id: "avatar-1",
  createdAt: "2026-10-05T00:00:00.000Z",
  source: "generated",
  mediaType: "image/png",
  seedDescription: "Test avatar",
  description: "a description long enough to submit",
  describeModel: "m",
} as const;

/** Answers the two requests picking `TEST_AVATAR` makes: the gallery list and its image. */
export function stubAvatarGallery(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/avatar") {
        return { ok: true, status: 200, url, json: async () => ({ avatars: [TEST_AVATAR] }) };
      }
      if (url === `/avatar/${TEST_AVATAR.id}/image`) {
        return { ok: true, status: 200, url, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      }
      return { ok: false, status: 404, url, json: async () => ({ error: `not stubbed: ${url}` }) };
    }),
  );
}

/**
 * Reopens `TEST_AVATAR` from the gallery, which hands its description and id to the
 * composer and enables Run. Flushes with `act` rather than `findBy*`, so it works under
 * fake timers too.
 */
export async function pickTestAvatar(): Promise<void> {
  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Test avatar/ }));
  });
  await act(async () => {});
}
