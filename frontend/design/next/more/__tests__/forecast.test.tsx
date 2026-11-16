import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/analytics";
import { Forecast } from "../Forecast";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/insights?tab=forecast");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Forecast and plan", () => {
  it("shows the banner, the warnings, the work and the queue", async () => {
    renderWithQuery(<Forecast />);
    expect(await screen.findByTestId("fc-banner")).toBeInTheDocument();
    expect(screen.getByTestId("fc-warnings")).toBeInTheDocument();
    expect(screen.getByTestId("fc-actions")).toBeInTheDocument();
    expect(screen.getByTestId("fc-sprints")).toBeInTheDocument();
    expect(screen.getByTestId("fc-queue")).toBeInTheDocument();
  });

  it("asks for a new sprint plan when the hours change", async () => {
    const spy = vi.spyOn(api, "getSprintPlan");
    renderWithQuery(<Forecast />);
    const select = await screen.findByTestId("fc-sprint-hours");
    fireEvent.change(select, { target: { value: "80" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(80));
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getPredictive").mockRejectedValue(new Error("down"));
    renderWithQuery(<Forecast />);
    expect(await screen.findByText("The forecast could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("fc-banner")).toBeInTheDocument();
  });
});
