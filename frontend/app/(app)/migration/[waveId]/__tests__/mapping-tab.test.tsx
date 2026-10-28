import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as migrationApi from "@/lib/api/migration";
import type { TransferFieldMapping } from "@/types/api";
import { MappingTab } from "../mapping-tab";
import { splitTableField } from "../field-map-edit";

let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const MAP: TransferFieldMapping = {
  id: "m1", module: "material_master", source_field: "MARA.MATKL", dest_system_type: "s4hana", dest_table: "MARA", dest_field: "MATKL",
  value_map: true, origin: "identity", transform_note: null, is_confirmed: false, source_def: null, target_def: null,
};

beforeEach(() => { allowed = true; });
afterEach(() => vi.restoreAllMocks());

function mount() {
  return renderWithQuery(<MappingTab modules={["material_master"]} destType="s4hana" versionId="v1" runId="r2" />);
}

describe("splitTableField", () => {
  it("reads TABLE.FIELD in upper case and refuses anything else", () => {
    expect(splitTableField(" mara.matkl ")).toEqual({ table: "MARA", field: "MATKL" });
    expect(splitTableField("MATKL")).toBeNull();
    expect(splitTableField("A.B.C")).toBeNull();
  });
});

describe("MappingTab field map editing", () => {
  it("seeds from the wave's source version", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    const seed = vi.spyOn(migrationApi, "seedFieldMap").mockResolvedValue({ seeded: 12, module: "material_master", dest_system_type: "s4hana" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Seed from source" }));
    await waitFor(() => expect(seed).toHaveBeenCalledWith({ module: "material_master", dest_system_type: "s4hana", source_version_id: "v1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("12 mappings seeded for Material master"));
  });

  it("says why a seed was refused", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    vi.spyOn(migrationApi, "seedFieldMap").mockRejectedValue(Object.assign(new Error("x"), { isAxiosError: true, response: { status: 409, data: { detail: "No analysed source dataset" } } }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Seed from source" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("offers seeding and adding in the empty state", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([]);
    mount();
    expect(await screen.findByText("No field map yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seed from source" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add mapping" })).toBeDisabled();
  });

  it("adds a mapping from TABLE.FIELD text", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    const create = vi.spyOn(migrationApi, "createFieldMap").mockResolvedValue({ id: "m2" });
    mount();
    fireEvent.change(await screen.findByLabelText("Source field (TABLE.FIELD)"), { target: { value: "mara.mtart" } });
    fireEvent.change(screen.getByLabelText("Target field (empty: not migrated)"), { target: { value: "mara.mtart" } });
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      module: "material_master", dest_system_type: "s4hana", source_field: "MARA.MTART", dest_table: "MARA", dest_field: "MTART", value_map: false,
    }));
  });

  it("refuses a target that is not TABLE.FIELD", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    mount();
    fireEvent.change(await screen.findByLabelText("Source field (TABLE.FIELD)"), { target: { value: "MARA.MTART" } });
    fireEvent.change(screen.getByLabelText("Target field (empty: not migrated)"), { target: { value: "MTART" } });
    expect(screen.getByRole("button", { name: "Add mapping" })).toBeDisabled();
    expect(screen.getByText("Use TABLE.FIELD")).toBeInTheDocument();
  });

  it("removes a mapping after confirming", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    const del = vi.spyOn(migrationApi, "deleteFieldMap").mockResolvedValue();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Remove mapping of MARA.MATKL" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove mapping" }));
    await waitFor(() => expect(del.mock.calls[0]?.[0]).toBe("m1"));
  });

  it("offers no editing without the analyse permission", async () => {
    allowed = false;
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    mount();
    await screen.findAllByText("MARA.MATKL");
    expect(screen.queryByRole("button", { name: "Seed from source" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove mapping of/ })).toBeNull();
  });

  it("shows the error with a retry when the map does not load", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockRejectedValue(new Error("down"));
    mount();
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

describe("MappingTab value map", () => {
  it("lists unmapped source values, fills one into the form and removes a mapped pair", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    vi.spyOn(migrationApi, "getValueMap").mockResolvedValue([
      { id: "e1", target_field: "MARA.MATKL", source_value: "A1", target_value: "0001", note: null, updated_at: "2026-10-01T00:00:00Z" },
    ]);
    const cand = vi.spyOn(migrationApi, "getValueCandidates").mockResolvedValue([{ source_value: "ZZ", records: 14 }]);
    const del = vi.spyOn(migrationApi, "deleteValueMap").mockResolvedValue();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Value map" }));
    await waitFor(() => expect(cand).toHaveBeenCalledWith("r2", "MARA.MATKL"));
    fireEvent.click(await screen.findByRole("button", { name: "Map ZZ, 14 records" }));
    expect(screen.getByLabelText("Source value")).toHaveValue("ZZ");
    fireEvent.click(screen.getByRole("button", { name: "Remove the mapping of A1" }));
    await waitFor(() => expect(del.mock.calls[0]?.[0]).toBe("e1"));
  });

  it("says every value is mapped when no candidate is left", async () => {
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([MAP]);
    vi.spyOn(migrationApi, "getValueMap").mockResolvedValue([]);
    vi.spyOn(migrationApi, "getValueCandidates").mockResolvedValue([]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Value map" }));
    expect(await screen.findByText("Every source value in the last run has a target")).toBeInTheDocument();
  });
});
