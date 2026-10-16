// frontend/app/(app)/insights/operations/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as analyticsApi from "@/lib/api/analytics";
import * as usersApi from "@/lib/api/users";
import * as versionsApi from "@/lib/api/versions";
import OperationsPage, { stageLabel } from "../page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/operations",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-01T00:00:00Z" }] } as never);
  vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
  vi.spyOn(analyticsApi, "getSprints").mockResolvedValue({ sprints: [], total_actions: 0 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OperationsPage /></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

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
});
