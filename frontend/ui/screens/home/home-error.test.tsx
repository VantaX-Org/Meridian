import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { Home } from "./Home";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/next/portfolio", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/next/portfolio")>()),
  usePortfolio: () => ({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() }),
}));

describe("Home errors", () => {
  it("shows the error state when the portfolio query fails", async () => {
    window.history.replaceState(null, "", "/?fixture=1");
    renderWithQuery(<AletheiaProvider><ToastHost><Home /></ToastHost></AletheiaProvider>);
    expect(await screen.findByText("The overview could not be loaded", {}, { timeout: 5000 })).toBeTruthy();
  });
});
