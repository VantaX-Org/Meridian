import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as ent from "@/lib/api/v2/enterprise";
import { resetAdminFixture, resetEnterpriseFixture } from "@/lib/api/v2/fixtures";
import { setLang } from "@/lib/v2/i18n";
import { checkAccent, darkTint, DARK_GROUND_LUMINANCE, luminance, ratio, refreshTenantTheme, themeRootProps, useTenantTheme } from "@/lib/v2/theme";
import { AppearanceBlock, ComplianceBlock, DiagnosticsBlock, GroupRoleEditor, ScimBadge, ScimCard } from "../admin/enterprise";
import { UsersSection } from "../admin/users";
import { resetKeptOutcomes } from "../inspector/shared";
import { V2Shell } from "../shell/V2Shell";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetEnterpriseFixture();
  resetKeptOutcomes();
  refreshTenantTheme();
  setLang("en");
  setUrl("/v2/admin/settings?fixture=1");
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  undoLayout();
  undoLayout = () => undefined;
  window.sessionStorage.clear();
  refreshTenantTheme();
  vi.restoreAllMocks();
});

/* ── Theming ── */

describe("accent contrast", () => {
  it("measures the accent against both grounds and refuses it below 4.5:1 on the light one", () => {
    const navy = checkAccent("#1b3f8f");
    expect(navy?.light).toBeGreaterThan(9);
    expect(navy?.light).toBeLessThan(10.5);
    expect(navy?.darkAsChosen).toBeLessThan(4.5);
    // On the dark ground Meridian uses a lighter tint of it, which passes.
    expect(navy?.dark).toBeGreaterThanOrEqual(4.5);
    expect(navy?.ok).toBe(true);
    const gold = checkAccent("#ffd700");
    expect(gold?.light).toBeLessThan(4.5);
    expect(gold?.ok).toBe(false);
    expect(checkAccent("gold")).toBeNull();
    expect(checkAccent("#12345")).toBeNull();
  });

  it("a tint always reaches 4.5:1 on the dark ground, and the ratio formula is WCAG's", () => {
    for (const c of ["#000000", "#1b3f8f", "#a3221a", "#1d6b3f"]) expect(ratio(luminance(darkTint(c)), DARK_GROUND_LUMINANCE)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(luminance("#ffffff"), luminance("#000000"))).toBeCloseTo(21, 5);
    expect(ratio(luminance("#767676"), 1)).toBeCloseTo(4.54, 2);
  });

  it("puts a passing accent on the shell root as custom properties, and nothing for a failing one", () => {
    const ok = themeRootProps({ logo_url: null, product_name: null, accent: "#1b3f8f" });
    expect(ok["data-tenant-accent"]).toBe("");
    expect(ok.style).toMatchObject({ "--m2-tenant-accent": "#1b3f8f" });
    expect(themeRootProps({ logo_url: null, product_name: null, accent: "#ffd700" })).toEqual({});
    expect(themeRootProps(null)).toEqual({});
  });
});

function ThemeProbe() {
  const theme = useTenantTheme();
  return <div data-testid="probe" {...themeRootProps(theme)}>{theme?.product_name ?? "none"}</div>;
}

describe("Admin › Settings › Appearance", () => {
  it("shows the contrast as numbers, refuses a light accent and saves a dark one, which the shell then applies", async () => {
    const put = vi.spyOn(ent, "putThemeSettings");
    renderWithQuery(
      <>
        <AppearanceBlock />
        <ThemeProbe />
      </>,
    );
    const block = await screen.findByRole("region", { name: "Appearance" });
    fireEvent.click(await within(block).findByLabelText("Use our own accent colour"));
    const hex = within(block).getByLabelText("Accent, hexadecimal");
    fireEvent.change(hex, { target: { value: "#ffd700" } });
    const result = within(block).getByTestId("contrast-result");
    expect(result).toHaveTextContent(/On the light ground\s*1\.\d\d:1, below 4\.5:1/);
    expect(within(block).getByRole("alert")).toHaveTextContent("Choose a darker accent.");
    expect(within(block).getByRole("button", { name: "Save the appearance" })).toBeDisabled();
    fireEvent.change(hex, { target: { value: "#1b3f8f" } });
    expect(within(block).getByTestId("contrast-result")).toHaveTextContent(/On the light ground\s*9\.\d\d:1, passes/);
    expect(within(block).getByTestId("contrast-result")).toHaveTextContent(/On the dark ground, as used/);
    fireEvent.change(within(block).getByLabelText(/^Product name/), { target: { value: "Acme Data Quality" } });
    fireEvent.click(within(block).getByRole("button", { name: "Save the appearance" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ logo_url: null, product_name: "Acme Data Quality", accent: "#1b3f8f" }));
    await waitFor(() => expect(screen.getByText("Appearance saved")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("Acme Data Quality"));
    expect(screen.getByTestId("probe")).toHaveAttribute("data-tenant-accent", "");
    expect(screen.getByTestId("probe").style.getPropertyValue("--m2-tenant-accent")).toBe("#1b3f8f");
  });

  it("previews an uploaded logo and refuses a file over 256 KB or of another type", async () => {
    renderWithQuery(<AppearanceBlock />);
    const block = await screen.findByRole("region", { name: "Appearance" });
    const input = (await within(block).findByLabelText(/^Logo/)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x".repeat(300 * 1024)], "big.png", { type: "image/png" })] } });
    expect(await within(block).findByRole("alert")).toHaveTextContent("The logo is 300 KB; the limit is 256 KB.");
    fireEvent.change(input, { target: { files: [new File(["GIF89a"], "a.gif", { type: "image/gif" })] } });
    expect(await within(block).findByRole("alert")).toHaveTextContent("Choose a PNG, SVG, JPEG or WebP image.");
    fireEvent.change(input, { target: { files: [new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "logo.svg", { type: "image/svg+xml" })] } });
    const img = await within(block).findByRole("img", { name: "Logo preview" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("the shell root and the top bar take the tenant's accent, logo and name; About keeps the Meridian mark", async () => {
    await ent.putThemeSettings({ logo_url: null, product_name: "Acme Data Quality", accent: "#1b3f8f" });
    refreshTenantTheme();
    setUrl("/v2?fixture=1");
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    await waitFor(() => expect(document.querySelector(".m2-root")).toHaveAttribute("data-tenant-accent", ""));
    expect((document.querySelector(".m2-root") as HTMLElement).style.getPropertyValue("--m2-tenant-accent")).toBe("#1b3f8f");
    expect(screen.getByRole("link", { name: "Acme Data Quality, go to the landscape" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Account/ }));
    fireEvent.click(within(await screen.findByRole("menu", { name: "Account" })).getByRole("menuitem", { name: "About Meridian" }));
    const about = await screen.findByRole("dialog", { name: "About Meridian" });
    expect(within(about).getByTestId("about-meridian").querySelector("svg.m2-mark")).not.toBeNull();
  });
});

/* ── Compliance and diagnostics ── */

describe("Admin › Settings › Compliance", () => {
  it("shows residency, encryption and the last backup, and saves an edited retention", async () => {
    const put = vi.spyOn(ent, "putCompliance");
    renderWithQuery(<ComplianceBlock />);
    const block = await screen.findByRole("region", { name: "Compliance" });
    expect(await within(block).findByText("meridian.demo-corp.example, eu-central-1")).toBeInTheDocument();
    expect(block).toHaveTextContent("Encryption at rest");
    expect(block).toHaveTextContent(/Last backup\s*20 Oct 2026, 02:10/);
    const runs = within(block).getByLabelText("Analysis runs, days kept");
    expect(runs).toHaveValue(365);
    const save = within(block).getByRole("button", { name: "Save retention" });
    expect(save).toBeDisabled();
    fireEvent.change(runs, { target: { value: "0" } });
    expect(within(block).getByRole("alert")).toHaveTextContent("Each kind of data is kept from 1 to 3650 days.");
    expect(save).toBeDisabled();
    fireEvent.change(runs, { target: { value: "400" } });
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0].retention).toContainEqual({ family: "runs", days: 400 });
    await waitFor(() => expect(screen.getByText("Retention saved")).toBeInTheDocument());
  });
});

describe("Admin › System › diagnostics bundle", () => {
  it("downloads the zip through the v2 download and says which file was saved", async () => {
    const url = window.URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const before = [url.createObjectURL, url.revokeObjectURL];
    url.createObjectURL = () => "blob:x";
    url.revokeObjectURL = () => undefined;
    try {
      const spy = vi.spyOn(ent, "downloadDiagnostics");
      renderWithQuery(<DiagnosticsBlock />);
      fireEvent.click(screen.getByRole("button", { name: "Download diagnostics bundle" }));
      await waitFor(() => expect(spy).toHaveBeenCalled());
      expect(await screen.findByText("Saved meridian-diagnostics-fixture.zip")).toBeInTheDocument();
    } finally {
      [url.createObjectURL, url.revokeObjectURL] = before;
    }
  });

  it("the Contact support panel attaches the server's JSON summary", async () => {
    setUrl("/v2?fixture=1&open=help");
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    const summary = await within(dialog).findByTestId("diagnostics-summary");
    expect(summary).toHaveTextContent('"migrations_head": "099"');
    expect(summary).toHaveTextContent('"scim_provisioned": 2');
    expect(summary).toHaveTextContent('"status": "degraded"');
  });
});

/* ── SCIM ── */

describe("Admin › Users › Provisioning (SCIM)", () => {
  it("shows the token's state, last use and the base URL to paste into Entra or Okta", async () => {
    renderWithQuery(<ScimCard />);
    const card = await screen.findByTestId("scim-card");
    expect(await within(card).findByText("Active")).toBeInTheDocument();
    expect(card).toHaveTextContent("http://localhost:9/api/v1/scim/v2");
    expect(within(card).getByRole("button", { name: "Copy the URL" })).toBeInTheDocument();
  });

  it("rotating shows the new secret once, copyable, and it is gone once stored", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    renderWithQuery(<ScimCard />);
    const card = await screen.findByTestId("scim-card");
    fireEvent.click(await within(card).findByRole("button", { name: "Rotate the token" }));
    const confirm = await screen.findByRole("dialog", { name: "Rotate the SCIM token" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate" }));
    const secret = await within(card).findByTestId("scim-secret");
    const token = within(secret).getByLabelText("SCIM token").textContent ?? "";
    expect(token).toMatch(/^scim_/);
    expect(secret).toHaveTextContent("Shown once.");
    fireEvent.click(within(secret).getByRole("button", { name: "Copy the token" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(token));
    fireEvent.click(within(secret).getByRole("button", { name: "I have stored it" }));
    expect(within(card).queryByTestId("scim-secret")).toBeNull();
    // A later read never carries the secret.
    expect((await ent.getScimToken()).token).toBeUndefined();
  });

  it("revoking stops provisioning, and a new token can be created", async () => {
    renderWithQuery(<ScimCard />);
    const card = await screen.findByTestId("scim-card");
    fireEvent.click(await within(card).findByRole("button", { name: "Revoke" }));
    const confirm = await screen.findByRole("dialog", { name: "Revoke the SCIM token" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke" }));
    expect(await within(card).findByText("Revoked")).toBeInTheDocument();
    fireEvent.click(await within(card).findByRole("button", { name: "Create a token" }));
    expect(await within(card).findByTestId("scim-secret")).toBeInTheDocument();
    expect(await within(card).findByText("Active")).toBeInTheDocument();
  });

  it("maps groups to roles, refusing an empty or repeated group", async () => {
    const put = vi.spyOn(ent, "putScimGroupRoles");
    renderWithQuery(<GroupRoleEditor initial={{ map: [{ group: "SAP-Basis", role: "sap_basis" }] }} />);
    const table = screen.getByRole("region", { name: "Group to role mapping" });
    expect(within(table).getByLabelText("Group 1")).toHaveValue("SAP-Basis");
    fireEvent.click(screen.getByRole("button", { name: "Add a group" }));
    expect(screen.getByText("Every row needs a group name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save the mapping" })).toBeDisabled();
    fireEvent.change(within(table).getByLabelText("Group 2"), { target: { value: "sap-basis" } });
    expect(screen.getByText("A group can map to one role only.")).toBeInTheDocument();
    fireEvent.change(within(table).getByLabelText("Group 2"), { target: { value: "SAP-DQ-Stewards" } });
    await waitFor(() => expect(within(table).getByLabelText("Role for group 2").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(within(table).getByLabelText("Role for group 2"), { target: { value: "data_steward" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the mapping" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ map: [{ group: "SAP-Basis", role: "sap_basis" }, { group: "SAP-DQ-Stewards", role: "data_steward" }] }));
    await waitFor(() => expect(screen.getByText("Mapping saved")).toBeInTheDocument());
  });

  it("marks the people who came through SCIM", async () => {
    expect(ent.provisionedByScim({ external_id: "x" })).toBe(true);
    expect(ent.provisionedByScim({ scim: true })).toBe(true);
    expect(ent.provisionedByScim({ external_id: "" })).toBe(false);
    renderWithQuery(<ScimBadge user={{ id: "u" }} />);
    expect(screen.queryByTestId("scim-badge")).toBeNull();
    undoLayout = stubLayout();
    setUrl("/v2/admin/users?fixture=1");
    renderWithQuery(<UsersSection />);
    const grid = await screen.findByRole("grid", { name: "Users" });
    await waitFor(() => expect(within(grid).getAllByTestId("scim-badge")).toHaveLength(2));
    expect(within(grid).getAllByTestId("scim-badge")[0].closest('[role="row"]')).toHaveTextContent("Thabo Molefe");
    await act(async () => undefined);
  });
});

describe("the grounds the accent is measured against", () => {
  it("are the light and dark --m2-sheet of design/v2/tokens.css", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { LIGHT_GROUND_LUMINANCE } = await import("@/lib/v2/theme");
    const css = readFileSync(join(__dirname, "..", "tokens.css"), "utf8");
    const sheets = [...css.matchAll(/--m2-sheet:\s*(#[0-9A-Fa-f]{6});/g)].map((m) => m[1]);
    expect(luminance(sheets[0])).toBeCloseTo(LIGHT_GROUND_LUMINANCE, 4);
    expect(luminance(sheets[1])).toBeCloseTo(DARK_GROUND_LUMINANCE, 4);
    expect(luminance(sheets[2])).toBeCloseTo(DARK_GROUND_LUMINANCE, 4);
  });
});
