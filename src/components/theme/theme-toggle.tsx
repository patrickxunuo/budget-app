"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  applyTheme,
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  readStoredPreference,
  THEME_PREFERENCE_LABELS,
  THEME_PREFERENCES,
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

/** A three-way radio group: System (the default), Light, and Dark. */
export function ThemeToggle() {
  const preference = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getSnapshot,
    preferenceStore.getServerSnapshot,
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

  return (
    <fieldset
      data-testid="theme-toggle"
      className="border-line min-w-0 rounded-2xl border px-2 pt-1 pb-2"
    >
      <legend className="font-utility text-muted px-1 text-[.62rem] tracking-[.12em] uppercase">
        Appearance
      </legend>
      <div className="flex min-w-0 items-stretch gap-1">
        {THEME_PREFERENCES.map((value) => {
          const selected = value === preference;
          const inputId = `theme-preference-${value}`;
          return (
            <div key={value} className="min-w-0 flex-1">
              <input
                type="radio"
                name="theme-preference"
                id={inputId}
                value={value}
                checked={selected}
                onChange={() => choose(value)}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                // Selected state is carried by a filled surface, a heavier
                // weight, and a check glyph — never by colour alone.
                className={`peer-focus-visible:outline-focus flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 text-center text-xs transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 ${
                  selected
                    ? "bg-brand text-on-accent font-bold"
                    : "text-muted hover:text-ink font-medium"
                }`}
              >
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="text-[.7rem] leading-none"
                  >
                    ✓
                  </span>
                ) : null}
                <span className="truncate">
                  {THEME_PREFERENCE_LABELS[value]}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
