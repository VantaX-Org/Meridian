/**
 * The export centre's request bodies (api/routes/report_library.py POST /reports/exports and the export_<dataset>
 * schedule kinds), built from the form's choices so the screen and its test share one shape.
 */
import type { ExportFormat, ExportRequest, ExportRun, ExportSeverity, ExportSplit } from "@/lib/api/v2/reports";
import type { ReportScheduleInput, ScheduleCadence } from "@/lib/api/reports";

export interface ExportChoice {
  dataset: string;
  format: ExportFormat;
  /** Column keys in the order chosen; every column when empty. */
  columns: string[];
  /** A system id, "upload" or "" for every system. */
  system: string;
  module: string;
  run: ExportRun;
  severity: ExportSeverity[];
  split: ExportSplit;
}

/** The body of POST /reports/exports. Empty choices are left out so the server applies its defaults. */
export function exportRequest(c: ExportChoice): ExportRequest {
  return {
    dataset: c.dataset,
    format: c.format,
    columns: c.columns,
    system: c.system || null,
    module: c.module || null,
    run: c.run,
    severity: c.severity,
    split: c.format === "xlsx" ? c.split : "none",
  };
}

export interface ExportScheduleChoice {
  name: string;
  cadence: ScheduleCadence;
  time: string;
  users: string[];
  /** Also write the file to the server export folder. */
  folder: boolean;
}

/** The body of POST /reports/schedules for an export: kind export_<dataset>, the same filters as a one-off export. */
export function exportSchedule(c: ExportChoice, s: ExportScheduleChoice): ReportScheduleInput {
  return {
    name: s.name.trim(),
    kind: `export_${c.dataset}`,
    format: c.format,
    params: {
      scope: c.system || "latest",
      module: c.module || null,
      columns: c.columns,
      severity: c.severity,
      run: c.run,
      split: c.format === "xlsx" ? c.split : "none",
      folder: s.folder,
    },
    cadence: s.cadence,
    time_of_day: s.time,
    weekday: s.cadence === "weekly" ? 0 : null,
    day_of_month: s.cadence === "monthly" ? 1 : null,
    recipient_user_ids: s.users,
    recipient_channel_ids: [],
    enabled: true,
  };
}

/** A schedule must deliver somewhere: to a person, or to the server folder. */
export const scheduleReady = (s: ExportScheduleChoice): boolean => s.name.trim().length > 0 && /^\d{2}:\d{2}$/.test(s.time) && (s.users.length > 0 || s.folder);
