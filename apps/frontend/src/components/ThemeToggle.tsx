import type { Theme } from "./AppShell.js";

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}): React.JSX.Element {
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={theme === "light"}
      onClick={() => onChange(next)}
    >
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
