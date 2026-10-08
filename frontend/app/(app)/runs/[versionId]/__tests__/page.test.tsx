// frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as runsApi from "@/lib/api/v1/runs";
import * as versionsApi from "@/lib/api/versions";
import RunDetailPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ versionId: "v1" }) }));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RunDetailPage", () => {
  it("renders the decisive error of a failed step", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue({
      id: "v1",
      label: "Oct 8",
      status: "failed",
      run_at: "2026-10-08T00:00:00Z",
      dqs_summary: null,
      metadata: null,
    } as never);
    vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
      version_id: "v1",
      steps: [
        {
          step_number: 4,
          step_name: "Generating AI insights",
          status: "failed",
          started_at: "t0",
          finished_at: "t1",
          duration_ms: 1200,
          error_detail: "LLM provider timed out after 120s",
        },
      ],
    });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("LLM provider timed out after 120s")).toBeInTheDocument());
  });
});
