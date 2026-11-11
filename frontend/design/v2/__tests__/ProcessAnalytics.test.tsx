import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ProcessAnalytics } from "../screens/ProcessAnalytics";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
const go = (q = "") => { const u = `/requests/analytics?fixture=1&persona=owner${q}`; window.history.pushState({}, "", u); setUrl(u); };
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  go();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("process analytics", () => {
  it("names the bottleneck step and marks it in the steps table", async () => {
    renderWithQuery(<ProcessAnalytics />);
    const banner = await screen.findByTestId("process-analytics");
    expect(banner.textContent).toMatch(/Finance approval is the slowest step/);
    expect(screen.getByTestId("pa-step-Finance approval")).toHaveAttribute("data-bottleneck", "1");
    expect(screen.getByTestId("pa-step-Data steward review")).not.toHaveAttribute("data-bottleneck");
  });

  it("shows the SLA breach rate and the open backlog by age", async () => {
    renderWithQuery(<ProcessAnalytics />);
    const banner = await screen.findByTestId("process-analytics");
    expect(within(banner).getByText(/29 of 238 tasks/)).toBeInTheDocument();
    expect(screen.getByTestId("pa-aging-bar")).toBeInTheDocument();
    expect(screen.getByTestId("pa-object-material")).toBeInTheDocument();
  });

  it("filters to one object", async () => {
    renderWithQuery(<ProcessAnalytics />);
    await screen.findByTestId("pa-object-vendor");
    fireEvent.change(screen.getByTestId("pa-object"), { target: { value: "material" } });
    await waitFor(() => {
      expect(screen.getByTestId("pa-object-material")).toBeInTheDocument();
      expect(screen.queryByTestId("pa-object-vendor")).toBeNull();
    });
  });

  it("forecasts each waiting step with its breach risk and lists the decided tasks it rests on", async () => {
    renderWithQuery(<ProcessAnalytics />);
    expect(await screen.findByTestId("pa-forecast-summary")).toHaveTextContent("4 open requests: 2 likely to miss the SLA, 1 already past it.");
    expect(screen.getByTestId("pa-forecast-CR-0997")).toHaveTextContent("SLA missed");
    const row = screen.getByTestId("pa-forecast-CR-0999");
    expect(row).toHaveTextContent("50.0%");
    expect(row).toHaveTextContent("then Finance approval");
    const ev = screen.getByTestId("pa-evidence-CR-1001");
    expect(ev).toHaveTextContent("Same object, kind and step 6 decided tasks");
    expect(ev.querySelectorAll("li")).toHaveLength(6);
  });
});
