import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { EngineSection } from "../admin/engine";
import { Insights } from "../screens/Insights";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: () => true }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/admin/aletheia?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Aletheia engine", () => {
  it("admin screen shows the engine runs unlicensed, its version and usage, and keeps working", async () => {
    renderWithQuery(<EngineSection />);
    expect(await screen.findByText("1.8.0")).toBeInTheDocument();
    expect(screen.getByText(/The engine runs unlicensed/)).toBeInTheDocument();
    expect(screen.getByText("Unlicensed")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getAllByText("14")).toHaveLength(2); // calls recorded, and the learn counter beside its label
    expect(screen.getByText("Ingest")).toBeInTheDocument();
  });

  it("insights names each measure beside its code and flags a latest run outside its normal range", async () => {
    setUrl("/insights");
    renderWithQuery(<Insights />);
    const panel = await screen.findByTestId("ins-drivers");
    const composite = (await within(panel).findAllByText("composite"))[0].closest("tr")!;
    expect(composite.textContent).toContain("Composite data quality score");
    expect(composite.textContent).toContain("Outside the normal range");
    expect(panel.textContent).toContain("Completeness dimension");
    expect(panel.textContent).toContain("-0.82");
  });
});
