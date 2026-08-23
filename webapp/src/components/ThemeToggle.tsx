// Theme control: one quiet icon button that cycles Auto → Light → Dark.
//
// A segmented three-way control shouted for a preference most people set once
// (or never). A single glyph keeps all three states reachable while staying
// out of the way: the icon shows which state you are IN, and the tooltip /
// accessible name says what a click will do next.
//
// Inline SVG rather than ☀/☾ characters — emoji fonts render those in color
// on some platforms, which is exactly the loudness this avoids.

import type { ThemeControl } from "@/lib/use-theme";
import type { ThemePreference } from "@/lib/theme";

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<ThemePreference, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

function Icon({ preference }: { preference: ThemePreference }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (preference === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1.4v1.3M8 13.3v1.3M14.6 8h-1.3M2.7 8H1.4M12.7 3.3l-.9.9M4.2 11.8l-.9.9M12.7 12.7l-.9-.9M4.2 4.2l-.9-.9" />
      </svg>
    );
  }
  if (preference === "dark") {
    return (
      <svg {...common}>
        <path d="M13.2 9.6A5.6 5.6 0 1 1 6.4 2.8a4.4 4.4 0 0 0 6.8 6.8Z" />
      </svg>
    );
  }
  // Auto: half-filled circle — the conventional "follows the system" mark.
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ThemeToggle({ theme }: { theme: ThemeControl }) {
  const next = NEXT[theme.preference];
  const state =
    theme.preference === "system"
      ? `Auto (${theme.resolved})`
      : LABEL[theme.preference];

  return (
    <button
      type="button"
      onClick={() => theme.setPreference(next)}
      title={`Theme: ${state} — switch to ${LABEL[next]}`}
      aria-label={`Theme: ${state}. Switch to ${LABEL[next]}.`}
      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
    >
      <Icon preference={theme.preference} />
    </button>
  );
}
