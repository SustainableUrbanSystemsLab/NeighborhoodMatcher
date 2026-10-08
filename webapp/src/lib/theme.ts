// Light / dark theme: follows the OS by default, overridable per device.
//
// Three states, not two — "system" is a real choice, not the absence of one:
// a viewer who follows their OS should flip with it (including at sunset,
// while the page is open), which a plain light/dark boolean cannot express.
//
// The chosen theme is applied as `data-theme` on <html>; main.css re-points
// the palette under `[data-theme="dark"]`. index.html applies the same rule
// before first paint, so a dark-mode viewer never gets a white flash.

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "nbhdmatch:theme";

function isPreference(v: unknown): v is ThemePreference {
  return v === "system" || v === "light" || v === "dark";
}

/** Stored choice, or "system" when nothing was chosen (or storage is blocked). */
export function loadPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isPreference(raw) ? raw : "system";
  } catch {
    return "system"; // private mode / storage disabled
  }
}

export function savePreference(pref: ThemePreference): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* not persisting is survivable; the session still honours the choice */
  }
}

/** What the OS/browser currently asks for. */
export function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

/** Writes the resolved theme where CSS can see it. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Calls back when the OS setting changes. Registered unconditionally (not
 * only while on "system") so switching back to "system" is instantly correct
 * without re-subscribing. Returns an unsubscribe function.
 */
export function watchSystemTheme(
  onChange: (theme: ResolvedTheme) => void
): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) return () => {};
  const handler = (e: MediaQueryListEvent) => onChange(e.matches ? "dark" : "light");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
