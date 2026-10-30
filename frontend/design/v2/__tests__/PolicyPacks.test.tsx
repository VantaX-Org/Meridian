import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s10 from "@/lib/api/v2/step10";
import type { Landscape, WorkPage } from "@/lib/api/v2/types";
import { visibleSections } from "@/lib/v2/admin-sections";
import { policyLabel, policyMark } from "@/lib/v2/step10";
import { Inspector } from "../Inspector";
import { AdminCanvas } from "../admin/Admin";
import { resetKeptOutcomes } from "../inspector/shared";
import { ObjectFrame, RulesTab } from "../screens/Object";
import { WorkCanvas } from "../screens/Work";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetKeptOutcomes();
  undo = stubLayout(1400, 600);
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const page = (open = "") => {
  setUrl(`/admin/policypacks?fixture=1${open ? `&open=${open}` : ""}`);
  return renderWithQuery(
    <>
      <AdminCanvas section="policypacks" />
      <Inspector />
    </>,
  );
};

describe("Admin, Policy packs", () => {
  it("is a section anyone with view reads, under Data", () => {
    const s = visibleSections((a) => a === "view").find((x) => x.slug === "policypacks");
    expect(s?.label).toBe("Policy packs");
    expect(visibleSections(() => false).some((x) => x.slug === "policypacks")).toBe(false);
  });

  it("lists every pack with its authority, coverage and whether it is applied", async () => {
    page();
    const list = await screen.findByTestId("policy-packs");
    const sox = within(list).getByTestId("pack-sox");
    expect(norm(sox)).toContain("SOX financial controls");
    expect(norm(sox)).toContain("Sarbanes-Oxley Act of 2002 (United States)");
    expect(norm(sox)).toContain("Applied 5 Oct 2026 by R. Govender");
    expect(within(sox).getByTestId("policy-mark")).toHaveAttribute("aria-label", expect.stringContaining("4 policy classes breached"));
    const cov = within(sox).getByTestId("pack-coverage");
    expect(norm(cov)).toContain("Classes breached4");
    expect(norm(within(list).getByTestId("pack-gdpr"))).toContain("Not applied since 20 Sept 2026");
    expect(screen.getByText(/2 of 3 packs applied/)).toBeInTheDocument();
  });

  it("applies a pack with manage_rules and asks before removing one", async () => {
    const apply = vi.spyOn(s10, "applyPolicyPack");
    const unapply = vi.spyOn(s10, "unapplyPolicyPack");
    page();
    const gdpr = await screen.findByTestId("pack-gdpr");
    fireEvent.click(within(gdpr).getByRole("button", { name: "Apply the pack" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("gdpr"));
    expect(await within(gdpr).findByText("GDPR personal data applied")).toBeInTheDocument();
    await waitFor(() => expect(norm(screen.getByTestId("pack-gdpr"))).toContain("Applied"));
    const sox = screen.getByTestId("pack-sox");
    fireEvent.click(within(sox).getByRole("button", { name: "Remove the pack" }));
    const dlg = await screen.findByRole("dialog", { name: "Remove SOX financial controls" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove the pack" }));
    await waitFor(() => expect(unapply).toHaveBeenCalledWith("sox"));
  });

  it("without manage_rules the packs are read only and say why", async () => {
    h.allowed = ["view"];
    page();
    const sox = await screen.findByTestId("pack-sox");
    expect(within(sox).queryByRole("button", { name: "Remove the pack" })).toBeNull();
    expect(within(sox).getByText("Applying or removing a pack needs the manage rules permission.")).toBeInTheDocument();
  });

  it("the pack inspector shows each class with its authority, fields and the evidence of each rule, now or at a run", async () => {
    page("policypack:sox");
    const insp = await screen.findByTestId("inspector");
    const classes = await within(insp).findByTestId("pack-classes");
    const bank = within(classes).getByTestId("class-vendor_bank");
    expect(norm(bank)).toContain("Vendor bank data");
    expect(norm(bank)).toContain("Breached");
    expect(norm(bank)).toContain("SOX Section 404(a) (controls over changes to vendor payment data)");
    expect(norm(bank)).toContain("LFBK.BANKN");
    const table = within(bank).getByRole("table", { name: "Rules evidencing Vendor bank data" });
    expect(norm(table)).toContain("AP039");
    expect(norm(table)).toContain("6 of 12,884");
    expect(within(bank).getByRole("link", { name: "Open the failing records in Work" })).toHaveAttribute("href", expect.stringContaining("policy=sox%3Avendor_bank"));
    const spy = vi.spyOn(s10, "getPolicyEvidence");
    fireEvent.change(within(insp).getByLabelText("Evidence of"), { target: { value: "b0600000-0000-4000-8000-000000000006" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("sox", "b0600000-0000-4000-8000-000000000006"));
    expect(norm(within(classes).getByTestId("class-gl_master"))).toContain("10 of 4,216");
    await waitFor(() => expect(norm(within(insp).getByTestId("class-gl_master"))).toContain("11 of 4,216"));
  });
});

describe("policy breaches on the cell, the ruler and the receipt", () => {
  it("the landscape cells carry policy_breaches for the applied packs, and the mark says it in words", () => {
    const l = fixtureResponse<Landscape>("/landscape", {});
    const mm = l.cells.find((c) => c.module === "material_master");
    expect(mm?.policy_breaches).toBe(1);
    expect(l.cells.find((c) => c.module === "fi_gl")?.policy_breaches).toBe(1);
    expect(l.cells.find((c) => c.module === "quality_management")?.policy_breaches).toBe(0);
    expect(policyMark(mm)?.title).toBe("1 policy class breached: a critical rule evidencing an applied policy pack fails");
    expect(policyMark({ policy_breaches: 0 })).toBeNull();
  });

  it("the object's ruler has the shield beside the contract diamond and the receipt names the breached classes", async () => {
    setUrl("/o/ecc-production/material-master?fixture=1");
    renderWithQuery(
      <ObjectFrame system="ecc-production" module="material-master">
        <RulesTab system="ecc-production" module="material-master" />
      </ObjectFrame>,
    );
    const block = await screen.findByTestId("receipt-policy");
    expect(norm(block)).toContain("Inventory valuation");
    expect(norm(block)).toContain("SOX Section 404(a) (controls over inventory valuation and stock account determination)");
    expect(within(block).getByRole("link", { name: "MM035" })).toBeInTheDocument();
    const marks = screen.getAllByTestId("policy-mark");
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".m2-ruler-box-lg [data-testid='policy-mark']")).not.toBeNull();
  });
});

describe("the Policy chip on the Work ledger", () => {
  it("reads policy= from the address, lists only the records failing a rule of the class, and says the filter in words", async () => {
    const rows = fixtureResponse<WorkPage>("/work/records", { policy: "sox:inventory_valuation", scope: "current", status: "open" });
    expect(rows.items.length).toBeGreaterThan(0);
    expect(rows.items.every((r) => r.checks.includes("MM035"))).toBe(true);
    setUrl("/work?fixture=1&policy=sox:inventory_valuation&filter=open");
    renderWithQuery(
      <ToastProvider>
        <WorkCanvas />
      </ToastProvider>,
    );
    const tags = await screen.findByRole("list", { name: "Filters in force" });
    await waitFor(() => expect(norm(tags)).toContain("Policy: Inventory valuation (SOX financial controls)"));
    const grid = await screen.findByRole("grid", { name: "Work ledger" });
    await waitFor(() => expect(within(grid).getAllByText("MM035").length).toBe(rows.items.length));
    expect(screen.getByRole("button", { name: "By rule" })).toBeDisabled();
  });

  it("the chip's menu lists the applied packs and their classes", async () => {
    setUrl("/work?fixture=1");
    renderWithQuery(
      <ToastProvider>
        <WorkCanvas />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Policy" }));
    const menu = await screen.findByRole("menu", { name: "Policy" });
    await waitFor(() => expect(within(menu).getByRole("menuitemradio", { name: /Vendor bank data/ })).toBeInTheDocument());
    expect(within(menu).queryByRole("menuitemradio", { name: /Identity of natural persons/ })).toBeNull(); // GDPR is not applied
    expect(policyLabel("sox", [])).toBe("sox");
  });
});
