import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetCleaningFixture } from "@/lib/api/v2/fixtures/cleaning";
import type { SafetyItem } from "@/lib/api/v2/cleaning";
import { Cleansing, worstVerdict } from "../screens/Cleansing";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  resetCleaningFixture();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/cleansing");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("cleansing safety", () => {
  it("totals the verdicts and shows the SAP dictionary evidence for a value SAP would reject", async () => {
    renderWithQuery(<Cleansing />);
    const banner = await screen.findByTestId("cleansing-safety-banner");
    expect(banner.textContent).toContain("6 of 9 new values are safe to apply, 1 would be rejected by SAP, 2 not checked.");
    const rows = within(screen.getByTestId("cleansing-safety")).getAllByTestId("cleansing-safety-cq-2005");
    const bad = rows.find((r) => r.textContent?.includes("GR"));
    expect(bad?.textContent).toContain("SAP would reject it");
    expect(within(bad as HTMLElement).getByTestId("ddic-nearest").textContent).toContain("KG");
    expect(within(bad as HTMLElement).getByTestId("ddic-card").textContent).toContain("check table T006, SAP-standard values");
  });

  it("takes the worst verdict over a proposal's values", () => {
    const item = (verdict: SafetyItem["verdict"]): SafetyItem => ({ id: "p", record_key: null, object_type: null, field: null, value: null, verdict, reasons: [] });
    expect(worstVerdict([item("safe"), item("reject")], "p")).toBe("reject");
    expect(worstVerdict([item("safe"), item("unknown")], "p")).toBe("unknown");
    expect(worstVerdict([item("safe")], "p")).toBe("safe");
    expect(worstVerdict([item("safe")], "other")).toBeNull();
  });
});
