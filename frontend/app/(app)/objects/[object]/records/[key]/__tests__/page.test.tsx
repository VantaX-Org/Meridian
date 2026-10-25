// frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
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
    // Field values with a value; the blank AKONT is left out.
    expect(screen.getByText("NAME1")).toBeInTheDocument();
    expect(screen.queryByText("AKONT")).not.toBeInTheDocument();
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
      issues: [{
        check_id: "AP012", severity: "critical", dimension: "completeness", message: "Reconciliation account is missing", field: "LFB1.AKONT",
        current_value: "", instruction: null, why_it_matters: null, sap_impact: null, suggestion: { value: "160000", source: "rule", confidence: "high", why: null },
        status: "to_fix", issue_id: "i1", resolution: null, first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, decision: null,
      }],
    });
    renderWithQuery(<RecordFixSheetPage />);
    expect(await screen.findByTestId("record-panel")).toBeInTheDocument();
    expect(work).toHaveBeenCalledWith("accounts_payable", "LIFNR=V9|BUKRS=2000", "v1");
    expect(screen.getByRole("button", { name: 'Accept "160000"' })).toBeInTheDocument();
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
