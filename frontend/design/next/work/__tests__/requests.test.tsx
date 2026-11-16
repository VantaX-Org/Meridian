import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { WorkRequests } from "../Requests";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Requests (next)", () => {
  it("lists the change requests and opens the new request form", async () => {
    setUrl("/requests?fixture=1&view=all");
    renderWithQuery(<ToastProvider><WorkRequests /></ToastProvider>);
    await screen.findByTestId("requests-canvas");
    await waitFor(() => expect(screen.getByRole("table", { name: /Change requests/ })).toBeTruthy());
    const btn = screen.getByRole("button", { name: "New request" });
    if (!(btn as HTMLButtonElement).disabled) {
      fireEvent.click(btn);
      expect(await screen.findByTestId("new-request")).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Entry defaults" }));
    expect(await screen.findByTestId("entry-defaults")).toBeTruthy();
  });
});
