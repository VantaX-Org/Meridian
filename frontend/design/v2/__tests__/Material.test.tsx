import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Material } from "../screens/Material";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Material 360", () => {
  it("asks for a material number when none is given", () => {
    setUrl("/materials");
    renderWithQuery(<Material />);
    expect(screen.getByText(/Type a material number/)).toBeInTheDocument();
    expect(within(screen.getByTestId("material-search")).getByRole("button")).toBeDisabled();
  });

  it("lists the materials with the most serious open findings and opens one on a click", async () => {
    setUrl("/materials");
    renderWithQuery(<Material />);
    const worst = await screen.findByTestId("material-worst");
    const picks = await within(worst).findAllByRole("button");
    expect(picks.length).toBeGreaterThan(0);
    expect(within(worst).getAllByText(/^(Critical|High|Medium|Low)$/).length).toBeGreaterThan(0);
    fireEvent.click(picks[0]);
    // The pick opens the material: the number lands in the search box and the landing list goes.
    const input = within(screen.getByTestId("material-search")).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toMatch(/^\d+$/);
    expect(screen.queryByTestId("material-worst")).toBeNull();
  });

  it("shows the matrix, failing rules, follow-up chain and look-alikes", async () => {
    setUrl("/materials?m=10004711");
    renderWithQuery(<Material />);
    const banner = await screen.findByTestId("material-banner");
    expect(banner).toHaveTextContent("Hydraulic pump seal kit");
    expect(banner).toHaveTextContent("Finished product, Seals and gaskets, base unit Each");

    const matrix = screen.getByTestId("material-matrix");
    expect(within(matrix).getByText("Valuation 1000")).toBeInTheDocument();
    expect(within(matrix).getAllByText("Missing", { selector: "td" }).length).toBe(3);
    // MM549 and MM061 fail on MRP at plant 1000, a maintained cell.
    const mrp = within(matrix).getByText("MRP").closest("tr") as HTMLElement;
    expect(await within(mrp).findByText("Failing")).toHaveAttribute("data-band", "2");

    const findings = await screen.findByTestId("material-findings");
    expect(within(findings).getByText("Valuation class is blank for a valuated material type")).toBeInTheDocument();
    expect(within(findings).getAllByRole("row").length).toBe(4);

    const chain = await screen.findByTestId("material-chain");
    expect(chain).toHaveTextContent("Ends with no successor");
    expect(chain).toHaveTextContent("Discontinued with no successor");
    expect(chain).toHaveTextContent("Discontinued part in an active BOM with no discontinuation group");

    const dups = await screen.findByTestId("material-duplicates");
    expect(within(dups).getByText("EAN same")).toBeInTheDocument();
  });

  it("says when the material is not in the material master", async () => {
    setUrl("/materials?m=999");
    renderWithQuery(<Material />);
    expect(await screen.findByText("This material is not in the material master.")).toBeInTheDocument();
  });

  it("opens the material typed in the form", async () => {
    setUrl("/materials");
    renderWithQuery(<Material />);
    const form = screen.getByTestId("material-search");
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: " 10004711 " } });
    fireEvent.submit(form);
    expect(await screen.findByTestId("material-banner")).toBeInTheDocument();
  });
});
