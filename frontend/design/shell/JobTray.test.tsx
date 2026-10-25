import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTray, jobHref } from "./JobTray";
import { touchedPredicate } from "../../hooks/use-jobs";
import { getJobs } from "@/lib/api/jobs";
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

vi.mock("@/lib/api/jobs", () => ({
  getJobs: vi.fn().mockResolvedValue([]),
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
