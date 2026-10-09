// frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { AxiosError, type AxiosResponse } from "axios";
import * as objectsApi from "@/lib/api/v1/objects";
import * as materialsApi from "@/lib/api/materials";
import RecordFixSheetPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master", key: "100001" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

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
  });

  it("shows a not-yet-available state for an unsupported object", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockRejectedValue(
      new AxiosError("Not Implemented", "ERR_BAD_RESPONSE", undefined, undefined, { status: 501 } as AxiosResponse),
    );
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
    await waitFor(() => expect(screen.getByText(/not yet available/i)).toBeInTheDocument());
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
