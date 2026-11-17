import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { PlanStep } from "./PlanStep";
import { PLAN, route } from "./move-fixture";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/client")>();
  const mk = () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() });
  return { ...m, default: mk(), uploadApiClient: mk() };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/load/move");
});
afterEach(() => undo());

describe("PlanStep", () => {
  it("shows the unplaced list first and the load order", async () => {
    route({ "GET /api/v1/migration/move/plans/p1": PLAN });
    const next = vi.fn();
    renderScreen(<PlanStep planId="p1" onBack={() => undefined} onNext={next} />);
    const unplaced = await screen.findByTestId("unplaced");
    expect(unplaced.textContent).toContain("LearningItem");
    expect(unplaced.textContent).toContain("No load method");
    expect((await screen.findAllByText("PerPerson")).length).toBeGreaterThan(0);
    screen.getByRole("button", { name: "Check before loading" }).click();
    expect(next).toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("shows what was cleaned and the configuration lists", async () => {
    route({ "GET /api/v1/migration/move/plans/p1": PLAN });
    renderScreen(<PlanStep planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("Cleaned automatically")).toBeTruthy();
    expect(screen.getByText("SF-EC-002")).toBeTruthy();
    expect(screen.getByText("1,520")).toBeTruthy();
    expect(screen.getByText(/still need review load with their current value/)).toBeTruthy();
    const lists = screen.getByRole("group", { name: "Configuration lists" });
    expect(lists.textContent).toContain("company_code");
    expect(lists.textContent).toContain("Company code");
    expect(screen.getAllByText("Upsert").length).toBeGreaterThan(0);
  });

  it("says the plan is being made while it builds, and shows the reason when it fails", async () => {
    route({ "GET /api/v1/migration/move/plans/p1": { ...PLAN, status: "building", waves: [] } });
    const { unmount } = renderScreen(<PlanStep planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("Making the plan")).toBeTruthy();
    unmount();
    route({ "GET /api/v1/migration/move/plans/p1": { ...PLAN, status: "failed", reason: "No full-history download" } });
    renderScreen(<PlanStep planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("No full-history download")).toBeTruthy();
  });
});
