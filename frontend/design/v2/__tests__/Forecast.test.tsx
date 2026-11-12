import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Forecast } from "../screens/Forecast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

const h = vi.hoisted(() => ({ totalActions: 0 }));
vi.mock("@/lib/api/v2/analytics", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/analytics")>();
  // totalActions > 0 plays a plan that holds more actions than the list returned
  return { ...m, getPrescriptive: async () => {
    const p = await m.getPrescriptive();
    return h.totalActions ? { ...p, total_actions: h.totalActions } : p;
  } };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/forecast");
  h.totalActions = 0;
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Forecast and plan", () => {
  it("leads with the objects below their floor and lists red before amber before green", async () => {
    renderWithQuery(<Forecast />);
    const banner = await screen.findByTestId("fc-banner");
    expect(banner.textContent).toMatch(/FI general ledger is below its floor/);
    const rows = within(await screen.findByTestId("fc-warnings")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["FI general ledger", "Material master", "Business partner"]);
    expect(rows[1].textContent).toMatch(/Heading below its floor within 30 days/);
  });

  it("names rules beside their ids, plans sprints, and counts only open queue stages", async () => {
    renderWithQuery(<Forecast />);
    const actions = await screen.findByTestId("fc-actions");
    const named = await within(actions).findByText("Base unit of measure MEINS must reference a valid entry in T006");
    expect(named.closest("th")!.textContent).toContain("MM142");
    expect(within(actions).getByText("Merge suggested for vendors 100234 and 100871")).toBeInTheDocument();
    const sprints = await screen.findByTestId("fc-sprints");
    expect(within(sprints).getByText("Sprint 1").closest("tr")!.textContent).toMatch(/82\.4 to 85\.1/);
    const queue = await screen.findByTestId("fc-queue");
    expect(within(queue).getByText("Waiting for approval")).toBeInTheDocument();
    expect(within(queue).getByTestId("fc-capacity").textContent).toMatch(/Stewards needed4/);
    expect(actions.textContent).toContain("Ranked by severity-weighted records fixed an hour");   // every action is listed
  });

  it("says how many actions the plan holds when the list shows only the top of them", async () => {
    h.totalActions = 90;
    renderWithQuery(<Forecast />);
    const actions = await screen.findByTestId("fc-actions");
    await waitFor(() => expect(actions.textContent).toMatch(/The first \d+ of 90/));
  });
});
