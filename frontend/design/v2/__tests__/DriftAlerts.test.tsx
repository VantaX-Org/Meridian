import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { landscapeFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import { putAutomation } from "@/lib/api/v2/step9";
import { kindOf } from "@/lib/v2/inbox";
import { driftWords } from "@/lib/v2/step9";
import { Inspector } from "../Inspector";
import { SystemCanvas } from "../screens/System";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

const [ECC, S4] = landscapeFixture.systems;
let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("config drift alerts", () => {
  it("the System canvas lists what changed, the rules touched, the owners told and the re-score", async () => {
    setUrl(`/s/${ECC.id}?fixture=1&tab=changes`);
    renderWithQuery(<SystemCanvas id={ECC.id} />);
    const view = await screen.findByTestId("config-changes");
    const [alert] = await within(view).findAllByTestId("drift-alert");
    const text = norm(alert);
    expect(text).toContain("Configuration sync");
    expect(text).toContain("3 changes in T006 and T134");
    expect(text).toContain("T006 1 added, 1 removed");
    expect(text).toContain("MM014 Base unit of measure not valid");
    expect(text).toContain("Owners notified: 2");
    expect(within(alert).getByRole("link", { name: "open the run" })).toHaveAttribute("href", expect.stringContaining("/run/"));
    expect(within(alert).getByRole("link", { name: "Material master" })).toHaveAttribute("href", expect.stringContaining("/o/ecc-production/material-master"));
  });

  it("says what the view is for when a system has no change, and when alerts are off", async () => {
    await putAutomation({ drift_alerts: { enabled: false } });
    const SF = landscapeFixture.systems[2];
    setUrl(`/s/${SF.id}?fixture=1&tab=changes`);
    renderWithQuery(<SystemCanvas id={SF.id} />);
    expect(await screen.findByText(/No configuration change has been seen on this system/)).toBeInTheDocument();
    expect(await screen.findByText(/Drift alerts are turned off/)).toBeInTheDocument();
  });

  it("shows the newest changes in the inbox panel, each opening its system", async () => {
    setUrl("/?fixture=1&open=inbox");
    renderWithQuery(<Inspector />);
    const box = await screen.findByTestId("inbox-drift");
    const items = within(box).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(norm(items[0])).toContain("ECC production");
    expect(norm(items[0])).toContain("2 rules depend on it; 2 owners told; re-score queued.");
    expect(within(items[1]).getByRole("link", { name: "Open the changes" })).toHaveAttribute("href", expect.stringContaining(`/s/${S4.id}?tab=changes`));
  });

  it("names a config drift notification and sums the areas", () => {
    expect(kindOf("config_drift").word).toBe("Configuration");
    expect(driftWords({ areas: [{ area: "T001W", added: 0, removed: 0, changed: 3 }] })).toBe("3 changes in T001W");
  });
});
