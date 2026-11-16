import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { PolicyPacks } from "../../more/PolicyPacks";
import { NOTIFY_SECTIONS, NotificationsSectionNative } from "../notify";
import { AlertsSection } from "../notify-alerts";
import { DigestsSection } from "../notify-digests";
import { WebhooksSection } from "../notify-webhooks";
import { SubjectRequestsSection } from "../notify-subject";
import { DqFirewallSection } from "../notify-firewall";
import { ExternalDbSection } from "../notify-externaldb";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const ok = (data: unknown) => ({ data, isLoading: false, isPending: false, isSuccess: true, isError: false, error: null, refetch: () => Promise.resolve() });

const S = vi.hoisted(() => ({
  can: (() => true) as (p?: string) => boolean,
  api: {
    saveAlertThresholds: vi.fn(),
    saveDefaultDigest: vi.fn(),
    sendDigestNow: vi.fn(),
    testChatAlerts: vi.fn(),
    searchSubject: vi.fn(),
    validateRecords: vi.fn(),
    testDbConnection: vi.fn(),
  },
}));

vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can, id: "u-self", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const settings = {
  alert_thresholds: { critical_threshold: 1, high_threshold: 5, dqs_drop_threshold: 5, module_floors: {} },
  licensed_modules: ["material_master"],
  notification_config: { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: false },
};
const channel = { id: "c1", kind: "email", target: "ops@example.com", digest: "daily", report_pack: null, immediate_critical: true, enabled: true };
const summary = { modules: ["material_master"], max_records: 100, block_severity: "critical", calls_24h: 3, calls_7d: 9, last_call_at: null, days: [], top_rules: [], by_module: [] };

vi.mock("@/lib/v2/admin-queries", () => ({
  useTenantSettings: () => ok(settings),
  useChannels: () => ok([channel]),
  useWaves: () => ok([]),
  useUsers: () => ok({ users: [] }),
  useFirewallSummary: () => ok(summary),
  useSubjectRequests: () => ok([]),
  useSuppressions: () => ok({ active_keys: 0, dropped_total: 0, items: [], field_texts: {} }),
  refreshAdmin: () => Promise.resolve(),
}));
vi.mock("@/lib/api/v2/admin", () => ({ saveAlertThresholds: S.api.saveAlertThresholds, saveDefaultDigest: S.api.saveDefaultDigest, createChannel: vi.fn(), updateChannel: vi.fn(), testChannel: vi.fn(), deleteChannel: vi.fn() }));

const digest = { id: "d1", name: "Monday lead", audience: "role", role: "admin", wave_id: null, cron: "0 7 * * 1", timezone: "UTC", channel: "email", recipients: ["lead@example.com"], recipient_user_ids: [], alert_channel_id: null, attach_pdf: false, enabled: true, last_sent_at: null, next_run_at: null, created_by: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };
vi.mock("@/lib/v2/step10-queries", () => ({
  useDigests: () => ok({ digests: [digest] }),
  useDigestDeliveries: () => ok({ deliveries: [] }),
  useDigestHtml: () => ok("<p>preview</p>"),
  useDigestNumbers: () => ok(undefined),
  refreshStep10: () => Promise.resolve(),
}));
vi.mock("@/lib/api/v2/step10", async (orig) => ({ ...(await orig<object>()), sendDigestNow: S.api.sendDigestNow, createDigest: vi.fn(), updateDigest: vi.fn(), deleteDigest: vi.fn() }));

vi.mock("@/lib/v2/step9-queries", () => ({
  useWebhooks: () => ok({ webhooks: [] }),
  useAutomation: () => ok({ drift_alerts: { enabled: true }, rule_mining: { min_records: 20 }, score_drop: { below: null, points: null } }),
  useChatAlerts: () => ok({ channels: { slack: true, teams: false }, events: ["run_failed"], available: ["run_failed", "dqs_drop"] }),
  useDeliveries: () => ok({ deliveries: [] }),
  useWebhookEvents: () => ok({ events: [] }),
  refreshStep9: () => Promise.resolve(),
}));
vi.mock("@/lib/api/v2/step9", async (orig) => ({ ...(await orig<object>()), testChatAlerts: S.api.testChatAlerts, putChatAlerts: vi.fn(), putAutomation: vi.fn(), createWebhook: vi.fn(), updateWebhook: vi.fn(), deleteWebhook: vi.fn(), testWebhook: vi.fn() }));

vi.mock("@/lib/api/v2/subject-requests", async (orig) => ({ ...(await orig<object>()), searchSubject: S.api.searchSubject }));
vi.mock("@/lib/api/v2/dq-firewall", async (orig) => ({ ...(await orig<object>()), validateRecords: S.api.validateRecords }));

const conn = { id: "x1", name: "Plant reporting DB", engine: "postgres", host: "db.example.com", port: 5432, database: "erp", username: "reader", ssl_mode: "require", last_test_ok: null, last_loaded_at: null };
vi.mock("@/lib/v2/external-db-queries", () => ({
  useDbConnections: () => ok({ connections: [conn], max_rows: 50000 }),
  useDbTables: () => ok(undefined),
  refreshDbConnections: () => Promise.resolve(),
}));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({ ...(await orig<object>()), useSystemsExtended: () => ok([]) }));
vi.mock("@/lib/api/v2/external-db", async (orig) => ({ ...(await orig<object>()), testDbConnection: S.api.testDbConnection, createDbConnection: vi.fn(), deleteDbConnection: vi.fn(), previewDb: vi.fn(), loadDb: vi.fn() }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more/admin/alerts?fixture=1");
  S.can = () => true;
  Object.values(S.api).forEach((f) => f.mockReset());
});
afterEach(() => undo());
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

describe("notify registry", () => {
  it("lists every slug and reuses PolicyPacks", () => {
    expect(Object.keys(NOTIFY_SECTIONS).sort()).toEqual(["alerts", "digests", "dqfirewall", "externaldb", "notifications", "policypacks", "subjectrequests", "webhooks"]);
    expect(NOTIFY_SECTIONS.policypacks).toBe(PolicyPacks);
    expect(NOTIFY_SECTIONS.notifications).toBe(NotificationsSectionNative);
  });
});

describe("alerts", () => {
  it("shows the channels and saves thresholds", async () => {
    S.api.saveAlertThresholds.mockResolvedValue({});
    wrap(<AlertsSection />);
    expect(screen.getByRole("region", { name: "Channels" })).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));
    await waitFor(() => expect(S.api.saveAlertThresholds).toHaveBeenCalled());
  });
});

describe("notifications", () => {
  it("renders without page chrome and saves the default digest", async () => {
    S.api.saveDefaultDigest.mockResolvedValue({});
    wrap(<NotificationsSectionNative />);
    expect(screen.getByRole("region", { name: "Channels and frequency" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save digest" }));
    await waitFor(() => expect(S.api.saveDefaultDigest).toHaveBeenCalled());
  });
});

describe("digests", () => {
  it("opens a digest and sends it now", async () => {
    S.api.sendDigestNow.mockResolvedValue({ status: "sent", delivered: 1, failed: 0, reason: null });
    wrap(<DigestsSection />);
    fireEvent.click(screen.getByRole("row", { name: "Monday lead" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send now" }));
    await waitFor(() => expect(S.api.sendDigestNow).toHaveBeenCalledWith("d1"));
  });

  it("denies without permission", () => {
    S.can = () => false;
    wrap(<DigestsSection />);
    expect(screen.queryByRole("button", { name: "Add a digest" })).not.toBeInTheDocument();
  });
});

describe("webhooks", () => {
  it("shows the empty list and sends a chat test", async () => {
    S.api.testChatAlerts.mockResolvedValue({ channels: { slack: { configured: true, delivered: true, error: null }, teams: { configured: false, delivered: false, error: null } } });
    wrap(<WebhooksSection />);
    expect(screen.getByText(/No webhook yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send a test message" }));
    await waitFor(() => expect(S.api.testChatAlerts).toHaveBeenCalled());
  });
});

describe("subject requests", () => {
  it("searches for a record key", async () => {
    S.api.searchSubject.mockResolvedValue({ total_rows: 0, rows_by_table: {}, extracts: { files: 0, complete: true, skipped: 0, errors: 0 }, keys: [] });
    wrap(<SubjectRequestsSection />);
    expect(screen.getByRole("region", { name: "Suppression list" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Record key or value"), { target: { value: "PERNR=00001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(S.api.searchSubject).toHaveBeenCalledWith("PERNR=00001234"));
  });
});

describe("dq firewall", () => {
  it("shows the endpoint and checks the sample records", async () => {
    S.api.validateRecords.mockResolvedValue({ verdict: "pass", block_severity: "critical", module: "material_master", rules_run: 4, records: [], duplicate_search: null });
    wrap(<DqFirewallSection />);
    expect(screen.getByText("POST /api/v1/dq-firewall/validate")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check records" }));
    await waitFor(() => expect(S.api.validateRecords).toHaveBeenCalled());
    expect(S.api.validateRecords.mock.calls[0][0]).toBe("material_master");
  });
});

describe("external db", () => {
  it("opens a source and tests the connection", async () => {
    S.api.testDbConnection.mockResolvedValue({ ok: true, server_version: "16", read_only: true, detail: null });
    wrap(<ExternalDbSection />);
    fireEvent.click(screen.getByRole("row", { name: "Plant reporting DB" }));
    fireEvent.click(await screen.findByRole("button", { name: "Test the connection" }));
    await waitFor(() => expect(S.api.testDbConnection).toHaveBeenCalledWith("x1"));
  });

  it("denies without manage_systems", () => {
    S.can = () => false;
    wrap(<ExternalDbSection />);
    expect(screen.queryByRole("button", { name: "Add a connection" })).not.toBeInTheDocument();
  });
});
