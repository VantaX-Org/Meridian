import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auditApi from "@/lib/api/audit";
import * as downloadApi from "@/lib/api/download";
import * as insightsApi from "@/lib/api/insights";
import * as reportsApi from "@/lib/api/reports";
import * as versionsApi from "@/lib/api/versions";
import ReportsPage from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const perm = vi.hoisted(() => ({ allowed: true, only: "" }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => ({ can: () => perm.allowed, has: (r: string, a: string) => (perm.only ? perm.only === `${r}.${a}` : perm.allowed) }),
  usePermissionsContext: () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }), useSearchParams: () => new URLSearchParams("") }));

const entry = (id: string, name: string, url: string | null) => ({
  id, name, format: "PDF" as const, about: `${name} about`, sections: ["Cover", "Scores"], page_estimate: 4, requires: [], url, last_built_at: null,
});

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
    { id: "v2", label: "Run 2", status: "complete", run_at: "2026-10-16T05:00:00Z", metadata: { modules: ["business_partner"] } },
    { id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-02T05:00:00Z", metadata: { modules: ["business_partner"] } },
    { id: "co", label: "controlling_1k", status: "complete", run_at: "2026-10-03T05:00:00Z", metadata: { modules: ["controlling"] } },
  ] } as never);
  vi.spyOn(reportsApi, "getReportCatalogue").mockResolvedValue([entry("board", "Board pack", "/api/v1/reports/board/v2.pdf"), entry("compare", "Run comparison", "/api/v1/reports/compare/v2.pdf"), entry("record", "Record fix sheet", null)]);
  vi.spyOn(insightsApi, "getOverview").mockResolvedValue({
    version_id: "v2", run_label: "Run 2", run_at: null, previous_version_id: null,
    dqs: { composite: 80, previous: null, delta: null, tier: "go", capped: false, cap_reason: null },
    blockers: { count: 2, previous: null, waves: 1 }, auto_fixable: { records: 0, failing_records: 0, pct: null, high_confidence: 0 },
    value_at_risk: { worst_l1: null, worst_l1_amount: 0, currency: "USD", features_blocked: 0 }, narrative: [],
  });
  vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ total: 1, limit: 5, offset: 0, entries: [{ id: "a1", actor_user_id: null, actor_email: "ana@example.test", action: "report.export", entity_type: "report", entity_id: "v2", method: "GET", path: "/x", status_code: 200, ip: null, user_agent: null, before_json: null, after_json: { kind: "board" }, created_at: "2026-10-12T10:00:00Z" }] });
  vi.spyOn(insightsApi, "getHeatmap").mockResolvedValue({ version_id: "v2", dimensions: [], rows: [] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ReportsPage /></QueryClientProvider>);
}

afterEach(() => { vi.restoreAllMocks(); perm.only = ""; });

describe("ReportsPage", () => {
  it("lists the recent export audit events", async () => {
    perm.allowed = true;
    mount();
    expect(await screen.findByText(/board by ana@example.test/)).toBeInTheDocument();
  });

  it.each(["audit.view", "users.admin"])("shows recent exports to a viewer with only %s and no export permission", async (only) => {
    perm.allowed = false;
    perm.only = only;
    mount();
    expect(await screen.findByText(/board by ana@example.test/)).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Reports" })).toBeNull();
  });

  it("hides recent exports and skips the audit query without audit access", async () => {
    perm.allowed = false;
    perm.only = "none.none";
    mount();
    await screen.findAllByText(/needs the auditor or analyst role/i);
    expect(screen.queryByText("Recent exports")).toBeNull();
    expect(auditApi.getAuditEntries).not.toHaveBeenCalled();
  });

  it("lists reports in a listbox, previews one and downloads it", async () => {
    perm.allowed = true;
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    mount();
    expect(await screen.findByRole("listbox", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: /Run comparison/ }));
    expect(screen.getByText(/Key figures: DQS 80/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/compare/v2.pdf", "compare_v2.pdf");
  });

  it("moves the selection with the arrow keys", async () => {
    perm.allowed = true;
    mount();
    const first = await screen.findByRole("option", { name: /Board pack/ });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Run comparison/ })).toHaveAttribute("aria-selected", "true");
  });

  it("disables record download until a key is typed", async () => {
    perm.allowed = true;
    mount();
    await userEvent.click(await screen.findByRole("option", { name: /Record fix sheet/ }));
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Record key"), "M1");
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("shows no library without the export permission", async () => {
    perm.allowed = false;
    mount();
    expect((await screen.findAllByText(/needs the auditor or analyst role/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("ReportsPage scope and rendering", () => {
  it("offers only runs of the same lineage under Compare with and writes the scope line from the run label", async () => {
    perm.allowed = true;
    mount();
    expect(await screen.findByText(/Scope: Run 2, no comparison run, every object in the run/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Compare with" }));
    expect(await screen.findByRole("option", { name: "Run 1" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "controlling_1k" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Run 2" })).toBeNull();
    expect(screen.getByText("1 earlier run of the same lineage can be compared.")).toBeInTheDocument();
  });

  it("shows a pending Rendering state on Download while the PDF builds", async () => {
    perm.allowed = true;
    let finish: () => void = () => {};
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockReturnValue(new Promise<void>((r) => { finish = r; }));
    mount();
    await screen.findByRole("listbox", { name: "Reports" });
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/board/v2.pdf", "board_v2.pdf");
    // The preview's Download button and the header's next step both say what is happening.
    const pending = await screen.findAllByRole("button", { name: /Rendering/ });
    expect(pending.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    finish();
    expect(await screen.findByRole("button", { name: "Download" })).toBeEnabled();
  });
});
