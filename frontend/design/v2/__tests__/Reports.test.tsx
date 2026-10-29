import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import * as rep from "@/lib/api/v2/reports";
import { Inspector } from "../Inspector";
import { resetKeptOutcomes } from "../inspector/shared";
import { ReportsCanvas } from "../screens/Reports";
import { ToastProvider } from "../Toast";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetAdminFixture();
  resetKeptOutcomes();
  undo = stubLayout();
  h.allowed = "all";
  setUrl("/v2/reports?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const dataRows = (name: string) => within(screen.getByRole("grid", { name })).getAllByRole("row").slice(1);
const page = () =>
  renderWithQuery(
    <ToastProvider>
      <ReportsCanvas />
      <Inspector />
    </ToastProvider>,
  );

describe("the reports canvas", () => {
  it("lists the reports with run, format, when, by whom and size, and the schedules with their last result", async () => {
    page();
    await waitFor(() => expect(dataRows("Reports")).toHaveLength(6));
    const first = norm(dataRows("Reports")[0]);
    expect(first).toContain("Board pack");
    expect(first).toContain("Run of 16 Oct 2026");
    expect(first).toContain("PDF");
    expect(first).toContain("Pieter van der Merwe");
    expect(first).toContain("1.8 MB");
    expect(norm(dataRows("Reports")[1])).toContain("XLSX");
    await waitFor(() => expect(dataRows("Schedules")).toHaveLength(3));
    const [weekly, monthly, paused] = dataRows("Schedules").map(norm);
    expect(weekly).toContain("Every Monday at 07:00");
    expect(weekly).toContain("Delivered");
    expect(weekly).toContain("Pieter van der Merwe");
    expect(monthly).toContain("Partly delivered");
    expect(paused).toContain("Paused");
    expect(paused).toContain("Failed");
    expect(screen.getByText(/6 reports made, 2 of 3 schedules are on/)).toBeInTheDocument();
  });

  it("downloads a report from its row, and says when the download fails", async () => {
    const spy = vi.spyOn(rep, "downloadReportFile").mockResolvedValueOnce("board-2026-10-16.pdf").mockRejectedValueOnce(new Error("The file is gone."));
    page();
    await waitFor(() => expect(dataRows("Reports")).toHaveLength(6));
    fireEvent.click(screen.getByRole("button", { name: "Download Board pack, board-2026-10-16.pdf" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("rf-1", "board-2026-10-16.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Download Analyst workbook, workbook-2026-10-15.xlsx" }));
    expect(await screen.findByText("The download did not finish. The file is gone.")).toBeInTheDocument();
  });

  it("opens a report in the inspector, and deletes the file only after a confirmation", async () => {
    const del = vi.spyOn(rep, "deleteReportFile");
    page();
    await waitFor(() => expect(dataRows("Reports")).toHaveLength(6));
    fireEvent.click(dataRows("Reports")[1]);
    await waitFor(() => expect(getUrl()).toContain("open=report%3Arf-2"));
    const dialog = await screen.findByRole("dialog", { name: "Analyst workbook" });
    expect(dialog).toHaveTextContent("workbook-2026-10-15.xlsx");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete the file" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete this report file" });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the file" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("rf-2"));
    await waitFor(() => expect(dataRows("Reports")).toHaveLength(5));
  });

  it("creates a report from a kind, a run and an object: the catalogue's address for them is what is built", async () => {
    const build = vi.spyOn(rep, "buildReport").mockResolvedValue("workbook.xlsx");
    setUrl("/v2/reports?fixture=1&open=report:new");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Create a report" });
    await within(dialog).findByRole("option", { name: "Analyst workbook" });
    fireEvent.change(within(dialog).getByLabelText("Report"), { target: { value: "workbook" } });
    await within(dialog).findByRole("option", { name: "Material master" });
    fireEvent.change(within(dialog).getByLabelText(/^Object/), { target: { value: "material_master" } });
    const go = await within(dialog).findByRole("button", { name: "Create the XLSX report" });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    expect(build.mock.calls[0][0]).toMatchObject({ id: "workbook", format: "XLSX", url: "/api/v1/reports/d3229ded-0708-4967-9dfb-1b7f4fada953/workbook.xlsx?module=material_master" });
    expect(await within(dialog).findByTestId("action-result")).toHaveTextContent("Analyst workbook built");
  });

  it("an object report waits for an object", async () => {
    setUrl("/v2/reports?fixture=1&open=report:new");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Create a report" });
    await within(dialog).findByRole("option", { name: "Object report" });
    fireEvent.change(within(dialog).getByLabelText("Report"), { target: { value: "object" } });
    const go = await within(dialog).findByRole("button", { name: "Create the PDF report" });
    await waitFor(() => expect(go).toBeDisabled());
    await within(dialog).findByRole("option", { name: "Material master" });
    fireEvent.change(within(dialog).getByLabelText(/^Object/), { target: { value: "material_master" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Create the PDF report" })).toBeEnabled());
  });

  it("builds the file from the catalogue address through the download path", async () => {
    const entry = { id: "board", name: "Board pack", format: "PDF" as const, about: "", sections: [], page_estimate: 8, requires: ["run"], url: "/api/v1/reports/board/abc.pdf?compare=def", last_built_at: null };
    await expect(Promise.resolve().then(() => rep.buildReport({ ...entry, url: null }))).rejects.toThrow("This report needs a run");
  });
});

describe("schedules", () => {
  it("creates one: name, report, cadence and at least one recipient", async () => {
    const create = vi.spyOn(rep, "createSchedule");
    setUrl("/v2/reports?fixture=1&open=schedule:new");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Schedule a report" });
    const go = within(dialog).getByRole("button", { name: "Create the schedule" });
    expect(go).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Monday board pack" } });
    expect(go).toBeDisabled();
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Pieter van der Merwe/ }));
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Monday board pack", kind: "board", format: "pdf", params: { scope: "latest", module: null }, cadence: "weekly", time_of_day: "07:00", weekday: 0, day_of_month: null, timezone: "Africa/Johannesburg", recipient_user_ids: ["u-2"], recipient_channel_ids: [], enabled: true }));
    await waitFor(() => expect(dataRows("Schedules")).toHaveLength(4));
  });

  it("a monthly schedule asks for the day of the month and sends that, not a weekday", async () => {
    const create = vi.spyOn(rep, "createSchedule");
    setUrl("/v2/reports?fixture=1&open=schedule:new");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Schedule a report" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Month end" } });
    fireEvent.change(within(dialog).getByLabelText("Cadence"), { target: { value: "monthly" } });
    fireEvent.change(within(dialog).getByLabelText("On day of the month"), { target: { value: "28" } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Aisha Khan/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create the schedule" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ cadence: "monthly", day_of_month: 28, weekday: null, recipient_user_ids: ["u-3"] });
  });

  it("edits one, and Undo in the notice puts the old schedule back", async () => {
    const update = vi.spyOn(rep, "updateSchedule");
    setUrl("/v2/reports?fixture=1&open=schedule:sch-1");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Board pack for the steering committee" });
    await within(dialog).findByRole("checkbox", { name: /Pieter van der Merwe/ });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Board pack for the steering committee");
    fireEvent.change(within(dialog).getByLabelText(/^At /), { target: { value: "06:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the schedule" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({ time_of_day: "06:30", cadence: "weekly", weekday: 0 });
    const notice = await screen.findByText("Schedule Board pack for the steering committee saved");
    fireEvent.click(within(notice.closest(".m2-toast") as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({ time_of_day: "07:00" });
  });

  it("pauses and resumes: the grid says Paused and the next run goes", async () => {
    const update = vi.spyOn(rep, "updateSchedule");
    setUrl("/v2/reports?fixture=1&open=schedule:sch-1");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Board pack for the steering committee" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("sch-1", expect.objectContaining({ enabled: false })));
    await waitFor(() => expect(norm(dataRows("Schedules")[0])).toContain("Paused"));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Resume" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("sch-1", expect.objectContaining({ enabled: true })));
    await waitFor(() => expect(norm(dataRows("Schedules")[0])).not.toContain("Paused"));
  });

  it("runs one now, and deletes it only after a confirmation", async () => {
    const run = vi.spyOn(rep, "runScheduleNow");
    const del = vi.spyOn(rep, "deleteSchedule");
    setUrl("/v2/reports?fixture=1&open=schedule:sch-2");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Analyst workbook, monthly" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Run it now" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("sch-2"));
    expect(await within(dialog).findByTestId("action-result")).toHaveTextContent("Queued to run now");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Analyst workbook, monthly" });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the schedule" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("sch-2"));
    await waitFor(() => expect(dataRows("Schedules")).toHaveLength(2));
  });

  it("without the export permission nothing can be created", async () => {
    h.allowed = ["view"];
    page();
    await waitFor(() => expect(dataRows("Reports")).toHaveLength(6));
    expect(screen.getByRole("button", { name: "Create a report" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Schedule a report" })).toBeDisabled();
    expect(screen.getByText("Creating and scheduling reports needs the export permission.")).toBeInTheDocument();
  });
});
