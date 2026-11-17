import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { Scope } from "./Scope";
import { route } from "./move-fixture";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/api/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/client")>();
  const mk = () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() });
  return { ...m, default: mk(), uploadApiClient: mk() };
});
vi.mock("@/lib/v2/admin-queries", () => ({ useLicence: () => ({ data: { enabled_modules: ["employee_central", "material_master"] } }) }));
vi.mock("../hooks", () => ({ useLoadPlan: () => ({ data: undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/load/move");
});
afterEach(() => undo());

describe("Scope", () => {
  it("defaults to every licensed module and makes the plan", async () => {
    const calls = route({ "POST /api/v1/migration/move/plans": { id: "p9" } });
    const onPlan = vi.fn();
    renderScreen(<Scope pick={{ source: "s1", target: "s2" }} scope={{ modules: [], mode: "cleansed" }} onScope={() => undefined} onBack={() => undefined} onPlan={onPlan} />);
    expect(screen.getByText("Cleaned values")).toBeTruthy();
    expect(screen.getByText("Keep the same IDs")).toBeTruthy();
    expect(screen.getByText("Full history")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make the plan" }));
    await waitFor(() => expect(onPlan).toHaveBeenCalledWith("p9"));
    expect(calls[0].body).toEqual({ source_system_id: "s1", target_system_id: "s2", modules: ["employee_central", "material_master"], mode: "cleansed" });
  });
});
