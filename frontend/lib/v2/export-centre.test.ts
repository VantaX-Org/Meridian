import { describe, expect, it } from "vitest";
import { exportRequest, exportSchedule, scheduleReady, type ExportChoice } from "./export-centre";

const choice: ExportChoice = { dataset: "findings", format: "xlsx", columns: ["rule_id", "rule_text"], system: "", module: "material_master", run: "all", severity: ["critical"], split: "module" };

describe("export centre bodies", () => {
  it("sends empty filters as null so the server applies its defaults", () => {
    expect(exportRequest(choice)).toEqual({ dataset: "findings", format: "xlsx", columns: ["rule_id", "rule_text"], system: null, module: "material_master", run: "all", severity: ["critical"], split: "module" });
  });

  it("splits sheets only in a workbook", () => {
    expect(exportRequest({ ...choice, format: "csv" }).split).toBe("none");
    expect(exportSchedule({ ...choice, format: "json" }, { name: "x", cadence: "daily", time: "07:00", users: [], folder: true }).params.split).toBe("none");
  });

  it("schedules the export kind with the same filters and the folder flag", () => {
    const body = exportSchedule({ ...choice, system: "sys-1" }, { name: " Weekly findings ", cadence: "weekly", time: "06:30", users: ["u1"], folder: true });
    expect(body).toMatchObject({ name: "Weekly findings", kind: "export_findings", format: "xlsx", cadence: "weekly", weekday: 0, day_of_month: null, time_of_day: "06:30", recipient_user_ids: ["u1"], recipient_channel_ids: [] });
    expect(body.params).toEqual({ scope: "sys-1", module: "material_master", columns: ["rule_id", "rule_text"], severity: ["critical"], run: "all", split: "module", folder: true });
    expect(exportSchedule(choice, { name: "m", cadence: "monthly", time: "06:30", users: ["u1"], folder: false }).params.scope).toBe("latest");
  });

  it("needs a name, a time and somewhere to deliver", () => {
    const s = { name: "n", cadence: "daily" as const, time: "07:00", users: [], folder: false };
    expect(scheduleReady(s)).toBe(false);
    expect(scheduleReady({ ...s, folder: true })).toBe(true);
    expect(scheduleReady({ ...s, users: ["u"] })).toBe(true);
    expect(scheduleReady({ ...s, users: ["u"], name: " " })).toBe(false);
  });
});
