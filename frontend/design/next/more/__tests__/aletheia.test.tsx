import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { Evidence, Foresight, Reason } from "@/lib/api/v2/aletheia-engine";
import { AletheiaForesight } from "../AletheiaForesight";
import { AletheiaReason } from "../AletheiaReason";
import { AletheiaEvidence } from "../AletheiaEvidence";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ foresight: null as unknown, reason: null as unknown, fail: false }));
vi.mock("@/lib/api/v2/aletheia-engine", async (orig) => ({
  ...(await orig<object>()),
  getForesight: () => (Q.fail ? Promise.reject(new Error("down")) : Promise.resolve(Q.foresight)),
  getReason: () => (Q.fail ? Promise.reject(new Error("down")) : Promise.resolve(Q.reason)),
}));

const ev: Evidence = { inputs: ["composite per run"], method: "Least squares", confidence: 0.8, runs: 6, first_run: "2026-01-01", last_run: "2026-06-01" };
const runs = [1, 2, 3, 4, 5, 6].map((i) => ({ version_id: `v${i}`, label: `Run ${i}`, run_at: `2026-0${i}-01`, composite: 60 + i }));

const foresight = (): Foresight => ({
  lineage: "l", labels: {}, target: 85, target_source: "tenant", runs,
  projection: { available: true, latest: 66, slope_per_30d: 1.2, next: { date: "2026-07-01", point: 67, low: 65, high: 69 },
    go_live: { status: "projected", projected: "2027-01-01", earliest: "2026-11-01", latest: "2027-03-01" },
    band: [{ date: "2026-07-01", point: 67, low: 65, high: 69 }], evidence: ev },
  engine: { available: true, normal: { mean: 63, low: 60, high: 66, n: 6, latest: 66, outside: false },
    surprises: [{ metric: "composite", version_id: "v4", label: "Run 4", run_at: "2026-04-01", expected: 63, observed: 70, z: 2.5, severity: "high" }],
    methodology: ["Rolling mean"], evidence: ev },
});

const reason = (): Reason => ({
  lineage: "l", labels: {}, runs,
  deterministic: { available: true, anomalies: [{ metric: "composite", version_id: "v3", label: "Run 3", run_at: "2026-03-01", expected: 62, observed: 50, z: -3, severity: "high" }],
    risks: [{ kind: "rule", driver: "MM-001", name: "Base unit present", change: -4, effect: -2.5, confidence: 70 }], anomaly_evidence: ev, risk_evidence: ev },
  engine: { available: false, reason: "not_configured", anomalies: [], risks: [], evidence: ev },
});

beforeEach(() => {
  setUrl("/more/aletheia?fixture=1");
  Q.foresight = foresight();
  Q.reason = reason();
  Q.fail = false;
});

describe("Aletheia foresight", () => {
  it("shows the projection, the engine surprises and evidence on each", async () => {
    renderWithQuery(<AletheiaForesight />);
    expect(await screen.findByTestId("aletheia-foresight")).toBeInTheDocument();
    expect(screen.getByTestId("fs-projection-evidence")).toBeInTheDocument();
    expect(within(screen.getByTestId("fs-engine")).getByText("Run 4")).toBeInTheDocument();
  });
  it("offers a retry when the request fails", async () => {
    Q.fail = true;
    renderWithQuery(<AletheiaForesight />);
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});

describe("Aletheia reason", () => {
  it("lists anomalies and drivers with their evidence and says why the engine is off", async () => {
    renderWithQuery(<AletheiaReason />);
    expect(await screen.findByTestId("aletheia-reason")).toBeInTheDocument();
    expect(within(screen.getByTestId("rs-anomalies")).getByText("Run 3")).toBeInTheDocument();
    expect(within(screen.getByTestId("rs-risks")).getByText("MM-001")).toBeInTheDocument();
    expect(screen.getByTestId("rs-anomaly-evidence")).toBeInTheDocument();
    expect(screen.getByTestId("rs-risk-evidence")).toBeInTheDocument();
    expect(within(screen.getByTestId("rs-engine")).getByText(/runs without its Aletheia engine/)).toBeInTheDocument();
  });
  it("says so when there are no runs", async () => {
    Q.reason = { ...reason(), runs: [] };
    renderWithQuery(<AletheiaReason />);
    expect(await screen.findByText(/No runs yet. Run an analysis/)).toBeInTheDocument();
  });
});

describe("Aletheia evidence", () => {
  it("links to the native survivorship tab", () => {
    renderWithQuery(<AletheiaEvidence />);
    expect(screen.getByRole("link", { name: "Open verified survivorship" }).getAttribute("href")).toContain("/more/aletheia?tab=survivorship");
  });
});
