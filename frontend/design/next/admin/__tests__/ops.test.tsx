import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { OPS_SECTIONS } from "../ops";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/screens/step10/Prediction", () => ({ RunForecast: () => null }));

const ok = (data: unknown) => ({ data, isPending: false, isLoading: false, isError: false, error: null, refetch: vi.fn(() => Promise.resolve()) });
const bad = () => ({ data: undefined, isPending: false, isLoading: false, isError: true, error: new Error("boom"), refetch: vi.fn(() => Promise.resolve()) });

const S = vi.hoisted(() => ({
  can: (): boolean => true,
  q: {} as Record<string, unknown>,
  admin: {
    startExtraction: vi.fn(),
    listProfiles: vi.fn(),
    listSyncRuns: vi.fn(),
    updateProfile: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    syncSystem: vi.fn(),
    pauseRunSchedule: vi.fn(),
    resumeRunSchedule: vi.fn(),
    deleteRunSchedule: vi.fn(),
    createRunSchedule: vi.fn(),
    patchRunSchedule: vi.fn(),
    triggerUpdate: vi.fn(),
    getUpdateProgress: vi.fn(),
  },
  runs: { analyseRun: vi.fn(), loadSystemConfig: vi.fn(), retryJobById: vi.fn(), uploadDataFile: vi.fn(), testSystemConnection: vi.fn() },
  deleteSystem: vi.fn(),
  downloadDiagnostics: vi.fn(),
  dryRun: vi.fn(),
  openItem: vi.fn(),
}));

vi.mock("@/lib/v2/hooks", async (orig) => ({
  ...(await orig<object>()),
  useV2Session: () => ({ can: S.can, id: "u-self", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }),
  useOpenItem: () => ({ open: null, openItem: S.openItem, close: vi.fn(), hrefFor: () => "#" }),
}));
vi.mock("@/lib/v2/runs-queries", () => ({
  useSystemsExtended: () => S.q.systems,
  useSystemObjectList: () => S.q.objects,
  useSystemExtractions: () => S.q.extractions,
  useSystemConfigLoad: () => S.q.configLoad,
  useV2Jobs: () => S.q.jobs,
}));
vi.mock("@/lib/v2/admin-queries", () => ({
  refreshAdmin: () => Promise.resolve(),
  useRunSchedules: () => S.q.schedules,
  useEngineStatus: () => S.q.engine,
  useDoctor: () => S.q.doctor,
  useHealth: () => S.q.health,
  useUpdateStatus: () => S.q.update,
}));
vi.mock("@/lib/v2/requests-queries", () => ({ useDefinitions: () => S.q.definitions, useFacts: () => S.q.facts }));
vi.mock("@/lib/v2/sys-queries", () => ({ useRefreshV2: () => vi.fn() }));
vi.mock("@/lib/api/v2/admin", () => S.admin);
vi.mock("@/lib/api/v2/runs", () => S.runs);
vi.mock("@/lib/api/v2/sys", () => ({ deleteSystem: S.deleteSystem }));
vi.mock("@/lib/api/v2/enterprise", () => ({ downloadDiagnostics: S.downloadDiagnostics }));
vi.mock("@/lib/api/v2/migration", () => ({ getTemplates: () => Promise.resolve({ templates: [] }) }));
vi.mock("@/lib/api/v2/syncTrigger", () => ({ getTriggerModules: () => Promise.resolve([]), triggerModules: vi.fn() }));
vi.mock("@/lib/api/v2/requests", () => ({
  dryRun: S.dryRun,
  activateDefinition: vi.fn(),
  createDefinition: vi.fn(),
  getDefinition: vi.fn(),
  newVersion: vi.fn(),
}));

const system = { id: "sys-1", name: "KMP", system_type: "ecc", host: "10.0.0.1", client: "100", sysnr: "03", environment: "production", health_status: "healthy", last_health_check: null, role: "source", target_system_id: null };
const job = { id: "job-1", kind: "extraction", status: "failed", label: "Extraction | Material master", modules: ["material_master"], stage: null, stages: [], percent: 100, rows_done: 0, rows_total: 0, tables: [], result: null, updated_at: 1_700_000_100, started_at: 1_700_000_000, finished_at: 1_700_000_100, message: "Stopped", error: "Read failed" };

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more/admin/runs?fixture=1");
  S.can = () => true;
  for (const fn of [...Object.values(S.admin), ...Object.values(S.runs), S.deleteSystem, S.downloadDiagnostics, S.dryRun, S.openItem]) fn.mockReset();
  S.admin.listProfiles.mockResolvedValue([]);
  S.admin.listSyncRuns.mockResolvedValue([]);
  S.admin.startExtraction.mockResolvedValue({ job_id: "job-9" });
  S.admin.pauseRunSchedule.mockResolvedValue({});
  S.runs.testSystemConnection.mockResolvedValue({ connected: true, message: "Pong" });
  S.downloadDiagnostics.mockResolvedValue("diagnostics.zip");
  S.dryRun.mockResolvedValue({ valid: true, problems: [], facts: {}, steps: [] });
  S.q = {
    systems: ok([system]),
    objects: ok({ objects: [{ object: "material_master", tables: ["MARA"], last_download: { records: 1200, at: "2026-11-01T00:00:00Z" } }] }),
    extractions: ok({ extractions: [] }),
    configLoad: ok(null),
    jobs: { ...ok([job]), jobs: [job], active: [] },
    schedules: ok({ schedules: [{ id: "rs-1", name: "Nightly material", system_id: "sys-1", system_name: "KMP", modules: ["material_master"], schedule_cron: null, cadence: { preset: "daily" }, extraction_mode: "full", active: true, next_run_at: null, last_run_at: null }] }),
    engine: ok({ configured: true, live: true, token_set: true, tenant: "komatsu-meridian", version: "1.4.0", licence: { licensed: true, valid: true, reason: null, deployment: "komatsu", expires: null, max_tenants: 3 }, usage: { events: 42, counters: {} } }),
    doctor: ok({ items: [{ id: "db", label: "Database", status: "ok", detail: "Reachable" }], checked_at: "2026-11-16T00:00:00Z" }),
    health: ok({ version: "0.0.700", llm_provider: "none", llm_connected: false, email_backend: null }),
    update: ok({ current_version: "0.0.700", latest_version: "0.0.700", update_available: false, updater_configured: true, release_notes: null }),
    definitions: ok({ items: [{ id: "wf-1", key: "fix_batch", name: "Fix batch approval", description: null, object_kind: "fix_batch", version: 1, active: true, definition: { steps: [] }, created_by_label: null, created_at: "2026-11-01T00:00:00Z", activated_at: null, activated_by_label: null }] }),
    facts: ok({ facts: { value_at_risk: "number" }, ops: ["gt"], assignee_rules: [], object_kinds: ["fix_batch"] }),
  };
});
afterEach(() => undo());
const wrap = (slug: string) => {
  const Section = OPS_SECTIONS[slug];
  return renderWithQuery(<ToastProvider><SheetHost><Section /></SheetHost></ToastProvider>);
};

describe("ops registry", () => {
  it("has every ops slug", () => {
    expect(Object.keys(OPS_SECTIONS).sort()).toEqual(["aletheia", "runs", "runschedules", "system", "systems", "workflows"]);
  });
});

describe("runs", () => {
  it("starts an extraction of the picked object", async () => {
    wrap("runs");
    const block = screen.getByTestId("ops-runs-extract");
    fireEvent.click(within(block).getByRole("checkbox", { name: /material/i }));
    fireEvent.click(within(block).getByRole("button", { name: /Extract 1 object/ }));
    await waitFor(() => expect(S.admin.startExtraction).toHaveBeenCalled());
    expect(S.admin.startExtraction.mock.calls[0][0]).toBe("sys-1");
    expect(S.admin.startExtraction.mock.calls[0][1]).toEqual(["material_master"]);
  });

  it("is denied without any run permission", () => {
    S.can = () => false;
    wrap("runs");
    expect(screen.getByTestId("denied")).toBeInTheDocument();
  });

  it("shows an empty screen when no system is connected", () => {
    S.q.systems = ok([]);
    wrap("runs");
    expect(screen.getByText(/No system is connected yet/)).toBeInTheDocument();
  });
});

describe("runschedules", () => {
  it("lists a schedule and pauses it", async () => {
    wrap("runschedules");
    expect(screen.getByText("Nightly material")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pause Nightly material/ }));
    await waitFor(() => expect(S.admin.pauseRunSchedule).toHaveBeenCalledWith("rs-1"));
  });
});

describe("systems", () => {
  it("lists a system and tests its connection without a password", async () => {
    wrap("systems");
    expect(screen.getByText("KMP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Test the connection of KMP/ }));
    await waitFor(() => expect(S.runs.testSystemConnection).toHaveBeenCalledWith("sys-1"));
    expect(S.runs.testSystemConnection.mock.calls[0]).toHaveLength(1);
  });

  it("error shows a retry", () => {
    S.q.systems = bad();
    wrap("systems");
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect((S.q.systems as { refetch: () => void }).refetch).toHaveBeenCalled();
  });
});

describe("system", () => {
  it("shows jobs and the version, and downloads diagnostics", async () => {
    wrap("system");
    expect(screen.getAllByText("0.0.700").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Download diagnostics bundle" }));
    await waitFor(() => expect(S.downloadDiagnostics).toHaveBeenCalled());
  });
});

describe("aletheia", () => {
  it("shows the engine status", () => {
    wrap("aletheia");
    expect(screen.getByText("komatsu-meridian")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
  });

  it("loading shows a skeleton, error retries", () => {
    S.q.engine = { ...ok(undefined) };
    const a = wrap("aletheia");
    expect(screen.queryByText("komatsu-meridian")).toBeNull();
    a.unmount();
    S.q.engine = bad();
    wrap("aletheia");
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect((S.q.engine as { refetch: () => void }).refetch).toHaveBeenCalled();
  });
});

describe("workflows", () => {
  it("shows a workflow and dry-runs its definition", async () => {
    wrap("workflows");
    expect(screen.getByTestId("workflow-fix_batch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => expect(S.dryRun).toHaveBeenCalled());
    expect(S.dryRun.mock.calls[0][1]).toBe("fix_batch");
  });
});
