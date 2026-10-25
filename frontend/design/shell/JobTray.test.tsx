import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTray, jobHref } from "./JobTray";
import { touchedPredicate } from "../../hooks/use-jobs";
import { getJobs, retryJob } from "@/lib/api/jobs";
import { retryAction, retrySentence } from "./RetryJob";
import { toast } from "./Toaster";
import type { Job } from "@/types/jobs";

let capturedOnJob: ((job: Job) => void) | null = null;

const completedJob: Job = {
  id: "j1",
  kind: "analysis",
  status: "completed",
  label: "Analysis",
  stage: null,
  stages: [],
  percent: 100,
  rows_done: 0,
  rows_total: 0,
  message: "",
  tables: [],
  error: null,
  result: null,
  started_at: 0,
  updated_at: 1,
  finished_at: 1,
  touches: ["run"],
};

let perms = new Set<string>();
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.has(a) }) }));
vi.mock("@/lib/api/connectivity", () => ({
  getSystems: vi.fn().mockResolvedValue([{ id: "s-1", name: "ECC PRD" }]),
}));

vi.mock("@/lib/api/jobs", () => ({
  getJobs: vi.fn().mockResolvedValue([]),
  retryJob: vi.fn().mockResolvedValue({ job_id: "dl-2", status: "queued" }),
  streamJobs: vi.fn((onJob: (job: Job) => void) => {
    capturedOnJob = onJob;
    return () => {};
  }),
}));

function renderWithClient(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <JobTray />
    </QueryClientProvider>,
  );
}

describe("JobTray", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient();
    capturedOnJob = null;
    perms = new Set();
  });

  it("invalidates only the query keys named in a finished job's touches", () => {
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    renderWithClient(client);

    expect(capturedOnJob).not.toBeNull();
    act(() => {
      capturedOnJob?.(completedJob);
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    const predicate = invalidateSpy.mock.calls[0][0]?.predicate as ReturnType<typeof touchedPredicate> | undefined;
    expect(predicate?.({ queryKey: ["run", "x"] })).toBe(true);
    expect(predicate?.({ queryKey: ["systems"] })).toBe(false);
  });

  it("renders without crashing when there are no jobs", () => {
    renderWithClient(client);
    expect(screen.getByLabelText("Jobs")).toBeInTheDocument();
  });

  it("shows an empty state with a next step when there are no jobs", () => {
    renderWithClient(client);
    fireEvent.click(screen.getByLabelText("Jobs"));
    expect(screen.getByText("No jobs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Job history" })).toHaveAttribute("href", "/admin/jobs");
  });

  it("shows a failed job's lifecycle, its error and an Open link to its run", async () => {
    vi.mocked(getJobs).mockResolvedValueOnce([
      { ...completedJob, id: "j2", status: "failed", percent: 40, error: "RFC_COMMUNICATION_FAILURE on BUT000", version_id: "v-9" },
    ]);
    renderWithClient(client);
    fireEvent.click(screen.getByLabelText("Jobs"));
    const status = await screen.findByText("Failed");
    expect(status).toHaveAttribute("data-status", "lifecycle");
    expect(screen.getByTestId("job-error")).toHaveTextContent("RFC_COMMUNICATION_FAILURE on BUT000");
    expect(screen.getByRole("link", { name: "Open Analysis" })).toHaveAttribute("href", "/runs/v-9");
  });

  const failedDownload: Job = {
    ...completedJob, id: "dl-1", kind: "extraction", status: "failed", label: "material_master", system_id: "s-1",
    modules: ["material_master"], retry: { via: "downloads", body: { objects: ["material_master"] } },
  };

  it("retries a failed download after confirming what runs again, and says it was queued", async () => {
    perms = new Set(["trigger_sync"]);
    vi.mocked(getJobs).mockResolvedValueOnce([failedDownload]);
    const success = vi.spyOn(toast, "success");
    renderWithClient(client);
    fireEvent.click(screen.getByLabelText("Jobs"));
    fireEvent.click(await screen.findByRole("button", { name: "Retry material_master" }));
    expect(await screen.findByText("Extract material master from ECC PRD again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(retryJob).toHaveBeenCalledWith("dl-1"));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Job queued", { description: "Extract material master from ECC PRD again" }));
  });

  it("shows Retry disabled, with the permission it needs, without the start permission", async () => {
    perms = new Set(["analyse"]);
    vi.mocked(getJobs).mockResolvedValueOnce([failedDownload]);
    renderWithClient(client);
    fireEvent.click(screen.getByLabelText("Jobs"));
    await screen.findByText("Failed");
    expect(screen.getByRole("button", { name: "Retry material_master. Needs extract permission" })).toBeDisabled();
    expect(retryJob).not.toHaveBeenCalled();
  });

  it("retries only failed jobs of kinds whose start can run again", () => {
    expect(retryAction(failedDownload)).toBe("trigger_sync");
    expect(retryAction({ ...failedDownload, retry: undefined })).toBeNull();
    expect(retryAction({ ...failedDownload, status: "completed" })).toBeNull();
    expect(retryAction({ ...failedDownload, kind: "upload" })).toBeNull();
    expect(retryAction({ ...failedDownload, kind: "analysis", version_id: "v-1" })).toBe("analyse");
    expect(retryAction({ ...failedDownload, kind: "process_discovery" })).toBe("run_process_discovery");
    expect(retrySentence({ ...failedDownload, modules: ["fi_gl", "business_partner"] }, undefined))
      .toBe("Extract FI general ledger and business partner from its system again");
  });

  it("links a discovery job to its discovery run and a system job to its system", () => {
    expect(jobHref({ ...completedJob, kind: "process_discovery", run_ids: ["pr-1"], system_id: "s-1" })).toBe("/process/runs/pr-1");
    expect(jobHref({ ...completedJob, kind: "extraction", system_id: "s-1" })).toBe("/systems/s-1");
    expect(jobHref(completedJob)).toBeNull();
  });
});

describe("touchedPredicate", () => {
  it("matches only keys whose first element is in touches", () => {
    const predicate = touchedPredicate(["object", "run"]);
    expect(predicate({ queryKey: ["object", "m1", "v1"] })).toBe(true);
    expect(predicate({ queryKey: ["run", "v1"] })).toBe(true);
    expect(predicate({ queryKey: ["systems"] })).toBe(false);
  });

  it("matches nothing when touches is absent", () => {
    const predicate = touchedPredicate(undefined);
    expect(predicate({ queryKey: ["object", "m1"] })).toBe(false);
  });
});
