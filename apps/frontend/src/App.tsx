import { useCallback, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import type { RunClient } from "./data/RunClient.js";
import { failingCount } from "./domain/derive.js";
import { useRunStream } from "./hooks/useRunStream.js";
import { T } from "./motion/tokens.js";
import { AppShell } from "./components/AppShell.js";
import { FixtureNotice } from "./components/FixtureNotice.js";
import { TopBar } from "./components/TopBar.js";
import { ArchitectureScreen } from "./screens/ArchitectureScreen.js";
import { RunScreen } from "./screens/RunScreen.js";
import { CompareScreen } from "./screens/CompareScreen.js";
import { VersionsScreen } from "./screens/VersionsScreen.js";

export type Screen = "run" | "architecture" | "versions" | "compare";

const PATH_BY_SCREEN: Record<Screen, string> = {
  run: "/",
  architecture: "/architecture",
  versions: "/versions",
  compare: "/compare",
};

function screenFromPath(pathname: string): Screen {
  if (pathname.startsWith("/architecture")) return "architecture";
  if (pathname.startsWith("/versions")) return "versions";
  if (pathname.startsWith("/compare")) return "compare";
  return "run";
}

function readInitialScreen(): Screen {
  if (typeof window === "undefined") return "run";
  return screenFromPath(window.location.pathname);
}

/**
 * Which run is on screen, as the URL records it.
 *
 * The run id used to live in `useState` and nowhere else, so a reload -- a laptop closing,
 * Chrome discarding the tab and reloading it on wake -- forgot it, and with it every result
 * the run had produced. `?run=<id>` is what survives that, and `live: false` is the honest
 * default on restore: the stream that carried the run is long gone, so it is fetched whole
 * from disk instead (see `useRunStream`).
 */
type OpenRun = { runId: string; live: boolean };

function readInitialRun(): OpenRun | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("run");
  return id ? { runId: id, live: false } : null;
}

function writeRunToUrl(runId: string | null): void {
  const url = new URL(window.location.href);
  if (runId === null) url.searchParams.delete("run");
  else url.searchParams.set("run", runId);
  window.history.pushState({ run: runId }, "", url);
}

/**
 * The app's one router: `useState<Screen>` plus `history.pushState`. Three screens do not need a
 * router dependency, and going live in a later phase must not have to unpick one.
 */
export function App({ client }: { client: RunClient }): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(readInitialScreen);
  const [open, setOpen] = useState<OpenRun | null>(readInitialRun);
  const runId = open?.runId ?? null;

  // Owned here, not inside `RunScreen`: Task 15's Architecture screen reads the same event stream
  // to drive its graph, and a hook inside each screen would open two `EventSource` subscriptions
  // to one run once both screens exist (see the task report).
  const { run, status, events, error } = useRunStream(client, runId, { live: open?.live ?? true });

  // A run this session started streams; one picked out of the history is read back off
  // disk. Both put the id in the URL, so either survives the tab being reloaded.
  const startRun = useCallback((newRunId: string) => {
    setOpen({ runId: newRunId, live: true });
    writeRunToUrl(newRunId);
  }, []);

  const openRun = useCallback((pastRunId: string) => {
    setOpen({ runId: pastRunId, live: false });
    writeRunToUrl(pastRunId);
  }, []);

  const closeRun = useCallback(() => {
    setOpen(null);
    writeRunToUrl(null);
  }, []);
  const failing = failingCount(run?.passes.at(-1)?.results ?? []);
  // `no_improvement` is the only state in the product that carries a solid alarm-fill treatment
  // (design doc §6.2); every other failing badge — here, `improved_still_failing` — is the alarm
  // outline instead, so the tab badge cannot borrow the same fill regardless of status.
  const badgeTone = status === "no_improvement" ? "fill" : "outline";

  useEffect(() => {
    const onPopState = () => {
      setScreen(screenFromPath(window.location.pathname));
      setOpen(readInitialRun());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Screen) => {
    setScreen(next);
    const path = PATH_BY_SCREEN[next];
    if (window.location.pathname !== path) {
      window.history.pushState({ screen: next }, "", path);
    }
  }, []);

  return (
    <MotionConfig reducedMotion="user" transition={T.reveal}>
      <AppShell>
        <TopBar
          screen={screen}
          run={run}
          failingCount={failing}
          badgeTone={badgeTone}
          onScreenChange={navigate}
          right={client.isFixture ? <FixtureNotice /> : null}
        />
        <main className="screen-body">
          {screen === "run" ? (
            <RunScreen
              client={client}
              run={run}
              status={status}
              events={events}
              error={error}
              onRunStarted={startRun}
              onOpenRun={openRun}
              onCloseRun={closeRun}
            />
          ) : null}
          {screen === "architecture" ? (
            <ArchitectureScreen run={run} status={status} events={events} error={error} />
          ) : null}
          {screen === "versions" ? <VersionsScreen client={client} /> : null}
          {screen === "compare" ? (
            <CompareScreen live={!client.isFixture} client={client} />
          ) : null}
        </main>
      </AppShell>
    </MotionConfig>
  );
}
