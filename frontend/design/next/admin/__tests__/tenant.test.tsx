import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { TENANT_SECTIONS } from "../tenant";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const { pendingQ, ok, never } = vi.hoisted(() => ({
  pendingQ: { data: undefined, isLoading: true, isError: false, error: null, refetch: () => Promise.resolve() },
  ok: (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() }),
  never: () => new Promise(() => undefined),
}));

const S = vi.hoisted(() => ({
  can: (_p: string): boolean => true,
  licence: undefined as unknown,
  billing: vi.fn(),
  tenant: undefined as unknown,
  theme: undefined as unknown,
  validateLicence: vi.fn(),
  patchTenant: vi.fn(),
  putTheme: vi.fn(),
}));

vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can, id: "u-self", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/admin-queries", () => ({
  useLicence: () => S.licence,
  useUpdateStatus: () => ({ data: undefined }),
  useBilling: (period: string) => S.billing(period),
  useTenantSettings: () => S.tenant,
  useScoring: () => pendingQ,
  useCostModel: () => pendingQ,
  useRetention: () => pendingQ,
  usePurgeLog: () => pendingQ,
  useQualityThresholds: () => pendingQ,
  refreshAdmin: () => Promise.resolve(),
}));
vi.mock("@/lib/v2/enterprise-queries", () => ({ useThemeSettings: () => S.theme, useCompliance: () => pendingQ }));
vi.mock("@/lib/v2/step10-queries", () => ({ useSandbox: () => pendingQ, refreshStep10: () => Promise.resolve() }));
vi.mock("@/lib/v2/theme", async (orig) => ({ ...(await orig<object>()), refreshTenantTheme: () => undefined }));
vi.mock("@/lib/api/v2/llm", () => ({ getLlmConfig: never, getLlmProviders: never, putLlmConfig: vi.fn(), putLlmAggregatesOnly: vi.fn(), testLlm: vi.fn() }));
vi.mock("@/lib/api/v2/maintenance", () => ({ MAX_WINDOWS: 8, getMaintenance: never, putMaintenance: vi.fn() }));
vi.mock("@/lib/api/v2/admin", async (orig) => ({ ...(await orig<object>()), validateLicence: S.validateLicence, patchTenant: S.patchTenant, getCostFeatures: never }));
vi.mock("@/lib/api/v2/enterprise", async (orig) => ({ ...(await orig<object>()), putThemeSettings: S.putTheme, uploadThemeLogo: vi.fn(), putCompliance: vi.fn() }));

const wrap = (slug: string) => {
  const Section = TENANT_SECTIONS[slug];
  return renderWithQuery(
    <ToastProvider>
      <SheetHost>
        <Section />
      </SheetHost>
    </ToastProvider>,
  );
};

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more/admin/licence?fixture=1");
  S.can = () => true;
  S.validateLicence.mockReset();
  S.patchTenant.mockReset();
  S.putTheme.mockReset();
  S.billing.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => undo());

describe("tenant registry", () => {
  it("registers licence, billing and settings", () => {
    expect(Object.keys(TENANT_SECTIONS).sort()).toEqual(["billing", "licence", "settings"]);
  });
});

describe("licence", () => {
  it("shows the licence and checks it with Meridian HQ", async () => {
    S.licence = ok({ valid: true, status: "active", company_name: "Acme", tier: "enterprise", seats: 10, seats_used: 4, expiry_date: "2027-06-30", days_remaining: 200, enabled_modules: ["material_master"], features: { max_users: 10 }, last_validated: "2026-11-15T08:00:00Z" });
    S.validateLicence.mockResolvedValue({ valid: true });
    wrap("licence");
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("4 of 10 in use")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check with Meridian HQ now" }));
    await waitFor(() => expect(S.validateLicence).toHaveBeenCalled());
    expect(await screen.findByText("Licence checked with Meridian HQ")).toBeInTheDocument();
  });

  it("offers a retry when the licence cannot be read", () => {
    const refetch = vi.fn(() => Promise.resolve());
    S.licence = { data: undefined, isLoading: false, isError: true, error: new Error("boom"), refetch };
    wrap("licence");
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("billing", () => {
  it("shows the month and reads another month", () => {
    S.billing.mockReturnValue(ok({ total_amount: 1500, base_fee: 1000, currency: "USD", stripe_invoice_id: null, tier1_count: 5, tier1_amount: 100, tier2_count: 4, tier2_amount: 200, tier3_count: 0, tier3_amount: 0, tier4_count: 1, tier4_amount: 200 }));
    wrap("billing");
    expect(screen.getByRole("table", { name: "Billing by tier" })).toBeInTheDocument();
    expect(screen.getByText("Not invoiced yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-01" } });
    expect(S.billing).toHaveBeenLastCalledWith("2026-01");
  });

  it("needs manage_settings", () => {
    S.can = () => false;
    S.billing.mockReturnValue(pendingQ);
    wrap("billing");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("settings", () => {
  beforeEach(() => {
    S.tenant = ok({ name: "Acme", currency: "ZAR", licensed_modules: ["material_master"], planner_config: null });
    S.theme = ok({ product_name_override: null, accent: null, accent_dark: null, logo_url: null, logo_content_type: null, updated_at: null, contrast: { on_white: null, on_dark: null } });
  });

  it("saves the tenant name", async () => {
    S.patchTenant.mockResolvedValue(undefined);
    wrap("settings");
    expect(screen.getByText("This tenant uses Meridian's own look; nothing has been customised.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tenant name"), { target: { value: "Acme Mining" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the tenant" }));
    await waitFor(() => expect(S.patchTenant).toHaveBeenCalledWith({ name: "Acme Mining" }));
  });

  it("saves the appearance with a product name", async () => {
    S.putTheme.mockResolvedValue(undefined);
    wrap("settings");
    fireEvent.change(screen.getByPlaceholderText("Meridian"), { target: { value: "Acme  Data" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the appearance" }));
    await waitFor(() => expect(S.putTheme).toHaveBeenCalledWith({ product_name_override: "Acme Data", accent: null, accent_dark: null, logo_url: null }));
  });
});
