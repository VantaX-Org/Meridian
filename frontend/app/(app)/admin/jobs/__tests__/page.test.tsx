import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as jobsApi from "@/lib/api/jobs";
import * as connectivityApi from "@/lib/api/connectivity";
import type { Job } from "@/types/jobs";
import JobsPage from "../page";

let perms = new Set<string>();
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.has(a), loading: false }) }));

const BASE: Job = {
  id: "j1", kind: "analysis", status: "failed", label: "Re-analysis", stage: null, stages: [], percent: 40,
  rows_done: 0, rows_total: 0, message: "Failed", tables: [], error: "Worker lost", result: null,
  started_at: 1, updated_at: 2, finished_at: 2, system_id: "s-1", version_id: "v-1",
};

describe("admin jobs page", () => {
  beforeEach(() => {
    perms = new Set();
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s-1", name: "ECC PRD" }] as never);
  });

  it("retries a failed analysis for a user who may analyse", async () => {
    perms = new Set(["analyse"]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([BASE]);
    const retry = vi.spyOn(jobsApi, "retryJob").mockResolvedValue({ job_id: "v-1", status: "pending" });
    renderWithQuery(<JobsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry Re-analysis" }));
    expect(await screen.findByText("Analyse the ECC PRD data again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("j1"));
  });

  it("shows Retry disabled with the permission it needs, and none on an upload", async () => {
    perms = new Set(["trigger_sync"]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([BASE, { ...BASE, id: "j2", kind: "upload", label: "file.csv" }]);
    renderWithQuery(<JobsPage />);
    await screen.findByText("file.csv");
    expect(screen.getByRole("button", { name: "Retry Re-analysis. Needs analyse permission" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Retry file\.csv/ })).toBeNull();
  });

  it("shows Extract again disabled without the extract permission", async () => {
    perms = new Set();
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([{ ...BASE, kind: "extraction", label: "material_master" }]);
    renderWithQuery(<JobsPage />);
    expect(await screen.findByRole("button", { name: "Extract material_master again. Needs extract permission" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Extract material_master again/ })).toBeNull();
  });

  it("explains a failed job in plain words and keeps the raw error behind a disclosure", async () => {
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([{ ...BASE, error: "RFC_LOGON_FAILURE: Name or password is incorrect" }]);
    renderWithQuery(<JobsPage />);
    expect(await screen.findByText("SAP refused the sign-in")).toBeInTheDocument();
    expect(screen.queryByText(/RFC_LOGON_FAILURE/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand row" }));
    expect(screen.getByText("Technical detail")).toBeInTheDocument();
    expect(screen.getByText("RFC_LOGON_FAILURE: Name or password is incorrect")).toBeInTheDocument();
  });

  it("filters by status and polls while a job is still running", async () => {
    const get = vi.spyOn(jobsApi, "getJobs").mockResolvedValue([
      BASE, { ...BASE, id: "j2", status: "running", label: "Nightly extract", error: null, finished_at: null },
    ]);
    renderWithQuery(<JobsPage />);
    await screen.findByText("Nightly extract");
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(screen.queryByText("Nightly extract")).toBeNull();
    expect(screen.getByText("Re-analysis")).toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1), { timeout: 7_000 });
  }, 10_000);

  it("sends a failed extraction without a recorded request to its system's Extract drawer", async () => {
    perms = new Set(["trigger_sync"]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([{ ...BASE, kind: "extraction", label: "material_master" }]);
    renderWithQuery(<JobsPage />);
    expect(await screen.findByRole("link", { name: "Extract material_master again" })).toHaveAttribute("href", "/systems/s-1?extract=1");
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("opens a discovery job's run, never the readiness page or the extraction it chained", async () => {
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([
      { ...BASE, id: "pd-r-1", kind: "process_discovery", status: "completed", error: null, label: "Process discovery: PTP", run_ids: ["r-1", "r-2"] },
      { ...BASE, id: "pd-r-9", kind: "process_discovery", status: "completed", error: null, label: "Process discovery: OTC", run_ids: undefined },
      { ...BASE, id: "x-3", kind: "process_discovery", status: "completed", error: null, label: "Process discovery: R2R", run_ids: [] },
    ]);
    renderWithQuery(<JobsPage />);
    expect(await screen.findByRole("link", { name: "Open Process discovery: PTP" })).toHaveAttribute("href", "/process/runs/r-1");
    expect(screen.getByRole("link", { name: "Open Process discovery: OTC" })).toHaveAttribute("href", "/process/runs/r-9");
    expect(screen.getByRole("link", { name: "Open Process discovery: R2R" })).toHaveAttribute("href", "/process/runs");
  });

  it("says the list is the newest 200 jobs the registry keeps, and asks for all of them", async () => {
    const get = vi.spyOn(jobsApi, "getJobs").mockResolvedValue([BASE]);
    renderWithQuery(<JobsPage />);
    expect(await screen.findByText(/^The newest 200 extractions, analyses, uploads and simulations, latest first; older jobs are not kept, and the filters apply to these\./)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith({ limit: 200 });
  });
});
