import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { SystemComparePair } from "../screens/SystemComparePair";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/compare");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("saved comparison of a pair", () => {
  it("opens an earlier comparison from the trend list and closes it again", async () => {
    renderWithQuery(<ToastProvider><SystemComparePair id="pair-0001" onBack={() => undefined} /></ToastProvider>);
    const buttons = await screen.findAllByRole("button", { name: /^Open the comparison of/ });
    fireEvent.click(buttons[0]);
    const saved = await screen.findByTestId("cmp-saved");
    expect(await within(saved).findByText(/^Comparison of /)).toBeTruthy();
    fireEvent.click(within(saved).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("cmp-saved")).toBeNull();
  });
});
