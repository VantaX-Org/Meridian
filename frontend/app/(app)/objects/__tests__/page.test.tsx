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
  it.each([["ready", "Ready Obj", "Blocked Obj"], ["not_ready", "Blocked Obj", "Ready Obj"]])("?verdict=%s filters rows", async (v, shown, hidden) => {
    currentSearch = `run=v1&verdict=${v}`;
    const mk = (module: string, label: string, readiness: "pass" | "warn") => ({ module, label, composite_score: 80, readiness, failing_checks: 0, affected_records: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "Ready Obj", "pass"), mk("b", "Blocked Obj", "warn")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(shown)).toBeInTheDocument());
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    currentSearch = "run=v1";
  });

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
    expect(screen.getByText("72.5").closest("a")).toHaveAttribute("href", "/objects/material_master?run=v1&tab=rules");
    expect(screen.getByText("Not ready")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("No objects measured yet.")).toBeInTheDocument());
    expect(screen.getByText("Objects appear after the first analysis.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect a system" })).toBeInTheDocument();
    currentSearch = "run=v1";
  });
});

describe("ObjectsPage verdict param", () => {
  it.each(["garbage", "constructor"])("ignores ?verdict=%s: every object, no banner", async (v) => {
    currentSearch = `run=v1&verdict=${v}`;
    const mk = (module: string, label: string, readiness: "pass" | "warn") => ({ module, label, composite_score: 80, readiness, failing_checks: 0, affected_records: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "Ready Obj", "pass"), mk("b", "Blocked Obj", "warn")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Ready Obj")).toBeInTheDocument());
    expect(screen.getByText("Blocked Obj")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all objects" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    currentSearch = "run=v1";
  });
});
