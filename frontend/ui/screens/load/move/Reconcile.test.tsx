import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Reconcile } from "./Reconcile";
import { RECON, route } from "./move-fixture";

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

const B = "/api/v1/migration/move";

describe("Reconcile", () => {
  it("shows three scores, the table and a sample drill", async () => {
    route({ [`POST ${B}/plans/p1/reconcile`]: { id: "c1" }, [`GET ${B}/reconciliations/c1`]: RECON });
    renderScreen(<Reconcile planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Reconcile now" }));
    expect(await screen.findByText("Projected target")).toBeTruthy();
    expect(screen.getByText("Actual target")).toBeTruthy();
    expect(screen.getByText("Rows rejected by the target")).toBeTruthy();
    await screen.findAllByText("PerPerson");
    fireEvent.click(document.getElementById("mx-row-PerPerson") as HTMLElement);
    expect(await screen.findByText("Sample rows for PerPerson")).toBeTruthy();
    expect(screen.getByText("a@x.test")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("leaves the scores out while they are not known", async () => {
    route({ [`POST ${B}/plans/p1/reconcile`]: { id: "c1" }, [`GET ${B}/reconciliations/c1`]: { ...RECON, dqs: null } });
    renderScreen(<Reconcile planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Reconcile now" }));
    await screen.findAllByText("PerPerson");
    expect(screen.queryByText("Projected target")).toBeNull();
  });
});
