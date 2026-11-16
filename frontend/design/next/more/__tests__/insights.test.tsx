import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/insights";
import { Insights } from "../Insights";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/insights?tab=costs");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Cost and causes", () => {
  it("shows the banner and every panel", async () => {
    renderWithQuery(<Insights />);
    expect(await screen.findByTestId("ins-banner")).toBeInTheDocument();
    for (const id of ["ins-areas", "ins-impact", "ins-causes", "ins-proven", "ins-trend", "ins-exec", "ins-cleansing", "ins-drivers"]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
  });

  it("shows empty states when nothing is measured", async () => {
    vi.spyOn(api, "getProvenCost").mockRejectedValue({ status: 404 });
    vi.spyOn(api, "getImpact").mockRejectedValue({ status: 404 });
    vi.spyOn(api, "getCauseClusters").mockRejectedValue({ status: 404 });
    renderWithQuery(<Insights />);
    expect(await screen.findByText("No cost or value at risk has been measured yet.")).toBeInTheDocument();
    expect(await screen.findByText("No priced SAP feature is blocked or degraded.")).toBeInTheDocument();
    expect(await screen.findByText("No failing rule to group yet.")).toBeInTheDocument();
    expect(screen.getByText("No posted document shows a cost from bad data yet.")).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getProvenCost").mockRejectedValue(new Error("down"));
    renderWithQuery(<Insights />);
    expect(await screen.findByText("What bad data costs could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("ins-banner")).toBeInTheDocument();
  });
});
