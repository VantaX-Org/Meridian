import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { RuleCanvas } from "../screens/Rule";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("../screens/object/LedgerSlot", () => ({
  LedgerSlot: ({ label, scope }: { label: string; scope: { module?: string; filters?: Record<string, string> } }) => (
    <div data-testid="ledger-slot" data-label={label} data-module={scope.module} data-filters={JSON.stringify(scope.filters ?? {})} />
  ),
}));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetObjectFixture();
  setUrl("/r/MM014?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the rule canvas /r/{check_id}", () => {
  it("heads the page with the rule id and name, and a stat line of its own with no ruler", async () => {
    renderWithQuery(<RuleCanvas id="MM014" />);
    await waitFor(() => expect(norm(screen.getByRole("heading", { level: 1 }))).toContain("MM014 Base unit of measure not valid"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const line = await screen.findByTestId("rule-stat-line");
    const parts = Array.from(line.querySelectorAll("span")).map((s) => s.textContent);
    expect(parts.slice(0, 3)).toEqual(["Critical", "Validity", "4,212 failing across 2 objects"]);
    expect(parts).toContain("4.99% of records checked");
    expect(parts).toContain("blocks 3 S/4 features");
    await waitFor(() => expect(Array.from(line.querySelectorAll("span")).map((s) => s.textContent)).toContain("over tolerance"));
    expect(document.querySelector('svg[data-size]')).toBeNull(); // a rule has no ruler
  });

  it("has the tabs Definition, Failing records, Impact and History, Definition first", async () => {
    renderWithQuery(<RuleCanvas id="MM014" />);
    const nav = await screen.findByRole("navigation", { name: "Views of MM014" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Definition", "Failing records", "Impact", "History"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).toHaveAttribute("href", expect.stringMatching(/^\/r\/MM014\?.*tab=failing/));
    expect(links[0]).toHaveAttribute("href", expect.not.stringContaining("tab="));
  });

  it("Definition shows the definition, authority, versions, scope, contract and the role's actions", async () => {
    renderWithQuery(<RuleCanvas id="MM014" />);
    await screen.findByRole("region", { name: "Definition" });
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Definition", "Authority", "Versions", "Scope: 2 objects, 1 system", "Contract", "Actions"]);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(expect.arrayContaining(["Definition", "Scope: 2 objects, 1 system"]));
    // On the canvas the rule is already open: no link back to itself.
    expect(within(screen.getByRole("region", { name: "Actions" })).queryByRole("link", { name: "Open the rule" })).toBeNull();
  });

  it("Failing records is the ledger scoped to the rule: module and a check_id filter", async () => {
    setUrl("/r/MM014?tab=failing&fixture=1");
    renderWithQuery(<RuleCanvas id="MM014" />);
    const slot = await screen.findByTestId("ledger-slot");
    expect(slot).toHaveAttribute("data-module", "material_master");
    expect(JSON.parse(slot.getAttribute("data-filters") ?? "{}")).toEqual({ check_id: "MM014" });
    expect(screen.getByRole("link", { name: "Failing records" })).toHaveAttribute("aria-current", "page");
  });

  it("Impact shows the facts, what the rule blocks and the lineage", async () => {
    setUrl("/r/MM014?tab=impact&fixture=1");
    renderWithQuery(<RuleCanvas id="MM014" />);
    await screen.findByRole("region", { name: "Facts" });
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Facts", "Blocks: 3 S/4 features", "Lineage"]);
    expect(screen.getByTestId("lineage")).toBeInTheDocument();
  });

  it("History lists the runs and versions", async () => {
    setUrl("/r/MM014?tab=history&fixture=1");
    renderWithQuery(<RuleCanvas id="MM014" />);
    const h = await screen.findByRole("region", { name: "History" });
    await waitFor(() => expect(within(h).getAllByRole("listitem").length).toBeGreaterThan(2));
    expect(norm(within(h).getAllByRole("listitem")[0])).toContain("Run 16 Oct 2026: 3,640 failing in Material master");
  });

  it("keeps the run in the tab links", async () => {
    setUrl("/r/MM014?run=abc&fixture=1");
    renderWithQuery(<RuleCanvas id="MM014" />);
    const nav = await screen.findByRole("navigation", { name: "Views of MM014" });
    expect(within(nav).getByRole("link", { name: "Impact" })).toHaveAttribute("href", expect.stringContaining("run=abc"));
  });

  it("says so, with Retry and a way on, for a rule that cannot be read", async () => {
    renderWithQuery(<RuleCanvas id="ZZ999" />);
    const alert = await screen.findByTestId("error-frame");
    expect(alert).toHaveTextContent("This rule could not be read.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the rules library" })).toHaveAttribute("href", expect.stringContaining("/rules"));
  });

  it("holds the layout while the rule loads", () => {
    renderWithQuery(<RuleCanvas id="MM014" />);
    expect(screen.getByTestId("rule-canvas-loading")).toHaveAttribute("aria-busy", "true");
  });
});
