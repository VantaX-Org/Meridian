// frontend/app/(app)/objects/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectsPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("ObjectsPage", () => {
  it("renders one row per object with its readiness", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [
        {
          module: "material_master",
          label: "Material Master",
          composite_score: 72.5,
          readiness: "warn",
          failing_checks: 3,
          affected_records: 120,
        },
      ],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Material Master")).toBeInTheDocument());
    expect(screen.getByText("72.5")).toBeInTheDocument();
  });

  it("shows an empty state when the run has no objects", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(/no objects/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(objectsApi, "getObjects").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
  });
});
