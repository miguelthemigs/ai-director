import { useCallback, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import type { RunClient } from "./data/RunClient.js";
import { failingCount } from "./domain/derive.js";
import { useRunStream } from "./hooks/useRunStream.js";
import { T } from "./motion/tokens.js";
import { AppShell } from "./components/AppShell.js";
import { TopBar } from "./components/TopBar.js";
import { RunScreen } from "./screens/RunScreen.js";

export type Screen = "run" | "architecture" | "versions";

const PATH_BY_SCREEN: Record<Screen, string> = {
  run: "/",
  architecture: "/architecture",
  versions: "/versions",
};

function screenFromPath(pathname: string): Screen {
  if (pathname.startsWith("/architecture")) return "architecture";
  if (pathname.startsWith("/versions")) return "versions";
  return "run";
}

function readInitialScreen(): Screen {
  if (typeof window === "undefined") return "run";
  return screenFromPath(window.location.pathname);
}

// The other two screens are built in Tasks 14-16; this task builds only the chrome they stand
// inside. Each stub carries the level-1 heading App.test.tsx asserts on and nothing else.
function ArchitectureScreenStub(): React.JSX.Element {
  return <h1 className="screen-title">Architecture</h1>;
}

function VersionsScreenStub(): React.JSX.Element {
  return <h1 className="screen-title">Versions</h1>;
}

/**
 * The app's one router: `useState<Screen>` plus `history.pushState`. Three screens do not need a
 * router dependency, and going live in a later phase must not have to unpick one.
 */
export function App({ client }: { client: RunClient }): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(readInitialScreen);
  const [runId, setRunId] = useState<string | null>(null);

  // Owned here, not inside `RunScreen`: Task 15's Architecture screen reads the same event stream
  // to drive its graph, and a hook inside each screen would open two `EventSource` subscriptions
  // to one run once both screens exist (see the task report).
  const { run, status, events, error } = useRunStream(client, runId);
  const failing = failingCount(run?.passes.at(-1)?.results ?? []);
  // `no_improvement` is the only state in the product that carries a solid alarm-fill treatment
  // (design doc §6.2); every other failing badge — here, `improved_still_failing` — is the alarm
  // outline instead, so the tab badge cannot borrow the same fill regardless of status.
  const badgeTone = status === "no_improvement" ? "fill" : "outline";

  useEffect(() => {
    const onPopState = () => setScreen(screenFromPath(window.location.pathname));
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
        />
        <main className="screen-body">
          {screen === "run" ? (
            <RunScreen
              client={client}
              run={run}
              status={status}
              events={events}
              error={error}
              onRunStarted={setRunId}
            />
          ) : null}
          {screen === "architecture" ? <ArchitectureScreenStub /> : null}
          {screen === "versions" ? <VersionsScreenStub /> : null}
        </main>
      </AppShell>
    </MotionConfig>
  );
}
