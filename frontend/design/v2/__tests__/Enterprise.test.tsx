import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as ent from "@/lib/api/v2/enterprise";
import { resetAdminFixture, resetEnterpriseFixture } from "@/lib/api/v2/fixtures";
import { setLang } from "@/lib/v2/i18n";
import { checkAccent, darkTint, DARK_GROUND_LUMINANCE, lightShade, luminance, ratio, refreshTenantTheme, themeRootProps, useTenantTheme } from "@/lib/v2/theme";
import { AppearanceBlock, ComplianceBlock, DiagnosticsBlock, GroupRoleEditor, ScimCard } from "../admin/enterprise";
import { resetKeptOutcomes } from "../inspector/shared";
import { V2Shell } from "../shell/V2Shell";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetEnterpriseFixture();
  resetKeptOutcomes();
  refreshTenantTheme();
  setLang("en");
  setUrl("/admin/settings?fixture=1");
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
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

  it("repaints the shell root only for a customised theme with a passing accent", () => {
    const base = { product_name: "Meridian", accent: "#1B3F8F", accent_dark: "#8FB0F5", logo_url: null, customised: true };
    const ok = themeRootProps(base);
    expect(ok["data-tenant-accent"]).toBe("");
    expect(ok.style).toMatchObject({ "--m2-tenant-accent": "#1B3F8F", "--m2-tenant-accent-dark": "#8FB0F5" });
    // The server's dark accent is checked on its own dark ground; one too dark for this sheet is tinted further.
    expect((themeRootProps({ ...base, accent_dark: "#5A7BC0" }).style as Record<string, string>)["--m2-tenant-accent-dark"]).not.toBe("#5A7BC0");
    expect(themeRootProps({ ...base, customised: false })).toEqual({});
    expect(themeRootProps(null)).toEqual({});
  });

  it("clamps an accent that does not read at 4.5:1 to the nearest shade of it that does, in both themes", () => {
    const base = { product_name: "Meridian", accent: "#FFD700", accent_dark: "", logo_url: null, customised: true };
    const props = themeRootProps(base);
    expect(props["data-tenant-accent"]).toBe("");
    const vars = props.style as Record<string, string>;
    expect(vars["--m2-tenant-accent"]).not.toBe("#FFD700");
    expect(ratio(luminance(vars["--m2-tenant-accent"]), 1)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(luminance(vars["--m2-tenant-accent-dark"]), DARK_GROUND_LUMINANCE)).toBeGreaterThanOrEqual(4.5);
    // Each clamp is the first passing step: one step lighter would fail.
    expect(ratio(luminance(lightShade("#FFD700")), 1)).toBeLessThan(4.9);
    // An accent that passes is drawn as chosen.
    expect(lightShade("#1B3F8F")).toBe("#1B3F8F");
    expect(checkAccent("#ffd700")?.lightShade).toBe(lightShade("#ffd700"));
    for (const c of ["#FFFFFF", "#00FF00", "#7FB3E8", "#E87BA4"]) expect(ratio(luminance(lightShade(c)), 1), c).toBeGreaterThanOrEqual(4.5);
  });
});

function ThemeProbe() {
  const theme = useTenantTheme();
  return <div data-testid="probe" {...themeRootProps(theme)}>{theme ? `${theme.product_name}${theme.customised ? ", customised" : ""}` : "none"}</div>;
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
    expect(result).toHaveTextContent(/Accent on the light ground\s*1\.\d\d:1, below 4\.5:1/);
    expect(within(block).getByRole("alert")).toHaveTextContent("Choose a darker accent.");
    expect(within(block).getByRole("button", { name: "Save the appearance" })).toBeDisabled();
    fireEvent.change(hex, { target: { value: "#1b3f8f" } });
    expect(within(block).getByTestId("contrast-result")).toHaveTextContent(/Accent on the light ground\s*9\.\d\d:1, passes/);
    expect(within(block).getByTestId("contrast-result")).toHaveTextContent("Derived by the server from the accent");
    fireEvent.change(within(block).getByLabelText(/^Product name/), { target: { value: "Acme Data Quality" } });
    fireEvent.click(within(block).getByRole("button", { name: "Save the appearance" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ product_name_override: "Acme Data Quality", accent: "#1b3f8f", accent_dark: null, logo_url: null }));
    await waitFor(() => expect(screen.getByText("Appearance saved")).toBeInTheDocument());
    // The server's answer: the accent normalised, a derived dark accent, and both contrasts.
    const saved = await put.mock.results[0].value;
    expect(saved).toMatchObject({ product_name_override: "Acme Data Quality", accent: "#1B3F8F", contrast: { on_white: expect.any(Number), on_dark: expect.any(Number) } });
    expect(saved.accent_dark).toMatch(/^#[0-9A-F]{6}$/);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("Acme Data Quality, customised"));
    expect(screen.getByTestId("probe")).toHaveAttribute("data-tenant-accent", "");
    expect(screen.getByTestId("probe").style.getPropertyValue("--m2-tenant-accent")).toBe("#1B3F8F");
  });

  it("shows the server's refusal sentence for an accent it will not take", async () => {
    await expect(ent.putThemeSettings({ product_name_override: null, accent: "#FFD700", accent_dark: null, logo_url: null })).rejects.toMatchObject({ response: { status: 422 } });
    await expect(ent.putThemeSettings({ product_name_override: null, accent: null, accent_dark: "#FFFFFF", logo_url: null })).rejects.toMatchObject({ response: { data: { detail: "Set the accent before a dark-mode accent" } } });
    await expect(ent.putThemeSettings({ product_name_override: null, accent: null, accent_dark: null, logo_url: "data:image/png;base64,AAAA" })).rejects.toMatchObject({ response: { data: { detail: "Upload the logo with POST /api/v1/settings/theme/logo" } } });
  });

  it("uploads the logo as a file on save, refusing a file over 512 KB or of another type", async () => {
    const url = window.URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const before = [url.createObjectURL, url.revokeObjectURL];
    url.createObjectURL = () => "blob:logo";
    url.revokeObjectURL = () => undefined;
    try {
      const upload = vi.spyOn(ent, "uploadThemeLogo");
      const put = vi.spyOn(ent, "putThemeSettings");
      renderWithQuery(<AppearanceBlock />);
      const block = await screen.findByRole("region", { name: "Appearance" });
      const input = (await within(block).findByLabelText(/^Logo/)) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(["x".repeat(600 * 1024)], "big.png", { type: "image/png" })] } });
      expect(await within(block).findByRole("alert")).toHaveTextContent("The logo is 600 KB; the limit is 512 KB.");
      fireEvent.change(input, { target: { files: [new File(["GIF89a"], "a.gif", { type: "image/gif" })] } });
      expect(await within(block).findByRole("alert")).toHaveTextContent("Choose a PNG or SVG image.");
      const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "logo.svg", { type: "image/svg+xml" });
      fireEvent.change(input, { target: { files: [svg] } });
      expect((await within(block).findByRole("img", { name: "Logo preview" })).getAttribute("src")).toBe("blob:logo");
      fireEvent.click(within(block).getByRole("button", { name: "Save the appearance" }));
      await waitFor(() => expect(upload).toHaveBeenCalledWith(svg));
      // The theme then names the stored logo; it never carries the file.
      await waitFor(() => expect(put).toHaveBeenCalledWith(expect.objectContaining({ logo_url: "blob:logo" })));
      expect(await ent.getThemeSettings()).toMatchObject({ logo_url: "blob:logo", logo_content_type: "image/svg+xml" });
      expect(await ent.getTheme()).toMatchObject({ logo_url: "blob:logo", customised: true });
    } finally {
      [url.createObjectURL, url.revokeObjectURL] = before;
    }
  });

  it("the shell root and the top bar take the tenant's accent, logo and name; About keeps the Meridian mark", async () => {
    await ent.putThemeSettings({ product_name_override: "Acme Data Quality", accent: "#1b3f8f", accent_dark: null, logo_url: null });
    refreshTenantTheme();
    setUrl("/?fixture=1");
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    await waitFor(() => {
      expect(document.querySelector(".m2-root")).toHaveAttribute("data-tenant-accent", "");
      expect((document.querySelector(".m2-root") as HTMLElement).style.getPropertyValue("--m2-tenant-accent")).toBe("#1B3F8F");
    });
    expect(await screen.findByRole("link", { name: "Acme Data Quality, go to the landscape" }, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Account/ }));
    fireEvent.click(within(await screen.findByRole("menu", { name: "Account" })).getByRole("menuitem", { name: "About Meridian" }));
    const about = await screen.findByRole("dialog", { name: "About Meridian" });
    expect(within(about).getByTestId("about-meridian").querySelector("svg.m2-mark")).not.toBeNull();
  });
});

/* ── Compliance and diagnostics ── */

describe("Admin › Settings › Compliance", () => {
  it("shows residency, encryption and the last backup as the server states them, and saves an edited retention", async () => {
    const put = vi.spyOn(ent, "putCompliance");
    renderWithQuery(<ComplianceBlock />);
    const block = await screen.findByRole("region", { name: "Compliance" });
    expect(await within(block).findByText("postgres")).toBeInTheDocument();
    expect(block).toHaveTextContent(/Database volume encrypted at rest\s*Yes/);
    // Not declared by the deployment: a dash, never a guess.
    expect(block).toHaveTextContent(/Object storage encrypted at rest\s*—/);
    expect(block).toHaveTextContent(/Last backup\s*20 Oct 2026, 02:10/);
    expect(block).toHaveTextContent(/Health samples\s*35 days\s*\(fixed\)/);
    const runs = within(block).getByLabelText("Analysis runs, findings and work lists, days kept");
    expect(runs).toHaveValue(365);
    const save = within(block).getByRole("button", { name: "Save retention" });
    expect(save).toBeDisabled();
    const audit = within(block).getByLabelText("Audit log, days kept");
    fireEvent.change(audit, { target: { value: "10" } });
    expect(within(block).getByRole("alert")).toHaveTextContent("the audit log from 30");
    expect(save).toBeDisabled();
    fireEvent.change(audit, { target: { value: "2555" } });
    fireEvent.change(runs, { target: { value: "400" } });
    fireEvent.change(within(block).getByLabelText("Generated reports, days kept"), { target: { value: "" } });
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledWith({ versions_days: 400, reports_days: null, audit_days: 2555 }));
    await waitFor(() => expect(screen.getByText("Retention saved")).toBeInTheDocument());
    expect((await ent.getCompliance()).retention.families.find((f) => f.family === "reports")?.days).toBeNull();
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
    setUrl("/?fixture=1&open=help");
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
  it("shows the token's state, prefix, last use and the server's base URL to paste into Entra or Okta", async () => {
    renderWithQuery(<ScimCard />);
    const card = await screen.findByTestId("scim-card");
    expect(await within(card).findByText("Active")).toBeInTheDocument();
    expect(card).toHaveTextContent("mscim_5f3a91c2...b1a7");
    expect(card).toHaveTextContent("https://meridian.demo-corp.example/scim/v2");
    expect(within(card).getByRole("button", { name: "Copy the URL" })).toBeInTheDocument();
  });

  it("rotating posts the rotate action and shows the new secret once, copyable, and it is gone once stored", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    const rotate = vi.spyOn(ent, "rotateScimToken");
    renderWithQuery(<ScimCard />);
    const card = await screen.findByTestId("scim-card");
    fireEvent.click(await within(card).findByRole("button", { name: "Rotate the token" }));
    const confirm = await screen.findByRole("dialog", { name: "Rotate the SCIM token" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate" }));
    const secret = await within(card).findByTestId("scim-secret");
    expect(rotate).toHaveBeenCalled();
    const token = within(secret).getByLabelText("SCIM token").textContent ?? "";
    expect(token).toMatch(/^mscim_/);
    expect(secret).toHaveTextContent("Shown once.");
    fireEvent.click(within(secret).getByRole("button", { name: "Copy the token" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(token));
    fireEvent.click(within(secret).getByRole("button", { name: "I have stored it" }));
    expect(within(card).queryByTestId("scim-secret")).toBeNull();
    // A later read never carries the secret, only its prefix.
    const later = await ent.getScimToken();
    expect(later.token).toBeUndefined();
    expect(later.token_prefix).toBe(`${token.slice(0, 14)}...${token.slice(-4)}`);
  });

  it("revoking posts the revoke action and leaves no token; a new one can be created", async () => {
    renderWithQuery(<ScimCard />);
    const card = await screen.findByTestId("scim-card");
    fireEvent.click(await within(card).findByRole("button", { name: "Revoke" }));
    const confirm = await screen.findByRole("dialog", { name: "Revoke the SCIM token" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke" }));
    expect(await within(card).findByText("No token")).toBeInTheDocument();
    expect(await ent.getScimToken()).toMatchObject({ configured: false, token_prefix: null, created_at: null, last_used_at: null });
    await expect(ent.revokeScimToken()).rejects.toMatchObject({ response: { status: 404 } });
    fireEvent.click(await within(card).findByRole("button", { name: "Create a token" }));
    expect(await within(card).findByTestId("scim-secret")).toBeInTheDocument();
    expect(await within(card).findByText("Active")).toBeInTheDocument();
  });

  it("maps groups to roles with their members, refusing an empty or repeated group", async () => {
    const put = vi.spyOn(ent, "putScimGroupRoles");
    renderWithQuery(<GroupRoleEditor initial={{ mappings: [{ group: "SAP-Basis", role: "sap_basis", role_name: "SAP Basis / integration admin", group_exists: false, members: 0 }, { group: "SAP-DQ-Owners", role: "data_owner", role_name: "Data owner / approver", group_exists: true, members: 3 }] }} />);
    const table = screen.getByRole("region", { name: "Group to role mapping" });
    expect(within(table).getByLabelText("Group 1")).toHaveValue("SAP-Basis");
    expect(within(table).getByLabelText("Group 1").closest("tr")).toHaveTextContent("Not sent yet");
    expect(within(table).getByLabelText("Group 2").closest("tr")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "Add a group" }));
    expect(screen.getByText("Every row needs a group name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save the mapping" })).toBeDisabled();
    fireEvent.change(within(table).getByLabelText("Group 3"), { target: { value: "sap-basis" } });
    expect(screen.getByText("A group can map to one role only.")).toBeInTheDocument();
    fireEvent.change(within(table).getByLabelText("Group 3"), { target: { value: "SAP-DQ-Stewards" } });
    await waitFor(() => expect(within(table).getByLabelText("Role for group 3").querySelector('option[value="data_steward"]')).not.toBeNull());
    fireEvent.change(within(table).getByLabelText("Role for group 3"), { target: { value: "data_steward" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the mapping" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith([
        { group: "SAP-Basis", role: "sap_basis" },
        { group: "SAP-DQ-Owners", role: "data_owner" },
        { group: "SAP-DQ-Stewards", role: "data_steward" },
      ]),
    );
    await waitFor(() => expect(screen.getByText("Mapping saved")).toBeInTheDocument());
    expect(screen.getByText("9 people were re-synced to the new roles.")).toBeInTheDocument();
  });
});

describe("the grounds the accent is measured against", () => {
  it("are the light and dark --m2-sheet of design/v2/tokens.css", async () => {
    const { LIGHT_GROUND_LUMINANCE } = await import("@/lib/v2/theme");
    const { resolve } = await import("./tokens-css");
    expect(luminance(resolve("light", "--m2-sheet"))).toBeCloseTo(LIGHT_GROUND_LUMINANCE, 4);
    expect(luminance(resolve("dark", "--m2-sheet"))).toBeCloseTo(DARK_GROUND_LUMINANCE, 4);
  });
});
