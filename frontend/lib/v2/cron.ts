/** The schedules a person can pick, and the check of a custom cron. Times are UTC, as the scheduler runs. */

export const CUSTOM = "custom";

export const PRESETS: { value: string; label: string }[] = [
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 2 * * 1", label: "Weekly, Monday 02:00" },
  { value: "0 2 1 * *", label: "Monthly, 1st at 02:00" },
  { value: "0 * * * *", label: "Hourly" },
  { value: CUSTOM, label: "Custom cron" },
];

export const MODES: { value: "full" | "delta"; label: string }[] = [
  { value: "full", label: "Full extraction" },
  { value: "delta", label: "Changes only" },
];

export const isPreset = (cron: string): boolean => PRESETS.some((p) => p.value === cron && p.value !== CUSTOM);

export const presetLabel = (cron: string | null): string => (!cron ? "Manual only" : PRESETS.find((p) => p.value === cron)?.label ?? cron);

const FIELD = (min: number) => {
  const n = `(?:${min === 0 ? "[0-9]|[1-5][0-9]" : "[0-9]|[1-9][0-9]"})`;
  const item = `(?:\\*|${n}(?:-${n})?)(?:/[1-9][0-9]?)?`;
  return { re: new RegExp(`^${item}(?:,${item})*$`), min };
};
const FIELDS = [
  { ...FIELD(0), max: 59 },
  { ...FIELD(0), max: 23 },
  { ...FIELD(1), max: 31 },
  { ...FIELD(1), max: 12 },
  { ...FIELD(0), max: 7 },
];
const NAMES = ["Minute", "Hour", "Day", "Month", "Weekday"];

/** Five cron fields, each a number, range, list, step or star within its bounds; nothing fancier is accepted. */
export function cronError(cron: string): string | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Enter five fields: minute, hour, day, month, weekday";
  const bad = parts.findIndex((p, i) => {
    const f = FIELDS[i];
    if (!f.re.test(p)) return true;
    return p.split(/[,\-/]/).some((x) => /^\d+$/.test(x) && (Number(x) < f.min || Number(x) > f.max));
  });
  return bad >= 0 ? `${NAMES[bad]} is out of range` : undefined;
}

const WEEKDAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** A cron in words for the common shapes (daily, weekly), else the cron itself. Times are UTC, as the scheduler runs. */
export function describeCron(cron: string | null): string {
  if (!cron) return "No schedule";
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (![m, h, dom, mon, dow].every(Boolean) || !/^\d+$/.test(m) || !/^\d+$/.test(h) || dom !== "*" || mon !== "*") return cron;
  const at = `${h.padStart(2, "0")}:${m.padStart(2, "0")} UTC`;
  if (dow === "*") return `Every day at ${at}`;
  return /^\d$/.test(dow) ? `${WEEKDAY[Number(dow) % 7]} at ${at}` : cron;
}

