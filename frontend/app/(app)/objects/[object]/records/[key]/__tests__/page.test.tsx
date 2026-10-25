// frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as materialsApi from "@/lib/api/materials";
import * as workApi from "@/lib/api/work";
import RecordFixSheetPage from "../page";

let routeParams = { object: "material_master", key: "100001" };
vi.mock("next/navigation", () => ({
  useParams: () => routeParams,
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const material: materialsApi.Material360 = {
  matnr: "100001",
  description: "Steel bolt",
  language: "EN",
  mara: {}, makt: [], marm: [], mean: [], marc: [], mvke: [], mbew: [], mard: [], mlgn: [],
  labels: { MTART: "FERT", MATKL: "100", MEINS: "EA" },
  expected_views: null,
  expected_known: true,
  levels: [],
  levels_total: 3,
  views: [
    { view: "basic", label: "Basic data", expected: true, cells: [{ level: "client", state: "ok" }] },
  ],
  phasing: {
    plants: 0, phasing_out: 0, with_followup: 0,
    plant: null, ausdt: null, nfmat: null, followup_description: null,
  },
  version_id: "v1",
};

describe("RecordFixSheetPage", () => {
  it("renders the record identity and view completeness", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue(material);
    vi.spyOn(materialsApi, "getMaterialFindings").mockResolvedValue({
      matnr: "100001", version_id: "v1", rules_total: 0, by_view: [],
    });
    vi.spyOn(materialsApi, "getMaterialSupersession").mockResolvedValue({
      matnr: "100001", plants: [], bom_usage: null,
    });
    vi.spyOn(materialsApi, "getMaterialDuplicates").mockResolvedValue({
      matnr: "100001", algorithm: "exact", threshold: 1, source: "makt", items: [],
    });
    renderWithQuery(<RecordFixSheetPage />);
    await waitFor(() => expect(screen.getByText("Steel bolt")).toBeInTheDocument());
    expect(screen.getByText("100001")).toBeInTheDocument();
    expect(screen.getByText(/basic data: 1\/1 maintained/i)).toBeInTheDocument();
    // One Export, in the record header.
    const exports = screen.getAllByRole("button", { name: "Export" });
    expect(exports).toHaveLength(1);
    expect(exports[0].closest("header")).not.toBeNull();
  });

  it("reads a material that fails a rule as No-go even with every field filled, and links the rule", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue(material);
    vi.spyOn(materialsApi, "getMaterialFindings").mockResolvedValue({
      matnr: "100001", version_id: "v1", rules_total: 1,
      by_view: [{
        view: "basic", label: "Basic data", rules: 1, passing_count: 0, not_evaluated: [],
        failing: [{ check_id: "MM101", message: "Base unit is not allowed", severity: "critical", field: "MARA.MEINS", level: "client", actual_value: "XX", record_key: "100001", issue_id: null, issue_status: null, record_fix: null }],
      }],
    } as never);
    vi.spyOn(materialsApi, "getMaterialSupersession").mockResolvedValue({ matnr: "100001", plants: [], bom_usage: null });
    vi.spyOn(materialsApi, "getMaterialDuplicates").mockResolvedValue({ matnr: "100001", algorithm: "exact", threshold: 1, source: "makt", items: [] });
    renderWithQuery(<RecordFixSheetPage />);
    expect(await screen.findByText("Base unit is not allowed")).toBeInTheDocument();
    expect(screen.getByText("No-go")).toBeInTheDocument();
    expect(screen.queryByText(/^Go$/)).toBeNull();
    expect(screen.getByText("Failing rules", { selector: "h2, h3, [class*=title]" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MM101" })).toHaveAttribute("href", expect.stringContaining("/objects/material_master/rules/MM101"));
  });

  it("shows any other object's record: its fields and the rules it fails, looked up by the whole key", async () => {
    routeParams = { object: "accounts_payable", key: encodeURIComponent("LIFNR=V9|BUKRS=2000") };
    const record = vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue({
      ...material, matnr: "LIFNR=V9|BUKRS=2000", description: "Acme Ltd", views: [],
      mara: { LIFNR: "V9", BUKRS: "2000", AKONT: "", NAME1: "Acme Ltd" }, labels: { Table: "LFB1", LIFNR: "V9", BUKRS: "2000" },
    });
    const findings = vi.spyOn(objectsApi, "getObjectRecordFindings").mockResolvedValue({
      version_id: "v1", failing: [{ check_id: "AP012", severity: "critical", message: "Reconciliation account is missing", field: "LFB1.AKONT" }],
    });
    renderWithQuery(<RecordFixSheetPage />);

    expect(await screen.findByText("Reconciliation account is missing")).toBeInTheDocument();
    expect(record).toHaveBeenCalledWith("accounts_payable", "LIFNR=V9|BUKRS=2000", expect.anything());
    expect(findings).toHaveBeenCalledWith("accounts_payable", "LIFNR=V9|BUKRS=2000", { version_id: "v1" });
    expect(screen.getByRole("link", { name: "AP012" })).toHaveAttribute("href", expect.stringContaining("/objects/accounts_payable/rules/AP012"));
    // Every field, grouped by the sheet's table: the filled ones listed, the blank AKONT folded under "1 blank field".
    const sheet = screen.getByTestId("field-sheet");
    const lfb1 = within(sheet).getByRole("region", { name: "Table LFB1" });
    expect(within(lfb1).getByText("NAME1")).toBeInTheDocument();
    expect(within(lfb1).getByText("1 blank field").closest("details")).toHaveTextContent("AKONT");
    expect(screen.queryByText(/view completeness/i)).not.toBeInTheDocument();
    routeParams = { object: "material_master", key: "100001" };
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockRejectedValue(new Error("network error"));
    vi.spyOn(materialsApi, "getMaterialFindings").mockResolvedValue({
      matnr: "100001", version_id: "v1", rules_total: 0, by_view: [],
    });
    vi.spyOn(materialsApi, "getMaterialSupersession").mockResolvedValue({
      matnr: "100001", plants: [], bom_usage: null,
    });
    vi.spyOn(materialsApi, "getMaterialDuplicates").mockResolvedValue({
      matnr: "100001", algorithm: "exact", threshold: 1, source: "makt", items: [],
    });
    renderWithQuery(<RecordFixSheetPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("puts the record's fix panel for the run at the top, above the record sheet", async () => {
    routeParams = { object: "accounts_payable", key: encodeURIComponent("LIFNR=V9|BUKRS=2000") };
    vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue({ ...material, matnr: "LIFNR=V9|BUKRS=2000", views: [], mara: { LIFNR: "V9" }, labels: { LIFNR: "V9" } });
    vi.spyOn(objectsApi, "getObjectRecordFindings").mockResolvedValue({ version_id: "v1", failing: [] });
    const work = vi.spyOn(workApi, "getWorkRecord").mockResolvedValue({
      version_id: "v1", module: "accounts_payable", record_key: "LIFNR=V9|BUKRS=2000", name: "Acme Ltd", status: "to_fix",
      assigned_to: null, assignee_email: null, values: {}, events: [], can: { fix: true, sign_off: true, assign: true, comment: true },
      other_runs: null, golden_record: null, duplicates: { open: 0, href: "/fix?tab=dedup" }, currency: null,
      issues: [{
        rule: { id: null, name: "Reconciliation account is missing", dimension: "completeness", authority: null, cost_at_risk: null, cost_per_record: null },
        failing: 3, others_failing: 2, population: 40, pass_rate: 92.5, allowed_values: null,
        check_id: "AP012", severity: "critical", dimension: "completeness", message: "Reconciliation account is missing", field: "LFB1.AKONT",
        current_value: "", instruction: null, why_it_matters: null, sap_impact: null, suggestion: { value: "160000", source: "rule", confidence: "high", why: null },
        status: "to_fix", issue_id: "i1", resolution: null, first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, decision: null,
      }],
    });
    renderWithQuery(<RecordFixSheetPage />);
    expect(await screen.findByTestId("record-panel")).toBeInTheDocument();
    expect(work).toHaveBeenCalledWith("accounts_payable", "LIFNR=V9|BUKRS=2000", "v1");
    expect(screen.getByRole("button", { name: 'Accept "160000"' })).toBeInTheDocument();
    expect(screen.getByText(/Fails in 3 of 40 records \(92\.5% pass\)/)).toBeInTheDocument();
    routeParams = { object: "material_master", key: "100001" };
  });

  it("highlights the fields a check fails, in the severity's tint, with a link down to the issue", async () => {
    routeParams = { object: "accounts_payable", key: encodeURIComponent("LIFNR=V9|BUKRS=2000") };
    vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue({
      ...material, matnr: "LIFNR=V9|BUKRS=2000", views: [], mara: { LIFNR: "V9", AKONT: "", ZTERM: "Z030" },
      labels: { Table: "LFB1", LIFNR: "V9" },
    });
    vi.spyOn(objectsApi, "getObjectRecordFindings").mockResolvedValue({ version_id: "v1", failing: [] });
    const issue = (check_id: string, severity: "critical" | "high", field: string, current_value: string | null) => ({
      check_id, severity, dimension: "completeness", message: `${field} is wrong`, field, current_value, instruction: null,
      why_it_matters: null, sap_impact: null, suggestion: null, status: "to_fix" as const, issue_id: null, resolution: null,
      first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, decision: null,
    });
    vi.spyOn(workApi, "getWorkRecord").mockResolvedValue({
      version_id: "v1", module: "accounts_payable", record_key: "LIFNR=V9|BUKRS=2000", name: "Acme Ltd", status: "to_fix",
      assigned_to: null, assignee_email: null, events: [], can: { fix: true, sign_off: true, assign: true, comment: true },
      values: { "LFB1.AKONT": "", "LFA1.STCD1": null },
      issues: [issue("AP012", "critical", "LFB1.AKONT", ""), issue("AP020", "high", "LFA1.STCD1", null)],
    });
    renderWithQuery(<RecordFixSheetPage />);
    const sheet = await screen.findByTestId("field-sheet");
    await waitFor(() => expect(within(sheet).getAllByTestId("failing-field")).toHaveLength(2));
    // Failing tables first: LFA1 (the check's own table) and LFB1, the sheet's.
    const tables = within(sheet).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(tables).toEqual(["Table LFA1", "Table LFB1"]);
    const [stcd1, akont] = within(sheet).getAllByTestId("failing-field");
    expect(akont).toHaveTextContent("AKONT");
    expect(akont.className).toContain("var(--m-critical-soft)");
    expect(stcd1).toHaveTextContent("STCD1");
    expect(stcd1.className).toContain("var(--m-high-soft)");
    const jumps = within(sheet).getAllByRole("link", { name: "Jump to issue" });
    expect(jumps.map((a) => a.getAttribute("href"))).toEqual(["#issue-AP020", "#issue-AP012"]);
    // The anchors exist on the fix panel above.
    expect(document.getElementById("issue-AP012")).not.toBeNull();
    // AKONT is failing, so it is not folded away with the blank fields; ZTERM is listed with its value.
    expect(within(sheet).queryByText(/blank field/)).toBeNull();
    expect(within(sheet).getByText("Z030")).toBeInTheDocument();
    routeParams = { object: "material_master", key: "100001" };
  });

  it("leaves the fix panel out for a record the run's work list does not hold (404)", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue(material);
    vi.spyOn(materialsApi, "getMaterialFindings").mockResolvedValue({ matnr: "100001", version_id: "v1", rules_total: 0, by_view: [] });
    vi.spyOn(materialsApi, "getMaterialSupersession").mockResolvedValue({ matnr: "100001", plants: [], bom_usage: null });
    vi.spyOn(materialsApi, "getMaterialDuplicates").mockResolvedValue({ matnr: "100001", algorithm: "exact", threshold: 1, source: "makt", items: [] });
    const { AxiosError, AxiosHeaders } = await import("axios");
    vi.spyOn(workApi, "getWorkRecord").mockRejectedValue(new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 404, data: { detail: "This record does not fail any check in this run." }, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
    }));
    renderWithQuery(<RecordFixSheetPage />);
    await waitFor(() => expect(screen.getByText("Steel bolt")).toBeInTheDocument());
    await waitFor(() => expect(workApi.getWorkRecord).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("record-panel")).toBeNull());
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });
});
