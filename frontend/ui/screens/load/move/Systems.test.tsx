import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { Systems } from "./Systems";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const state = { role: "source" };
const list = vi.fn(async () => [
  { id: "s1", name: "Dev ECC", environment: "dev", role: "source" },
  { id: "s2", name: "New S4", environment: "prod", role: state.role },
]);
const update = vi.fn(async (_id: string, body: { role: string }) => { state.role = body.role; return {}; });
vi.mock("@/lib/api/v2/runs", async (orig) => ({ ...(await orig<object>()), getSystemsExtended: () => list() }));
vi.mock("@/lib/api/v2/sys", async (orig) => ({ ...(await orig<object>()), updateSystem: (id: string, b: { role: string }) => update(id, b) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  state.role = "source";
  window.history.replaceState(null, "", "/n/load/move");
});
afterEach(() => undo());

describe("Systems", () => {
  it("blocks Continue until the target is flagged, then flags it", async () => {
    const onNext = vi.fn();
    renderScreen(<Systems pick={{ source: "s1", target: "s2" }} onPick={() => undefined} onNext={onNext} />);
    const toggle = await screen.findByRole("switch");
    expect((screen.getByRole("button", { name: "Continue to scope" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(update).toHaveBeenCalledWith("s2", { role: "target" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to scope" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
