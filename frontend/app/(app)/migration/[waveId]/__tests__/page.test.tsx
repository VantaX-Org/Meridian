import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as pairingApi from "@/lib/api/config-pairing";
import * as migrationApi from "@/lib/api/migration";
import * as systemsApi from "@/lib/api/connectivity";
import * as triageApi from "@/lib/api/triage";
import type { WaveCockpit } from "@/types/api";
import WaveCockpitPage from "../page";

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/migration/w1",
  useSearchParams: () => search,
  useParams: () => ({ waveId: "w1" }),
}));
let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COCKPIT: WaveCockpit = {
  wave: {
    id: "w1", name: "Wave 1", source_system_id: "s1", target_system_id: null, target_release: "s4hana",
    modules: ["accounts_payable"], target_date: "2027-03-01", stage: "mock1", min_readiness: 95, min_dqs: null,
    signed_off_by: null, signed_off_at: null, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
  },
  run_id: "r2", source_version_id: "v1", dest_system_type: "s4hana", verdict: "at_risk", score: 97,
  records_total: 100, records_blocked: 3,
  objects: [{ module: "accounts_payable", label: "BP supplier", verdict: "at_risk", score: 94, records: 50,
              records_blocked: 3, blocker_count: 3, dqs: 72 }],
  trend: [{ run_id: "r1", completed_at: "2026-10-07T08:00:00Z", score: 80 },
          { run_id: "r2", completed_at: "2026-10-10T08:00:00Z", score: 97 }],
  blockers: [{ module: "accounts_payable", label: "BP supplier", gap_type: "value_unmapped",
               field: "BUT000.BU_GROUP", severity: "critical", records: 3, gaps: 3 }],
};

describe("WaveCockpitPage", () => {
  it("shows the header, verdict and objects", async () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText("Wave 1")).toBeInTheDocument();
    expect(screen.getAllByText("At risk").length).toBeGreaterThan(0);
    expect(screen.getByText("97.0%")).toBeInTheDocument();
    // The object reads by formatModuleName, never the API's label.
    expect(screen.getByText("Accounts payable")).toBeInTheDocument();
    expect(screen.queryByText("BP supplier")).toBeNull();
    // The gap count is migration gaps and opens this wave's gap view, not the object's rules.
    expect(screen.getByRole("columnheader", { name: /Migration gaps/ })).toBeInTheDocument();
    expect(screen.queryByText("Blocking gaps")).toBeNull();
    const gaps = screen.getAllByRole("link", { name: "3" }).find((a) => a.getAttribute("href")?.includes("tab=blockers"));
    expect(gaps).toHaveAttribute("href", "/migration/w1?tab=blockers");
    expect(screen.queryByRole("button", { name: "Sign off" })).not.toBeInTheDocument();
  });

  it("shows the sign-off time in the tenant's time zone", async () => {
    search = new URLSearchParams();
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({
      timezone: "Asia/Tokyo", work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00",
      holidays: [], fallback_user_id: null,
    });
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue({
      ...COCKPIT, wave: { ...COCKPIT.wave, signed_off_by: "u1", signed_off_at: "2026-10-10T22:30:00Z" },
    });
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText(/signed off 11 Oct 2026, 07:30 GMT\+9/)).toBeInTheDocument();
  });

  it("drafts a fix batch from a blocker", async () => {
    search = new URLSearchParams("tab=blockers");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    const fix = vi.spyOn(migrationApi, "createBlockerFixBatch").mockResolvedValue({ id: "b1" });
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText("BUT000.BU_GROUP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create fix batch" }));
    await waitFor(() => expect(fix).toHaveBeenCalledWith("w1", {
      module: "accounts_payable", gap_type: "value_unmapped", field: "BUT000.BU_GROUP",
    }));
  });

  it("drills a blocker's records into the analysis version, never the migration run id", async () => {
    search = new URLSearchParams("tab=blockers");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    renderWithQuery(<WaveCockpitPage />);
    await screen.findByText("BUT000.BU_GROUP");
    const drill = screen.getAllByRole("link", { name: "3" }).find((a) => a.getAttribute("href")?.includes("tab=records"));
    expect(drill).toHaveAttribute("href", "/objects/accounts_payable?run=v1&tab=records");
  });

  it("reads a blocker's count as plain text when the run has no analysis version", async () => {
    search = new URLSearchParams("tab=blockers");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue({ ...COCKPIT, source_version_id: null });
    renderWithQuery(<WaveCockpitPage />);
    await screen.findByText("BUT000.BU_GROUP");
    expect(screen.queryAllByRole("link").filter((a) => a.getAttribute("href")?.includes("run=r2"))).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: "3" }).filter((a) => a.getAttribute("href")?.includes("tab=records"))).toHaveLength(0);
  });

  it("offers sign-off when the verdict is go", async () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue({ ...COCKPIT, verdict: "go" });
    const sign = vi.spyOn(migrationApi, "signoffWave").mockResolvedValue(COCKPIT.wave);
    renderWithQuery(<WaveCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign off" }));
    await waitFor(() => expect(sign).toHaveBeenCalledWith("w1"));
  });

  it("downloads the readiness report", async () => {
    search = new URLSearchParams("tab=overview");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    const dl = vi.spyOn(migrationApi, "downloadWaveReport").mockResolvedValue();
    renderWithQuery(<WaveCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Readiness report (PDF)" }));
    await waitFor(() => expect(dl).toHaveBeenCalledWith("w1", "pdf"));
  });

  it("downloads the realignment report", async () => {
    search = new URLSearchParams("tab=overview");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    const dl = vi.spyOn(pairingApi, "downloadRealignment").mockResolvedValue();
    renderWithQuery(<WaveCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Realignment (Excel)" }));
    await waitFor(() => expect(dl).toHaveBeenCalledWith("r2", "xlsx"));
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Realignment (PDF)" }));
    await waitFor(() => expect(dl).toHaveBeenCalledWith("r2", "pdf"));
  });

  it("selects the tab named by ?tab=", async () => {
    search = new URLSearchParams("tab=blockers");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByRole("tab", { name: "Blockers", selected: true })).toBeInTheDocument();
  });

  it("shows a loading skeleton while the cockpit loads", () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<WaveCockpitPage />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe("WaveCockpitPage empty states", () => {
  const NOT_RUN: WaveCockpit = { ...COCKPIT, run_id: null, source_version_id: null, score: null, trend: [], blockers: [] };
  const NO_MODULES: WaveCockpit = { ...NOT_RUN, wave: { ...COCKPIT.wave, modules: [] }, objects: [] };
  const emptyOf = async (text: string) => (await screen.findByText(text)).closest("[data-state='empty']") as HTMLElement;

  beforeEach(() => { allowed = true; vi.restoreAllMocks(); });

  it("opens the wave editor from the overview when the wave has no objects", async () => {
    search = new URLSearchParams("tab=overview");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(NO_MODULES);
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    const update = vi.spyOn(migrationApi, "updateWave").mockResolvedValue({ ...COCKPIT.wave, modules: ["fi_gl"] });
    renderWithQuery(<WaveCockpitPage />);
    const empty = await emptyOf("No objects in this wave");
    fireEvent.click(within(empty).getByRole("button", { name: "Add objects" }));
    fireEvent.change(await screen.findByLabelText("Objects"), { target: { value: "fi_gl" } });
    fireEvent.click(screen.getByRole("button", { name: "Save wave" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("w1", expect.objectContaining({ modules: ["fi_gl"] })));
  });

  it("sends a viewer without edit rights to the waves list from the mapping tab", async () => {
    allowed = false;
    search = new URLSearchParams("tab=mapping");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(NO_MODULES);
    renderWithQuery(<WaveCockpitPage />);
    const empty = await emptyOf("No objects in this wave");
    expect(within(empty).getByRole("link", { name: "Open waves" })).toHaveAttribute("href", "/migration");
  });

  it.each([
    ["blockers", "Run this wave to see its blockers."],
    ["s4", "Run this wave to see its S/4 simplification areas."],
  ])("runs the wave from the %s tab before its first run", async (tab, detail) => {
    search = new URLSearchParams(`tab=${tab}`);
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(NOT_RUN);
    const run = vi.spyOn(migrationApi, "runWave").mockResolvedValue({ run_id: "r9", task_id: "t", status: "queued", mode: "source_to_destination", modules: [] });
    renderWithQuery(<WaveCockpitPage />);
    const empty = await emptyOf("Not run yet");
    expect(within(empty).getByText(detail)).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("w1"));
  });

  it("runs the wave to seed a module's field map", async () => {
    search = new URLSearchParams("tab=mapping");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(NOT_RUN);
    vi.spyOn(migrationApi, "getFieldMap").mockResolvedValue([]);
    const run = vi.spyOn(migrationApi, "runWave").mockResolvedValue({ run_id: "r9", task_id: "t", status: "queued", mode: "source_to_destination", modules: [] });
    renderWithQuery(<WaveCockpitPage />);
    const empty = await emptyOf("No field map yet");
    fireEvent.click(within(empty).getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("w1"));
  });

  it("offers no Run now without the analyse permission", async () => {
    allowed = false;
    search = new URLSearchParams("tab=blockers");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(NOT_RUN);
    renderWithQuery(<WaveCockpitPage />);
    await emptyOf("Not run yet");
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
  });
});

describe("WaveCockpitPage not found", () => {
  beforeEach(() => { allowed = true; vi.restoreAllMocks(); search = new URLSearchParams(); });

  it("says the wave is not found with a link back to migration on a 404", async () => {
    vi.spyOn(migrationApi, "getWaveCockpit").mockRejectedValue(Object.assign(new Error("nf"), { isAxiosError: true, response: { status: 404, data: {} } }));
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText("Wave not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to migration" })).toHaveAttribute("href", "/migration");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps the error with Retry for any other failure", async () => {
    vi.spyOn(migrationApi, "getWaveCockpit").mockRejectedValue(Object.assign(new Error("x"), { isAxiosError: true, response: { status: 500, data: {} } }));
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText("The server could not complete the request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("makes Review N blockers the primary and opens the Blockers tab", async () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    renderWithQuery(<WaveCockpitPage />);
    const review = await screen.findByRole("link", { name: `Review ${COCKPIT.blockers.length === 1 ? "1 blocker" : `${COCKPIT.blockers.length} blockers`}` });
    expect(review).toHaveAttribute("href", "/migration/w1?tab=blockers");
    expect(review).toHaveClass("m-btn-primary");
  });

  it("offers no blockers button when there are none", async () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue({ ...COCKPIT, blockers: [] });
    renderWithQuery(<WaveCockpitPage />);
    await screen.findByText("Wave 1");
    expect(screen.queryByRole("link", { name: /^Review \d+ blockers?$/ })).toBeNull();
  });

});
