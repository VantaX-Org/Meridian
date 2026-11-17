import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { PlanStep } from "./PlanStep";
import { PLAN, route } from "./move-fixture";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/api/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/client")>();
  const mk = () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() });
  return { ...m, default: mk(), uploadApiClient: mk() };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/n/load/move");
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

  it("shows what was cleaned and opens the review list", async () => {
    route({ "GET /api/v1/migration/move/plans/p1": PLAN });
    renderScreen(<PlanStep planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("Cleaned automatically")).toBeTruthy();
    expect(screen.getByText("Phone number format")).toBeTruthy();
    expect(screen.getByText(/still need review load with their current value/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the 7 records to review" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("a@x");
    expect(dialog.textContent).toContain("Email must be valid");
  });
});
