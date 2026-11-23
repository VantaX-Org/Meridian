import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as pd from "@/lib/api/v2/discovery";
import { resetDiscoveryFixture } from "@/lib/api/v2/fixtures/discovery";
import { HealthCard, ModelView } from "./DiscoveryHealth";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, role: "viewer", can: () => false, logout: () => undefined }) }));
vi.mock("@/lib/api/v2/discovery", async (orig) => ({ ...(await orig<typeof pd>()), getDiscoveryHealth: vi.fn(), getRunModel: vi.fn() }));

const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
let undo: () => void = () => undefined;
beforeEach(async () => {
  undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/x?fixture=1");
  resetDiscoveryFixture();
  const real = await vi.importActual<typeof pd>("@/lib/api/v2/discovery");
  vi.mocked(pd.getDiscoveryHealth).mockImplementation(real.getDiscoveryHealth);
  vi.mocked(pd.getRunModel).mockImplementation(real.getRunModel);
});
afterEach(() => undo());

describe("discovery health", () => {
  it("shows freshness and drift per process", async () => {
    renderWithQuery(<HealthCard systemId={ECC} />);
    expect(await screen.findByRole("group", { name: "Discovery health" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Fitness of the latest run" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
  });

  it("empty system says so", async () => {
    renderWithQuery(<HealthCard systemId="other" />);
    expect(await screen.findByText("No processes to watch", undefined, { timeout: 5000 })).toBeTruthy();
  });

  it("error offers retry", async () => {
    vi.mocked(pd.getDiscoveryHealth).mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<HealthCard systemId={ECC} />);
    expect(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 })).toBeTruthy();
  });

  it("pauses a schedule", async () => {
    renderWithQuery(<HealthCard systemId={ECC} />);
    const pause = await screen.findAllByRole("button", { name: "Pause" }, { timeout: 5000 });
    fireEvent.click(pause[0]);
    expect((await screen.findAllByRole("button", { name: "Resume" }, { timeout: 5000 })).length).toBeGreaterThan(0);
  });

  it("changing a schedule walks choose, review, saved", async () => {
    renderWithQuery(<HealthCard systemId={ECC} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Change" }, { timeout: 5000 }))[0]);
    fireEvent.change(await screen.findByLabelText(/Cron expression/), { target: { value: "0 3 * * 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByText("The schedule is saved.", undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe("mined model", () => {
  it("lists the observed steps", async () => {
    renderWithQuery(<ModelView runId="pd-run-ptp" />);
    expect(await screen.findByRole("group", { name: "Mined model" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Cases by step" })).toBeTruthy();
  });

  it("error offers retry", async () => {
    vi.mocked(pd.getRunModel).mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<ModelView runId="pd-run-ptp" />);
    expect(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 })).toBeTruthy();
  });
});
