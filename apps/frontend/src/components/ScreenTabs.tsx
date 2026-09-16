import type { Screen } from "../App.js";

const TABS: ReadonlyArray<{ id: Screen; label: string; path: string }> = [
  { id: "run", label: "Run", path: "/" },
  { id: "architecture", label: "Architecture", path: "/architecture" },
  { id: "versions", label: "Versions", path: "/versions" },
  { id: "compare", label: "Compare", path: "/compare" },
];

/**
 * Four tabs. Carries the failing-check count as a persistent badge on RUN so a failed run stays
 * visible from any screen (design doc §5 "Shared").
 */
export function ScreenTabs({
  active,
  failingCount,
  badgeTone = "outline",
  onChange,
}: {
  active: Screen;
  failingCount: number;
  /** Design doc §6.2: `fill` (the product's one solid-colour-behind-text treatment) is reserved
   *  for `no_improvement`; every other failing run's badge is the alarm outline. */
  badgeTone?: "outline" | "fill";
  onChange: (screen: Screen) => void;
}): React.JSX.Element {
  return (
    <nav className="screen-tabs" aria-label="Screens">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <a
            key={tab.id}
            href={tab.path}
            aria-current={isActive ? "page" : undefined}
            className="screen-tab"
            data-active={isActive || undefined}
            onClick={(event) => {
              event.preventDefault();
              onChange(tab.id);
            }}
          >
            {tab.label}
            {tab.id === "run" && failingCount > 0 ? (
              <span
                className="screen-tab__badge tnum"
                data-tone={badgeTone}
                aria-label={`${failingCount} failing`}
              >
                {failingCount}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
