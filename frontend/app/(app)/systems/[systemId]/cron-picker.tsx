"use client";

import { useState } from "react";
import { Input, Select } from "@/design";

const CUSTOM = "custom";
export const PRESETS = [
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 2 * * 1", label: "Weekly, Monday 02:00" },
  { value: "0 2 1 * *", label: "Monthly, 1st at 02:00" },
  { value: "0 * * * *", label: "Hourly" },
  { value: CUSTOM, label: "Custom cron…" },
];
export const presetLabel = (cron: string | null) =>
  !cron ? "Manual only" : PRESETS.find((p) => p.value === cron)?.label ?? cron;

/** Five cron fields, each a number, range, list, step or star within its bounds; nothing fancier is accepted. */
const FIELD = (min: number, max: number) => {
  const n = `(?:${min === 0 ? "[0-9]|[1-5][0-9]" : "[0-9]|[1-9][0-9]"})`;
  const item = `(?:\\*|${n}(?:-${n})?)(?:/[1-9][0-9]?)?`;
  return { re: new RegExp(`^${item}(?:,${item})*$`), min, max };
};
const FIELDS = [FIELD(0, 59), FIELD(0, 23), FIELD(1, 31), FIELD(1, 12), FIELD(0, 7)];
/** The reason a cron expression is rejected, or undefined when it is valid. */
export function cronError(cron: string): string | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Enter five fields: minute, hour, day, month, weekday";
  const bad = parts.findIndex((p, i) => {
    const f = FIELDS[i]!;
    if (!f.re.test(p)) return true;
    return p.split(/[,\-/]/).some((x) => /^\d+$/.test(x) && (Number(x) < f.min || Number(x) > f.max));
  });
  if (bad >= 0) return `${["Minute", "Hour", "Day", "Month", "Weekday"][bad]} is out of range`;
  return undefined;
}

export function CronPicker({ value, onChange, disabled }: { value: string; onChange: (cron: string) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(!PRESETS.some((p) => p.value === value));
  const [text, setText] = useState(value);
  const error = custom && text.trim() ? cronError(text) : undefined;
  const commit = () => { const t = text.trim(); if (t && !cronError(t) && t !== value) onChange(t); };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="[width:200px]">
          <Select
            label="Schedule"
            options={PRESETS} value={custom ? CUSTOM : value}
            onValueChange={(v) => { setCustom(v === CUSTOM); if (v !== CUSTOM) onChange(v); }} />
        </div>
        {custom && (
          <Input aria-label="Cron expression" placeholder="min hour day month weekday" disabled={disabled}
            className="font-mono" aria-invalid={!!error}
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
            onBlur={commit} />
        )}
      </div>
      {error ? <p className="m-field-error">{error}</p> : null}
    </div>
  );
}
