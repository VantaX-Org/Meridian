import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { WorkProcessAnalytics } from "../ProcessAnalytics";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Process analytics (next)", () => {
  it("shows the figures and the forecast", async () => {
    setUrl("/requests/analytics?fixture=1");
    renderWithQuery(<ToastProvider><WorkProcessAnalytics /></ToastProvider>);
    await screen.findByTestId("process-analytics");
    expect(await screen.findByTestId("pa-forecast")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Median cycle").length).toBeGreaterThan(0));
  });
});
