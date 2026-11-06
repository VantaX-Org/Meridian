import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as promotionApi from "@/lib/api/v2/rule-promotion";
import { resetRulePromotion } from "@/lib/api/v2/fixtures/rulePromotion";
import { RulePromotion, ratePct } from "../screens/RulePromotion";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/rule-promotion");
  resetRulePromotion();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("rule promotion", () => {
  it("says when the generated rules cannot be read", async () => {
    vi.spyOn(promotionApi, "getPromotionModules").mockRejectedValue(new Error("Network Error"));
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    expect(await screen.findByText("The generated rules could not be read.")).toBeInTheDocument();
  });

  it("says when the preview fails and keeps approval away", async () => {
    vi.spyOn(promotionApi, "getPromotionPreview").mockRejectedValue(new Error("Network Error"));
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    fireEvent.click(await screen.findByTestId("promo-preview"));
    expect(await screen.findByText("The rules could not be evaluated.")).toBeInTheDocument();
    expect(screen.queryByTestId("promo-revert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve the top/ })).toBeNull();
  });

  it("lets a viewer preview but not approve or revert", async () => {
    const u = "/rule-promotion?fixture=1&role=viewer";
    window.history.pushState({}, "", u);
    setUrl(u);
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    expect(await screen.findByText("Managing rules needs the manage rules permission.")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("promo-preview"));
    await screen.findByTestId("promo-rules");
    expect(screen.queryByTestId("promo-revert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve the top/ })).toBeNull();
  });

  it("formats a small rate without rounding it to zero", () => {
    expect(ratePct(0.000249)).toBe("0.025%");
    expect(ratePct(0.082555)).toBe("8.3%");
    expect(ratePct(0)).toBe("0.0%");
  });

  it("lists objects, previews with codes beside text, applies, flags drift and reverts", async () => {
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    const objects = await screen.findByTestId("rule-promotion-modules");
    expect(await within(objects).findByTestId("promo-module-material_master")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("promo-preview"));
    const table = await screen.findByTestId("promo-rules");
    // rule id with its description, field with its description
    expect(within(table).getByText("MARA.BRGEW must be filled")).toBeInTheDocument();
    expect(within(table).getByText("Gross weight")).toBeInTheDocument();
    expect(screen.queryByTestId("promo-drift")).toBeNull();
    fireEvent.click(await screen.findByTestId("promo-apply"));
    expect(await screen.findByText("2 rules promoted")).toBeInTheDocument();
    // the promoted rule has since started failing: it is flagged
    fireEvent.click(await screen.findByTestId("promo-preview"));
    expect(await screen.findByTestId("drift-MM_GEN_MARA_BRGEW_NULL")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("promo-revert"));
    expect(await screen.findByText("2 rules reverted")).toBeInTheDocument();
  });

  it("promotes a review rule anyway only with a reason", async () => {
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    fireEvent.click(await screen.findByTestId("promo-preview"));
    fireEvent.click(await screen.findByTestId("promo-chip-review"));
    const row = await screen.findByTestId("promo-rule-MM_GEN_MARA_MATKL_NULL");
    expect(within(row).getByText(/000000000010004211/)).toBeInTheDocument(); // sample keys only
    fireEvent.click(within(row).getByTestId("anyway-MM_GEN_MARA_MATKL_NULL"));
    const confirm = screen.getByTestId("promo-anyway-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("promo-anyway-reason"), { target: { value: "Group is mandatory for finance" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByText("Rule promoted. The reason is in the audit log.")).toBeInTheDocument();
  });
});

describe("stage 5: primary action gating", () => {
  it("makes Preview the filled action before any preview, then Approve once candidates exist", async () => {
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    const preview = await screen.findByTestId("promo-preview");
    expect(preview).toHaveClass("m2-next");
    fireEvent.click(preview);
    const apply = await screen.findByTestId("promo-apply");
    expect(apply).toHaveClass("m2-next");
    expect(apply).toHaveTextContent(/Approve the top candidate/);
    expect(screen.getByTestId("promo-preview")).not.toHaveClass("m2-next");
  });

  it("shows the current step, says what approving does before it runs, and charts the outcomes", async () => {
    renderWithQuery(<ToastProvider><RulePromotion /></ToastProvider>);
    const steps = await screen.findByTestId("promo-steps");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent("Preview on your data");
    expect(screen.queryByTestId("consequence")).toBeNull();
    expect(screen.queryByTestId("promo-buckets")).toBeNull();
    fireEvent.click(screen.getByTestId("promo-preview"));
    await screen.findByTestId("promo-rules");
    expect(screen.getByTestId("promo-steps").querySelector('[aria-current="step"]')).toHaveTextContent("Approve the ready rules");
    expect(screen.getByTestId("consequence")).toHaveTextContent(/Approving switches on 2 rules/);
    expect(screen.getByTestId("consequence")).toHaveTextContent(/Revert switches them off again/);
    expect(screen.getByTestId("promo-buckets")).toBeInTheDocument();
  });
});
