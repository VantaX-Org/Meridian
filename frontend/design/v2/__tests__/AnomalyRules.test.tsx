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
    expect((await within(fields).findAllByText("Gross weight")).length).toBeGreaterThan(0);
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

  it("proposes a draft rule from a shift", async () => {
    renderWithQuery(<AnomalyRules />);
    const btn = await screen.findByTestId("propose-shift-shift-2");
    fireEvent.click(btn);
    expect(await within(screen.getByTestId("shift-shift-2")).findByText("Proposed")).toBeDisabled();
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

describe("stage 5: explanation", () => {
  it("says what the screen shows and what to do next", async () => {
    renderWithQuery(<AnomalyRules />);
    expect(await screen.findByText(/Aletheia finds values far outside the usual range/)).toBeInTheDocument();
  });
});

describe("stage 5: anomaly rules second pass", () => {
  const cur = () => screen.getByTestId("anomaly-steps").querySelector('[aria-current="step"]')?.textContent ?? "";

  it("shows where the user is from outlier to rule and moves on with each step", async () => {
    renderWithQuery(<AnomalyRules />);
    await screen.findByTestId("anomaly-rules-fields");
    expect(cur()).toContain("Pick a field");
    fireEvent.click(await screen.findByTestId("propose-anom-1"));
    await screen.findByTestId("anomaly-rules-yaml");
    expect(cur()).toContain("Save it as a draft");
    expect(screen.getAllByTestId("consequence").some((e) => /flags nothing until a steward publishes/.test(e.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByTestId("anomaly-rules-save"));
    await screen.findByText("Saved as draft");
    expect(cur()).toContain("Publish it in the rule workbench");
  });

  it("states what proposing does before any button is pressed, and charts outliers by field", async () => {
    renderWithQuery(<AnomalyRules />);
    expect(await screen.findByTestId("anomaly-rules-chart")).toBeInTheDocument();
    expect(screen.getAllByTestId("consequence")[0]).toHaveTextContent(/Nothing is saved and nothing is flagged until you save the draft/);
  });
});

function asViewer(path: string) {
  const url = `${path}?fixture=1&role=viewer`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

describe("anomaly rules: roles", () => {
  it("tells a viewer proposing needs manage rules, and shows no propose button", async () => {
    asViewer("/anomaly-rules");
    renderWithQuery(<AnomalyRules />);
    expect(await screen.findByTestId("needs-permission")).toHaveTextContent("Proposing an anomaly rule needs the manage rules permission");
    expect(screen.queryByTestId("propose-anom-1")).toBeNull();
  });
});
