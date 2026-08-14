"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  applyTheme,
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  readStoredPreference,
  THEME_STORAGE_KEY,
  writeStoredPreference,
  type ThemePreference,
} from "@/lib/theme/theme";

/**
 * Reading `window.localStorage` itself throws when storage is blocked, which is
 * before `readStoredPreference` ever gets a chance to be defensive.
 */
function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia?.(DARK_SCHEME_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * The preference lives outside React, so the selected pill is read through
 * `useSyncExternalStore` rather than seeded into `useState`. A lazy initializer
 * would return "system" on the server and "dark" on the client for anyone who
 * has chosen a theme, and React would hydrate that as a mismatch — the inline
 * `<head>` script fixes `<html>`, but it does not rewrite this control's markup.
 * `getServerSnapshot` is also what React uses while hydrating, so the first
 * client render matches the server exactly and the real choice settles in a
 * passive update straight after. Nothing flashes: the palette itself was
 * already painted by the head script.
 */
const preferenceStore = (() => {
  const listeners = new Set<() => void>();
  /**
   * Where the choice lives when it cannot be persisted at all (blocked storage,
   * private browsing). Storage stays authoritative whenever it is readable, so
   * another tab's change still wins; this only keeps the control honest for a
   * member whose selection can never be written down.
   */
  let session: ThemePreference | null = null;

  return {
    subscribe(onStoreChange: () => void): () => void {
      listeners.add(onStoreChange);
      // `storage` fires in the *other* tabs, keeping several windows in step.
      window.addEventListener("storage", onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener("storage", onStoreChange);
      };
    },

    getSnapshot(): ThemePreference {
      const storage = safeStorage();
      if (storage) {
        try {
          const stored = storage.getItem(THEME_STORAGE_KEY);
          if (isThemePreference(stored)) return stored;
        } catch {
          // Storage that reads as present but throws: same as having none.
        }
      }
      return session ?? DEFAULT_THEME_PREFERENCE;
    },

    getServerSnapshot(): ThemePreference {
      return DEFAULT_THEME_PREFERENCE;
    },

    set(next: ThemePreference): void {
      session = next;
      writeStoredPreference(safeStorage(), next);
      // `storage` does not fire in the tab that wrote the value, so tell this
      // one directly.
      for (const listener of listeners) listener();
    },
  };
})();

const deviceThemeStore = {
  subscribe(onStoreChange: () => void): () => void {
    const query = window.matchMedia?.(DARK_SCHEME_QUERY);
    query?.addEventListener?.("change", onStoreChange);
    return () => query?.removeEventListener?.("change", onStoreChange);
  },
  getSnapshot: prefersDark,
  getServerSnapshot: () => false,
};

/** A compact light/dark switch sized for a touch target, not a toolbar panel. */
export function ThemeToggle() {
  const preference = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getSnapshot,
    preferenceStore.getServerSnapshot,
  );
  const devicePrefersDark = useSyncExternalStore(
    deviceThemeStore.subscribe,
    deviceThemeStore.getSnapshot,
    deviceThemeStore.getServerSnapshot,
  );

  useLayoutEffect(() => {
    // React's development remount tears down and replays this tree without
    // replaying the inline <head> script, which leaves `data-theme` cleared.
    // Re-reading storage and applying it before paint restores the attribute
    // without a second render: only the document element can be out of date,
    // because the store above is already the source of truth for this control.
    applyTheme(
      document.documentElement,
      readStoredPreference(safeStorage()),
      prefersDark(),
    );
  }, []);

  const choose = (next: ThemePreference) => {
    preferenceStore.set(next);
    applyTheme(document.documentElement, next, prefersDark());
  };

  const resolvedTheme =
    preference === "system"
      ? devicePrefersDark
        ? "dark"
        : "light"
      : preference;
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-icon={resolvedTheme === "dark" ? "moon" : "sun"}
      aria-label={`Switch to ${nextTheme} theme`}
      aria-pressed={resolvedTheme === "dark"}
      title={`Switch to ${nextTheme} theme`}
      onClick={() => choose(nextTheme)}
      className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus grid size-11 shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {resolvedTheme === "dark" ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.4 14.1A8.5 8.5 0 0 1 9.9 3.6 8.5 8.5 0 1 0 20.4 14.1Z" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="3.75" />
          <path d="M12 2.25v2M12 19.75v2M4.25 12h-2M21.75 12h-2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4" />
        </svg>
      )}
    </button>
  );
}
