import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { Runs } from "../Runs";
import { SheetHost } from "../../shell/SheetHost";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const E = vi.hoisted(() => ({ exportRuns: vi.fn(async () => undefined) }));
vi.mock("@/lib/api/v2/run-ops", async (orig) => ({ ...(await orig<object>()), ...E }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/next/runs?fixture=1");
  E.exportRuns.mockClear();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

describe("Runs list parity (next)", () => {
  it("includes archived runs on request and exports the list", async () => {
    renderWithQuery(<ToastProvider><SheetHost><Runs /></SheetHost></ToastProvider>);
    const box = (await screen.findByTestId("runs-archived")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    const exp = screen.getByTestId("runs-export");
    fireEvent.click(within(exp).getAllByRole("button")[0]);
    await waitFor(() => expect(E.exportRuns).toHaveBeenCalled());
    expect((E.exportRuns.mock.calls[0] as unknown[])[1]).toMatchObject({ include_archived: true });
  });
});
