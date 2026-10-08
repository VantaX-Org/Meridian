import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTray } from "./JobTray";
import { touchedPredicate } from "../../hooks/use-jobs";
import type { Job } from "@/types/jobs";

let capturedOnJob: ((job: Job) => void) | null = null;

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
      capturedOnJob?.({
        id: "j1",
        kind: "analysis",
        status: "completed",
        touches: ["run"],
      } as Job);
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    const predicate = invalidateSpy.mock.calls[0][0]?.predicate;
    expect(predicate?.({ queryKey: ["run", "x"] } as never)).toBe(true);
    expect(predicate?.({ queryKey: ["systems"] } as never)).toBe(false);
  });

  it("renders without crashing when there are no jobs", () => {
    renderWithClient(client);
    expect(screen.getByLabelText("Jobs")).toBeInTheDocument();
  });
});

describe("touchedPredicate", () => {
  it("matches only keys whose first element is in touches", () => {
    const predicate = touchedPredicate(["object", "run"]);
    expect(predicate({ queryKey: ["object", "m1", "v1"] } as never)).toBe(true);
    expect(predicate({ queryKey: ["run", "v1"] } as never)).toBe(true);
    expect(predicate({ queryKey: ["systems"] } as never)).toBe(false);
  });

  it("matches nothing when touches is absent", () => {
    const predicate = touchedPredicate(undefined);
    expect(predicate({ queryKey: ["object", "m1"] } as never)).toBe(false);
  });
});
