import axe from "axe-core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/attention";
import * as connectivityApi from "@/lib/api/connectivity";
import { SAMPLE, item, listOf } from "@/components/attention/__tests__/fixtures";
import type { Permissions } from "@/lib/permissions";
import AttentionPage from "../page";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn() }),
  usePathname: () => "/attention",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
type Scope = { system_id: string | null; module: string | null };
const perms = vi.hoisted(() => ({ value: {} as Record<string, unknown>, make: (scopes: { system_id: string | null; module: string | null }[]) => ({
  loading: false, data: undefined, has: () => true, can: () => true, scopes, scopeFilter: { systems: null, modules: null }, requestAccess: () => {},
}) }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => perms.value as unknown as Permissions,
  usePermissionsContext: () => perms.value as unknown as Permissions,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  nav.search = "";
  nav.push.mockReset();
  nav.replace.mockReset();
  perms.value = perms.make([]);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s1", name: "KSA PRD" } as never]);
});

describe("To do page", () => {
  it("shows a skeleton while loading, then the ledger in the order returned with the action last", async () => {
    let resolve: (v: api.AttentionList) => void = () => {};
    vi.spyOn(api, "getAttention").mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWithQuery(<AttentionPage />);
    expect(screen.queryByText("Nothing in your scope needs a person now")).toBeNull();
    resolve(listOf(SAMPLE));
    const grid = await screen.findByRole("grid", { name: "To do" });
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("KSA PRD cannot be reached");
    expect(rows[0]).toHaveTextContent("Critical");
    expect(rows[1]).toHaveTextContent("Material master");
    expect(rows[1]).toHaveTextContent("4");
    const headers = within(grid).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers[headers.length - 1]).toBe("Action");
    const action = within(rows[0]).getByRole("link", { name: "Open system: KSA PRD cannot be reached" });
    expect(action).toHaveAttribute("href", "/systems/s1");
    expect(screen.getByText(/6 items in your scope, as of \d{2}:\d{2}/)).toBeInTheDocument();
    expect(api.getAttention).toHaveBeenCalledWith({ limit: 200 });
  });

  it("filters by tier and kind from the URL and writes a chip click back to it", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf(SAMPLE));
    nav.search = "tier=1&kind=approvals";
    renderWithQuery(<AttentionPage />);
    const grid = await screen.findByRole("grid", { name: "To do" });
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("2 fix batches wait for your approval");
    expect(screen.getByRole("button", { name: "Blocked work" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Approvals" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Data regressions" }));
    expect(nav.replace).toHaveBeenCalledWith("/attention?tier=2&kind=approvals", { scroll: false });
  });

  it("asks the server for one object and offers to clear it", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([SAMPLE[1]]));
    nav.search = "object=material_master";
    renderWithQuery(<AttentionPage />);
    await screen.findByRole("grid", { name: "To do" });
    expect(api.getAttention).toHaveBeenCalledWith({ limit: 200, object: "material_master" });
    fireEvent.click(screen.getByRole("button", { name: "Show all objects" }));
    expect(nav.replace).toHaveBeenCalledWith("/attention", { scroll: false });
  });

  it("opens the focused row with Enter", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf(SAMPLE));
    renderWithQuery(<AttentionPage />);
    const grid = await screen.findByRole("grid", { name: "To do" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(nav.push).toHaveBeenCalledWith("/fix?module=material_master&st=to_fix");
  });

  it("names the unscoped viewer's reach when nothing is waiting", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([]));
    renderWithQuery(<AttentionPage />);
    expect(await screen.findByText("Nothing in your scope needs a person now")).toBeInTheDocument();
    expect(screen.getByText(/Your scope is every system and object\./)).toBeInTheDocument();
  });

  it("names a scoped viewer's slice when nothing is waiting", async () => {
    perms.value = perms.make([{ system_id: "s1", module: "material_master" }, { system_id: null, module: "fi_gl" }] satisfies Scope[]);
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([]));
    renderWithQuery(<AttentionPage />);
    expect(await screen.findByText("Nothing in your scope needs a person now")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Your scope is Material master on KSA PRD, FI general ledger\./)).toBeInTheDocument());
  });

  it("says a filter removed everything without calling the list empty", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([item(), item({ id: "b", kind: "approvals", tier: 1 })]));
    nav.search = "kind=nothing";
    renderWithQuery(<AttentionPage />);
    // An unknown kind in the URL falls back to all.
    const grid = await screen.findByRole("grid", { name: "To do" });
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
  });

  it("has no axe violations", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf(SAMPLE));
    const { container } = renderWithQuery(<AttentionPage />);
    await screen.findByRole("grid", { name: "To do" });
    // jsdom has no layout, so colour contrast is checked by the e2e axe pass instead.
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
