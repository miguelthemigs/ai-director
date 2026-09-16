import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompareScreen } from "../../src/screens/CompareScreen.js";

const AVATARS = [
  {
    id: "avatar-1",
    createdAt: "2026-09-12T13:23:27.890Z",
    source: "generated" as const,
    mediaType: "image/jpeg",
    description: "A young man with wavy brown hair.",
  },
];

const RUNS = [
  {
    runId: "run-1",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "improved_still_failing",
    startedAt: "2026-09-12T13:38:30.943Z",
    finishedAt: "2026-09-12T13:39:08.735Z",
    passes: 3,
  },
];

function row(over: Record<string, unknown> = {}) {
  const side = (s: "before" | "after", o: Record<string, unknown> = {}) => ({
    side: s,
    status: "queued",
    taskId: null,
    submittedAt: null,
    finishedAt: null,
    failureCode: null,
    failure: null,
    estimatedMicroUsd: 411_201,
    actualMicroUsd: null,
    clipUrl: null,
    description: s === "before" ? "raw" : "repaired",
    descriptionSha256: (s === "before" ? "a" : "b").repeat(64),
    rubricVersion: "v1",
    repairerPromptVersion: null,
    polls: 0,
    ...o,
  });
  return {
    comparisonId: "cmp-1",
    createdAt: "2026-09-16T10:00:00.000Z",
    finishedAt: null,
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    before: side("before"),
    after: side("after"),
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeFetch(handlers: Record<string, () => Response>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected request: ${key}`);
    return handler();
  });
}

beforeEach(() => {
  fetchMock = routeFetch({
    "GET /avatar": () => json({ avatars: AVATARS }),
    "GET /runs": () => json(RUNS),
    "GET /compare": () => json([]),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CompareScreen", () => {
  it("shows the pair estimate before anything is submitted, derived from the controls", async () => {
    render(<CompareScreen live />);
    // Default: 480x854 at 4 seconds, two clips.
    expect(await screen.findByTestId("pair-estimate")).toHaveTextContent("$0.82");
  });

  it("re-derives the estimate when the size changes, and never hardcodes it", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live />);
    await screen.findByTestId("pair-estimate");

    await user.selectOptions(screen.getByLabelText(/size/i), "720x1280");
    await waitFor(() => expect(screen.getByTestId("pair-estimate")).toHaveTextContent("$1.85"));
  });

  it("keeps submit disabled until an avatar and a run are both chosen", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live />);
    const button = await screen.findByRole("button", { name: /render both/i });
    expect(button).toBeDisabled();

    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("submits the four controls and renders the returned pair", async () => {
    const user = userEvent.setup();
    fetchMock = routeFetch({
      "GET /avatar": () => json({ avatars: AVATARS }),
      "GET /runs": () => json(RUNS),
      "GET /compare": () => json([]),
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => json(row()),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await user.click(screen.getByRole("button", { name: /render both/i }));

    await waitFor(() => expect(screen.getByTestId("render-before")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      avatarId: "avatar-1",
      runId: "run-1",
      seconds: 4,
      size: "480x854",
    });
  });

  it("shows the server's refusal instead of a pair, and spends nothing further", async () => {
    const user = userEvent.setup();
    fetchMock = routeFetch({
      "GET /avatar": () => json({ avatars: AVATARS }),
      "GET /runs": () => json(RUNS),
      "GET /compare": () => json([]),
      "POST /compare": () => json({ error: 'run "run-1" repaired nothing' }, 400),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await user.click(screen.getByRole("button", { name: /render both/i }));

    expect(await screen.findByText(/repaired nothing/)).toBeInTheDocument();
    expect(screen.queryByTestId("render-before")).not.toBeInTheDocument();
  });

  it("shows the avatar sheet and says it is never sent to the video model", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));

    const sheet = await screen.findByAltText(/character sheet/i);
    expect(sheet.getAttribute("src")).toBe("/avatar/avatar-1/image");
    expect(screen.getByText(/never sent to the video model/i)).toBeInTheDocument();
  });

  it("polls an unfinished pair and stops once both sides are terminal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let reads = 0;
    fetchMock = routeFetch({
      "GET /avatar": () => json({ avatars: AVATARS }),
      "GET /runs": () => json(RUNS),
      "GET /compare": () => json([]),
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => {
        reads += 1;
        if (reads < 2) return json(row());
        return json(
          row({
            finishedAt: "2026-09-16T10:02:00.000Z",
            before: { ...row().before, status: "succeeded", clipUrl: "/compare/cmp-1/before/clip" },
            after: { ...row().after, status: "succeeded", clipUrl: "/compare/cmp-1/after/clip" },
          }),
        );
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await user.click(screen.getByRole("button", { name: /render both/i }));

    await vi.advanceTimersByTimeAsync(20_000);
    const settled = reads;
    await vi.advanceTimersByTimeAsync(20_000);
    // Both sides terminal, so the interval was cleared and no further read happened.
    expect(reads).toBe(settled);
  });

  it("offers no render button at all in fixture mode", async () => {
    render(<CompareScreen live={false} />);
    expect(await screen.findByText(/needs the real backend/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /render both/i })).not.toBeInTheDocument();
  });
});
