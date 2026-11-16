import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s10 from "@/lib/api/v2/step10";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { PolicyPacks } from "../PolicyPacks";
import { RulesLibrary } from "../RulesLibrary";
import { Rules } from "../Rules";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout(1400, 900);
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

describe("Rules, native", () => {
  it("draws the library and the packs without the legacy frame", async () => {
    setUrl("/more/rules?fixture=1");
    wrap(<Rules />);
    expect(await screen.findByTestId("rules-status-line")).toBeInTheDocument();
    expect(document.querySelector("[data-legacy]")).toBeNull();
    setUrl("/more/rules?tab=packs&fixture=1");
    wrap(<Rules />);
    expect(await screen.findByTestId("policy-packs-screen")).toBeInTheDocument();
  });

  it("the library shows the rules failing the most records and offers export", async () => {
    setUrl("/more/rules?fixture=1");
    wrap(<RulesLibrary />);
    const board = await screen.findByTestId("rule-board");
    expect(within(board).getByRole("heading", { name: "Rules failing the most records" })).toBeInTheDocument();
    expect(within(board).getByTestId("table-export")).toBeInTheDocument();
  });
});

describe("Policy packs, native", () => {
  it("lists every pack with its authority, coverage and whether it is applied", async () => {
    wrap(<PolicyPacks />);
    const list = await screen.findByTestId("policy-packs");
    const sox = within(list).getByTestId("pack-sox");
    expect(norm(sox)).toContain("SOX financial controls");
    expect(norm(sox)).toContain("Sarbanes-Oxley Act of 2002 (United States)");
    expect(norm(within(sox).getByTestId("pack-coverage"))).toContain("Classes breached");
    expect(norm(within(list).getByTestId("pack-gdpr"))).toContain("Not applied since");
    expect(screen.getByText(/2 of 3 packs applied/)).toBeInTheDocument();
  });

  it("applies a pack and asks before removing one", async () => {
    const apply = vi.spyOn(s10, "applyPolicyPack");
    const unapply = vi.spyOn(s10, "unapplyPolicyPack");
    wrap(<PolicyPacks />);
    fireEvent.click(await screen.findByTestId("pack-apply-gdpr"));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("gdpr"));
    fireEvent.click(screen.getByTestId("pack-remove-sox"));
    const dlg = await screen.findByRole("alertdialog", { name: "Remove SOX financial controls" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove the pack" }));
    await waitFor(() => expect(unapply).toHaveBeenCalledWith("sox"));
  });

  it("without manage_rules the packs are read only and say why", async () => {
    h.allowed = ["view"];
    wrap(<PolicyPacks />);
    const sox = await screen.findByTestId("pack-sox");
    expect(within(sox).queryByTestId("pack-remove-sox")).toBeNull();
    expect(within(sox).getByTestId("pack-gate")).toHaveTextContent("Applying or removing a pack needs the manage rules permission.");
  });

  it("without view the packs are not read", () => {
    h.allowed = [];
    wrap(<PolicyPacks />);
    expect(screen.getByText("Reading policy packs needs the view permission.")).toBeInTheDocument();
  });

  it("opens each class with its fields and the evidence of each rule", async () => {
    wrap(<PolicyPacks />);
    const open = await screen.findByTestId("pack-open-sox");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const ev = await screen.findByTestId("pack-evidence-sox");
    const bank = await within(ev).findByTestId("class-vendor_bank");
    expect(norm(bank)).toContain("Vendor bank data");
    expect(norm(bank)).toContain("LFBK-BANKN");
    const table = within(bank).getByRole("table", { name: "Rules evidencing Vendor bank data" });
    expect(norm(table)).toContain("AP039");
    expect(norm(table)).toContain("6 of 12,884");
    expect(within(bank).getByRole("link", { name: "Open the failing records in Work" })).toHaveAttribute("href", expect.stringContaining("policy=sox%3Avendor_bank"));
  });
});
