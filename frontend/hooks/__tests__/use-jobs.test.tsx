import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as jobsApi from "@/lib/api/jobs";
import { useJobs } from "../use-jobs";
import { useV2Jobs } from "@/lib/v2/runs-queries";

function Strip() {
  useV2Jobs();
  return null;
}
function Line() {
  useJobs();
  return null;
}

describe("one jobs read per page", () => {
  it("the job line, the status strip and every screen share one read of /jobs, and a later mount reads the cache", async () => {
    window.sessionStorage.clear();
    const spy = vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <Line />
        <Strip />
        <Strip />
        <Strip />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender(
      <QueryClientProvider client={qc}>
        <Line />
        <Strip />
        <Strip />
        <Strip />
        <Strip />
        <Line />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ limit: 100 });
  });
});
