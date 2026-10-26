import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/config-intelligence";
import { ConfigurationTab } from "../config-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems/s1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

const ELEMENTS: api.ConfigElement[] = [
  { module: "fi_gl", element_type: "company_code", element_value: "1000", transaction_count: 40, first_seen: null, last_seen: null, status: "active", sap_reference_table: "T001" },
  { module: "fi_gl", element_type: "company_code", element_value: "2000", transaction_count: 0, first_seen: null, last_seen: null, status: "ghost", sap_reference_table: "T001" },
];
const FINDING: api.AlignmentFinding = {
  check_id: "CFG-1", module: "fi_gl", category: "ghost", severity: "high", title: "Company code 2000 unused",
  description: "No postings", affected_elements: ["2000"], remediation: "Remove it", estimated_impact_zar: 0,
};

describe("ConfigurationTab", () => {
  it("shows an honest empty state when no analysis exists (404)", async () => {
    const notFound = new AxiosError("nf", "ERR", undefined, undefined, { status: 404, data: {}, statusText: "", headers: {}, config: {} as never });
    for (const fn of ["getConfigHealth", "getConfigInventory"] as const) vi.spyOn(api, fn).mockRejectedValue(notFound);
    renderWithQuery(<ConfigurationTab systemId="s1" canPropose={false} />);
    expect(await screen.findByText("No configuration analysis yet")).toBeInTheDocument();
  });

  it("Discover now queues a discovery for the system", async () => {
    vi.spyOn(api, "getConfigHealth").mockResolvedValue({ run_id: "r1", scores: [] });
    const discover = vi.spyOn(api, "discoverConfigNow").mockResolvedValue({ queued: true, version_id: "v1" });
    renderWithQuery(<ConfigurationTab systemId="s1" canPropose={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Discover now" }));
    await waitFor(() => expect(discover).toHaveBeenCalledWith("s1"));
  });

  it("opens a module's inventory in a drawer with status counts", async () => {
    vi.spyOn(api, "getConfigHealth").mockResolvedValue({ run_id: "r1", scores: [] });
    vi.spyOn(api, "getConfigInventory").mockResolvedValue({ run_id: "r1", elements: ELEMENTS });
    const byModule = vi.spyOn(api, "getConfigInventoryByModule").mockResolvedValue({ run_id: "r1", elements: ELEMENTS });
    renderWithQuery(<ConfigurationTab systemId="s1" canPropose={false} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Inventory" }));
    const card = (await screen.findByText("By module")).closest("section") as HTMLElement;
    await userEvent.click(await within(card).findByText("FI general ledger"));
    await waitFor(() => expect(byModule).toHaveBeenCalledWith("fi_gl"));
    expect(await screen.findByTestId("inventory-counts")).toBeInTheDocument();
  });

  it("opens a module's alignment findings in a drawer", async () => {
    vi.spyOn(api, "getConfigHealth").mockResolvedValue({ run_id: "r1", scores: [] });
    vi.spyOn(api, "getConfigAlignment").mockResolvedValue({ run_id: "r1", findings: [FINDING] });
    const byModule = vi.spyOn(api, "getConfigAlignmentByModule").mockResolvedValue({ run_id: "r1", findings: [FINDING] });
    renderWithQuery(<ConfigurationTab systemId="s1" canPropose={false} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Alignment" }));
    const card = (await screen.findByText("By module")).closest("section") as HTMLElement;
    await userEvent.click(await within(card).findByText("FI general ledger"));
    await waitFor(() => expect(byModule).toHaveBeenCalledWith("fi_gl"));
    expect((await screen.findAllByText("Company code 2000 unused")).length).toBeGreaterThan(0);
  });

  it("labels the impact column with the currency the API sends, never a fixed one", async () => {
    vi.spyOn(api, "getConfigHealth").mockResolvedValue({ run_id: "r1", scores: [] });
    vi.spyOn(api, "getConfigAlignment").mockResolvedValue({ run_id: "r1", currency: "EUR", findings: [{ ...FINDING, estimated_impact_zar: 2500 }] });
    renderWithQuery(<ConfigurationTab systemId="s1" canPropose={false} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Alignment" }));
    expect(await screen.findByRole("columnheader", { name: "Impact (EUR)" })).toBeInTheDocument();
    expect(screen.getAllByText(/EUR[\u00a0 ]?2[,. \u00a0]?500/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ZAR/)).toBeNull();
  });
});
