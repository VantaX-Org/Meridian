import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as sourceDesign from "@/lib/api/source-design";
import { CoverageTab, TablesTab, coveragePartLabel, sourceShort, sourceWords } from "../design-panels";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

describe("data dictionary", () => {
  it("opens a table's drawer from the keyboard, through the table name's button", async () => {
    vi.spyOn(sourceDesign, "getDesignTables").mockResolvedValue({
      total: 1,
      items: [{ table: "MARA", description: "General material data", category: null, delivery_class: "A", customer_table: false, field_count: 240, customer_fields: 0 }],
    });
    vi.spyOn(sourceDesign, "getDesignTable").mockResolvedValue({
      table: "MARA", description: "General material data", category: null, delivery_class: "A", customer_table: false,
      in_sap_standard: true, fields: [], standard_fields_missing: [], foreign_keys: [],
    });
    renderWithQuery(<TablesTab id="s1" />);
    const open = await screen.findByRole("button", { name: "MARA" });
    expect(open).toHaveAttribute("type", "button");
    open.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "MARA" })).toBeInTheDocument();
    expect(sourceDesign.getDesignTable).toHaveBeenCalledWith("s1", "MARA");
  });
});

describe("coverage and configuration copy", () => {
  it("titles each coverage part in words, never its key", async () => {
    vi.spyOn(sourceDesign, "getDesignCoverage").mockResolvedValue({
      snapshot_id: "x", coverage: { ddic: [{ table: "MARA", status: "live", rows: 3 }], config: [{ table: "T001", status: "failed" }] },
    });
    renderWithQuery(<CoverageTab id="s1" />);
    expect(await screen.findByText("Data dictionary")).toBeInTheDocument();
    expect(screen.getByText("Configuration tables")).toBeInTheDocument();
    expect(screen.queryByText("ddic")).toBeNull();
  });

  it("says where configuration values came from in words", () => {
    expect(sourceShort("live")).toBe("live");
    expect(sourceShort("reference")).toBe("SAP reference");
    expect(sourceWords("reference")).toBe("from the SAP reference values");
    expect(sourceWords("some_upload")).toBe("from some upload");
    expect(coveragePartLabel("metadata")).toBe("Metadata");
    expect(coveragePartLabel("new_part")).toBe("New part");
  });
});
