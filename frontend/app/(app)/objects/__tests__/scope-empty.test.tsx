// frontend/app/(app)/objects/__tests__/scope-empty.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as permissions from "@/lib/permissions";
import ObjectsPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("ObjectsPage scope", () => {
  it("says the run's objects are outside the user's access when the scope hides every one", async () => {
    vi.spyOn(permissions, "usePermissions").mockReturnValue({
      loading: false, data: undefined, has: () => true, can: () => true, scopes: [],
      scopeFilter: { systems: null, modules: new Set(["hcm"]) }, requestAccess: () => {},
    });
    const mk = (module: string, label: string) => ({ module, label, composite_score: 80, readiness: "pass" as const, failing_checks: 0, affected_records: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA"), mk("b", "BBB")] });
    renderWithQuery(<ObjectsPage />);
    expect(await screen.findByText("2 objects in this run are outside your access")).toBeInTheDocument();
    expect(screen.getByText("Ask an administrator for access to them.")).toBeInTheDocument();
    expect(screen.queryByText("No objects in this run")).toBeNull();
  });
});
