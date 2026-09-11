import type { RunView } from "@ai-director/contract";
import type { Screen } from "../App.js";
import { useTheme } from "./AppShell.js";
import { RunIdentityStrip } from "./RunIdentityStrip.js";
import { ScreenTabs } from "./ScreenTabs.js";
import { ThemeToggle } from "./ThemeToggle.js";

/**
 * Product mark, screen tabs, run provenance strip, theme toggle (design doc §5 "Shared").
 */
export function TopBar({
  screen,
  run,
  failingCount,
  onScreenChange,
  right,
}: {
  screen: Screen;
  run: RunView | null;
  failingCount: number;
  onScreenChange: (screen: Screen) => void;
  right?: React.ReactNode;
}): React.JSX.Element {
  const { theme, setTheme } = useTheme();

  return (
    <header className="top-bar">
      <span className="top-bar__mark">Prompt Coach</span>
      <ScreenTabs active={screen} failingCount={failingCount} onChange={onScreenChange} />
      <RunIdentityStrip run={run} compact />
      <div className="top-bar__right">
        {right}
        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>
    </header>
  );
}
