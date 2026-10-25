// frontend/lib/report-filename.ts
/** The one name of a downloaded report: "Meridian board pack – ECC PRD – 2026-10-25.pdf", never a raw run id. */

/** Reports the pages download by a fixed kind; a catalogue entry passes its own name and extension. */
export const REPORT_FILES = {
  board: { name: "Board pack", ext: "pdf" },
  executive: { name: "Executive report", ext: "pdf" },
  workbook: { name: "Analyst workbook", ext: "xlsx" },
  run_data: { name: "Run data", ext: "json" },
} as const satisfies Record<string, ReportFile>;

export interface ReportFile {
  /** The report as the page names it ("Board pack"); it reads lower case after "Meridian" unless it starts with an acronym. */
  name: string;
  /** File extension without the dot. */
  ext: string;
}

export type ReportFileKind = keyof typeof REPORT_FILES;

// Characters a file system refuses (Windows is the strictest) and control characters.
const UNSAFE = /[\\/:*?"<>|]+/g;

const clean = (s: string) =>
  Array.from(s, (c) => (c.charCodeAt(0) < 32 ? " " : c)).join("").replace(UNSAFE, "-").replace(/\s+/g, " ").trim();

/** "Board pack" reads "board pack" mid-name; "SAP extract" and "ECC run" keep their acronym. */
const midName = (name: string) => (/^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));

/** YYYY-MM-DD in the viewer's own calendar, so a report downloaded tonight carries tonight's date. */
function isoDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The file name of a report download: the product, the report, the scope it covers (a run name such as `runName`
 * gives, or "latest run") and the day, joined by en dashes. A missing scope or an unreadable date drops its part.
 */
export function reportFilename(report: ReportFileKind | ReportFile, scopeLabel?: string | null, date: Date | string = new Date()): string {
  const file = typeof report === "string" ? REPORT_FILES[report] : report;
  const parts = [`Meridian ${midName(clean(file.name))}`, clean(scopeLabel ?? ""), isoDay(date)].filter(Boolean);
  return `${parts.join(" – ")}.${file.ext}`;
}
