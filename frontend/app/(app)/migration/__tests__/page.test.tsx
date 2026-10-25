import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as migrationApi from "@/lib/api/migration";
import * as systemsApi from "@/lib/api/connectivity";
import type { MigrationWave } from "@/types/api";
import MigrationPage from "../page";

let currentSearch = "";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/migration",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const WAVE: MigrationWave = {
  id: "w1", name: "Wave 1", source_system_id: "s1", target_system_id: null, target_release: "s4hana",
  modules: ["material_master"], target_date: "2027-03-01", stage: "mock1", min_readiness: 95, min_dqs: null,
  signed_off_by: null, signed_off_at: null, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
  last_run_id: "r2", last_verdict: "conditional", last_score: 97, last_completed_at: "2026-10-10T08:00:00Z",
  trend: [80, 97],
};

describe("MigrationPage", () => {
  it("lists waves with verdict, readiness and run now", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([WAVE]);
    const run = vi.spyOn(migrationApi, "runWave").mockResolvedValue({
      run_id: "r3", task_id: "t", status: "queued", mode: "source_to_destination", modules: ["material_master"],
    });
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText("Wave 1")).toBeInTheDocument();
    expect(screen.getAllByText("At risk")[0]).toBeInTheDocument();
    expect(screen.getByText("97.0%")).toBeInTheDocument();
    expect(screen.getByText("Mock 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("w1"));
  });

  it("opens a wave on row click", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([WAVE]);
    renderWithQuery(<MigrationPage />);
    fireEvent.click(await screen.findByText("Wave 1"));
    expect(push).toHaveBeenCalledWith("/migration/w1");
  });

  it("creates a wave", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([]);
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    const create = vi.spyOn(migrationApi, "createWave").mockResolvedValue({ ...WAVE, id: "w2", name: "Wave 2" });
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText("No waves yet")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Create wave" })[0]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wave 2" } });
    fireEvent.change(screen.getByLabelText("Modules"), { target: { value: "material_master, fi_gl" } });
    fireEvent.click(screen.getByRole("button", { name: "Save wave" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Wave 2", modules: ["material_master", "fi_gl"], stage: "plan", min_readiness: 95,
    })));
  });

  it("renders the page header, not four empty cells, while the waves load", () => {
    vi.spyOn(migrationApi, "getWaves").mockReturnValue(new Promise(() => {}));
    renderWithQuery(<MigrationPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Migration" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows the error with a retry", async () => {
    vi.spyOn(migrationApi, "getWaves").mockRejectedValue(new Error("network down"));
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });
});

describe("MigrationPage verdict param", () => {
  it.each(["garbage", "constructor"])("ignores ?verdict=%s: every wave, no banner", async (v) => {
    currentSearch = `verdict=${v}`;
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([WAVE, { ...WAVE, id: "w2", name: "Wave 2", last_verdict: "no-go" }]);
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText("Wave 1")).toBeInTheDocument();
    expect(screen.getByText("Wave 2")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all waves" })).not.toBeInTheDocument();
    currentSearch = "";
  });

  it("?verdict=no_go lists only no-go waves", async () => {
    currentSearch = "verdict=no_go";
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([WAVE, { ...WAVE, id: "w2", name: "Wave 2", last_verdict: "no-go" }]);
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText("Wave 2")).toBeInTheDocument();
    expect(screen.queryByText("Wave 1")).not.toBeInTheDocument();
    currentSearch = "";
  });
});
