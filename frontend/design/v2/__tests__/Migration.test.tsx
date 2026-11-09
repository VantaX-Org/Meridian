import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureWorkbookReport } from "@/lib/api/v2/fixtures/migration";
import * as migrationApi from "@/lib/api/v2/migration";
import * as runsApi from "@/lib/api/v2/runs";
import { Migration } from "../screens/Migration";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/migration");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Migration analysis", () => {
  it("leads with the verdict of the latest analysis and lists both analyses", async () => {
    renderWithQuery(<Migration />);
    const banner = await screen.findByTestId("mig-banner");
    expect(banner.textContent).toMatch(/Not ready to load/);
    const runs = await screen.findByTestId("mig-runs");
    expect(within(runs).getAllByRole("row").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the field-level gaps with their fields and the field map", async () => {
    renderWithQuery(<Migration />);
    const findings = await screen.findByTestId("mig-findings");
    await within(findings).findAllByRole("row");
    expect(findings.textContent).toContain("MTART");
    expect(findings.textContent).toContain("ZROH");
    const map = await screen.findByTestId("mig-field-map");
    await within(map).findAllByRole("row");
    expect(map.textContent).toContain("MAKTX");
    expect(map.textContent).toContain("Shortened from 70 to 40 characters");
    expect(map.textContent).toContain("Type changes from NUMC to DEC");
    expect(map.textContent).toContain("Needs a transformation");
    expect(within(map).getByTestId("mig-delta-bars").textContent).toContain("Change with no transformation yet");
  });

  it("lets a second person approve a proposed value and keeps the proposer's own entry waiting", async () => {
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const map = await screen.findByTestId("mig-field-map");
    fireEvent.click(await within(map).findByRole("button", { name: "Values" }));
    const vm = await screen.findByTestId("mig-value-map");
    expect(await within(vm).findByTestId("mig-vm-status-ZFRT")).toHaveTextContent("Approved");
    expect(within(vm).queryByTestId("mig-vm-approve-ZFRT")).toBeNull();
    expect(within(vm).getByTestId("mig-vm-status-ZROH")).toHaveTextContent("Waits for a second person");
    fireEvent.click(within(vm).getByTestId("mig-vm-approve-ZROH"));
    await waitFor(() => expect(within(vm).getByTestId("mig-vm-status-ZROH")).toHaveTextContent("Approved"));
    fireEvent.change(within(vm).getByLabelText("Target value for HALB"), { target: { value: "HALB" } });
    fireEvent.click(within(vm).getByRole("button", { name: "Propose these values" }));
    await waitFor(() => expect(within(vm).getByTestId("mig-vm-status-HALB")).toHaveTextContent("Waits for a second person"));
    expect(within(vm).queryByTestId("mig-vm-approve-HALB")).toBeNull();
  });

  it("marks an automatic reconciliation and shows the count change since the previous one", async () => {
    renderWithQuery(<Migration />);
    const panel = await screen.findByTestId("mig-post-load");
    expect((await within(panel).findByTestId("mig-post-load-auto")).textContent).toContain("Started automatically");
    const change = within(panel).getByTestId("mig-post-load-change").textContent ?? "";
    expect(change).toContain("198 missing (-241)");
    expect(change).toContain("143 fields differ (-58)");
    expect(change).toContain("83,782 found (+241)");
  });

  it("offers the target extraction when the reconciliation found nothing to compare with", async () => {
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Open the analysis of 20 Oct/ }));
    const note = await screen.findByTestId("mig-post-load-needs-target");
    expect(note.textContent).toContain("has not been extracted yet");
    fireEvent.click(within(note).getByRole("button", { name: "Extract the target system" }));
    expect(await screen.findByText("Extraction of the target system started")).toBeTruthy();
  });

  it("deletes an analysis only after a confirmation", async () => {
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const runs = await screen.findByTestId("mig-runs");
    const before = within(runs).getAllByRole("row").length;
    fireEvent.click(within(runs).getAllByRole("button", { name: /^Delete the analysis of/ })[2]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete the analysis" }));
    expect(await screen.findByText("Analysis deleted")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId("mig-runs")).getAllByRole("row").length).toBe(before - 1));
  });
});

describe("Workbook from the new system", () => {
  const pick = async () => {
    const panel = await screen.findByTestId("mig-workbook");
    const button = await within(panel).findByRole("button", { name: "Check the workbook" });
    return { panel, button: button as HTMLButtonElement };
  };
  const choose = (panel: HTMLElement) =>
    fireEvent.change(within(panel).getByTestId("mig-workbook-file"), { target: { files: [new File(["x"], "target.xlsx")] } });

  it("keeps the check closed until a workbook is chosen", async () => {
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    expect(button.disabled).toBe(true);
    choose(panel);
    expect(button.disabled).toBe(false);
  });

  it("reports what fits, what is missing and what is held back", async () => {
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    expect((await within(panel).findByTestId("mig-workbook-summary")).textContent).toContain("118 rows are ready and 2 are held back");
    expect(within(panel).getByTestId("mig-workbook-required").textContent).toContain("2 required columns");
    expect(panel.textContent).toContain("Biographical Information");
    expect(panel.textContent).toContain("Not filled");
    expect(panel.textContent).toContain("Not a valid date");
    expect(within(panel).getByTestId("mig-workbook-format").textContent).toContain("Excel workbook");
    expect(within(panel).getByTestId("mig-workbook-mapped").textContent).toContain("14 values");
    expect(panel.textContent).toContain("Country rules not checked");
  });

  it("names the upload's format and offers the same layout back", async () => {
    vi.spyOn(migrationApi, "checkTargetWorkbook").mockResolvedValue({
      ...fixtureWorkbookReport(), format: { id: "xml2003", same: true, written_as: "xml", skipped: ["notes.pdf"] },
      summary: { ...fixtureWorkbookReport().summary, mandatory_sheets_empty: 1 },
    });
    const save = vi.spyOn(migrationApi, "exportTargetWorkbook").mockResolvedValue("target_workbook.xml");
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    expect((await within(panel).findByTestId("mig-workbook-format")).textContent).toContain("Migration Cockpit");
    expect(within(panel).getByTestId("mig-workbook-skipped").textContent).toContain("notes.pdf");
    expect(within(panel).getByTestId("mig-workbook-empty").textContent).toContain("1 mandatory sheets");
    fireEvent.click(within(panel).getByRole("button", { name: "Export in the same format" }));
    await screen.findByText("Workbook data saved as target_workbook.xml");
    expect(save.mock.calls[0].slice(2)).toEqual(["source", "xml"]);
  });

  it("does not offer the same layout when the upload cannot come back in it", async () => {
    vi.spyOn(migrationApi, "checkTargetWorkbook").mockResolvedValue({ ...fixtureWorkbookReport(), format: { id: "xlsx", same: false, written_as: "xlsx", skipped: [] } });
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    await within(panel).findByTestId("mig-workbook-summary");
    expect(within(panel).queryByRole("button", { name: "Export in the same format" })).toBeNull();
  });

  it("exports the checked workbook in the chosen format", async () => {
    const save = vi.spyOn(migrationApi, "exportTargetWorkbook").mockResolvedValue("target_workbook.xlsx");
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    fireEvent.click(await within(panel).findByRole("button", { name: "Export as Excel" }));
    expect(await screen.findByText("Workbook data saved as target_workbook.xlsx")).toBeTruthy();
    expect(save.mock.calls[0][2]).toBe("xlsx");
  });

  it("clears the report when the workbook changes", async () => {
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    await within(panel).findByTestId("mig-workbook-summary");
    choose(panel);
    await waitFor(() => expect(within(panel).queryByTestId("mig-workbook-summary")).toBeNull());
  });

  it("lists the columns it learned and updates the run that fetches them", async () => {
    const start = vi.spyOn(runsApi, "extractObjects").mockResolvedValue({ job_id: "dl-1", status: "queued" });
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    const learned = await within(panel).findByTestId("mig-workbook-learned");
    expect(learned.textContent).toContain("1 columns in this workbook were not in the extraction");
    expect(learned.textContent).toContain("Pay Grade");
    expect(learned.textContent).not.toContain("Seniority Band");
    expect(screen.getByTestId("mig-workbook-not-in-system").textContent).toContain("did not return on the last run");
    const ambiguous = screen.getByTestId("mig-workbook-ambiguous").textContent;
    expect(ambiguous).toContain("1 columns name a field that more than one of this object's tables holds");
    expect(ambiguous).toContain("PA0001");
    expect(ambiguous).toContain("PA0008");
    fireEvent.click(within(learned).getByTestId("mig-workbook-update"));
    expect((await within(panel).findByTestId("mig-workbook-updating")).textContent).toContain("check the workbook again");
    expect(start).toHaveBeenCalledWith("sys-sf", ["employee_central"], true);
  });

  it("states why the workbook was refused", async () => {
    vi.spyOn(migrationApi, "checkTargetWorkbook").mockRejectedValue({ isAxiosError: true, response: { data: { detail: "Nothing in this run matches the sheets in this workbook." } } });
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const { panel, button } = await pick();
    choose(panel);
    fireEvent.click(button);
    expect((await within(panel).findByRole("alert")).textContent).toContain("Nothing in this run matches");
  });

  it("says so when no run has finished", async () => {
    vi.spyOn(runsApi, "getVersionsPage").mockResolvedValue({ versions: [], total: 0 });
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    expect((await screen.findByTestId("mig-workbook")).textContent).toBeTruthy();
    expect(await screen.findByText(/No run has finished yet/)).toBeTruthy();
  });

  it("offers a retry when the runs cannot be read", async () => {
    vi.spyOn(runsApi, "getVersionsPage").mockRejectedValue(new Error("Network Error"));
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    const panel = await screen.findByTestId("mig-workbook");
    expect(await within(panel).findByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("is hidden from a role that cannot export", async () => {
    const u = "/migration?fixture=1&role=viewer";
    window.history.pushState({}, "", u);
    setUrl(u);
    renderWithQuery(<ToastProvider><Migration /></ToastProvider>);
    await screen.findByTestId("mig-banner");
    expect(screen.queryByTestId("mig-workbook")).toBeNull();
    window.history.pushState({}, "", "/");
  });
});
