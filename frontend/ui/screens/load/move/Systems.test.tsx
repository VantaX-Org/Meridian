import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Systems } from "./Systems";
import { route } from "./move-fixture";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const state = { target: false };
const list = vi.fn(async () => [
  { id: "s1", name: "Dev ECC", environment: "dev", role: "source", migration_target: false },
  { id: "s2", name: "New S4", environment: "prod", role: "source", migration_target: state.target },
]);
vi.mock("@/lib/api/v2/runs", async (orig) => ({ ...(await orig<object>()), getSystemsExtended: () => list() }));
vi.mock("@/lib/api/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/client")>();
  const mk = () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() });
  return { ...m, default: mk(), uploadApiClient: mk() };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  state.target = false;
  window.history.replaceState(null, "", "/load/move");
});
afterEach(() => undo());

describe("Systems", () => {
  it("blocks Continue until the target is flagged, then flags it", async () => {
    const calls = route({ "PATCH /api/v1/systems/s2/migration-target": (b: unknown) => { state.target = (b as { enabled: boolean }).enabled; return { id: "s2", migration_target: state.target }; } });
    const onNext = vi.fn();
    renderScreen(<Systems pick={{ source: "s1", target: "s2" }} onPick={() => undefined} onNext={onNext} />);
    const toggle = await screen.findByRole("switch");
    expect((screen.getByRole("button", { name: "Continue to scope" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(calls[0]).toEqual({ key: "PATCH /api/v1/systems/s2/migration-target", body: { enabled: true } }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to scope" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("disables the switch while saving, and offers a retry when the flag fails", async () => {
    let fail = true;
    route({ "PATCH /api/v1/systems/s2/migration-target": () => { if (fail) throw new Error("boom"); return { id: "s2", migration_target: true }; } });
    renderScreen(<Systems pick={{ source: "s1", target: "s2" }} onPick={() => undefined} onNext={() => undefined} />);
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByText(/The flag could not be saved/)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(/The flag could not be saved/)).toBeNull());
  });
});
