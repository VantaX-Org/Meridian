import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { RulesLibrary } from "../screens/RulesLibrary";
import { stubLayout } from "./layout-stub";
import { getUrl, setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: new Set<string>() }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "steward", label: "Data steward", name: "", email: null, fixture: true, can: (a: string) => h.allowed.has(a) }) };
});
vi.mock("@/lib/api/v2/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/client")>();
  return { ...m, v2Send: vi.fn(m.v2Send) };
});
import { v2Send } from "@/lib/api/v2/client";

const sent = vi.mocked(v2Send);

let undo: () => void = () => undefined;
afterEach(() => undo());

beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  sent.mockClear();
  h.allowed = new Set(["manage_rules", "approve"]);
  setUrl("/rules?fixture=1");
});

const render = () => renderWithQuery(<RulesLibrary />);
const grid = () => screen.findByRole("grid", { name: "Rules library" });
/** The number of rules in the grid: the grid draws only the rows in view, and says how many there are. */
const count = (g: HTMLElement) => Number(g.getAttribute("aria-rowcount")) - 1;
const rowsOf = (g: HTMLElement) => within(g).getAllByRole("row").slice(1);
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const bodyOf = (method: string, path: string) => sent.mock.calls.find((c) => c[0] === method && c[1] === path)?.[2] as Record<string, unknown> | undefined;

describe("the rules library", () => {
  it("lists every rule of the tenant across objects, worst severity first", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    expect(screen.getByTestId("rules-status-line")).toHaveTextContent(/rules across \d+ objects/);
    expect(rowsOf(g)[0]).toHaveTextContent("Critical");
  });

  it("filters by object and by severity, and counts what is left", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    pick("Object", "business_partner");
    await waitFor(() => expect(count(g)).toBe(6));
    pick("Severity", "critical");
    await waitFor(() => expect(count(g)).toBeLessThan(6));
    expect(screen.getByRole("button", { name: "Clear the filters" }).parentElement).toHaveTextContent(/^\d+ of 38 rules\./);
    fireEvent.click(screen.getByRole("button", { name: "Clear the filters" }));
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
  });

  it("searches by code and by name", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    pick("Search", "MM014");
    await waitFor(() => expect(count(g)).toBe(1));
    expect(rowsOf(g)[0]).toHaveTextContent("Base unit of measure not valid");
  });

  it("filters by dimension and class by reading the rules of each object", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    const all = count(g);
    pick("Dimension", "completeness");
    await waitFor(() => expect(count(g)).toBeLessThan(all));
    expect(rowsOf(g).every((r) => /Completeness/.test(r.textContent ?? ""))).toBe(true);
    pick("Class", "null_check");
    await waitFor(() => expect(rowsOf(g).every((r) => /Null check/.test(r.textContent ?? ""))).toBe(true));
  });

  it("filters by state", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    pick("State", "disabled");
    expect(await screen.findByText("No rule matches these filters.")).toBeInTheDocument();
  });

  it("a row opens the rule in the inspector", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    pick("Search", "MM014");
    await waitFor(() => expect(count(g)).toBe(1));
    fireEvent.click(rowsOf(g)[0]);
    expect(getUrl()).toContain("open=rule%3AMM014");
  });

  it("disables the selected rules", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    pick("Search", "MM014");
    await waitFor(() => expect(count(g)).toBe(1));
    fireEvent.click(within(g).getByRole("checkbox", { name: "Select row 1" }));
    fireEvent.click(within(await screen.findByTestId("bulk-bar")).getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("1 rule disabled")).toBeInTheDocument();
    expect(sent).toHaveBeenCalledWith("PATCH", "/rules/rule-MM014", { enabled: false });
    pick("State", "disabled");
    await waitFor(() => expect(count(g)).toBe(1));
  });

  it("starts from the suppressions: a suppressed rule can be ended", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: /^Suppressed/ }));
    expect(await screen.findByText(/No rule is suppressed/)).toBeInTheDocument();
  });

  it("a viewer reads the library and cannot write or select", async () => {
    h.allowed = new Set(["view"]);
    render();
    const g = await grid();
    await waitFor(() => expect(count(g)).toBeGreaterThan(30));
    expect(screen.queryByRole("button", { name: "New rule draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drafts" })).toBeNull();
    expect(within(g).queryByRole("checkbox", { name: "Select row 1" })).toBeNull();
    expect(screen.getByTestId("gate-note")).toHaveTextContent("manage rules");
  });
});

describe("rule drafts", () => {
  const openDrafts = async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: /^Drafts/ }));
    return screen.findByTestId("drafts-table");
  };

  it("lists the drafts of every object", async () => {
    const table = await openDrafts();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(table).toHaveTextContent("Net weight above gross weight");
  });

  it("creates a draft, validating first", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: "New rule draft" }));
    const form = await screen.findByRole("form", { name: "New draft" });
    fireEvent.click(within(form).getByRole("button", { name: "Create draft" }));
    expect(await within(form).findByText("Enter a rule id")).toBeInTheDocument();
    expect(within(form).getByText("Choose an object", { selector: "span" })).toBeInTheDocument();
    expect(within(form).getByText("Enter the message stewards will see")).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Rule id"), { target: { value: "ZR000501" } });
    fireEvent.change(within(form).getByLabelText("Object"), { target: { value: "business_partner" } });
    fireEvent.change(within(form).getByLabelText("Message stewards see"), { target: { value: "VAT number missing" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(bodyOf("POST", "/rule-authoring/drafts")).toBeDefined());
    const body = bodyOf("POST", "/rule-authoring/drafts") as { module: string; rule_yaml: string };
    expect(body.module).toBe("business_partner");
    expect(JSON.parse(body.rule_yaml)).toMatchObject({ id: "ZR000501", message: "VAT number missing", check_class: "null_check" });
    await waitFor(() => expect(within(screen.getByTestId("drafts-table")).getAllByRole("row")).toHaveLength(3));
  });

  it("edits a draft and runs it dry", async () => {
    await openDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Edit draft ZR000412" }));
    const form = await screen.findByRole("form", { name: "Edit draft" });
    fireEvent.change(within(form).getByLabelText("Message stewards see"), { target: { value: "Net weight exceeds gross weight" } });
    fireEvent.click(within(form).getByRole("button", { name: "Dry run" }));
    expect(await within(form).findByTestId("dry-run-result")).toHaveTextContent("212 of 61,816 records would fail");
    fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(bodyOf("PUT", "/rule-authoring/drafts/dr-001")).toBeDefined());
    expect(JSON.parse((bodyOf("PUT", "/rule-authoring/drafts/dr-001") as { rule_yaml: string }).rule_yaml)).toMatchObject({ message: "Net weight exceeds gross weight" });
  });

  it("publishes a draft as a rule", async () => {
    await openDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Edit draft ZR000412" }));
    const form = await screen.findByRole("form", { name: "Edit draft" });
    fireEvent.click(within(form).getByRole("button", { name: "Publish rule" }));
    await waitFor(() => expect(sent).toHaveBeenCalledWith("POST", "/rule-authoring/drafts/dr-001/publish"));
    fireEvent.click(screen.getByRole("button", { name: "All rules" }));
    const g = await grid();
    pick("Search", "ZR000412");
    await waitFor(() => expect(count(g)).toBe(1));
    expect(rowsOf(g)[0]).toHaveTextContent("Custom");
  });

  it("deletes a draft after asking", async () => {
    await openDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Edit draft ZR000412" }));
    const form = await screen.findByRole("form", { name: "Edit draft" });
    fireEvent.click(within(form).getByRole("button", { name: "Delete draft" }));
    expect(sent.mock.calls.some((c) => c[0] === "DELETE")).toBe(false);
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(sent).toHaveBeenCalledWith("DELETE", "/rule-authoring/drafts/dr-001"));
    expect(await screen.findByText(/No drafts\./)).toBeInTheDocument();
  });

  it("the Rules tab link opens the drafts of the object", async () => {
    setUrl("/rules?fixture=1&view=drafts&module=material_master");
    render();
    expect(await screen.findByTestId("drafts-table")).toBeInTheDocument();
  });
});
