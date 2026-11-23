import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as cfg from "@/lib/api/v2/config";
import { ProcessCard, RediscoverCard } from "./ConfigProcess";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, role: "viewer", can: () => false, logout: () => undefined }) }));
vi.mock("@/lib/api/v2/config", async (orig) => ({ ...(await orig<typeof cfg>()), getConfigProcesses: vi.fn() }));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/x?fixture=1"); vi.mocked(cfg.getConfigProcesses).mockReset(); });
afterEach(() => undo());

describe("config process", () => {
  it("shows a process step by step", async () => {
    const real = await vi.importActual<typeof cfg>("@/lib/api/v2/config");
    vi.mocked(cfg.getConfigProcesses).mockImplementation(real.getConfigProcesses);
    renderWithQuery(<ProcessCard />);
    expect(await screen.findByRole("group", { name: "Process steps" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Volume by step" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
  });

  it("empty list says so", async () => {
    vi.mocked(cfg.getConfigProcesses).mockResolvedValue({ run_id: "r", processes: [] });
    renderWithQuery(<ProcessCard />);
    expect(await screen.findByText("No processes found", undefined, { timeout: 5000 })).toBeTruthy();
  });

  it("error offers retry", async () => {
    vi.mocked(cfg.getConfigProcesses).mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<ProcessCard />);
    expect(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 })).toBeTruthy();
  });

  it("rediscover walks confirm, queue, queued", async () => {
    renderWithQuery(<RediscoverCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Rediscover" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue the rerun" }));
    expect(await screen.findByText(/Queued on run/, undefined, { timeout: 5000 })).toBeTruthy();
  });

  it("rediscover is hidden without the permission", () => {
    window.history.replaceState(null, "", "/x?fixture=1&role=viewer");
    renderWithQuery(<RediscoverCard />);
    expect(screen.queryByRole("button", { name: "Rediscover" })).toBeNull();
  });
});
