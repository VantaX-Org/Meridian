// frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as materialsApi from "@/lib/api/materials";
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
});
