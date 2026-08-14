/**
 * Colour-scheme preference: the member's stored choice, which defaults to
 * following the device. `system` is the default so a fresh install matches
 * whatever the phone or desktop is already doing.
 */
export type ThemePreference = "system" | "light" | "dark";

/** What actually gets painted once the device preference is folded in. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "budget-app-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** Painted while the resolved theme is light and dark, respectively. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#e8eee9",
  dark: "#0c1712",
};

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    THEME_PREFERENCES.includes(value as ThemePreference)
  );
}

/**
 * Reads the stored preference. Anything unreadable, absent, or corrupt falls
 * back to `system` rather than throwing: private-mode Safari and storage-denied
 * embeddings both make `getItem` raise.
 */
export function readStoredPreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ThemePreference {
  if (!storage) return DEFAULT_THEME_PREFERENCE;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Persists the preference; a storage failure is not worth breaking the UI. */
export function writeStoredPreference(
  storage: Pick<Storage, "setItem"> | null | undefined,
  preference: ThemePreference,
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore: the choice still applies for this session.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

type ThemeTarget = {
  dataset: { theme?: string };
  style: { colorScheme: string };
};

/**
 * Applies the resolved theme to the document element. `system` leaves
 * `data-theme` off entirely so the `prefers-color-scheme` rules in globals.css
 * stay in charge and keep tracking the device live.
 */
export function applyTheme(
  root: ThemeTarget,
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  const resolved = resolveTheme(preference, prefersDark);
  if (preference === "system") {
    delete root.dataset.theme;
    root.style.colorScheme = "light dark";
  } else {
    root.dataset.theme = preference;
    root.style.colorScheme = preference;
  }
  return resolved;
}

/**
 * Runs synchronously in <head> during HTML parsing, before the first paint, so
 * a stored Light/Dark choice never flashes the other palette on a hard reload.
 * Kept as a single expression string with no external references because it is
 * inlined with dangerouslySetInnerHTML.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p==="light"||p==="dark"){document.documentElement.dataset.theme=p;document.documentElement.style.colorScheme=p;}}catch(e){}})();`;
