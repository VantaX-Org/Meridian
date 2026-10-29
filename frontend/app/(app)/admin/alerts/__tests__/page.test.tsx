import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as settingsApi from "@/lib/api/settings";
import * as notificationsApi from "@/lib/api/notifications";
import type { TenantSettings } from "@/types/api";
import AlertsPage from "../page";

let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => allowed && a === "manage_settings" }) }));
vi.mock("@/hooks/use-nav", () => ({ useVisibleNav: () => [] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/alerts", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const SETTINGS: TenantSettings = {
  name: "Acme",
  licensed_modules: ["material_master"],
  planner_config: null,
  dqs_weights: null,
  alert_thresholds: { critical_threshold: 2, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {}, readiness_dqs_threshold: 75, readiness_waves: {} },
  notification_config: { email: "dq@acme.com", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true },
  stripe_customer_id: null,
};

beforeEach(() => {
  allowed = true;
  vi.restoreAllMocks();
  vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
  vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
});

describe("Alerts page", () => {
  it("answers who is told about what and when in one page", async () => {
    renderWithQuery(<AlertsPage />);
    await screen.findByRole("region", { name: "When to alert" });
    expect(screen.getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    for (const name of ["Channels", "Default digest"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByLabelText("Critical failing rules")).toHaveValue(2);
    expect(screen.getByLabelText("Email")).toHaveValue("dq@acme.com");
    expect(screen.getByRole("link", { name: "Your own digest" })).toHaveAttribute("href", "/me/preferences");
    expect(screen.getByRole("link", { name: "Scoring" })).toHaveAttribute("href", "/rules/scoring");
    expect(await screen.findByText("No alert channels")).toBeInTheDocument();
  });

  it("saves thresholds and the default digest with manage_settings", async () => {
    const th = vi.spyOn(settingsApi, "updateAlertThresholds").mockResolvedValue();
    const dg = vi.spyOn(settingsApi, "saveNotificationSettings").mockResolvedValue();
    renderWithQuery(<AlertsPage />);
    fireEvent.change(await screen.findByLabelText("Critical failing rules"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));
    await waitFor(() => expect(th).toHaveBeenCalled());
    expect(th.mock.calls[0][0].critical_threshold).toBe(3);
    fireEvent.click(screen.getByLabelText("Daily digest"));
    fireEvent.click(within(screen.getByRole("region", { name: "Default digest" })).getByRole("button", { name: "Save digest" }));
    await waitFor(() => expect(dg).toHaveBeenCalled());
    expect(dg.mock.calls[0][0]).toMatchObject({ email: "dq@acme.com", daily_digest: true });
  });

  it("is read only without manage_settings", async () => {
    allowed = false;
    renderWithQuery(<AlertsPage />);
    expect(await screen.findByText("These settings are read only for your role")).toBeInTheDocument();
    expect(screen.getByLabelText("Critical failing rules")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save thresholds" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save digest" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add channel" })).toBeNull();
  });

  it("warns at the top that alerts stay in the app when no channel is set up, and Add channel opens the dialog", async () => {
    renderWithQuery(<AlertsPage />);
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("Alerts stay in the app: no channel is set up");
    const add = within(warning).getByRole("button", { name: "Add channel" });
    expect(add).toHaveClass("m-btn-secondary");
    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "Add a channel" })).toBeInTheDocument();
  });

  it("shows no warning once a channel exists", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([
      { id: "c1", kind: "email", target: "dq@acme.com", digest: "daily", immediate_critical: true, enabled: true, report_pack: "off" } as never,
    ]);
    renderWithQuery(<AlertsPage />);
    await screen.findByRole("region", { name: "When to alert" });
    await screen.findByText("dq@acme.com");
    expect(screen.queryByText("Alerts stay in the app: no channel is set up")).toBeNull();
  });

});
