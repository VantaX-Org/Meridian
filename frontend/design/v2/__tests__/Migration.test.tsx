import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Migration } from "../screens/Migration";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/migration");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Migration analysis", () => {
  it("leads with the verdict of the latest analysis and lists both analyses", async () => {
    renderWithQuery(<Migration />);
    const banner = await screen.findByTestId("mig-banner");
    expect(banner.textContent).toMatch(/Not ready to load/);
    const runs = await screen.findByTestId("mig-runs");
    expect(within(runs).getAllByRole("row").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the field-level gaps with their fields and the field map", async () => {
    renderWithQuery(<Migration />);
    const findings = await screen.findByTestId("mig-findings");
    await within(findings).findAllByRole("row");
    expect(findings.textContent).toContain("MTART");
    expect(findings.textContent).toContain("ZROH");
    const map = await screen.findByTestId("mig-field-map");
    await within(map).findAllByRole("row");
    expect(map.textContent).toContain("MAKTX");
    expect(map.textContent).toContain("Shortened from 70 to 40 characters");
    expect(map.textContent).toContain("Type changes from NUMC to DEC");
    expect(map.textContent).toContain("Needs a transformation");
    expect(within(map).getByTestId("mig-delta-bars").textContent).toContain("Change with no transformation yet");
  });

  it("marks an automatic reconciliation and shows the count change since the previous one", async () => {
    renderWithQuery(<Migration />);
    const panel = await screen.findByTestId("mig-post-load");
    expect((await within(panel).findByTestId("mig-post-load-auto")).textContent).toContain("Started automatically");
    const change = within(panel).getByTestId("mig-post-load-change").textContent ?? "";
    expect(change).toContain("198 missing (-241)");
    expect(change).toContain("143 fields differ (-58)");
    expect(change).toContain("83,782 found (+241)");
  });
});
