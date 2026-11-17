import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { Delta } from "./Delta";
import { RUN, route } from "./move-fixture";

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

const B = "/api/v1/migration/move";

describe("Delta", () => {
  it("needs a date, then sends the delta", async () => {
    const calls = route({ [`POST ${B}/plans/p1/delta`]: { ...RUN, id: "d1", dry_run: false }, [`GET ${B}/runs/d1`]: { ...RUN, id: "d1", dry_run: false } });
    renderScreen(<Delta planId="p1" onBack={() => undefined} />);
    const send = screen.getByRole("button", { name: "Send the delta" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(document.querySelector("input[type=date]") as HTMLInputElement, { target: { value: "2026-11-01" } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.key.endsWith("/delta"))?.body).toEqual({ since: "2026-11-01" }));
    expect(await screen.findByLabelText("Progress by wave")).toBeTruthy();
  });
});
