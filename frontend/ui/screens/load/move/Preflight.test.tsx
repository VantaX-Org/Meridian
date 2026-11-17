import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { Preflight } from "./Preflight";
import { route } from "./move-fixture";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
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

const URL = "POST /api/v1/migration/move/plans/p1/preflight";

describe("Preflight", () => {
  it("locks the load while an error exists", async () => {
    route({ [URL]: { issues: [{ entity: "PerPerson", field: "email", records: 12, reason: "Email missing", severity: "critical" }, { entity: "MARA", field: null, records: 3, reason: "Short text", severity: "low" }] } });
    renderScreen(<Preflight planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("Email missing")).toBeTruthy();
    expect(screen.getByText("Short text")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to load" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the load go ahead when clean", async () => {
    route({ [URL]: { issues: [] } });
    const next = vi.fn();
    renderScreen(<Preflight planId="p1" onBack={() => undefined} onNext={next} />);
    expect(await screen.findByText("No issues found")).toBeTruthy();
    const b = screen.getByRole("button", { name: "Continue to load" }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    b.click();
    expect(next).toHaveBeenCalled();
  });
});
