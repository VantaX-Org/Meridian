// frontend/app/(app)/home/process/__tests__/page.test.tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as pdApi from "@/lib/api/process-discovery";
import * as versionsApi from "@/lib/api/versions";
import * as jobsHook from "@/hooks/use-jobs";
import type { CatalogueRow } from "@/lib/api/process-discovery";
import type { BusinessProcessL1, SAPSystemExtended } from "@/types/api";
import ProcessHomePage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/home/process",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/components/help/home-onboarding", () => ({ HomeOnboarding: () => null }));

const SYS = { id: "sys-1", name: "KSA PRD", system_type: "S4HANA" } as unknown as SAPSystemExtended;
const row = (l1: string, name: string): CatalogueRow => ({
  l1, name, coverage: "discovered", reason: null, in_progress: null, failed: null, sources: [],
  last_run: { id: `run-${l1}`, status: "completed", finished_at: "2026-10-10T00:00:00Z", cases: 100, variants: 7, median_seconds: 60, automation_rate: 0.5, fitness: 0.9 },
});
const field = (over: Partial<BusinessProcessL1["l2_groups"][number]["l3_processes"][number]["l4_subprocesses"][number]["activities"][number]["fields"][number]>) => ({
  field: "LFA1.STCD1", description: "Tax number", mandatory: true, config_source: "", check_id: "AP001", dq_status: "green" as const,
  pass_rate: 100, affected_count: 0, finding_message: "", ...over,
});
const l1 = (id: string, name: string, fields: ReturnType<typeof field>[]): BusinessProcessL1 => ({
  l1_id: id, l1_name: name, l1_description: "", system: "ecc",
  l2_groups: [{ l2_id: `${id}-1`, l2_name: "Area", l3_processes: [{
    l3_id: `${id}-1-1`, l3_name: "Step", description: "", overall_readiness: "red",
    l4_subprocesses: [{ l4_id: `${id}-1-1-1`, l4_name: "Sub", tcode: "FK01", description: "", config_dependency: null, step_status: "red",
      activities: [{ l5_id: "a", l5_name: "Enter", description: "", tcode: "FK01", fields, check_ids: [], activity_status: "red" }] }],
  }] }],
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYS]);
  vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([row("PTP", "Procure to pay"), row("R2R", "Record to report")]);
  vi.spyOn(pdApi, "listRuns").mockResolvedValue([]);
  vi.spyOn(jobsHook, "useJobs").mockReturnValue({ jobs: [], active: [] } as unknown as ReturnType<typeof jobsHook.useJobs>);
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
    { id: "v1", label: "ap_1k", status: "complete", run_at: "2026-10-09T00:00:00Z", dqs_summary: { accounts_payable: 80 }, metadata: { system_id: "sys-1" } } as never,
  ] });
});

describe("process home", () => {
  it("leads with each L1's verdict, its blocking rule and a Can it run link; unscored L1s read as a dash", async () => {
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([
      l1("PTP", "Procure to pay", [field({ dq_status: "red", affected_count: 1234, pass_rate: 40 }), field({ check_id: "AP002" })]),
    ]);
    renderWithQuery(<ProcessHomePage />);
    expect(await screen.findByText("No-go")).toBeInTheDocument();
    expect(screen.getByText("AP001")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Can it run" }).getAttribute("href")).toBe("/insights/process?l1=PTP&object=accounts_payable&run=v1");
    expect(screen.getByText(/^1 of 1 scored processes no-go, from ap_1k, .* on KSA PRD$/)).toBeInTheDocument();
    const runs = screen.getAllByRole("link", { name: "Run discovery" }).map((a) => a.getAttribute("href"));
    expect(runs).toContain("/process/runs?system=sys-1&new=1&l1=PTP");
    expect(runs).toContain("/process/runs?system=sys-1&new=1&l1=R2R");
  });

  it("scores readiness from the selected system's newest run, never a newer run of another system", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
      { id: "v-other", label: "other_sys", status: "complete", run_at: "2026-10-12T00:00:00Z", dqs_summary: { accounts_payable: 10 }, metadata: { system_id: "sys-2" } } as never,
      { id: "v1", label: "ap_1k", status: "complete", run_at: "2026-10-09T00:00:00Z", dqs_summary: { accounts_payable: 80 }, metadata: { system_id: "sys-1" } } as never,
    ] });
    const bp = vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([l1("PTP", "Procure to pay", [field({})])]);
    renderWithQuery(<ProcessHomePage />);
    expect(await screen.findByText(/from ap_1k, .* on KSA PRD$/)).toBeInTheDocument();
    expect(bp.mock.calls.map((c) => c[0])).toEqual(["v1"]);
    expect(screen.getByRole("link", { name: "Can it run" }).getAttribute("href")).toContain("run=v1");
  });

  it("says when the selected system has no finished analysis, rather than borrowing another system's", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
      { id: "v-other", label: "other_sys", status: "complete", run_at: "2026-10-12T00:00:00Z", dqs_summary: { accounts_payable: 10 }, metadata: { system_id: "sys-2" } } as never,
    ] });
    const bp = vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([]);
    renderWithQuery(<ProcessHomePage />);
    expect(await screen.findByText("No finished analysis of KSA PRD to score readiness from")).toBeInTheDocument();
    expect(bp).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Can it run" })).toBeNull();
  });

  it("reads go when every mapped field passes", async () => {
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([l1("PTP", "Procure to pay", [field({})])]);
    renderWithQuery(<ProcessHomePage />);
    expect(await screen.findByText("Go")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });
});
