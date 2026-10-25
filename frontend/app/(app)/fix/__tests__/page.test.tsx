import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../../__tests__/render";
import FixPage from "../page";
import { getCleaningGroups, type CleaningGroup } from "@/lib/api/cleaning";

const push = vi.fn();
// Stable instance across re-renders: useUrlState's sync effect depends on this
// object's identity (see app/(app)/rules/__tests__/page.test.tsx for the same pattern).
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/fix",
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/api/cleaning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cleaning")>("@/lib/api/cleaning");
  return { ...actual, getCleaningGroups: vi.fn() };
});
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

const group = (over: Partial<CleaningGroup>): CleaningGroup => ({
  version_id: "R1", object_type: "material_master", kind: "MARA.MEINS", rule_name: null, records: 2,
  avg_confidence: 0.85, confident: 1, run_label: "material_master_25k", run_at: "2026-10-16T05:17:00Z",
  ...over,
});

beforeEach(() => {
  // These cover the cleaning proposals tab; Records to fix (the default) is covered in components/work.
  searchParams.set("tab", "cleaning");
  push.mockClear();
  vi.mocked(getCleaningGroups).mockReset();
});

describe("FixPage", () => {
  it("lists every open proposal, even ones no batch was ever set on, grouped by run and what they fix", async () => {
    // Regression: cleaning items carry their run but never a batch_id, and the old page grouped
    // by batch_id, so a queue of 61,816 proposals rendered as "No cleaning proposals".
    vi.mocked(getCleaningGroups).mockResolvedValue({
      groups: [group({}), group({ kind: "duplicate", object_type: "business_partner", records: 1, avg_confidence: 0.6, confident: 0 })],
      records: 61_816, confident: 40_000, runs: 2,
    });
    renderWithQuery(<FixPage />);

    expect(await screen.findByText("61,816")).toBeInTheDocument();
    expect(screen.getByText("40,000")).toBeInTheDocument();
    const review = screen.getByRole("link", { name: "Review Fix MARA.MEINS from material_master_25k" });
    expect(review).toHaveAttribute("href", "/fix/proposals/R1?kind=MARA.MEINS");
    const row = review.closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Material master");
    expect(row).toHaveTextContent("85%");
    // Duplicates are merged on the Duplicates tab, not drafted into a fix batch.
    expect(screen.getByRole("link", { name: "Review Duplicate records from material_master_25k" })).toHaveAttribute("href", "/fix?tab=dedup");
  });

  it("lists the match engine's review pairs, which carry no run, on an every-run page", async () => {
    vi.mocked(getCleaningGroups).mockResolvedValue({
      groups: [group({ version_id: null, kind: "match", object_type: "business_partner", run_label: null, run_at: null })],
      records: 2, confident: 1, runs: 0,
    });
    renderWithQuery(<FixPage />);
    expect(await screen.findByRole("link", { name: "Review Match review from Matching" })).toHaveAttribute("href", "/fix/proposals/all?kind=match");
  });

  it("opens the run and rule on row click", async () => {
    vi.mocked(getCleaningGroups).mockResolvedValue({ groups: [group({})], records: 2, confident: 1, runs: 1 });
    renderWithQuery(<FixPage />);

    await userEvent.click(await screen.findByText("material_master_25k"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/fix/proposals/R1?kind=MARA.MEINS"));
  });

  it("?module= keeps one object's groups behind a removable chip", async () => {
    searchParams.set("module", "business_partner");
    vi.mocked(getCleaningGroups).mockResolvedValue({
      groups: [group({}), group({ kind: "LFA1.NAME1", object_type: "business_partner" })],
      records: 3, confident: 1, runs: 1,
    });
    renderWithQuery(<FixPage />);
    expect(await screen.findByRole("button", { name: "Remove filter Object" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Review Fix LFA1.NAME1/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Review Fix MARA.MEINS/ })).toBeNull();
    searchParams.delete("module");
  });

  it("shows an empty state when there are no proposals", async () => {
    vi.mocked(getCleaningGroups).mockResolvedValue({ groups: [], records: 0, confident: 0, runs: 0 });
    renderWithQuery(<FixPage />);

    expect(await screen.findByText("No cleaning proposals")).toBeInTheDocument();
  });
});

describe("FixPage under a chosen run", () => {
  it("shows that run's proposals and the matcher's, which carry no run", async () => {
    searchParams.set("run", "R1");
    try {
      vi.mocked(getCleaningGroups).mockResolvedValue({
        groups: [group({ records: 5 }), group({ version_id: "R2", records: 7 }), group({ version_id: null, kind: "match", records: 3 })],
        records: 15, confident: 3, runs: 2,
      });
      renderWithQuery(<FixPage />);
      expect(await screen.findByText("8")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /^Review/ })).toHaveLength(2);
    } finally {
      searchParams.delete("run");
    }
  });
});
