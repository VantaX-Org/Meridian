import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { WorkRecordDetail } from "@/lib/api/work";
import { RecordDuplicates, RecordSheetFallback } from "../RecordDuplicates";

const A = vi.hoisted(() => ({ cluster: vi.fn(), sheet: vi.fn(), findings: vi.fn() }));
vi.mock("@/lib/api/v2/insights", async (orig) => ({ ...(await orig<object>()), getDuplicateCluster: A.cluster }));
vi.mock("@/lib/api/v2/object-records", async (orig) => ({ ...(await orig<object>()), getRecordSheet: A.sheet, getRecordFindings: A.findings }));

afterEach(() => vi.clearAllMocks());

const detail = (d: Partial<WorkRecordDetail>) => d as WorkRecordDetail;

describe("record duplicates", () => {
  it("links the open duplicates and the golden record and lists the cluster", async () => {
    A.cluster.mockResolvedValue({ edges: [{ source: "MATNR=1", target: "MATNR=2", label: "0.93" }], thresholds: { auto_merge: 0.95, review_floor: 0.8 } });
    renderWithQuery(<RecordDuplicates module="material_master" detail={detail({ duplicates: { open: 2, href: "/dup" }, golden_record: { id: "g1", status: "active", key: "MATNR=1", href: "/golden" } })} />);
    expect(screen.getByText(/Possible duplicate/).closest("a")?.getAttribute("href")).toBe("/dup");
    expect(screen.getByText("Golden record").closest("a")?.getAttribute("href")).toBe("/golden");
    expect(await screen.findByText("MATNR=2")).toBeTruthy();
    expect(A.cluster).toHaveBeenCalledWith("material_master", "g1");
  });

  it("says no golden record is named and hides a missing cluster", () => {
    renderWithQuery(<RecordDuplicates module="material_master" detail={detail({ duplicates: { open: 0, href: "/dup" }, golden_record: null })} />);
    expect(screen.getByText("No golden record is named.")).toBeTruthy();
    expect(screen.queryByTestId("record-cluster")).toBeNull();
  });
});

describe("record sheet fallback", () => {
  it("shows the run's fields for a record that fails nothing", async () => {
    A.sheet.mockResolvedValue({ mara: { MTART: "FERT", MEINS: null }, description: "Pump" });
    A.findings.mockResolvedValue({ failing: [] });
    renderWithQuery(<RecordSheetFallback module="material_master" recordKey="MATNR=9" notFound="gone" />);
    expect(await screen.findByTestId("record-sheet")).toBeTruthy();
    expect(screen.getByText("FERT")).toBeTruthy();
    expect(screen.queryByText("MEINS")).toBeNull();
    expect(await screen.findByText("No rule fails this record in this run.")).toBeTruthy();
  });

  it("says not found when the run has no such record", async () => {
    A.sheet.mockRejectedValue({ status: 404 });
    A.findings.mockRejectedValue({ status: 404 });
    renderWithQuery(<RecordSheetFallback module="material_master" recordKey="X" notFound="gone" />);
    expect(await screen.findByTestId("record-not-found")).toBeTruthy();
  });
});
