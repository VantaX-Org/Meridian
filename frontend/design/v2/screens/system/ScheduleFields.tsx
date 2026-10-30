"use client";

import { useState } from "react";
import { cronError, CUSTOM, isPreset, MODES, PRESETS } from "@/lib/v2/cron";
import { Field } from "../../forms";
import { t } from "@/lib/v2/i18n";

export interface ScheduleValue {
  cron: string;
  mode: "full" | "delta";
}

/** A schedule's timetable and mode: a preset or a custom cron (checked as you type), and full or changes only. */
export function ScheduleFields({ value, onChange, disabled }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(() => !isPreset(value.cron));
  const error = custom && value.cron.trim() ? cronError(value.cron) : custom ? t("Enter five fields: minute, hour, day, month, weekday") : undefined;
  return (
    <>
      <Field label={t("Schedule")} hint={t("Times are UTC; a due run starts within 5 minutes.")}>
        {(p) => (
          <select
            {...p}
            disabled={disabled}
            value={custom ? CUSTOM : value.cron}
            onChange={(e) => {
              if (e.target.value === CUSTOM) setCustom(true);
              else {
                setCustom(false);
                onChange({ ...value, cron: e.target.value });
              }
            }}
          >
            {PRESETS.map((x) => (
              <option key={x.value} value={x.value}>{x.label}</option>
            ))}
          </select>
        )}
      </Field>
      {custom ? (
        <Field label={t("Cron expression")} error={error} hint={t("Minute hour day month weekday")}>
          {(p) => <input {...p} disabled={disabled} className="m2-mono" value={value.cron} onChange={(e) => onChange({ ...value, cron: e.target.value })} placeholder="0 2 * * 1" />}
        </Field>
      ) : null}
      <Field label={t("Mode")} hint={t("Changes only reads the records SAP changed since the last download, with a full download at least once a week.")}>
        {(p) => (
          <select {...p} disabled={disabled} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value === "delta" ? "delta" : "full" })}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

/** True when the schedule value can be sent. */
export const scheduleValid = (v: ScheduleValue): boolean => !cronError(v.cron);
