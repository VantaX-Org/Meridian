/** Fixture reads for the monitor feed and the Aletheia suggestions (batch 8). */
export const NONE_B8 = Symbol("none-b8");

const items = [
  { module: "material_master", label: "Material master", check_id: "MM022", change: "new", records: 412, reason: "Material group is blank on new records.", version_id: "run-0412", baseline_version_id: "run-0409", detected_at: "2026-11-14T06:10:00Z", severity: "high", owner: "Ana Roberts" },
  { module: "material_master", label: "Material master", check_id: "MM031", change: "regressed", records: 96, reason: "Base unit of measure is blank again.", version_id: "run-0412", baseline_version_id: "run-0409", detected_at: "2026-11-14T06:10:00Z", severity: "medium", owner: "Ana Roberts" },
  { module: "sd_customer_master", label: "Customer master", check_id: "CM014", change: "new", records: 58, reason: "Tax number missing on new customers.", version_id: "run-0411", baseline_version_id: "run-0408", detected_at: "2026-11-13T06:05:00Z", severity: "high", owner: "Sipho Dlamini" },
  { module: "employee_central", label: "Employee Central", check_id: "EC009", change: "regressed", records: 21, reason: "Manager link points to a terminated employee.", version_id: "run-0410", baseline_version_id: "run-0407", detected_at: "2026-11-12T06:00:00Z", severity: "low", owner: "Lerato Mokoena" },
];
const runs = [
  { version_id: "run-0412", resolved: 37, module: "material_master", label: "Material master", baseline_version_id: "run-0409", detected_at: "2026-11-14T06:10:00Z", owner: "Ana Roberts" },
  { version_id: "run-0411", resolved: 12, module: "sd_customer_master", label: "Customer master", baseline_version_id: "run-0408", detected_at: "2026-11-13T06:05:00Z", owner: "Sipho Dlamini" },
  { version_id: "run-0410", resolved: 5, module: "employee_central", label: "Employee Central", baseline_version_id: "run-0407", detected_at: "2026-11-12T06:00:00Z", owner: "Lerato Mokoena" },
];

export function b8Read(path: string, params: Record<string, unknown>): unknown {
  if (path === "/objects/monitor/feed") {
    const m = params.module ? String(params.module) : "";
    const rows = m ? items.filter((i) => i.module === m) : items;
    return { items: rows, runs: m ? runs.filter((r) => r.module === m) : runs, total: rows.length, limit: Number(params.limit ?? 50), offset: 0, next_offset: null };
  }
  if (path === "/assistant/suggestions") {
    return { suggestions: ["Which rules fail the most records?", "What changed since the last run?", "Where is the biggest cost of bad data?", "Which owner has the most open items?"] };
  }
  return NONE_B8;
}
