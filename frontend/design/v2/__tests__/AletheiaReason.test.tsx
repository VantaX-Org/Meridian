import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/aletheia-engine";
import { AletheiaReason } from "../screens/AletheiaReason";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => { window.sessionStorage.setItem("mn_v2_fixture", "1"); setUrl("/aletheia/reason"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

const ev: api.Evidence = { inputs: ["x"], method: "m", confidence: null };
const base = (over: Partial<api.Reason>): api.Reason => ({
  lineage: "material_master", labels: {}, runs: [],
  deterministic: { available: true, anomalies: [], risks: [], anomaly_evidence: ev, risk_evidence: ev },
  engine: { available: false, reason: "not_configured", anomalies: [], risks: [], evidence: ev }, ...over,
});

describe("Aletheia reason", () => {
  it("shows anomalies, ranked drivers and evidence from the fixture", async () => {
    renderWithQuery(<AletheiaReason />);
    expect(await screen.findByText("Some runs fell out of line with their history")).toBeInTheDocument();
    expect(screen.getByTestId("rs-anomalies")).toHaveTextContent("Run 9");
    expect(screen.getByTestId("rs-risks")).toHaveTextContent("Plant is missing on the material");
    expect(screen.getByTestId("rs-anomaly-evidence")).toHaveTextContent("Method");
    expect(screen.getByTestId("rs-risk-evidence")).toHaveTextContent("76 out of 100");
  });

  it("shows the Aletheia mark and why the engine layer is off", async () => {
    renderWithQuery(<AletheiaReason />);
    expect(await screen.findByTestId("rs-engine-evidence")).toBeInTheDocument();
    expect(screen.getByTestId("rs-engine")).toHaveTextContent("Aletheia");
  });

  it("explains an empty tenant instead of drawing empty charts", async () => {
    vi.spyOn(api, "getReason").mockResolvedValue(base({ deterministic: { available: false, reason: "too_few_runs", anomalies: [], risks: [], anomaly_evidence: ev, risk_evidence: ev } }));
    renderWithQuery(<AletheiaReason />);
    expect(await screen.findByText("No runs yet. Run an analysis, then come back to see what moved the score.")).toBeInTheDocument();
  });

  it("keeps the layers apart when there are too few runs", async () => {
    vi.spyOn(api, "getReason").mockResolvedValue(base({
      runs: [{ version_id: "a", label: "Run 1", run_at: "2026-10-01", composite: 80 }],
      deterministic: { available: false, reason: "too_few_runs", anomalies: [], risks: [], anomaly_evidence: ev, risk_evidence: ev },
      engine: { available: false, reason: "too_few_runs", anomalies: [], risks: [], evidence: ev },
    }));
    renderWithQuery(<AletheiaReason />);
    expect(await screen.findByText("Not enough runs to reason about the score")).toBeInTheDocument();
    expect(screen.getByText("Four scored runs are needed before runs can be compared with their history.")).toBeInTheDocument();
    expect(screen.getByText("Four scored runs are needed before the engine can reason about the runs.")).toBeInTheDocument();
  });
});
