import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/reference-data";
import * as runs from "@/lib/api/v2/runs";
import type { SAPSystemExtended } from "@/types/api";
import { ToastProvider } from "../../../kit";
import { ReferenceDataNative } from "../ReferenceData";

const Q = vi.hoisted(() => ({ can: (() => true) as (p: string) => boolean }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const cov = { same: 1, approved: 0, proposed: 1, rejected: 0, open: 1 };
const list: api.RefList = {
  id: "plant", table: "T001W", module: "material_master", target_fields: ["MARC.WERKS"], target_label: "S/4HANA", version_id: "v1",
  versions: [{ load_id: "v1", origin: "extract", finished_at: "2026-11-01T00:00:00Z", codes: 3 }],
  source: [{ code: "1000", text: "Plant A" }, { code: "2000", text: "Plant B" }, { code: "3000", text: "Plant C" }],
  target: [{ code: "1000", text: "Plant A" }, { code: "ZA01", text: "Plant Z" }],
  mappings: [{ id: "m1", target_field: "MARC.WERKS", source_code: "2000", target_code: "ZA01", status: "proposed", proposed_by: "other" }],
  coverage: cov,
};

function mockAll() {
  vi.spyOn(runs, "getSystemsExtended").mockResolvedValue([{ id: "s1", name: "ECC" } as SAPSystemExtended]);
  vi.spyOn(api, "getRefLists").mockResolvedValue({ target_label: "S/4HANA", lists: [{ id: "plant", table: "T001W", module: "material_master", target_fields: ["MARC.WERKS"], source_codes: 3, target_codes: 2, versions: 1, coverage: cov }] });
  vi.spyOn(api, "getRefList").mockResolvedValue(list);
  vi.spyOn(api, "getRefUsage").mockResolvedValue({ id: "plant", table: "T001W", version_id: null, fields: [], orphans: [], orphans_complete: true, unused: [], unused_certain: false, codes: 3, used: 0, filled: 0, covered: 0, covered_at_least: false } as api.RefUsage);
}

const wrap = () => renderWithQuery(<ToastProvider><ReferenceDataNative /></ToastProvider>);
beforeEach(() => { Q.can = () => true; setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Reference data (native)", () => {
  it("renders the lists and the codes with their text", async () => {
    mockAll();
    wrap();
    expect(await screen.findByTestId("ref-lists")).toBeInTheDocument();
    expect((await screen.findByTestId("ref-code-2000")).textContent).toMatch(/Plant B/);
  });

  it("approves a proposed mapping", async () => {
    mockAll();
    const decide = vi.spyOn(api, "decideMapping").mockResolvedValue({ id: "m1", status: "confirmed" });
    wrap();
    fireEvent.click(await screen.findByTestId("ref-approve-2000"));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("m1", "approve"));
  });

  it("hides approve and propose without the permissions", async () => {
    Q.can = () => false;
    mockAll();
    wrap();
    expect(await screen.findByTestId("ref-propose-needs")).toBeInTheDocument();
    expect(screen.queryByTestId("ref-approve-2000")).toBeNull();
  });

  it("says a 403 cannot be read", async () => {
    mockAll();
    vi.spyOn(api, "getRefLists").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the reference data.")).toBeInTheDocument();
  });
});
