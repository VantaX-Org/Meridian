import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { resetRulePromotion } from "@/lib/api/v2/fixtures/rulePromotion";
import { ToastProvider } from "../../kit";
import { RulePromotion, ratePct } from "../sections/promotion";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
const go = (u: string) => { window.history.pushState({}, "", u); setUrl(u); };
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  go("/more/admin/flow/rules?fixture=1");
  resetRulePromotion();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});
const view = () => renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);

describe("native rule promotion", () => {
  it("renders the fixture objects and previews rules with codes beside text", async () => {
    view();
    const objects = await screen.findByTestId("rule-promotion-modules");
    expect(await within(objects).findByTestId("promo-module-material_master")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("promo-preview"));
    const table = await screen.findByTestId("promo-rules");
    expect(within(table).getByText("MARA.BRGEW must be filled")).toBeInTheDocument();
    expect(within(table).getByText("Gross weight")).toBeInTheDocument();
    expect(screen.getByTestId("consequence")).toHaveTextContent(/Approving switches on 2 rules/);
  });

  it("approves the ready rules, flags drift and reverts", async () => {
    view();
    fireEvent.click(await screen.findByTestId("promo-preview"));
    fireEvent.click(await screen.findByTestId("promo-apply"));
    expect(await screen.findByText("2 rules promoted")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("promo-preview"));
    expect(await screen.findByTestId("drift-MM_GEN_MARA_BRGEW_NULL")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("promo-revert"));
    expect(await screen.findByText("2 rules reverted")).toBeInTheDocument();
  });

  it("promotes a review rule anyway only with a reason", async () => {
    view();
    fireEvent.click(await screen.findByTestId("promo-preview"));
    fireEvent.click(await screen.findByTestId("promo-chip-review"));
    await screen.findByTestId("promo-rule-MM_GEN_MARA_MATKL_NULL");
    expect(screen.getByText(/000000000010004211/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("anyway-MM_GEN_MARA_MATKL_NULL"));
    const confirm = screen.getByTestId("promo-anyway-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByTestId("promo-anyway-reason"), { target: { value: "Group is mandatory for finance" } });
    expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirm);
    expect(await screen.findByText("Rule promoted. The reason is in the audit log.")).toBeInTheDocument();
  });

  it("lets a viewer preview but not approve or revert", async () => {
    go("/more/admin/flow/rules?fixture=1&role=viewer");
    view();
    expect(await screen.findByText("Managing rules needs the manage rules permission.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("promo-preview"));
    await screen.findByTestId("promo-rules");
    expect(screen.queryByTestId("promo-apply")).toBeNull();
    expect(screen.queryByTestId("promo-revert")).toBeNull();
    expect(screen.queryByTestId("anyway-MM_GEN_MARA_MATKL_NULL")).toBeNull();
  });

  it("formats a small rate without rounding it to zero", () => {
    expect(ratePct(0.000249)).toBe("0.025%");
    expect(ratePct(0)).toBe("0.0%");
  });
});
