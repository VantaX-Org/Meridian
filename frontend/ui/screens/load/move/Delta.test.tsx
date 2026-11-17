import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Delta } from "./Delta";
import { RUN, route } from "./move-fixture";

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

describe("Delta", () => {
  it("needs a date and a dry run, then sends the delta", async () => {
    const calls = route({
      [`POST ${B}/plans/p1/delta`]: (b) => ((b as { dry_run: boolean }).dry_run ? { ...RUN, id: "d0" } : { ...RUN, id: "d1", dry_run: false }),
      [`GET ${B}/runs/d0`]: { ...RUN, id: "d0" },
      [`GET ${B}/runs/d1`]: { ...RUN, id: "d1", dry_run: false },
    });
    renderScreen(<Delta planId="p1" onBack={() => undefined} />);
    const dry = screen.getByRole("button", { name: "Dry run the delta" }) as HTMLButtonElement;
    const send = screen.getByRole("button", { name: "Send the delta" }) as HTMLButtonElement;
    expect(dry.disabled).toBe(true);
    fireEvent.change(document.querySelector("input[type=date]") as HTMLInputElement, { target: { value: "2026-11-01" } });
    expect(send.disabled).toBe(true);
    fireEvent.click(dry);
    await waitFor(() => expect(calls.find((c) => c.key.endsWith("/delta"))?.body).toEqual({ since: "2026-11-01", dry_run: true }));
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(calls.filter((c) => c.key.endsWith("/delta")).at(-1)?.body).toEqual({ since: "2026-11-01", dry_run: false }));
    expect(await screen.findByLabelText("Progress by wave")).toBeTruthy();
  });
});
