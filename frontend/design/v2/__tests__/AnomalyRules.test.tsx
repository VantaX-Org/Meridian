import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AnomalyRules, groupByField } from "../screens/AnomalyRules";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/anomaly-rules");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("anomaly rules", () => {
  it("proposes a rule, shows its hit count beside the outliers, and saves it as a draft", async () => {
    renderWithQuery(<AnomalyRules />);
    const fields = await screen.findByTestId("anomaly-rules-fields");
    // every field is shown by its description with the SAP name beside it
    expect(await within(fields).findByText("Gross weight")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("propose-anom-1"));
    const yaml = await screen.findByTestId("anomaly-rules-yaml");
    expect(yaml.textContent).toContain("MARA.BRGEW");
    const evidence = screen.getByTestId("anomaly-rules-evidence");
    expect(within(evidence).getByText("2")).toBeInTheDocument(); // outliers found
    expect(screen.getByTestId("anomaly-rules-hits").textContent).toBe("4");
    fireEvent.click(screen.getByTestId("anomaly-rules-save"));
    expect(await screen.findByText("Saved as draft")).toBeInTheDocument();
  });

  it("shows null spikes and unexpected codes with field, run comparison and counts", async () => {
    renderWithQuery(<AnomalyRules />);
    const spike = await screen.findByTestId("shift-shift-1");
    expect(within(spike).getByText("Gross weight")).toBeInTheDocument();
    expect(within(spike).getByText("MARA-BRGEW")).toBeInTheDocument();
    expect(within(spike).getByText("Null spike")).toBeInTheDocument();
    expect(within(spike).getByText("Run 12 against run 11")).toBeInTheDocument();
    expect(within(spike).getByText("4.5% empty")).toBeInTheDocument();
    expect(within(spike).getByText("65.1% empty")).toBeInTheDocument();
    const code = screen.getByTestId("shift-shift-2");
    expect(within(code).getByText("Unexpected code")).toBeInTheDocument();
    expect(within(code).getByText("HALB")).toBeInTheDocument();
    expect(within(code).getByText("3,420 records")).toBeInTheDocument();
  });

  it("says so when no rule fits", async () => {
    renderWithQuery(<AnomalyRules />);
    fireEvent.click(await screen.findByTestId("propose-anom-7")); // credit limit: no known table
    expect(await screen.findByText("No rule could be proposed for this outlier.")).toBeInTheDocument();
  });

  it("groups outliers per object and field, most first", () => {
    const row = (id: string, f: string, severity: string) => ({ id, module_id: "m", field_name: f, severity }) as never;
    const g = groupByField([row("1", "A", "low"), row("2", "B", "low"), row("3", "B", "high")]);
    expect(g.map((x) => [x.first.id, x.count])).toEqual([["3", 2], ["1", 1]]);
  });
});
