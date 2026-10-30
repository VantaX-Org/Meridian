import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { Inspector } from "../Inspector";
import { MappingsSection, ReferenceSection } from "../admin/data";
import { SettingsSection } from "../admin/settings";
import { BillingSection, LicenceSection } from "../admin/tenant";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
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
  undo = stubLayout();
  h.allowed = "all";
  setUrl("/admin/licence?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const dataRows = (name: string) => within(screen.getByRole("grid", { name })).getAllByRole("row").slice(1);

describe("Admin: licence", () => {
  it("shows company, status, seats in use, validity, modules and features", async () => {
    renderWithQuery(<LicenceSection />);
    expect(await screen.findByText("Demo Corp")).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Detail" });
    expect(norm(detail)).toContain("Valid");
    expect(norm(detail)).toContain("7 of 25 in use");
    expect(norm(detail)).toMatch(/31 Mar 2027, \d+ days left/);
    const modules = screen.getByRole("list", { name: "Licensed modules" });
    expect(within(modules).getAllByRole("listitem")).toHaveLength(10);
    expect(within(screen.getByRole("list", { name: "Licensed features" })).getByText("Export reports")).toBeInTheDocument();
  });

  it("checks the licence with Meridian HQ on request, and only for who may", async () => {
    const spy = vi.spyOn(adminApi, "validateLicence");
    renderWithQuery(<LicenceSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Check with Meridian HQ now" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Licence checked with Meridian HQ");
  });

  it("shows the default fixture as valid, without an offline warning", async () => {
    renderWithQuery(<LicenceSection />);
    await screen.findByText("Demo Corp");
    expect(screen.queryByText(/Offline: the last signed licence/)).toBeNull();
    expect(norm(screen.getByRole("region", { name: "Detail" }))).not.toContain("Offline grace");
  });

  it("warns while the licence service is unreachable and the last signed licence is honoured", async () => {
    const base = await adminApi.getLicence();
    vi.spyOn(adminApi, "getLicence").mockResolvedValue({
      ...base,
      valid: true,
      status: "offline_grace",
      offline_grace: { active: true, signed_at: "2026-10-20T08:00:00+00:00", ends_at: "2026-11-03T08:00:00+00:00", days_left: 4, grace_days: 14 },
    });
    renderWithQuery(<LicenceSection />);
    const note = await screen.findByText(/Offline: the last signed licence is honoured until/);
    expect(norm(note)).toContain("until 3 Nov 2026 (4 days left)");
    expect(norm(note)).toContain("Check that this server can reach the licence service");
    const detail = screen.getByRole("region", { name: "Detail" });
    expect(norm(detail)).toContain("Offline grace");
    expect(norm(detail)).not.toMatch(/Status ?Valid/);
    expect(norm(detail)).toContain("honoured for 14 days");
  });

  it("offers no refresh without the manage system permission", async () => {
    h.allowed = ["view"];
    renderWithQuery(<LicenceSection />);
    await screen.findByText("Demo Corp");
    expect(screen.queryByRole("button", { name: "Check with Meridian HQ now" })).toBeNull();
  });
});

describe("Admin: billing", () => {
  it("lists the tiers of the month with counts and amounts, and the total", async () => {
    renderWithQuery(<BillingSection />);
    const table = await screen.findByRole("table", { name: "Billing by tier" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(norm(rows[0])).toContain("Tier 1");
    expect(norm(rows[0])).toContain("42");
    expect(screen.getByText("ZAR 63,400.00")).toBeInTheDocument();
  });

  it("a month with no figures says so and offers the way back", async () => {
    renderWithQuery(<BillingSection />);
    await screen.findByRole("table", { name: "Billing by tier" });
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2999-01" } });
    expect(await screen.findByText(/No billing figures for this month/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to this month" }));
    expect(await screen.findByRole("table", { name: "Billing by tier" })).toBeInTheDocument();
  });

  it("needs the manage settings permission", async () => {
    h.allowed = ["view"];
    renderWithQuery(<BillingSection />);
    expect(await screen.findByTestId("needs-permission")).toHaveTextContent("manage settings");
  });
});

describe("Admin: settings", () => {
  it("shows the tenant, and saves dimension weights only when they add up to 100", async () => {
    const spy = vi.spyOn(adminApi, "putScoring");
    renderWithQuery(<SettingsSection />);
    expect(await screen.findByText("Demo Corp")).toBeInTheDocument();
    const save = await screen.findByRole("button", { name: "Save weights" });
    fireEvent.change(screen.getByLabelText(/Completeness weight/), { target: { value: "30" } });
    expect(save).toBeDisabled();
    expect(screen.getByText("The weights add up to 105.0. Adjust them to 100 to save.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Accuracy weight/), { target: { value: "20" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].dimension_weights).toEqual({ completeness: 30, accuracy: 20, consistency: 20, timeliness: 10, uniqueness: 10, validity: 10 });
    expect(spy.mock.calls[0][0].thresholds).toEqual({ target: 90, warning: 75, critical: 60 });
    await waitFor(() => expect(screen.getAllByText("Weights saved").length).toBeGreaterThan(0));
  });

  it("refuses bands that are out of order", async () => {
    renderWithQuery(<SettingsSection />);
    const target = (await screen.findAllByLabelText("Target"))[0];
    fireEvent.change(target, { target: { value: "70" } });
    expect(screen.getByText("Critical must not exceed warning, and warning must not exceed target.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save bands" })).toBeDisabled();
  });

  it("saves the tolerance and the cost model currency in capitals", async () => {
    const scoring = vi.spyOn(adminApi, "putScoring");
    const cost = vi.spyOn(adminApi, "putCostModel");
    renderWithQuery(<SettingsSection />);
    fireEvent.change(await screen.findByLabelText(/Failing records/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tolerance" }));
    await waitFor(() => expect(scoring).toHaveBeenCalled());
    expect(scoring.mock.calls[0][0].critical_tolerance).toEqual({ pct: 0.1, rows: 10 });
    fireEvent.change(await screen.findByLabelText(/^Currency/), { target: { value: "eur" } });
    expect(screen.getByLabelText(/^Currency/)).toHaveValue("EUR");
    fireEvent.click(screen.getByRole("button", { name: "Save cost model" }));
    await waitFor(() => expect(cost).toHaveBeenCalled());
    expect(cost.mock.calls[0][0].currency).toBe("EUR");
    expect(cost.mock.calls[0][0].subscription_monthly).toBe(48000);
  });

  it("saves the retention policy, and previews what a draft would purge before anything is deleted", async () => {
    const put = vi.spyOn(adminApi, "putRetention");
    const del = vi.spyOn(adminApi, "purgeVersion");
    renderWithQuery(<SettingsSection />);
    const days = await screen.findByLabelText(/Keep runs, days/);
    fireEvent.change(days, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ versions_days: 90, reports_days: 180, audit_days: null, keep_baseline: true, keep_latest_per_system: 3 }));
    expect(del).not.toHaveBeenCalled();
  });

  it("is read only without the manage settings permission", async () => {
    h.allowed = ["view"];
    renderWithQuery(<SettingsSection />);
    expect(await screen.findByText(/read only for your role/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save weights" })).toBeNull();
    expect(screen.queryByTestId("tenant-purge")).toBeNull();
  });

  it("deleting all data is two steps, each typed", async () => {
    const request = vi.spyOn(adminApi, "requestTenantPurge");
    renderWithQuery(<SettingsSection />);
    const zone = await screen.findByTestId("tenant-purge");
    fireEvent.click(within(zone).getByRole("button", { name: "Request a purge" }));
    const dialog = await screen.findByRole("dialog", { name: "Request a purge of all data" });
    const go = within(dialog).getByRole("button", { name: "Request purge" });
    expect(go).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type "purge all data"/), { target: { value: "purge all data" } });
    fireEvent.click(go);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(await within(zone).findByRole("button", { name: "Purge now" })).toBeDisabled();
    window.localStorage.removeItem("meridian:tenant-purge");
  });
});

describe("Admin: field mappings", () => {
  it("lists the standard fields with the customer column, and narrows by search", async () => {
    setUrl("/admin/mappings?fixture=1");
    renderWithQuery(<MappingsSection />);
    await waitFor(() => expect(dataRows("Field mappings")).toHaveLength(12));
    expect(norm(dataRows("Field mappings")[0])).toContain("MARA-MATNR");
    expect(norm(dataRows("Field mappings")[0])).toContain("MATNR_X");
    expect(norm(dataRows("Field mappings")[0])).toContain("Mapped");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "LIFNR" } });
    await waitFor(() => expect(dataRows("Field mappings")).toHaveLength(1));
  });

  it("edits one mapping in its inspector and saves the column", async () => {
    const spy = vi.spyOn(adminApi, "updateFieldMapping");
    setUrl("/admin/mappings?fixture=1&open=mapping:fm-2");
    renderWithQuery(
      <>
        <MappingsSection />
        <Inspector />
      </>,
    );
    const dialog = await screen.findByRole("dialog", { name: "MARA.MTART" });
    const save = within(dialog).getByRole("button", { name: "Save the mapping" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Column header in your file"), { target: { value: "MTART_X" } });
    fireEvent.click(save);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("fm-2", { customer_field: "MTART_X", customer_label: "", notes: "", is_mapped: true }));
    await waitFor(() => expect(screen.getAllByText("Mapping saved").length).toBeGreaterThan(0));
  });

  it("resets the customised mappings after a confirmation", async () => {
    const spy = vi.spyOn(adminApi, "resetFieldMappings");
    setUrl("/admin/mappings?fixture=1");
    renderWithQuery(<MappingsSection />);
    await waitFor(() => expect(dataRows("Field mappings")).toHaveLength(12));
    fireEvent.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset all mappings to defaults" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(undefined));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("4 mappings reset to defaults");
  });

  it("is read only without the manage field mappings permission", async () => {
    h.allowed = ["view"];
    setUrl("/admin/mappings?fixture=1");
    renderWithQuery(<MappingsSection />);
    await waitFor(() => expect(dataRows("Field mappings")).toHaveLength(12));
    expect(screen.queryByRole("button", { name: "Reset all to defaults" })).toBeNull();
    expect(screen.getByText(/Read only for your role/)).toBeInTheDocument();
  });
});

describe("Admin: reference data", () => {
  it("shows the lists loaded for a system and uploads a replacement", async () => {
    const spy = vi.spyOn(adminApi, "uploadReference");
    setUrl("/admin/reference?fixture=1");
    renderWithQuery(<ReferenceSection />);
    const table = await screen.findByRole("table", { name: "Reference lists" });
    expect(norm(table)).toContain("Postal codes");
    expect(norm(table)).toContain("48,210");
    expect(norm(table)).toContain("ZA, DE, GB");
    const csv = "country,postcode\nZA,2000\nZA,2001\nDE,10115";
    fireEvent.change(screen.getByLabelText(/^CSV/), { target: { value: csv } });
    fireEvent.click(screen.getByRole("button", { name: "Upload the list" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("a1b2c3d4-0001-4000-8000-000000000001", "postal-codes", csv));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Postal codes loaded");
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("a system with no list says so", async () => {
    setUrl("/admin/reference?fixture=1");
    renderWithQuery(<ReferenceSection />);
    await screen.findByRole("table", { name: "Reference lists" });
    fireEvent.change(screen.getByLabelText("System"), { target: { value: "a1b2c3d4-0002-4000-8000-000000000002" } });
    expect(await screen.findByText(/No reference data is loaded for S\/4HANA sandbox/)).toBeInTheDocument();
  });

  it("uploading needs the manage systems permission", async () => {
    h.allowed = ["view"];
    setUrl("/admin/reference?fixture=1");
    renderWithQuery(<ReferenceSection />);
    expect(await screen.findByTestId("needs-permission")).toHaveTextContent("manage systems");
    expect(screen.queryByRole("button", { name: "Upload the list" })).toBeNull();
  });
});
