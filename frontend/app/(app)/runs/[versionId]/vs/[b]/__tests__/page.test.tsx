// frontend/app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import CompareRunsPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ versionId: "v1", b: "v2" }) }));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("CompareRunsPage", () => {
  it("renders the rule delta table with new/resolved/persisting counts", async () => {
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({
      v1: "v1", v2: "v2", totals: { new: 3, resolved: 5, persisting: 20 },
      checks: [{ check_id: "mm_missing_desc", module: "material_master", severity: "high", new: 3, resolved: 5, persisting: 20, comparable: true }],
    });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
  });

  it("shows an empty state when there is nothing to compare", async () => {
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({
      v1: "v1", v2: "v2", totals: { new: 0, resolved: 0, persisting: 0 }, checks: [],
    });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText(/no differences/i)).toBeInTheDocument());
  });
});
