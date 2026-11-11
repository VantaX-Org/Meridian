import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/aletheia-engine";
import { AletheiaForesight } from "../screens/AletheiaForesight";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => { window.sessionStorage.setItem("mn_v2_fixture", "1"); setUrl("/aletheia/foresight"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Aletheia foresight", () => {
  it("shows the go-live date, the band and the evidence from the fixture", async () => {
    renderWithQuery(<AletheiaForesight />);
    expect(await screen.findByText("The composite score is on course for the go-live target")).toBeInTheDocument();
    expect(screen.getByTestId("fs-banner")).toHaveTextContent("Go-live date");
    expect(screen.getByText("Projected score with its band")).toBeInTheDocument();
    expect(screen.getByTestId("fs-projection-evidence")).toHaveTextContent("Method");
  });

  it("lists the runs the engine did not expect with the Aletheia mark", async () => {
    renderWithQuery(<AletheiaForesight />);
    expect(await screen.findByText("Runs the engine did not expect")).toBeInTheDocument();
    expect(screen.getByTestId("fs-normal")).toHaveTextContent("Outside the normal range");
    expect(screen.getByTestId("fs-engine")).toHaveTextContent("Aletheia");
    expect(screen.getByTestId("fs-engine-evidence")).toBeInTheDocument();
  });

  it("keeps the projection and says why when the engine is off", async () => {
    window.sessionStorage.clear();
    const off: api.Foresight = {
      lineage: "material_master", labels: {}, target: 90, target_source: "tenant",
      runs: [{ version_id: "a", label: "Run 1", run_at: "2026-10-01", composite: 80 }],
      projection: { available: false, reason: "too_few_runs", evidence: { inputs: ["Composite score of 1 runs"], method: "m", confidence: 0 } },
      engine: { available: false, reason: "too_few_runs", normal: null, surprises: [], methodology: [], evidence: { inputs: [], method: "m", confidence: null } },
    };
    vi.spyOn(api, "getForesight").mockResolvedValue(off);
    renderWithQuery(<AletheiaForesight />);
    expect(await screen.findByText("Three scored runs are needed before the score can be projected.")).toBeInTheDocument();
    expect(screen.getByText("Six scored runs are needed before the engine can learn how the runs move.")).toBeInTheDocument();
    expect(screen.getByText("Not enough runs to project the score")).toBeInTheDocument();
  });
});
