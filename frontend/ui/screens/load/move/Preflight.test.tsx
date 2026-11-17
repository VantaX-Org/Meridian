import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Preflight } from "./Preflight";
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

const B = "/api/v1/migration/move/plans/p1";
const plan = (preflight: unknown) => ({ ...PLAN, preflight });

describe("Preflight", () => {
  it("queues the check, then locks the load while an error exists", async () => {
    const calls = route({
      [`POST ${B}/preflight`]: { issues: [], status: "queued" },
      [`GET ${B}`]: plan({ status: "completed", issues: [
        { entity: "PerPerson", field: "email", records: ["1001", "1002"], reason: "Email missing", severity: "error" },
        { entity: null, field: null, records: [], reason: "Target is read only", severity: "warning" },
      ] }),
    });
    renderScreen(<Preflight planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("Email missing")).toBeTruthy();
    expect(screen.getByText(/2 records, for example 1001, 1002/)).toBeTruthy();
    expect(screen.getByText("Target system")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to load" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.key === `POST ${B}/preflight`)).toBe(true);
  });

  it("waits while queued and lets the load go ahead when clean", async () => {
    route({ [`POST ${B}/preflight`]: { issues: [], status: "queued" }, [`GET ${B}`]: plan({ status: "queued", issues: [] }) });
    const { unmount } = renderScreen(<Preflight planId="p1" onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText(/Checking the target/)).toBeTruthy();
    unmount();
    route({ [`POST ${B}/preflight`]: { issues: [], status: "queued" }, [`GET ${B}`]: plan({ status: "completed", issues: [] }) });
    const next = vi.fn();
    renderScreen(<Preflight planId="p1" onBack={() => undefined} onNext={next} />);
    expect(await screen.findByText("No issues found")).toBeTruthy();
    const b = screen.getByRole("button", { name: "Continue to load" }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    b.click();
    expect(next).toHaveBeenCalled();
  });
});
