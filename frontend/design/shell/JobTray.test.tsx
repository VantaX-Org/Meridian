import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTray } from "./JobTray";
import { touchedPredicate } from "../../hooks/use-jobs";
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
