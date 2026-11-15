import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { Agreement } from "@/lib/api/v2/roundtrip";

const get = vi.fn();
vi.mock("@/lib/api/v2/roundtrip", async (orig) => ({ ...(await orig<object>()), getAgreement: (...a: unknown[]) => get(...a) }));
const { AgreementBody } = await import("../runs/Agreement");

const data: Agreement = {
  version_id: "v1", base_version_id: "v0", run_id: "r2", run_at: "2026-11-14T10:00:00Z",
  total: 3, matched: 1, different: 1, missing: 1, score: 33.3,
  fields: [{ table: "MARA", field: "MTART", description: "Material type", matched: 0, different: 1, missing: 1 }, { table: "MARA", field: "MEINS", description: "Base unit of measure", matched: 1, different: 0, missing: 0 }],
  rows: [
    { table: "MARA", key: "100", field: "MTART", description: "Material type", status: "different", cleaned: "FERT", current: "HALB" },
    { table: "MARA", key: "200", field: "MTART", description: "Material type", status: "missing", cleaned: "FERT", current: null },
    { table: "MARA", key: "100", field: "MEINS", description: "Base unit of measure", status: "matched", cleaned: "EA", current: "EA" },
  ],
  rows_total: 3,
};

describe("clean file agreement", () => {
  it("shows the score, the split, each field with its description and each cell", async () => {
    get.mockResolvedValue(data);
    renderWithQuery(<AgreementBody versionId="v1" />);
    expect(await screen.findByRole("img", { name: "33.3 percent of cleaned values reached the source" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("v1", undefined);
    expect(screen.getByRole("img", { name: "1 matched, 1 still different, 1 missing" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Material type")).toBeInTheDocument();
    expect(within(rows[0]).getByText("HALB")).toBeInTheDocument();
    expect(within(rows[1]).getByText("record not found")).toBeInTheDocument();
    expect(screen.getAllByText("Base unit of measure").length).toBeGreaterThan(0);
  });

  it("explains what to do when no later run exists", async () => {
    get.mockRejectedValue({ response: { status: 404, data: { detail: { error: "no_later_run", detail: "x" } } } });
    renderWithQuery(<AgreementBody versionId="v1" run="r9" />);
    expect(await screen.findByText("No later run yet")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("v1", "r9");
  });
});
