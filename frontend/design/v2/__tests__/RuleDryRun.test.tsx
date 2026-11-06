import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { RuleDryRun, parseChanges, pct } from "../screens/RuleDryRun";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/rule-dry-run?rule=AP002&module=accounts_payable");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("rule dry run", () => {
  it("parses the changes box and formats a rate", () => {
    expect(parseChanges("  ")).toBeNull();
    expect(parseChanges('{"pattern": "^[0-9]+$"}')).toEqual({ pattern: "^[0-9]+$" });
    expect(() => parseChanges("[1]")).toThrow();
    expect(() => parseChanges("{nope")).toThrow();
    expect(pct(2.75)).toBe("2.8%");
  });

  it("runs from the query, shows codes with text, the cap note and shapes", async () => {
    renderWithQuery(<RuleDryRun />);
    expect(screen.getByTestId("dry-run-rule")).toHaveValue("AP002");
    fireEvent.click(screen.getByTestId("dry-run-go"));
    const result = await screen.findByTestId("dry-run-result");
    expect(within(result).getByText("Vendor number must be alphanumeric, at most 10 characters")).toBeInTheDocument();
    expect(within(result).getByText("Account number of vendor or creditor")).toBeInTheDocument();
    expect(screen.getByTestId("dry-run-cap-note")).toHaveTextContent("50,000");
    expect(screen.getByTestId("dry-run-delta-score")).toHaveTextContent("-1.2");
    const shapes = screen.getByTestId("dry-run-shapes");
    expect(within(shapes).getByText("960 values")).toBeInTheDocument();
    // an edit with no changes still shows the delta against the current rule
    expect(screen.getByTestId("dry-run-edit-line")).toHaveTextContent("0 newly failing, 0 newly passing");
  });

  it("shows the edit delta when changes are given", async () => {
    renderWithQuery(<RuleDryRun />);
    fireEvent.change(screen.getByTestId("dry-run-changes"), { target: { value: '{"pattern": "^[0-9]{1,10}$"}' } });
    fireEvent.click(screen.getByTestId("dry-run-go"));
    expect(await screen.findByTestId("dry-run-edit-line")).toHaveTextContent("960 newly failing, 20 newly passing");
  });

  it("refuses changes that are not a JSON object", async () => {
    renderWithQuery(<RuleDryRun />);
    fireEvent.change(screen.getByTestId("dry-run-changes"), { target: { value: "{nope" } });
    fireEvent.click(screen.getByTestId("dry-run-go"));
    expect(await screen.findByText(/must be a JSON object of rule fields/)).toBeInTheDocument();
    expect(screen.queryByTestId("dry-run-result")).toBeNull();
  });
});

describe("stage 5: primary action", () => {
  it("is the filled action to run the draft against current data", async () => {
    renderWithQuery(<RuleDryRun />);
    const go = screen.getByTestId("dry-run-go");
    expect(go).toHaveClass("m2-next");
    expect(go).toHaveTextContent("Run the draft against current data");
  });
});
