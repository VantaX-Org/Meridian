import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { Inspector } from "../Inspector";
import { AuditSection } from "../admin/data";
import { AlertsSection, NotificationsSection } from "../admin/notify";
import { SystemSection } from "../admin/system";
import { resetKeptOutcomes } from "../inspector/shared";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetRunsFixture();
  resetKeptOutcomes();
  undo = stubLayout(900, 3000);
  h.allowed = "all";
  setUrl("/admin/audit?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const dataRows = (name: string) => within(screen.getByRole("grid", { name })).getAllByRole("row").slice(1);
const withInspector = (ui: React.ReactElement) =>
  renderWithQuery(
    <>
      {ui}
      <Inspector />
    </>,
  );

describe("Admin: audit log", () => {
  it("lists the first page of events with who, what and the result, and pages on", async () => {
    withInspector(<AuditSection />);
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(25));
    expect(screen.getByText("1 to 25 of 36")).toBeInTheDocument();
    expect(norm(dataRows("Audit log")[0])).toContain("Nomsa Dlamini");
    expect(norm(dataRows("Audit log")[0])).toContain("created the user Ines Fernandes");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(11));
    expect(screen.getByText("26 to 36 of 36")).toBeInTheDocument();
  });

  it("filters by object kind and by date, and says so when nothing matches", async () => {
    const spy = vi.spyOn(adminApi, "listAudit");
    withInspector(<AuditSection />);
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(25));
    await screen.findByRole("option", { name: "Roles" });
    fireEvent.change(screen.getByLabelText("Object kind"), { target: { value: "roles" } });
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(4));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "roles", offset: 0 }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2030-01-01" } });
    expect(await screen.findByText(/Nothing matches these filters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(25));
  });

  it("filters by who did it", async () => {
    withInspector(<AuditSection />);
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(25));
    await screen.findByRole("option", { name: "Thabo Molefe" });
    fireEvent.change(screen.getByLabelText("Who"), { target: { value: "u-4" } });
    await waitFor(() => expect(dataRows("Audit log").every((r) => norm(r).includes("Thabo Molefe"))).toBe(true));
  });

  it("exports with the filters that are on screen", async () => {
    const spy = vi.spyOn(adminApi, "exportAudit");
    withInspector(<AuditSection />);
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(25));
    await screen.findByRole("option", { name: "Roles" });
    fireEvent.change(screen.getByLabelText("Object kind"), { target: { value: "roles" } });
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("csv", expect.objectContaining({ entity_type: "roles" })));
    fireEvent.click(screen.getByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("xlsx", expect.anything()));
  });

  it("opens one entry in the inspector with what it read before and after", async () => {
    withInspector(<AuditSection />);
    await waitFor(() => expect(dataRows("Audit log")).toHaveLength(25));
    fireEvent.click(dataRows("Audit log")[0]);
    await waitFor(() => expect(getUrl()).toContain("open=audit%3Aau-"));
    const dialog = await screen.findByRole("dialog", { name: /created the user Ines Fernandes/ });
    expect(within(dialog).getByText("Request")).toBeInTheDocument();
    expect(within(dialog).getByText("Audit entries are permanent. They cannot be edited or removed from here.")).toBeInTheDocument();
  });

  it("shows the AI calls beside the log", async () => {
    withInspector(<AuditSection />);
    const table = await screen.findByRole("table", { name: "AI calls" });
    expect(norm(table)).toContain("Remediation agent");
    expect(norm(table)).toContain("3,420 ms");
  });

  it("needs the view audit permission", async () => {
    h.allowed = ["view"];
    withInspector(<AuditSection />);
    expect(await screen.findByTestId("needs-permission")).toHaveTextContent("view audit");
  });
});

describe("Admin: alerts and notifications", () => {
  it("lists the channels with their digest, board pack and status, and the score floors", async () => {
    setUrl("/admin/alerts?fixture=1");
    withInspector(<AlertsSection />);
    await waitFor(() => expect(dataRows("Alert channels")).toHaveLength(3));
    expect(norm(dataRows("Alert channels")[0])).toContain("dq-team@demo-corp.example");
    expect(norm(dataRows("Alert channels")[0])).toContain("Weekly");
    expect(norm(dataRows("Alert channels")[2])).toContain("Off");
    const floors = await screen.findByRole("table", { name: "Score floors" });
    expect(norm(floors)).toContain("Material master");
  });

  it("saves thresholds and floors together", async () => {
    const spy = vi.spyOn(adminApi, "saveAlertThresholds");
    setUrl("/admin/alerts?fixture=1");
    withInspector(<AlertsSection />);
    fireEvent.change(await screen.findByLabelText("Critical failing rules"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Material master floor"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ critical_threshold: 2, high_threshold: 10, dqs_drop_threshold: 5, module_floors: { material_master: 70, accounts_payable: 80 } });
    await waitFor(() => expect(screen.getAllByText("Alert thresholds saved").length).toBeGreaterThan(0));
  });

  it("adds a channel in its inspector; an email address is checked first", async () => {
    const spy = vi.spyOn(adminApi, "createChannel");
    setUrl("/admin/alerts?fixture=1&open=channel:new");
    withInspector(<AlertsSection />);
    const dialog = await screen.findByRole("dialog", { name: "Add a channel" });
    const add = within(dialog).getByRole("button", { name: "Add the channel" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Address"), { target: { value: "ops@demo-corp.example" } });
    fireEvent.change(within(dialog).getByLabelText("Digest"), { target: { value: "weekly" } });
    fireEvent.click(add);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ kind: "email", target: "ops@demo-corp.example", digest: "weekly", immediate_critical: true }));
    await waitFor(() => expect(dataRows("Alert channels")).toHaveLength(4));
  });

  it("edits, tests and removes a channel", async () => {
    const update = vi.spyOn(adminApi, "updateChannel");
    const test = vi.spyOn(adminApi, "testChannel");
    const remove = vi.spyOn(adminApi, "deleteChannel");
    setUrl("/admin/alerts?fixture=1&open=channel:ch-2");
    withInspector(<AlertsSection />);
    const dialog = await screen.findByRole("dialog", { name: "Microsoft Teams: outlook.office.com" });
    fireEvent.click(within(dialog).getByLabelText("Send new critical findings at once"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("ch-2", { digest: "weekly", immediate_critical: true, enabled: true }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send a test message" }));
    await waitFor(() => expect(test).toHaveBeenCalledWith("ch-2"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove the channel" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove the Microsoft Teams channel" });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove the channel" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("ch-2"));
    await waitFor(() => expect(dataRows("Alert channels")).toHaveLength(2));
  });

  it("warns when no channel is set up", async () => {
    vi.spyOn(adminApi, "listChannels").mockResolvedValue([]);
    setUrl("/admin/alerts?fixture=1");
    withInspector(<AlertsSection />);
    expect(await screen.findByText(/Alerts stay in the app: no channel is set up/)).toBeInTheDocument();
  });

  it("alerts are read only without the manage settings permission", async () => {
    h.allowed = ["view"];
    setUrl("/admin/alerts?fixture=1");
    withInspector(<AlertsSection />);
    await waitFor(() => expect(dataRows("Alert channels")).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Add a channel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save thresholds" })).toBeNull();
  });

  it("saves the default digest", async () => {
    const spy = vi.spyOn(adminApi, "saveDefaultDigest");
    setUrl("/admin/notifications?fixture=1");
    renderWithQuery(<NotificationsSection />);
    expect(await screen.findByLabelText("Email")).toHaveValue("dq-team@demo-corp.example");
    fireEvent.click(screen.getByLabelText("Daily digest"));
    fireEvent.click(screen.getByRole("button", { name: "Save digest" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ email: "dq-team@demo-corp.example", teams_webhook: "", daily_digest: true, weekly_summary: true, monthly_report: true }));
    await waitFor(() => expect(screen.getAllByText("Default digest saved").length).toBeGreaterThan(0));
  });
});

describe("Admin: jobs and system update", () => {
  it("lists jobs, filters to the failed ones, and opens one in its inspector", async () => {
    setUrl("/admin/system?fixture=1");
    withInspector(<SystemSection />);
    await waitFor(() => expect(dataRows("Jobs").length).toBeGreaterThanOrEqual(4));
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "failed" } });
    await waitFor(() => expect(dataRows("Jobs")).toHaveLength(1));
    expect(norm(dataRows("Jobs")[0])).toContain("Failed");
    fireEvent.click(dataRows("Jobs")[0]);
    await waitFor(() => expect(getUrl()).toContain("open=job%3A"));
  });

  it("runs an update after a confirmation, and follows it", async () => {
    const spy = vi.spyOn(adminApi, "triggerUpdate");
    setUrl("/admin/system?fixture=1");
    renderWithQuery(<SystemSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Update to 0.1.2" }));
    const dialog = await screen.findByRole("dialog", { name: "Update to 0.1.2" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Run the update" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Update started");
  });

  it("reads the health checks and counts them", async () => {
    setUrl("/admin/system?fixture=1");
    renderWithQuery(<SystemSection />);
    const table = await screen.findByRole("table", { name: "Health checks" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(await screen.findByText(/5 passing, 1 warning/)).toBeInTheDocument();
  });

  it("without the manage system permission there is no update and no health check", async () => {
    h.allowed = ["view"];
    setUrl("/admin/system?fixture=1");
    renderWithQuery(<SystemSection />);
    await waitFor(() => expect(dataRows("Jobs").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /^Update to/ })).toBeNull();
    expect(screen.queryByRole("table", { name: "Health checks" })).toBeNull();
    expect(screen.getByText("Running an update needs the manage system permission.")).toBeInTheDocument();
  });
});
