// frontend/app/(app)/objects/[object]/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("ObjectDetailPage", () => {
  it("renders the narrative, dimension chart and rules table", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({
      module: "material_master",
      label: "Material Master",
      composite_score: 72.5,
      readiness: "warn",
      failing_checks: 1,
      affected_records: 120,
      dimension_scores: { completeness: 80, accuracy: 90 },
      rules: [
        {
          check_id: "mm_missing_desc",
          severity: "high",
          dimension: "completeness",
          affected_count: 42,
          total_count: 100,
          pass_rate: 0.58,
        },
      ],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText(/1 of 1 checks fail/i)).toBeInTheDocument());
    expect(screen.getByText("mm_missing_desc")).toBeInTheDocument();
  });

  it("shows an empty state with no rules", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({
      module: "material_master",
      label: "Material Master",
      composite_score: null,
      readiness: null,
      failing_checks: 0,
      affected_records: 0,
      dimension_scores: {},
      rules: [],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText(/no results for this object in this run/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(objectsApi, "getObject").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });
});
