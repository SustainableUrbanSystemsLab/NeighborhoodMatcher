// Local persistence for the data-use agreement. Stores only a version and
// a timestamp in localStorage — no dataset contents, nothing identifying.
// Bump AGREEMENT_VERSION whenever the agreement text changes materially so
// previously-saved acceptances are re-prompted.

export const AGREEMENT_VERSION = 1;

const KEY = "nbhdmatch:agreement";

export interface SavedAgreement {
  version: number;
  acceptedAt: string; // ISO date
}

export function loadSavedAgreement(): SavedAgreement | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedAgreement;
    if (parsed.version !== AGREEMENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAgreement(): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: AGREEMENT_VERSION,
        acceptedAt: new Date().toISOString(),
      } satisfies SavedAgreement)
    );
  } catch {
    // Storage unavailable (private mode etc.) — silently fall back to
    // asking every time.
  }
}

export function clearAgreement(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
