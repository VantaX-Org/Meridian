import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { MdmSnapshot } from "@/lib/api/v2/mdm-health";
import { MdmHealth } from "../MdmHealth";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ latest: null as unknown, err: null as unknown, calls: 0 }));
const snap = (d: string, score: number): MdmSnapshot => ({
  snapshot_date: d, golden_record_count: 120, golden_record_coverage_pct: 0.8, avg_match_confidence: 0.9, steward_sla_compliance_pct: 0.7,
  source_consistency_pct: 0.6, mdm_health_score: score, backlog_count: 14, sync_coverage_pct: 0.5,
});
vi.mock("@/lib/api/v2/mdm-health", async (orig) => ({
  ...(await orig<object>()),
  getMdmHealth: () => { Q.calls += 1; return Q.err ? Promise.reject(Q.err) : Promise.resolve({ latest: Q.latest, trend: [], active_systems_count: 3 }); },
  getMdmHistory: () => Promise.resolve({ history: [snap("2026-11-01", 70), snap("2026-11-02", 74)] }),
}));
vi.mock("@/lib/api/v2/analytics", async (orig) => ({
  ...(await orig<object>()),
  getMdmHealthSeries: () => Promise.resolve({ days: 56, data: [{ ...snap("2026-11-02", 74), ai_projected_score: 78, ai_narrative: "Coverage rising", ai_risk_flags: ["Backlog growing"] }] }),
}));

beforeEach(() => {
  setUrl("/more/mdm?fixture=1");
  Q.latest = snap("2026-11-02", 74);
  Q.err = null;
  Q.calls = 0;
});

describe("MDM health", () => {
  it("shows the banner, the weighted parts, the trends and the scorecard projection", async () => {
    renderWithQuery(<MdmHealth />);
    expect(await screen.findByTestId("mdm-banner")).toHaveTextContent("74");
    expect(screen.getByTestId("mdm-parts")).toHaveTextContent("Golden record coverage");
    expect(await screen.findByTestId("mdm-backlog")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Scorecard")[0].closest("button") ?? screen.getAllByText("Scorecard")[0]);
    expect(await screen.findByTestId("mdm-aletheia")).toHaveTextContent("Backlog growing");
  });
  it("says when no snapshot exists", async () => {
    Q.latest = null;
    renderWithQuery(<MdmHealth />);
    expect(await screen.findByText("No MDM snapshot has been taken yet. The snapshot runs once a day.")).toBeInTheDocument();
  });
  it("says the role cannot read on 403", async () => {
    Q.err = Object.assign(new Error("no"), { status: 403 });
    renderWithQuery(<MdmHealth />);
    expect(await screen.findByText("Your role cannot read the MDM health figures.")).toBeInTheDocument();
  });
  it("retries after an error", async () => {
    Q.err = Object.assign(new Error("down"), { status: 500 });
    renderWithQuery(<MdmHealth />);
    expect(await screen.findByText("The MDM health figures could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    Q.err = null;
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("mdm-banner")).toBeInTheDocument();
  });
});
