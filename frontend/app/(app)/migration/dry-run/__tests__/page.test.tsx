import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";
import * as migrationApi from "@/lib/api/migration";
import DryRunPage from "../page";

let searchParams = "run=run-1";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParams),
  useRouter: () => ({ push }),
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

  it("pages through every failing record and points the stats at the list, not the data quality run", async () => {
    vi.spyOn(migrationApi, "getMigrationRun").mockResolvedValue(RUN_DETAIL);
    const row = (k: string) => ({ module: "material_master", source_table: "MARA", record_key: k, status: "load_fail" as const, reasons: ["x"] });
    const records = vi.spyOn(migrationApi, "getDryRunRecords").mockImplementation(async (_id, p) => ({
      total: 450, rows: [row(`K${p?.offset ?? 0}`)],
    }));
    renderWithQuery(<DryRunPage />);
    expect(await screen.findByText("K0")).toBeInTheDocument();
    expect(records).toHaveBeenCalledWith("run-1", { status: "load_fail", limit: 200, offset: 0 });
    expect(screen.getByText("1–200 of 450")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("K200")).toBeInTheDocument();
    expect(records).toHaveBeenCalledWith("run-1", { status: "load_fail", limit: 200, offset: 200 });
    // "Would fail to load" opens the failing records below; nothing links to the data quality run's page
    expect(screen.getByRole("link", { name: /Would fail to load/ })).toHaveAttribute("href", "#failing-records");
    expect(screen.queryAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/runs/"))).toHaveLength(0);
  });

  it("lists the dry runs to choose from when none is selected, and opens one", async () => {
    searchParams = "";
    const list = vi.spyOn(migrationApi, "getMigrationRuns").mockResolvedValue([RUN_DETAIL.run]);
    renderWithQuery(<DryRunPage />);
    fireEvent.click(await screen.findByText("60 of 100"));
    expect(list).toHaveBeenCalledWith({ mode: "s4_dry_run" });
    expect(push).toHaveBeenCalledWith("/migration/dry-run?run=run-1");
    searchParams = "run=run-1";
  });

  it("says how to start one when there are no dry runs", async () => {
    searchParams = "";
    vi.spyOn(migrationApi, "getMigrationRuns").mockResolvedValue([]);
    renderWithQuery(<DryRunPage />);
    expect(await screen.findByText("No dry runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open migration cockpit" })).toHaveAttribute("href", "/migration");
    searchParams = "run=run-1";
  });

  it("offers the list when the run in the address is not a dry run", async () => {
    // Pages are scoped by ?run=, so a data quality run's id can arrive here and 404.
    vi.spyOn(migrationApi, "getMigrationRun").mockRejectedValue(
      new AxiosError("Not Found", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse));
    vi.spyOn(migrationApi, "getDryRunRecords").mockResolvedValue({ total: 0, rows: [] });
    vi.spyOn(migrationApi, "getMigrationRuns").mockResolvedValue([RUN_DETAIL.run]);
    renderWithQuery(<DryRunPage />);
    expect(await screen.findByText(/not a dry run/i)).toBeInTheDocument();
    expect(await screen.findByText("60 of 100")).toBeInTheDocument();
  });

  it("shows an error state when the run fails to load", async () => {
    vi.spyOn(migrationApi, "getMigrationRun").mockRejectedValue(new Error("network error"));
    vi.spyOn(migrationApi, "getDryRunRecords").mockResolvedValue({ total: 0, rows: [] });
    renderWithQuery(<DryRunPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
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

  it("shows the loading skeleton while the run loads", () => {
    vi.spyOn(migrationApi, "getMigrationRun").mockReturnValue(new Promise(() => {}));
    vi.spyOn(migrationApi, "getDryRunRecords").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<DryRunPage />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
