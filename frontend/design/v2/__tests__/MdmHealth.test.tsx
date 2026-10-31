import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/mdm-health";
import { mdmHealthRead } from "@/lib/api/v2/fixtures/mdm-health";
import { MdmHealth, PARTS, points } from "../screens/MdmHealth";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/mdm");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("MDM health", () => {
  it("breaks the score into four weighted shares whose points add up to it", () => {
    const { latest } = mdmHealthRead("/mdm-metrics") as api.MdmDashboard;
    const sum = PARTS.reduce((s, p) => s + points(latest!, p), 0);
    expect(sum).toBeCloseTo(latest!.mdm_health_score, 1);
    expect(PARTS.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
  });

  it("shows the score, the breakdown and both trends", async () => {
    renderWithQuery(<MdmHealth />);
    const banner = await screen.findByTestId("mdm-banner");
    expect(banner.textContent).toMatch(/Health \d+\.\d out of 100/);
    const parts = screen.getByTestId("mdm-parts");
    expect(within(parts).getAllByRole("row")).toHaveLength(5);
    expect(within(parts).getByText("Golden record coverage")).toBeInTheDocument();
    expect(await screen.findByTestId("mdm-trend")).toBeInTheDocument();
    expect(screen.getByTestId("mdm-backlog")).toBeInTheDocument();
  });

  it("says so when no snapshot has run", async () => {
    vi.spyOn(api, "getMdmHealth").mockResolvedValue({ latest: null, trend: [], active_systems_count: 0 });
    renderWithQuery(<MdmHealth />);
    expect(await screen.findByText("No MDM snapshot has been taken yet. The snapshot runs once a day.")).toBeInTheDocument();
  });
});
