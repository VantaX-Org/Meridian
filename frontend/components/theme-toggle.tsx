"use client";

import type { KeyboardEvent } from "react";
import { useAuroraPrefs, type Theme } from "@/hooks/use-theme";
import { IconMonitor, IconMoon, IconSun, type Icon } from "@/design";

const OPTIONS: { value: Theme; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "system", label: "System", icon: IconMonitor },
  { value: "dark", label: "Dark", icon: IconMoon },
];

/** Light / System / Dark as `.m-choice` pills in a radio group (arrow keys move the choice). Stored by useAuroraPrefs. */
export function ThemeToggle() {
  const { theme, setTheme } = useAuroraPrefs();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation(); // keep a parent menu's own arrow handling out of it
    const i = OPTIONS.findIndex((o) => o.value === theme);
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length]!;
    setTheme(next.value);
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown} className="inline-flex items-center gap-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={value}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTheme(value)}
            className="m-choice"
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
