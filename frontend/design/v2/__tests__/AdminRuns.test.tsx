import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import * as runsApi from "@/lib/api/v2/runs";
import { RunsSection, cronFor } from "../admin/runs";
import { resetKeptOutcomes } from "../inspector/shared";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));
const ECC = "a1b2c3d4-0001-4000-8000-000000000001";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetRunsFixture();
  resetKeptOutcomes();
  undo = stubLayout(900, 2000);
  h.allowed = "all";
  setUrl("/v2/admin/runs?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const page = () => renderWithQuery(<ToastProvider><RunsSection /></ToastProvider>);
const rows = (name: string) => within(screen.getByRole("grid", { name })).getAllByRole("row").slice(1);

describe("Admin: runs and jobs", () => {
  it("builds a cron line from a cadence", () => {
    expect(cronFor("daily", "02:30", 1, 1)).toBe("30 2 * * *");
    expect(cronFor("weekly", "04:00", 1, 1)).toBe("0 4 * * 1");
    expect(cronFor("monthly", "06:15", 1, 12)).toBe("15 6 12 * *");
  });

  it("starts an extraction of the chosen objects within a scope, and links to the job", async () => {
    const spy = vi.spyOn(adminApi, "startExtraction");
    page();
    const list = await screen.findByRole("list", { name: "Objects to extract" });
    const boxes = await within(list).findAllByRole("checkbox");
    expect(screen.getByRole("button", { name: "Choose objects to extract" })).toBeDisabled();
    fireEvent.click(boxes[0]);
    fireEvent.change(screen.getByLabelText(/Company codes/), { target: { value: "1000, 2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract 1 object" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [system, objects, analyse, scope] = spy.mock.calls[0];
    expect(system).toBe(ECC);
    expect(objects).toHaveLength(1);
    expect(analyse).toBe(true);
    expect(scope).toEqual({ company_codes: ["1000", "2000"], plants: undefined, date_from: undefined, date_to: undefined });
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveTextContent("Extraction started");
    expect(within(result).getByRole("link", { name: "Open the job" })).toBeInTheDocument();
  });

  it("starts an analysis of a stored extraction", async () => {
    const spy = vi.spyOn(runsApi, "analyseRun");
    page();
    const select = await screen.findByLabelText("Extraction");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(0));
    const go = screen.getByRole("button", { name: "Run the analysis" });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Analysis started")).toBeInTheDocument();
  });

  it("loads the configuration of the system", async () => {
    const spy = vi.spyOn(runsApi, "loadSystemConfig");
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Load the configuration" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(ECC));
    expect(await screen.findByText("Configuration load started")).toBeInTheDocument();
  });

  it("lists the scheduled runs, and creates, pauses, edits and deletes one", async () => {
    const create = vi.spyOn(adminApi, "createProfile");
    const update = vi.spyOn(adminApi, "updateProfile");
    const del = vi.spyOn(adminApi, "deleteProfile");
    page();
    await waitFor(() => expect(rows("Scheduled runs")).toHaveLength(2));
    expect(rows("Scheduled runs")[0]).toHaveTextContent("Mondays at 04:00 UTC");
    expect(rows("Scheduled runs")[1]).toHaveTextContent("Paused");

    fireEvent.click(screen.getByRole("button", { name: "Schedule a run" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule a run" });
    const go = within(dialog).getByRole("button", { name: "Create the schedule" });
    expect(go).toBeDisabled();
    await within(dialog).findAllByRole("option", { name: /Material master/ });
    const object = within(dialog).getByLabelText("Object") as HTMLSelectElement;
    fireEvent.change(object, { target: { value: "vendor_master" } });
    fireEvent.click(go);
    await waitFor(() => expect(create).toHaveBeenCalledWith(ECC, expect.objectContaining({ schedule_cron: "0 4 * * 1", active: true, extraction_mode: "full" })));
    await waitFor(() => expect(rows("Scheduled runs")).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Resume Business partner" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(ECC, "pf-2", { active: true }));
    await waitFor(() => expect(rows("Scheduled runs")[1]).not.toHaveTextContent("Paused"));

    fireEvent.click(screen.getByRole("button", { name: "Edit Material master" }));
    const edit = await screen.findByRole("dialog", { name: "Edit the schedule of Material master" });
    fireEvent.change(within(edit).getByLabelText(/Cron line/), { target: { value: "0 5 * * 2" } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save the schedule" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(ECC, "pf-1", { schedule_cron: "0 5 * * 2", extraction_mode: "delta" }));
    await waitFor(() => expect(rows("Scheduled runs")[0]).toHaveTextContent("Tuesdays at 05:00 UTC"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Business partner" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete the schedule of Business partner" });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the schedule" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(ECC, "pf-2"));
    await waitFor(() => expect(rows("Scheduled runs")).toHaveLength(2));
  });

  it("retries a failed job, and opens any job in its inspector", async () => {
    const spy = vi.spyOn(runsApi, "retryJobById");
    page();
    await waitFor(() => expect(rows("Recent jobs").some((r) => /Failed/.test(r.textContent ?? ""))).toBe(true));
    const failed = rows("Recent jobs").find((r) => /Failed/.test(r.textContent ?? "")) as HTMLElement;
    expect(within(failed).getByRole("button", { name: /^Open / })).toBeInTheDocument();
    fireEvent.click(within(failed).getByRole("button", { name: /^Retry / }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Started again")).toBeInTheDocument();
  });

  it("without any run permission it offers nothing; with analyse only, extraction and schedules stay off", async () => {
    h.allowed = ["view"];
    const first = page();
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
    first.unmount();
    h.allowed = ["analyse"];
    page();
    await screen.findByRole("list", { name: "Objects to extract" });
    expect(screen.getByRole("button", { name: "Choose objects to extract" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load the configuration" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Schedule a run" })).toBeDisabled();
    expect(screen.getByText("Scheduling needs the manage systems permission.")).toBeInTheDocument();
  });
});
