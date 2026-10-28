import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as sourceDesign from "@/lib/api/source-design";
import { CoverageTab, DeviationPanel, SnapshotsTab, TablesTab, coveragePartLabel, coverageSummary, sourceShort, sourceWords } from "../design-panels";

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

describe("coverage summary", () => {
  it("counts what was read, not found and failed", () => {
    expect(coverageSummary([{ status: "live" }, { status: "live" }, { status: "not_found" }, { status: "failed" }, { status: "unreachable" }]))
      .toBe("2 tables read, 1 not found, 2 failed");
    expect(coverageSummary([{ status: "live" }])).toBe("1 table read");
  });

  it("shows the summary above the parts", async () => {
    vi.spyOn(sourceDesign, "getDesignCoverage").mockResolvedValue({
      snapshot_id: "x", coverage: { ddic: [{ table: "MARA", status: "live", rows: 3 }], config: [{ table: "T001", status: "not_found" }] },
    });
    renderWithQuery(<CoverageTab id="s1" />);
    expect(await screen.findByTestId("coverage-summary")).toHaveTextContent("1 table read, 1 not found");
  });

  it("shows the error with a retry when coverage does not load", async () => {
    vi.spyOn(sourceDesign, "getDesignCoverage").mockRejectedValue(new Error("down"));
    renderWithQuery(<CoverageTab id="s1" />);
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

describe("configuration deviation", () => {
  it("lists custom and missing values with the counts on each side", async () => {
    vi.spyOn(sourceDesign, "getConfigDeviation").mockResolvedValue({
      tables: [{ reference: "T001W", live_count: 14, standard_count: 12, custom: ["Z001", "Z002"], missing: ["0003"] }],
    });
    renderWithQuery(<DeviationPanel id="s1" />);
    expect(await screen.findByText("T001W")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Z001, Z002")).toBeInTheDocument();
    expect(screen.getByText("0003")).toBeInTheDocument();
  });

  it("says so when there is nothing to compare", async () => {
    vi.spyOn(sourceDesign, "getConfigDeviation").mockResolvedValue({ tables: [] });
    renderWithQuery(<DeviationPanel id="s1" />);
    expect(await screen.findByText("No deviation to compare")).toBeInTheDocument();
  });

  it("shows the error with a retry", async () => {
    vi.spyOn(sourceDesign, "getConfigDeviation").mockRejectedValue(new Error("down"));
    renderWithQuery(<DeviationPanel id="s1" />);
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

describe("snapshots and drift", () => {
  const snap = (id: string, started_at: string) => ({ id, status: "complete", started_at, completed_at: started_at, tables: 100, customer_tables: 2, customer_fields: 5, error: null });

  it("says so when no snapshot exists", async () => {
    vi.spyOn(sourceDesign, "getDesignSnapshots").mockResolvedValue([]);
    renderWithQuery(<SnapshotsTab id="s1" />);
    expect(await screen.findByText("No snapshot yet")).toBeInTheDocument();
  });

  it("diffs the two latest snapshots by default and lists the changes", async () => {
    vi.spyOn(sourceDesign, "getDesignSnapshots").mockResolvedValue([snap("b", "2026-10-02T00:00:00Z"), snap("a", "2026-10-01T00:00:00Z")]);
    const diff = vi.spyOn(sourceDesign, "getDesignDiff").mockResolvedValue({
      changes: [{ table: "MARA", field: "ZZFLAG", change: "field_added" }, { table: "KNA1", field: "NAME1", change: "field_changed", diff: { length: [35, 40] } }],
    });
    renderWithQuery(<SnapshotsTab id="s1" />);
    expect(await screen.findByText("ZZFLAG")).toBeInTheDocument();
    expect(diff).toHaveBeenCalledWith("s1", "a", "b");
    expect(screen.getByText("length: 35 to 40")).toBeInTheDocument();
  });

  it("says when the diff fails, with a retry", async () => {
    vi.spyOn(sourceDesign, "getDesignSnapshots").mockResolvedValue([snap("b", "2026-10-02T00:00:00Z"), snap("a", "2026-10-01T00:00:00Z")]);
    vi.spyOn(sourceDesign, "getDesignDiff").mockRejectedValue(new Error("down"));
    renderWithQuery(<SnapshotsTab id="s1" />);
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("says when nothing changed", async () => {
    vi.spyOn(sourceDesign, "getDesignSnapshots").mockResolvedValue([snap("b", "2026-10-02T00:00:00Z"), snap("a", "2026-10-01T00:00:00Z")]);
    vi.spyOn(sourceDesign, "getDesignDiff").mockResolvedValue({ changes: [] });
    renderWithQuery(<SnapshotsTab id="s1" />);
    expect(await screen.findByText("No dictionary changes between these snapshots.")).toBeInTheDocument();
  });
});
