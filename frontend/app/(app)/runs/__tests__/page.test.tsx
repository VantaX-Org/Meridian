// frontend/app/(app)/runs/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import * as systemsApi from "@/lib/api/systems";
import RunsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RunsPage", () => {
  it("renders one row per run, including its system's name", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({
      versions: [
        {
          id: "v1",
          label: "Oct 8 upload",
          status: "complete",
          run_at: "2026-10-08T00:00:00Z",
          dqs_summary: null,
          metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 10, system_id: "sys-1" },
        },
      ],
    } as never);
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([
      { id: "sys-1", name: "ECC Prod" },
    ] as never);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });

  it("shows an empty state with no runs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] } as never);
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([] as never);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/no runs/i)).toBeInTheDocument());
  });
});
