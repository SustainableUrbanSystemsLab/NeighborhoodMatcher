// React binding for the theme preference (see lib/theme.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTheme,
  loadPreference,
  resolveTheme,
  savePreference,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

export interface ThemeControl {
  /** what the viewer asked for: "system" | "light" | "dark" */
  preference: ThemePreference;
  /** what is actually on screen right now */
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

export function useTheme(): ThemeControl {
  const [preference, setPreferenceState] = useState<ThemePreference>(loadPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(loadPreference())
  );
  // The OS listener below is registered once; it reads the CURRENT
  // preference through this ref rather than smuggling a setState side
  // effect into an updater function (React treats updaters as pure and may
  // invoke them twice under StrictMode or replay them when rendering
  // concurrently).
  const preferenceRef = useRef(preference);

  // Keep <html data-theme> in step with the resolved theme.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Follow the OS while the page is open — a viewer on "system" flips at
  // sunset without reloading; an explicit choice ignores the change.
  useEffect(
    () =>
      watchSystemTheme((systemNow) => {
        if (preferenceRef.current === "system") setResolved(systemNow);
      }),
    []
  );

  const setPreference = useCallback((pref: ThemePreference) => {
    preferenceRef.current = pref;
    setPreferenceState(pref);
    savePreference(pref);
    setResolved(resolveTheme(pref));
  }, []);

  return { preference, resolved, setPreference };
}
