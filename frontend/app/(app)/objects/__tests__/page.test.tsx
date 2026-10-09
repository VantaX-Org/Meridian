// frontend/app/(app)/objects/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as versionsApi from "@/lib/api/versions";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectsPage from "../page";

let currentSearch = "run=v1";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

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
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("shows the day-one empty state when the tenant has no run yet", async () => {
    currentSearch = "";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: null, objects: [] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ total: 0, loaded: 0, counts: {}, systems: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("No objects analysed yet.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Connect a system" })).toBeInTheDocument();
    currentSearch = "run=v1";
  });
});
