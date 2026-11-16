import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { PostClean, WatchedObjects } from "../PostClean";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  setUrl("/monitor?tab=clean&fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Monitor after cleaning and objects (next)", () => {
  it("shows the records failing again and links to cleansing", async () => {
    renderWithQuery(<ToastProvider><PostClean /></ToastProvider>);
    await waitFor(() => expect(screen.getByTestId("monitor-banner")).toBeTruthy());
    expect(screen.getAllByTestId("monitor-row").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open cleansing" }).getAttribute("href")).toMatch(/^\/cleansing/);
    await waitFor(() => expect(screen.getByTestId("back-weekly")).toBeTruthy());
  });

  it("lists every measured object with its freshness", async () => {
    renderWithQuery(<ToastProvider><WatchedObjects /></ToastProvider>);
    await waitFor(() => expect(screen.getAllByTestId("objects-monitor-row").length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("objects-monitor-row")[0].getAttribute("data-freshness")).toBeTruthy();
  });
});
