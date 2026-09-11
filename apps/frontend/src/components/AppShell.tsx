import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "prompt-coach:theme";

type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Consumed by `ThemeToggle` (via `TopBar`). Throws outside `AppShell` so a misplaced toggle
 *  fails loudly in development rather than silently doing nothing. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within AppShell");
  return context;
}

/**
 * Grid frame shared by all three screens: 48px top bar row, then the screen body, 100dvh, no
 * page-level max width. Also the sole owner of the `data-theme` attribute — everything under it,
 * including `ThemeToggle`, reads and writes theme through `useTheme()` rather than through props
 * threaded down from the caller.
 */
export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode, disabled cookies); the toggle still works
      // for the life of the tab, it just won't persist across reloads.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      <div className="shell">{children}</div>
    </ThemeContext.Provider>
  );
}
