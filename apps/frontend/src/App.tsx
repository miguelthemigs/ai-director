import { useCallback, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import type { RunClient } from "./data/RunClient.js";
import { T } from "./motion/tokens.js";
import { AppShell } from "./components/AppShell.js";
import { TopBar } from "./components/TopBar.js";

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

// The three screens themselves are built in Tasks 13-16; this task builds only the chrome they
// stand inside. Each stub carries the level-1 heading App.test.tsx asserts on and nothing else.
function RunScreenStub(): React.JSX.Element {
  return <h1 className="screen-title">Run</h1>;
}

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

  // `client` is the seam every screen will use once Tasks 13-16 build real bodies for these
  // stubs; accepting it here (rather than only in main.tsx) is what lets every later test inject
  // a FixtureRunClient and never touch the network.
  void client;

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
        <TopBar screen={screen} run={null} failingCount={0} onScreenChange={navigate} />
        <main className="screen-body">
          {screen === "run" ? <RunScreenStub /> : null}
          {screen === "architecture" ? <ArchitectureScreenStub /> : null}
          {screen === "versions" ? <VersionsScreenStub /> : null}
        </main>
      </AppShell>
    </MotionConfig>
  );
}
