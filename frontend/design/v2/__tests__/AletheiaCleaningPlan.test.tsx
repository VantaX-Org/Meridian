import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/aletheia-engine";
import { AletheiaCleaningPlan } from "../screens/object/AletheiaCleaningPlan";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => { window.sessionStorage.setItem("mn_v2_fixture", "1"); setUrl("/o/ecc/material_master"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Aletheia cleaning plan", () => {
  it("shows what changed, the fix batches, why each rule fails and the engine range", async () => {
    renderWithQuery(<AletheiaCleaningPlan module="material_master" label="Material master" />);
    expect(await screen.findByTestId("acp-narrative")).toHaveTextContent("Failing records rose from 2,923 to 3,183 since Run 11.");
    expect(screen.getAllByTestId("acp-batch")).toHaveLength(4);
    const items = screen.getAllByTestId("acp-item");
    expect(items).toHaveLength(4);
    expect(items.map((r) => r.textContent).join(" ")).toContain("86 out of 100");
    expect(screen.getAllByText("Material type").length).toBeGreaterThan(0);
    expect(screen.getByTestId("acp-engine")).toHaveTextContent("Outside the normal range");
    expect(screen.getByTestId("acp-engine-evidence")).toBeInTheDocument();
  });

  it("keeps the plan and says why when the engine is off", async () => {
    const plan = await api.getCleaningPlan("material_master");
    window.sessionStorage.clear();
    vi.spyOn(api, "getCleaningPlan").mockResolvedValue({
      ...plan, engine: { ...plan.engine, available: false, reason: "not_configured", ranges: [] },
    });
    renderWithQuery(<AletheiaCleaningPlan module="material_master" label="Material master" />);
    expect(await screen.findByText("This deployment runs without its Aletheia engine. An administrator can set it up.")).toBeInTheDocument();
    expect(screen.getAllByTestId("acp-item")).toHaveLength(4);
  });
});
