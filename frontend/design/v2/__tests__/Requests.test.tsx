import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { parseFields, parseKeys, RequestsCanvas } from "../screens/Requests";
import { RequestInspector } from "../inspector/request";
import { fireEvent } from "@testing-library/react";
import { WorkflowsSection } from "../admin/workflows";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, shared: false, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Requests", () => {
  it("reads one TABLE.FIELD=value per line and skips the rest", () => {
    expect(parseFields("MARA.MATKL=001\n\nnoise\n MARA.MEINS = EA \n=x")).toEqual({ "MARA.MATKL": "001", "MARA.MEINS": "EA" });
  });

  it("reads record keys from lines and commas and gives a bare number its key field", () => {
    expect(parseKeys("101\nMATNR=102, 101;VBELN=9", "material")).toEqual(["MATNR=101", "MATNR=102", "VBELN=9"]);
    expect(parseKeys("204411", "customer")).toEqual(["KUNNR=204411"]);
  });

  it("creates a mass change from pasted keys and previews each record before and after", async () => {
    setUrl("/requests?fixture=1&view=all");
    renderWithQuery(<RequestsCanvas />);
    fireEvent.click(screen.getByRole("button", { name: "New request" }));
    const form = await screen.findByTestId("new-request");
    fireEvent.change(form.querySelectorAll("select")[1], { target: { value: "mass_change" } });
    fireEvent.change(form.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "101\n102\n999" } });
    fireEvent.change(form.querySelector("input[placeholder='MARC.DISPO']") as HTMLInputElement, { target: { value: "marc.dispo" } });
    const value = Array.from(form.querySelectorAll("input")).filter((i) => !i.placeholder && i.maxLength === 500)[0];
    fireEvent.change(value, { target: { value: "N01" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const grid = await screen.findByTestId("mass-preview");
    await waitFor(() => expect(grid.textContent).toContain("Hex bolt M8 x 40"));
    expect(grid.textContent).toContain("MATNR=999");
    expect(grid.textContent).toContain("Not found");
    expect(grid.textContent).toContain("M02");
    expect(grid.textContent).toContain("N01");
    await waitFor(() => expect((screen.getByRole("button", { name: "Submit for approval" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("lists the fixture change requests with links that open the request inspector", async () => {
    setUrl("/requests?fixture=1&view=all");
    renderWithQuery(<RequestsCanvas />);
    const table = await screen.findByTestId("requests-table");
    const link = table.querySelector("a");
    expect(link?.getAttribute("href")).toContain("open=request");
  });

  it("shows the age and due time of an open request and the tenant entry defaults", async () => {
    setUrl("/requests?fixture=1&view=all");
    renderWithQuery(<RequestsCanvas />);
    const table = await screen.findByTestId("requests-table");
    expect(table.textContent).toContain("Age");
    expect(table.textContent).toMatch(/47 h/);
    fireEvent.click(screen.getByRole("button", { name: "Entry defaults" }));
    const panel = await screen.findByTestId("entry-defaults");
    await waitFor(() => expect(panel.textContent).toContain("MARA-MEINS"));
  });

  it("lists the field history of a request with each code beside its description", async () => {
    setUrl("/requests?fixture=1");
    renderWithQuery(<RequestInspector id="CR-1001" onClose={() => undefined} />);
    const table = await screen.findByTestId("request-field-history");
    expect(table.textContent).toContain("Defaulted");
    expect(table.textContent).toContain("Hydraulic seal kit 80mm");
    expect(table.textContent).toContain("MARA-MEINS");
    expect(table.textContent).toContain("Base unit of measure");
  });

  it("lists derivation rules and critical fields with each code beside its description", async () => {
    setUrl("/requests?fixture=1&view=all");
    renderWithQuery(<RequestsCanvas />);
    fireEvent.click(await screen.findByRole("button", { name: "Derivations and critical fields" }));
    const rules = await screen.findByTestId("derivation-rules");
    await waitFor(() => expect(rules.textContent).toContain("MARC-BESKZ"));
    expect(rules.textContent).toContain("MARA-MTART");
    const crit = await screen.findByTestId("critical-fields");
    await waitFor(() => expect(crit.textContent).toContain("MARA-MTART"));
  });

  it("flags the critical fields a request touches in the inspector", async () => {
    setUrl("/requests?fixture=1");
    renderWithQuery(<RequestInspector id="CR-1001" onClose={() => undefined} />);
    const flag = await screen.findByTestId("request-critical");
    expect(flag.textContent).toContain("MARA-MTART");
  });

  it("gates the workflow administration on manage_workflows", async () => {
    h.allowed = [];
    setUrl("/admin/workflows?fixture=1");
    renderWithQuery(<WorkflowsSection />);
    expect(screen.getByTestId("needs-permission").textContent).toContain("manage workflows");
  });

  it("lists the workflow versions in fixture mode", async () => {
    setUrl("/admin/workflows?fixture=1");
    renderWithQuery(<WorkflowsSection />);
    await waitFor(() => expect(document.querySelector("[data-testid^='workflow-']")).not.toBeNull());
  });
});
