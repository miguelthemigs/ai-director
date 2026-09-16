import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunEvent } from "@ai-director/contract";
import { CompareScreen } from "../../src/screens/CompareScreen.js";
import type { RunClient } from "../../src/data/RunClient.js";

const DESCRIPTION = "A young man with wavy brown hair.";

const AVATARS = [
  {
    id: "avatar-1",
    createdAt: "2026-09-12T13:23:27.890Z",
    source: "generated" as const,
    mediaType: "image/jpeg",
    description: DESCRIPTION,
  },
  {
    id: "avatar-2",
    createdAt: "2026-09-11T10:00:00.000Z",
    source: "uploaded" as const,
    mediaType: "image/png",
    // No description read off it yet: shown, and not selectable.
  },
];

const RUNS = [
  {
    runId: "run-v2",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "improved_still_failing",
    startedAt: "2026-09-16T13:38:30.943Z",
    finishedAt: "2026-09-16T13:39:08.735Z",
    passes: 3,
    avatarId: "avatar-1",
    repairerPromptVersion: "v2",
  },
  {
    runId: "run-v1",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "passed",
    startedAt: "2026-09-12T13:38:30.943Z",
    finishedAt: "2026-09-12T13:39:08.735Z",
    passes: 3,
    avatarId: "avatar-1",
    repairerPromptVersion: "v1",
  },
  {
    runId: "run-else",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "passed",
    startedAt: "2026-09-10T13:38:30.943Z",
    passes: 2,
    avatarId: "avatar-2",
    repairerPromptVersion: "v2",
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
    prompt: `WRAPPER\n\n${s === "before" ? "raw" : "repaired"}\n\nTAIL`,
    descriptionSha256: (s === "before" ? "a" : "b").repeat(64),
    rubricVersion: "v1",
    repairerPromptVersion: "v2",
    polls: 0,
    ...o,
  });
  return {
    comparisonId: "cmp-1",
    createdAt: "2026-09-16T10:00:00.000Z",
    finishedAt: null,
    avatarId: "avatar-1",
    runId: "run-v2",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    before: side("before"),
    after: side("after"),
    ...over,
  };
}

const HISTORY = [
  {
    comparisonId: "cmp-old",
    createdAt: "2026-09-15T10:00:00.000Z",
    avatarId: "avatar-1",
    runId: "run-v1",
    seconds: 4,
    size: "480x854",
    beforeStatus: "succeeded",
    afterStatus: "succeeded",
    estimatedMicroUsd: 822_402,
    actualMicroUsd: 795_000,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
let client: RunClient;
let sinks: Array<(event: RunEvent) => void>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeFetch(extra: Record<string, () => Response> = {}) {
  const handlers: Record<string, () => Response> = {
    "GET /avatar": () => json({ avatars: AVATARS }),
    "GET /runs": () => json(RUNS),
    "GET /compare": () => json(HISTORY),
    ...extra,
  };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const handler = handlers[`${init?.method ?? "GET"} ${url}`];
    if (!handler) throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    return handler();
  });
}

function makeClient(startRun = vi.fn(async () => ({ runId: "graded-1" }))): RunClient {
  return {
    isFixture: false,
    startRun,
    getRun: vi.fn(),
    listRuns: vi.fn(async () => []),
    subscribe: vi.fn((_runId: string, _from: unknown, sink: (event: RunEvent) => void) => {
      sinks.push(sink);
      return () => {};
    }),
  } as unknown as RunClient;
}

beforeEach(() => {
  sinks = [];
  fetchMock = routeFetch();
  vi.stubGlobal("fetch", fetchMock);
  client = makeClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function pickAvatar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "avatar-1" }));
}

describe("step 1, who", () => {
  it("picks by the sheet rather than by a uuid", async () => {
    render(<CompareScreen live client={client} />);
    const card = await screen.findByRole("radio", { name: "avatar-1" });
    const sheet = within(card).getByAltText(/character sheet for avatar-1/i);
    expect(sheet.getAttribute("src")).toBe("/avatar/avatar-1/image");
  });

  it("shows an undescribed avatar, disabled, rather than hiding it", async () => {
    render(<CompareScreen live client={client} />);
    const card = await screen.findByRole("radio", { name: "avatar-2" });
    expect(card).toBeDisabled();
    expect(within(card).getByText(/not described yet/i)).toBeInTheDocument();
  });

  it("shows the description and says the sheet is never sent to the video model", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    expect(await screen.findByText(DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText(/never sent as an image/i)).toBeInTheDocument();
  });
});

describe("step 2, grade and repair", () => {
  it("starts a v2 run by naming the avatar, without leaving the screen", async () => {
    const startRun = vi.fn(async () => ({ runId: "graded-1" }));
    client = makeClient(startRun);
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);

    await user.click(screen.getByRole("button", { name: /grade and repair with v2/i }));

    // The avatar id is the whole of v2: without it the server cannot hand the Repairer
    // the sheet.
    expect(startRun).toHaveBeenCalledWith(DESCRIPTION, "avatar-1");
  });

  it("streams every wire event of that run onto the screen", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(screen.getByRole("button", { name: /grade and repair with v2/i }));

    await waitFor(() => expect(sinks).toHaveLength(1));
    const emit = sinks[0]!;

    emit({
      id: "1-0",
      name: "repairer.started",
      at: "2026-09-16T10:00:00.000Z",
      pass: 1,
      spanIds: ["hair_spec:0"],
    } as RunEvent);

    const feed = await screen.findByTestId("run-event-feed");
    expect(within(feed).getByText(/repairer started/i)).toBeInTheDocument();
    // The failing fragment is named, which is what makes a fabricated repair catchable.
    expect(within(feed).getByText(/hair_spec:0/)).toBeInTheDocument();
  });

  it("labels each run with the repairer that wrote its after, and filters to this avatar", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);

    expect(await screen.findByRole("radio", { name: "run-v2" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "run-v1" })).toBeInTheDocument();
    // A run that graded a different person is not offered for this one.
    expect(screen.queryByRole("radio", { name: "run-else" })).not.toBeInTheDocument();

    expect(
      within(screen.getByRole("radio", { name: "run-v2" })).getByText(/saw the sheet/i),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("radio", { name: "run-v1" })).getByText(/blind/i),
    ).toBeInTheDocument();
  });
});

describe("step 3, render", () => {
  it("derives the pair estimate from the controls and never hardcodes it", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    expect(await screen.findByTestId("pair-estimate")).toHaveTextContent("$0.82");

    await user.selectOptions(screen.getByLabelText(/size/i), "720x1280");
    await waitFor(() => expect(screen.getByTestId("pair-estimate")).toHaveTextContent("$1.85"));
  });

  it("refuses to price or spend on a seconds value the server would reject", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    const button = screen.getByRole("button", { name: /render both/i });
    await waitFor(() => expect(button).toBeEnabled());

    await user.clear(screen.getByLabelText(/seconds/i));
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByTestId("pair-estimate")).not.toHaveTextContent("$0.00");

    await user.type(screen.getByLabelText(/seconds/i), "6");
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByTestId("pair-estimate")).toHaveTextContent("$1.23");
  });

  it("keeps the spend button disabled until an avatar and a run are both chosen", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    const button = await screen.findByRole("button", { name: /render both/i });
    expect(button).toBeDisabled();

    await pickAvatar(user);
    expect(button).toBeDisabled();

    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("names which repairer produced the after it is about to render", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v1" }));

    expect(await screen.findByTestId("render-source")).toHaveTextContent(/repairer v1/i);
  });

  it("submits the four controls and renders the returned pair", async () => {
    fetchMock = routeFetch({
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => json(row()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    await user.click(screen.getByRole("button", { name: /render both/i }));

    await waitFor(() => expect(screen.getByTestId("render-before")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      avatarId: "avatar-1",
      runId: "run-v2",
      seconds: 4,
      size: "480x854",
    });
  });

  it("shows the server's refusal instead of a pair", async () => {
    fetchMock = routeFetch({
      "POST /compare": () => json({ error: 'run "run-v2" repaired nothing' }, 400),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    await user.click(screen.getByRole("button", { name: /render both/i }));

    expect(await screen.findByText(/repaired nothing/)).toBeInTheDocument();
    expect(screen.queryByTestId("render-before")).not.toBeInTheDocument();
  });
});

describe("transparency", () => {
  it("shows both prompts as sent, and asserts they differ only in the description", async () => {
    fetchMock = routeFetch({
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => json(row()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    await user.click(screen.getByRole("button", { name: /render both/i }));

    const wire = await screen.findByTestId("wire-inspector");
    expect(within(wire).getByText(/identical apart from the description/i)).toBeInTheDocument();

    await user.click(within(wire).getByRole("button", { name: /show exactly what was sent/i }));
    expect(within(screen.getByTestId("wire-before")).getByText(/WRAPPER/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("wire-before")).getByText(/text only/i),
    ).toBeInTheDocument();
  });

  it("warns when the two prompts differ outside the description", async () => {
    const tampered = row();
    tampered.after.prompt = "A DIFFERENT WRAPPER\n\nrepaired\n\nTAIL";
    fetchMock = routeFetch({
      "POST /compare": () => json(tampered, 202),
      "GET /compare/cmp-1": () => json(tampered),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    await user.click(screen.getByRole("button", { name: /render both/i }));

    expect(await screen.findByText(/does not compare one variable/i)).toBeInTheDocument();
  });

  it("re-reads status on demand without ever submitting", async () => {
    fetchMock = routeFetch({
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => json(row()),
      "POST /compare/cmp-1/refresh": () =>
        json(row({ before: { ...row().before, status: "running", polls: 3 } })),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CompareScreen live client={client} />);
    await pickAvatar(user);
    await user.click(await screen.findByRole("radio", { name: "run-v2" }));
    await user.click(screen.getByRole("button", { name: /render both/i }));
    await screen.findByTestId("render-before");

    await user.click(screen.getByRole("button", { name: /re-read status/i }));

    await waitFor(() =>
      expect(
        within(screen.getByTestId("render-before")).getByText(/3 status reads/i),
      ).toBeInTheDocument(),
    );
    const posts = fetchMock.mock.calls.filter(
      ([url, init]) => (init as RequestInit)?.method === "POST" && url === "/compare",
    );
    expect(posts).toHaveLength(1);
  });
});

describe("history", () => {
  it("lists every pair rendered, with the estimate and the bill as separate columns", async () => {
    render(<CompareScreen live client={client} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("cmp-old")).toBeInTheDocument();
    // Two different figures on purpose: a table that printed the estimate in the billed
    // column would be invisible if they matched.
    expect(within(table).getByText("$0.82")).toBeInTheDocument();
    expect(within(table).getByText("$0.80")).toBeInTheDocument();
  });

  it("says not measured for a pair where only one side reported a bill", async () => {
    fetchMock = routeFetch({
      "GET /compare": () => json([{ ...HISTORY[0], actualMicroUsd: null }]),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CompareScreen live client={client} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("not measured")).toBeInTheDocument();
    expect(within(table).queryByText("$0.00")).not.toBeInTheDocument();
  });
});

describe("fixture mode", () => {
  it("offers nothing that spends, and says why", async () => {
    render(<CompareScreen live={false} client={client} />);
    expect(await screen.findByText(/needs the real backend/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /render both/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /grade and repair/i })).not.toBeInTheDocument();
  });
});
