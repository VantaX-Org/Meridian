// frontend/app/(app)/process/__tests__/process-pages.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as pdApi from "@/lib/api/process-discovery";
import * as jobsHook from "@/hooks/use-jobs";
import type { CatalogueRow, DiscoveryRun, DiscoveryRunDetail } from "@/lib/api/process-discovery";
import type { SAPSystemExtended } from "@/types/api";
import type { Job } from "@/types/jobs";
import ProcessCataloguePage from "../page";
import ProcessRunsPage from "../runs/page";
import ProcessRunPage from "../runs/[runId]/page";
import { headline } from "../_components/shared";

const h = vi.hoisted(() => ({ qs: "", can: (() => true) as (action: string) => boolean, push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
  usePathname: () => "/process",
  useSearchParams: () => new URLSearchParams(h.qs),
  useParams: () => ({ runId: "run-1" }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.can(a) }) }));

const L1S = ["PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG", "SFX", "ARB", "CNQ"];
const SYS = { id: "sys-1", name: "KSA PRD", system_type: "S4HANA" } as unknown as SAPSystemExtended;
const reference = (l1: string): CatalogueRow => ({ l1, name: `${l1} process`, coverage: "reference", reason: null, last_run: null, in_progress: null, failed: null, sources: [] });
const lastRun = (over: Partial<NonNullable<CatalogueRow["last_run"]>>): NonNullable<CatalogueRow["last_run"]> => ({
  id: "run-1", status: "completed", finished_at: "2026-10-10T00:00:00Z",
  cases: 100, variants: 7, median_seconds: 86_400, automation_rate: 0.5, fitness: 0.9, ...over,
});
const job = (over: Partial<Job>): Job => ({
  id: "job-1", kind: "process_discovery", status: "running", label: "PTP discovery", stage: "mining",
  stages: [{ id: "extraction", label: "Extracting", status: "done" }, { id: "mining", label: "Mining", status: "running" }],
  percent: 60, rows_done: 0, rows_total: 0, message: "", tables: [], error: null, result: null,
  started_at: 0, updated_at: 0, finished_at: null, ...over,
});
const RUN: DiscoveryRun = {
  id: "run-1", l1: "PTP", mode: "full", status: "completed", coverage: "discovered", window_from: null, window_to: null,
  watermark: null, extraction_version_id: null, job_id: null, filters: {}, stats: {}, error: null,
  started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:10:00Z",
};
const mockJobs = (jobs: Job[]) => vi.spyOn(jobsHook, "useJobs").mockReturnValue(
  { jobs, active: jobs.filter((j) => j.status === "running") } as unknown as ReturnType<typeof jobsHook.useJobs>);

beforeEach(() => {
  vi.restoreAllMocks();
  h.qs = ""; h.can = () => true; h.push = vi.fn();
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYS]);
  vi.spyOn(pdApi, "getCatalogue").mockResolvedValue(L1S.map(reference));
  vi.spyOn(pdApi, "listRuns").mockResolvedValue([]);
  mockJobs([]);
});

describe("process catalogue", () => {
  it("asks to connect a system on a fresh install", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByText("Connect a system to discover processes")).toBeTruthy();
    expect(pdApi.getCatalogue).not.toHaveBeenCalled();
  });

  it("shows 13 reference cards and a Run discovery action before any run", async () => {
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByText("0 of 13 processes discovered on KSA PRD; 13 reference only.")).toBeTruthy();
    expect(screen.getAllByText("Reference, not discovered")).toHaveLength(13);
    expect(screen.getAllByText("Not run yet")).toHaveLength(13);
    const action = screen.getByRole("link", { name: /Run discovery/ });
    expect(action.getAttribute("href")).toBe("/process/runs?system=sys-1&new=1");
  });

  it("offers the variants of the top L1 to a user who cannot run discovery", async () => {
    h.can = () => false;
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...reference("PTP"), coverage: "discovered", last_run: lastRun({}) }, ...L1S.slice(1).map(reference)]);
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByRole("link", { name: /Open PTP variants/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Run .*discovery/ })).toBeNull();
  });

  it("shows the error link of a failed run beside the last result", async () => {
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...reference("PTP"), coverage: "discovered", last_run: lastRun({}),
        failed: { id: "run-3", status: "failed", job_id: null, error: "boom" } },
      ...L1S.slice(1).map(reference)]);
    renderWithQuery(<ProcessCataloguePage />);
    expect((await screen.findByRole("link", { name: "See the error" })).getAttribute("href")).toBe("/process/runs/run-3");
    expect(screen.getByText("Cases")).toBeTruthy();
  });

  it("shows the live stage of a run in progress", async () => {
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...reference("PTP"), in_progress: { id: "run-2", status: "mining", job_id: "job-1", error: null } },
      ...L1S.slice(1).map(reference)]);
    mockJobs([job({})]);
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByText("Mining")).toBeTruthy();
  });

  it("links an L1's DQ defects to the failing objects and dashes an unmapped L1", async () => {
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...reference("PTP"), coverage: "discovered", last_run: lastRun({}), dq_defects: 7, dq_version_id: "v-7" },
      { ...reference("OTC"), dq_defects: null }]);
    renderWithQuery(<ProcessCataloguePage />);
    expect((await screen.findByRole("link", { name: "7" })).getAttribute("href")).toBe("/objects?run=v-7&readiness=fail");
  });
});

describe("headline", () => {
  it("counts discovered L1s, takes median fitness and gives no cross-L1 totals", () => {
    const rows: CatalogueRow[] = [
      { ...reference("PTP"), coverage: "discovered", last_run: lastRun({ cases: 300, automation_rate: 1, fitness: 0.9 }) },
      { ...reference("OTC"), coverage: "partial", last_run: lastRun({ cases: 100, automation_rate: 0, fitness: 0.5 }) },
      { ...reference("R2R"), failed: { id: "run-3", status: "failed", job_id: null, error: "boom" } },
    ];
    expect(headline(rows)).toEqual({ discovered: 2, fitness: 0.7 });
    expect(headline(rows)).not.toHaveProperty("cases");
    expect(headline(rows)).not.toHaveProperty("automation");
  });
});

describe("discovery runs", () => {
  it("says the run waits for a running extraction on the same system", async () => {
    mockJobs([job({ id: "x1", kind: "extraction", label: "PRD full extraction", system_id: "sys-1" })]);
    renderWithQuery(<ProcessRunsPage />);
    expect(await screen.findByText("Waiting for extraction PRD full extraction to finish.")).toBeTruthy();
  });

  it("starts a full run for the chosen L1s from the dialog", async () => {
    h.qs = "new=1";
    const start = vi.spyOn(pdApi, "startRuns").mockResolvedValue({ job_id: "job-9", run_ids: ["r1", "r2"] });
    renderWithQuery(<ProcessRunsPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /OTC/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("sys-1", {
      l1s: L1S.filter((l) => l !== "OTC"), mode: "full", period_from: null }));
  });

  it("hides New run from a user without run_process_discovery", async () => {
    h.can = () => false;
    vi.spyOn(pdApi, "listRuns").mockResolvedValue([RUN]);
    renderWithQuery(<ProcessRunsPage />);
    expect(await screen.findByText("PTP")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New run" })).toBeNull();
  });
});

describe("run detail", () => {
  it("shows the error of a failed run and retries it as a full run", async () => {
    const failed: DiscoveryRunDetail = { ...RUN, status: "failed", coverage: null, finished_at: null,
      error: "EKPO read failed: RFC_ERROR_SYSTEM_FAILURE", system_id: "sys-1", system_type: "S4HANA" };
    vi.spyOn(pdApi, "getRun").mockResolvedValue(failed);
    const start = vi.spyOn(pdApi, "startRuns").mockResolvedValue({ job_id: "job-2", run_ids: ["run-2"] });
    renderWithQuery(<ProcessRunPage />);
    expect(await screen.findByText("EKPO read failed: RFC_ERROR_SYSTEM_FAILURE")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Retry/ })[0]);
    await waitFor(() => expect(start).toHaveBeenCalledWith("sys-1", { l1s: ["PTP"], mode: "full" }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/process/runs/run-2"));
  });

  it("offers no Retry to a role that cannot run discovery", async () => {
    h.can = () => false;
    vi.spyOn(pdApi, "getRun").mockResolvedValue({ ...RUN, status: "failed", coverage: null, finished_at: null,
      error: "EKPO read failed", system_id: "sys-1", system_type: "S4HANA" });
    renderWithQuery(<ProcessRunPage />);
    expect(await screen.findByText("EKPO read failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.getByText("Ask a process analyst to run it again.")).toBeTruthy();
  });

  it("lists the tables read with partial and truncated flags", async () => {
    vi.spyOn(pdApi, "getRun").mockResolvedValue({ ...RUN, system_id: "sys-1", system_type: "S4HANA",
      stats: { cases: 100, tables: { EKKO: { rows: 10, partial: false }, CDHDR: { rows: 500, partial: true } }, truncated_tables: ["CDHDR"] } });
    renderWithQuery(<ProcessRunPage />);
    expect(await screen.findByText("CDHDR")).toBeTruthy();
    expect(screen.getByText("Truncated")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
  });
});
