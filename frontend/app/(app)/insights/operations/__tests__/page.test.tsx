// frontend/app/(app)/insights/operations/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as analyticsApi from "@/lib/api/analytics";
import * as triageApi from "@/lib/api/triage";
import * as usersApi from "@/lib/api/users";
import * as versionsApi from "@/lib/api/versions";
import OperationsPage, { stageLabel } from "../page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/operations",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
const role = vi.hoisted(() => ({ assign: true }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (p: string) => p !== "assign" || role.assign }) }));

const EMPTY_METRICS: triageApi.TriageMetrics = {
  weeks: 8, backlog_by_owner: [], backlog_by_team: [], unassigned: 0, resolved_in_sla: 0, resolved_total: 0,
  sla_attainment_pct: null, mtta_hours: null, mttr_hours: null, breach_count: 0, weekly: [],
};

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] } as never);
  vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
  vi.spyOn(analyticsApi, "getSprints").mockResolvedValue({ sprints: [], total_actions: 0 });
  if (!vi.isMockFunction(triageApi.getTriageMetrics)) vi.spyOn(triageApi, "getTriageMetrics").mockResolvedValue(EMPTY_METRICS);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OperationsPage /></QueryClientProvider>);
}

afterEach(() => { vi.restoreAllMocks(); role.assign = true; });

describe("stageLabel", () => {
  it("maps queue stage ids to the steward's words", () => {
    expect(stageLabel("detected")).toBe("Detected");
    expect(stageLabel("pending_review")).toBe("Pending review");
    expect(stageLabel("something_new")).toBe("Something new");
  });
});

describe("OperationsPage", () => {
  it("shows every KPI the API returns, stage names, whole hours and a capacity gap that cannot contradict itself", async () => {
    vi.spyOn(analyticsApi, "getOperational").mockResolvedValue({
      kpis: {
        throughput: 12, automation_rate: 40.4, mttr_hours: 330.4, sla_compliance_pct: 100, rejection_rate: 5, rollback_rate: 0,
        items_in_flight: 3, avg_queue_age_hours: 1.6, top_rule_by_volume: "AP083", top_object_type: "accounts_payable", total_processed: 7, total_detected: 10,
      },
      bottlenecks: [{ stage: "detected", count: 3, avg_age_hours: 1.6, recommendation: "Review the detected stage" }],
      capacity: { needed: 0, current: 1, surplus_deficit: 1, recommendation: "Capacity is fine" },
    });
    mount();
    expect(await screen.findByText("Processed")).toBeInTheDocument();
    expect(screen.getByText("of 10 detected")).toBeInTheDocument();
    expect(screen.getByText("Rejection rate")).toBeInTheDocument();
    expect(screen.getByText("Rollback rate")).toBeInTheDocument();
    expect(screen.getByText("Top rule by volume")).toBeInTheDocument();
    expect(screen.getByText("AP083")).toBeInTheDocument();
    // Hours are whole with a unit; the stage id never shows raw.
    expect(screen.getByText("330 h")).toBeInTheDocument();
    expect(screen.getAllByText("Detected").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^detected$/)).toBeNull();
    expect(screen.getByRole("img", { name: "Average age by stage in hours: Detected 2" })).toBeInTheDocument();
    expect(screen.getByText(/Detected holds work longest, at 2 h on average/)).toBeInTheDocument();
    // One capacity number: a surplus, with both inputs as the hint.
    expect(screen.getByText("+1 steward")).toBeInTheDocument();
    expect(screen.getByText("1 steward now, 0 needed")).toBeInTheDocument();
    expect(screen.queryByText("Stewards needed")).toBeNull();
    expect(screen.getByText("1 stage is holding work")).toBeInTheDocument();
    // The queue counts are the cleaning queue: they open Fix work's Cleaning proposals tab, not the inbox.
    // Four headline tiles; the other figures are a definition list whose values drill.
    for (const label of ["Processed", "In progress"]) {
      expect(screen.getByText(label).closest("a")).toHaveAttribute("href", "/fix?sugg=1");
    }
    for (const label of ["Throughput", "Time to resolve", "Average queue age"]) {
      const term = screen.getByText(label);
      expect(term.tagName).toBe("DT");
      expect(term.nextElementSibling?.querySelector("a")).toHaveAttribute("href", "/fix?sugg=1");
    }
    expect(document.querySelectorAll(".m-stat-grid .m-stat").length).toBe(4);
    expect(document.querySelector('a[href="/inbox"]')).toBeNull();
  });

  it("shows the parts that loaded while the slow operational query is still on its way, never the whole-page timeout", async () => {
    vi.spyOn(analyticsApi, "getOperational").mockReturnValue(new Promise(() => {}));
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(analyticsApi, "getSprints").mockResolvedValue({
      sprints: [{ sprint_number: 1, name: "Sprint 1", total_effort_hours: 12, records_fixed: 40, critical_cleared: 2, dqs_now: 70, dqs_projected: 74, estimated_cost: null, currency: "ZAR" }],
      total_actions: 3,
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><OperationsPage /></QueryClientProvider>);
    expect(await screen.findByText("Sprint 1")).toBeInTheDocument();
    expect(screen.getAllByText("Team member").length).toBeGreaterThan(0);
    // The cards fed by the slow query hold a skeleton of their own; the page frame is not in its loading or error state.
    expect(screen.getByText("Throughput and capacity")).toBeInTheDocument();
    expect(screen.queryByText("This is taking longer than expected.")).toBeNull();
    expect(screen.queryByText("Processed")).toBeNull();
  });

  it("says stewards are short when the queue outgrows the team, and hides the top rule until something is processed", async () => {
    vi.spyOn(analyticsApi, "getOperational").mockResolvedValue({
      kpis: {
        throughput: 0, automation_rate: 0, mttr_hours: 0, sla_compliance_pct: 0, rejection_rate: 0, rollback_rate: 0,
        items_in_flight: 40, avg_queue_age_hours: 0, top_rule_by_volume: "N/A", total_processed: 0, total_detected: 40,
      },
      bottlenecks: [{ stage: "pending_review", count: 40, avg_age_hours: 48, recommendation: "Add reviewers" }, { stage: "detected", count: 2, avg_age_hours: 3, recommendation: "x" }],
      capacity: { needed: 3, current: 1, surplus_deficit: -2, recommendation: "Add two stewards" },
    });
    mount();
    expect(await screen.findByText("2 stewards short")).toBeInTheDocument();
    expect(screen.getByText("Nothing processed yet")).toBeInTheDocument();
    expect(screen.getByText("2 stages are holding work")).toBeInTheDocument();
    expect(screen.getByText("Unblock Pending review first")).toBeInTheDocument();
  });

  it("reports steward work against the SLA with the open backlog per owner", async () => {
    vi.spyOn(analyticsApi, "getOperational").mockResolvedValue({
      kpis: {
        throughput: 0, automation_rate: 0, mttr_hours: 0, sla_compliance_pct: 0, rejection_rate: 0, rollback_rate: 0,
        items_in_flight: 1, avg_queue_age_hours: 0, top_rule_by_volume: "N/A", total_processed: 0, total_detected: 1,
      },
      bottlenecks: [],
      capacity: { needed: 1, current: 1, surplus_deficit: 0, recommendation: "" },
    });
    const metrics = vi.spyOn(triageApi, "getTriageMetrics").mockResolvedValue({
      ...EMPTY_METRICS, unassigned: 4, resolved_in_sla: 9, resolved_total: 12, sla_attainment_pct: 75, mtta_hours: 2.25, mttr_hours: 30, breach_count: 3,
      backlog_by_owner: [{ user_id: "u1", email: "ana@x.io", open: 7, breached: 2, at_risk: 1 }],
    });
    mount();
    expect(await screen.findByText("Steward work against the SLA")).toBeInTheDocument();
    expect(metrics).toHaveBeenCalledWith(8);
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("9 of 12 with a due date")).toBeInTheDocument();
    expect(screen.getByText("2.3 h")).toBeInTheDocument();
    expect(screen.getByText("30 h")).toBeInTheDocument();
    expect(screen.getByText("ana@x.io")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "7" })).toHaveAttribute("href", "/inbox?assignee=u1");
    expect(screen.getByRole("link", { name: "SLA policies" })).toHaveAttribute("href", "/admin/triage");
  });
});

describe("OperationsPage without assign", () => {
  it("leaves out the team member card and never asks for the assignable users (a viewer's 403)", async () => {
    role.assign = false;
    vi.spyOn(analyticsApi, "getOperational").mockReturnValue(new Promise(() => {}));
    mount();
    expect(await screen.findByText("Throughput and capacity")).toBeInTheDocument();
    expect(screen.queryByText("Team member")).not.toBeInTheDocument();
    expect(usersApi.getAssignableUsers).not.toHaveBeenCalled();
  });
});
