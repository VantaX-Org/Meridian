import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as downloadApi from "@/lib/api/download";
import * as reportsApi from "@/lib/api/reports";
import type { ReportFile, ReportSchedule, ScheduleOptions } from "@/lib/api/reports";
import { ReportHistory, formatSize } from "../_components/ReportHistory";
import { ReportSchedules, scheduleInput } from "../_components/ReportSchedules";

vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => ({ can: () => true, has: () => true }),
  usePermissionsContext: () => null,
}));

const NAMES: Record<string, string> = { board: "Board pack", workbook: "Comparison workbook", trend: "Progress report", object: "Object report" };
const nameOf = (k: string) => NAMES[k] ?? k;

const file = (over: Partial<ReportFile> = {}): ReportFile => ({
  id: "f1", kind: "board", name: "Board pack", version_id: "v2", run_label: "Run 2", run_at: "2026-10-16T05:00:00Z",
  format: "pdf", file_name: "meridian_board_v2.pdf", size_bytes: 248_000, source: "download", schedule_id: null,
  created_by: "u1", created_by_label: "Ana", created_at: "2026-10-20T08:00:00Z", can_delete: true, ...over,
});

const schedule = (over: Partial<ReportSchedule> = {}): ReportSchedule => ({
  id: "s1", name: "Monday board", kind: "board", format: "pdf", params: { scope: "latest" }, cadence: "weekly",
  time_of_day: "07:00", weekday: 0, day_of_month: null, timezone: "Africa/Johannesburg", recipient_user_ids: ["u1"],
  recipient_channel_ids: ["c1"], enabled: true, last_run_at: "2026-10-19T05:00:00Z", last_status: "partial",
  next_run_at: "2026-10-26T05:00:00Z", created_by: "u1", created_at: "2026-10-01T00:00:00Z",
  summary: "Every Monday at 07:00 (Africa/Johannesburg)", can_edit: true, ...over,
});

const OPTIONS: ScheduleOptions = {
  timezone: "Africa/Johannesburg",
  types: [
    { id: "board", name: "Board pack", format: "pdf", needs_run: true, needs_module: false },
    { id: "workbook", name: "Analyst workbook", format: "xlsx", needs_run: true, needs_module: false },
    { id: "object", name: "Object report", format: "pdf", needs_run: true, needs_module: true },
  ],
  users: [{ id: "u1", label: "Ana", detail: "ana@example.test" }, { id: "u2", label: "Bob", detail: "bob@example.test" }],
  channels: [{ id: "c1", label: "Slack", detail: "slack" }],
  systems: [{ id: "sys1", label: "ECC production" }],
  modules: ["material_master"],
};

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("ReportHistory", () => {
  it("lists stored files with name, type, run, format, size, by and when", async () => {
    vi.spyOn(reportsApi, "getReportHistory").mockResolvedValue({ total: 1, limit: 10, offset: 0, items: [file()] });
    mount(<ReportHistory nameOf={nameOf} kinds={["board", "workbook"]} />);
    const row = (await screen.findByText("Run 2")).closest("tr") as HTMLElement;
    expect(within(row).getByText("PDF")).toBeInTheDocument();
    expect(within(row).getByText("242 KB")).toBeInTheDocument();
    expect(within(row).getByText("Ana")).toBeInTheDocument();
    expect(reportsApi.getReportHistory).toHaveBeenCalledWith({ kind: undefined, limit: 10, offset: 0 });
  });

  it("downloads a stored file by its id and file name", async () => {
    vi.spyOn(reportsApi, "getReportHistory").mockResolvedValue({ total: 1, limit: 10, offset: 0, items: [file()] });
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    mount(<ReportHistory nameOf={nameOf} kinds={["board"]} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download Board pack" }));
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/history/f1/download", "meridian_board_v2.pdf");
  });

  it("deletes after confirmation, and offers delete only where allowed", async () => {
    vi.spyOn(reportsApi, "getReportHistory").mockResolvedValue({
      total: 2, limit: 10, offset: 0,
      items: [file(), file({ id: "f2", name: "Someone else's", can_delete: false, created_by_label: null, source: "schedule" })],
    });
    const del = vi.spyOn(reportsApi, "deleteReportFile").mockResolvedValue();
    mount(<ReportHistory nameOf={nameOf} kinds={["board"]} />);
    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Someone else's" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Delete Board pack" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete report" }));
    expect(del).toHaveBeenCalledWith("f1", expect.anything());
  });

  it("filters by report type", async () => {
    const get = vi.spyOn(reportsApi, "getReportHistory").mockResolvedValue({ total: 0, limit: 10, offset: 0, items: [] });
    mount(<ReportHistory nameOf={nameOf} kinds={["board", "workbook"]} />);
    expect(await screen.findByText(/No report has been kept yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Report type" }));
    await userEvent.click(await screen.findByRole("option", { name: "Comparison workbook" }));
    expect(get).toHaveBeenLastCalledWith({ kind: "workbook", limit: 10, offset: 0 });
  });

  it("formats sizes", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(12 * 1024 * 1024)).toBe("12 MB");
  });
});

describe("ReportSchedules", () => {
  it("lists schedules with cadence, recipients, next run and last result", async () => {
    vi.spyOn(reportsApi, "getReportSchedules").mockResolvedValue([schedule()]);
    vi.spyOn(reportsApi, "getReportScheduleOptions").mockResolvedValue(OPTIONS);
    mount(<ReportSchedules nameOf={nameOf} />);
    const row = (await screen.findByText("Monday board")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Every Monday at 07:00 (Africa/Johannesburg)")).toBeInTheDocument();
    expect(await within(row).findByText("Ana, Slack")).toBeInTheDocument();
    expect(within(row).getByText("Partly sent")).toBeInTheDocument();
  });

  it("runs a schedule now", async () => {
    vi.spyOn(reportsApi, "getReportSchedules").mockResolvedValue([schedule()]);
    vi.spyOn(reportsApi, "getReportScheduleOptions").mockResolvedValue(OPTIONS);
    const run = vi.spyOn(reportsApi, "runReportScheduleNow").mockResolvedValue({ queued: true, due_at: "x" });
    mount(<ReportSchedules nameOf={nameOf} />);
    await userEvent.click(await screen.findByRole("button", { name: "Run Monday board now" }));
    expect(run).toHaveBeenCalledWith("s1", expect.anything());
  });

  it("hides actions on a schedule the viewer cannot change", async () => {
    vi.spyOn(reportsApi, "getReportSchedules").mockResolvedValue([schedule({ can_edit: false })]);
    vi.spyOn(reportsApi, "getReportScheduleOptions").mockResolvedValue(OPTIONS);
    mount(<ReportSchedules nameOf={nameOf} />);
    expect(await screen.findByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Monday board/ })).toBeNull();
  });

  it("creates a schedule from the drawer in the tenant time zone", async () => {
    vi.spyOn(reportsApi, "getReportSchedules").mockResolvedValue([]);
    vi.spyOn(reportsApi, "getReportScheduleOptions").mockResolvedValue(OPTIONS);
    const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(schedule());
    mount(<ReportSchedules nameOf={nameOf} />);
    await screen.findByText(/No schedule yet/);
    await userEvent.click(await screen.findByRole("button", { name: "New schedule" }));
    const save = await screen.findByRole("button", { name: "Create schedule" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "Monthly board");
    await userEvent.click(screen.getByRole("button", { name: "Monthly" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Bob" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Slack" }));
    await userEvent.click(save);
    expect(create).toHaveBeenCalledWith({
      name: "Monthly board", kind: "board", params: { scope: "latest" }, cadence: "monthly", time_of_day: "07:00",
      weekday: null, day_of_month: 1, timezone: "Africa/Johannesburg", recipient_user_ids: ["u2"],
      recipient_channel_ids: ["c1"], enabled: true,
    });
  });

  it("edits a schedule and saves the whole body", async () => {
    vi.spyOn(reportsApi, "getReportSchedules").mockResolvedValue([schedule()]);
    vi.spyOn(reportsApi, "getReportScheduleOptions").mockResolvedValue(OPTIONS);
    const update = vi.spyOn(reportsApi, "updateReportSchedule").mockResolvedValue(schedule());
    mount(<ReportSchedules nameOf={nameOf} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Monday board" }));
    await userEvent.click(await screen.findByRole("switch", { name: "Schedule is on" }));
    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({ enabled: false, weekday: 0, day_of_month: null, cadence: "weekly" }));
  });

  it("sends a module only for a report that needs one", () => {
    const base = { name: " X ", kind: "object", scope: "sys1", module: "material_master", cadence: "daily" as const, time: "06:30",
      weekday: "3", day: "9", timezone: "", users: [], channels: [], enabled: true };
    expect(scheduleInput(base, true)).toMatchObject({ name: "X", params: { scope: "sys1", module: "material_master" }, weekday: null, day_of_month: null, timezone: null });
    expect(scheduleInput(base, false).params).toEqual({ scope: "sys1" });
  });
});
