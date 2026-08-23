// Three-way theme control: System / Light / Dark.
//
// "System" is offered explicitly (and is the default) so following the OS is
// a visible, reversible state rather than the invisible absence of a choice.

import type { ThemeControl } from "@/lib/use-theme";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: string;
  title: string;
}> = [
  { value: "system", label: "Auto", icon: "◐", title: "Follow my system setting" },
  { value: "light", label: "Light", icon: "☀", title: "Always light" },
  { value: "dark", label: "Dark", icon: "☾", title: "Always dark" },
];

export function ThemeToggle({ theme }: { theme: ThemeControl }) {
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center rounded-lg border border-gray-300 bg-surface p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = theme.preference === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            title={
              opt.value === "system"
                ? `${opt.title} (currently ${theme.resolved})`
                : opt.title
            }
            onClick={() => theme.setPreference(opt.value)}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}
          >
            <span aria-hidden="true">{opt.icon}</span>
            <span className="ml-1 hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
