import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as migrationApi from "@/lib/api/migration";
import DryRunPage from "../page";

let searchParams = "run=run-1";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParams),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const RUN_DETAIL = {
  run: {
    id: "run-1",
    mode: "s4_dry_run" as const,
    source_system_id: "sys-1",
    dest_system_id: null,
    source_version_id: "v1",
    target_release: "2023",
    target_connected: false,
    modules: ["material_master"],
    status: "analysed" as const,
    readiness_verdict: "no-go" as const,
    readiness_score: 40,
    critical_count: 1,
    records_total: 100,
    records_blocked: 60,
    error_detail: null,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:05:00Z",
    gap_summary: {
      material_master: {
        records: 100,
        blocked_records: 60,
        score: 40,
        verdict: "no-go" as const,
        gaps: {},
        source_tables: ["MARA"],
      },
    },
  },
  gap_breakdown: [],
  structural_critical: 0,
};

describe("DryRunPage", () => {
  it("renders module verdict badges, a load fail table and export links", async () => {
    vi.spyOn(migrationApi, "getMigrationRun").mockResolvedValue(RUN_DETAIL);
    vi.spyOn(migrationApi, "getDryRunRecords").mockResolvedValue({
      total: 1,
      rows: [
        {
          module: "material_master",
          source_table: "MARA",
          record_key: "MATNR1",
          status: "load_fail",
          reasons: ["Target field missing: WERKS"],
        },
      ],
    });

    renderWithQuery(<DryRunPage />);

    await waitFor(() => expect(screen.getByText(/no-go/i)).toBeInTheDocument());
    expect(screen.getByText(/load fail/i)).toBeInTheDocument();
    expect(screen.getByText("MATNR1")).toBeInTheDocument();
    expect(screen.getByText(/target field missing: werks/i)).toBeInTheDocument();

    const xlsxLink = screen.getByRole("link", { name: /excel/i });
    expect(xlsxLink).toHaveAttribute("href", "/api/v1/migration/runs/run-1/dry-run/xlsx");
    const pdfLink = screen.getByRole("link", { name: /pdf/i });
    expect(pdfLink).toHaveAttribute("href", "/api/v1/migration/runs/run-1/dry-run/pdf");
  });

  it("shows an empty state when there is no run selected", async () => {
    searchParams = "";
    renderWithQuery(<DryRunPage />);
    await waitFor(() => expect(screen.getByText(/no dry run selected/i)).toBeInTheDocument());
    searchParams = "run=run-1";
  });

  it("shows an error state when the run fails to load", async () => {
    vi.spyOn(migrationApi, "getMigrationRun").mockRejectedValue(new Error("network error"));
    vi.spyOn(migrationApi, "getDryRunRecords").mockResolvedValue({ total: 0, rows: [] });
    renderWithQuery(<DryRunPage />);
    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
  });

  it("retries both requests when the retry button is clicked", async () => {
    const getMigrationRun = vi
      .spyOn(migrationApi, "getMigrationRun")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(RUN_DETAIL);
    vi.spyOn(migrationApi, "getDryRunRecords").mockResolvedValue({ total: 0, rows: [] });
    renderWithQuery(<DryRunPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/no-go/i)).toBeInTheDocument());
    expect(getMigrationRun).toHaveBeenCalledTimes(2);
  });
});
