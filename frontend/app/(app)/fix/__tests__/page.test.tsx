import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "../../../../__tests__/render";
import FixPage from "../page";

const push = vi.fn();
const replace = vi.fn();
// Stable instance across re-renders: useUrlState's sync effect depends on this
// object's identity (see app/(app)/rules/__tests__/page.test.tsx for the same pattern).
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/fix",
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/api/connectivity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/connectivity")>("@/lib/api/connectivity");
  return { ...actual, getSystems: vi.fn().mockResolvedValue([]) };
});
vi.mock("@/lib/api/config-load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/config-load")>("@/lib/api/config-load");
  return { ...actual, getConfigLandscape: vi.fn().mockResolvedValue({ total: 0, loaded: 0, counts: {}, systems: [] }) };
});
vi.mock("@/lib/api/versions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/versions")>("@/lib/api/versions");
  return { ...actual, getVersions: vi.fn().mockResolvedValue({ versions: [] }) };
});
vi.mock("@/lib/api/rules", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/rules")>("@/lib/api/rules");
  return { ...actual, getRules: vi.fn().mockResolvedValue({ rules: [{ id: "MM045", name: "Base unit is mandatory" }], total: 1, limit: 1000, offset: 0 }) };
});
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/api/remediation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/remediation")>("@/lib/api/remediation");
  return { ...actual, listBatches: vi.fn().mockResolvedValue({ items: [] }), getMonitor: vi.fn().mockResolvedValue({ items: [] }) };
});
// Records to fix (the default tab) is covered in components/work.
vi.mock("@/components/work/fix-work", () => ({ FixWork: () => <div data-testid="fix-work" /> }));

beforeEach(() => {
  for (const k of [...searchParams.keys()]) searchParams.delete(k);
  push.mockClear();
  replace.mockClear();
});

describe("FixPage tabs", () => {
  it("has two tabs: records to fix (with the suggested values) and batches; no Monitor or Cleaning proposals tab", async () => {
    renderWithQuery(<FixPage />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Records to fix", "Batches and export"]);
    expect(screen.queryByRole("tab", { name: "Monitor" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Cleaning proposals" })).toBeNull();
    expect(await screen.findByTestId("fix-work")).toBeInTheDocument();
  });
});

describe("FixPage retired tabs", () => {
  it("sends ?tab=monitor to the Objects list's monitoring view", async () => {
    searchParams.set("tab", "monitor");
    renderWithQuery(<FixPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/objects?view=monitoring"));
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("sends ?tab=cleaning to the records with a suggested value", async () => {
    searchParams.set("tab", "cleaning");
    renderWithQuery(<FixPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fix?sugg=1"));
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("keeps the run and object a ?tab=cleaning link was scoped to", async () => {
    searchParams.set("tab", "cleaning");
    searchParams.set("run", "R1");
    searchParams.set("module", "material_master");
    renderWithQuery(<FixPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fix?sugg=1&run=R1&module=material_master"));
  });
});

describe("FixPage duplicates tab", () => {
  it("sends old links to Match review, the one place duplicate pairs are reviewed, keeping a record filter", async () => {
    searchParams.set("tab", "dedup");
    searchParams.set("object", "material_master");
    searchParams.set("record", "MATNR=2");
    renderWithQuery(<FixPage />);
    const href = "/mdm/golden/merge?source=cleaning&object=material_master&record=MATNR%3D2";
    expect(await screen.findByRole("link", { name: "Open Match review" })).toHaveAttribute("href", href);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(href));
  });
});
