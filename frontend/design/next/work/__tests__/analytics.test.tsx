import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import * as wa from "@/lib/api/v2/work-analytics";
import { ToastProvider } from "../../kit";
import { WorkAnalytics } from "../Analytics";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.history.pushState({}, "", "/next/work/analytics?fixture=1");
  setUrl("/next/work/analytics?fixture=1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});

const page = () => renderWithQuery(<ToastProvider><WorkAnalytics /></ToastProvider>);
const forbidden = () => Object.assign(new Error("403"), { isAxiosError: true, response: { status: 403 } });

describe("Work analytics", () => {
  it("renders the banner, the trend and every panel from the fixture", async () => {
    page();
    expect(await screen.findByTestId("wa-banner")).toBeTruthy();
    for (const id of ["wa-burndown", "wa-run-change", "wa-time-to-fix", "wa-throughput", "wa-cleaning-pace", "wa-recurrence", "wa-root-causes", "wa-proposals", "wa-rule-feedback"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it("shows the run change with the newly failing and recovered rules", async () => {
    page();
    const panel = await screen.findByTestId("wa-run-change");
    expect(await within(panel).findAllByText("MM302")).not.toHaveLength(0);
    expect(within(panel).getAllByText("MM023")).not.toHaveLength(0);
  });

  it("shows the whole-page dash when the role cannot read the burndown", async () => {
    vi.spyOn(wa, "getBurndown").mockRejectedValue(forbidden());
    page();
    expect(await screen.findByText("Your role cannot read the work analytics.")).toBeTruthy();
    expect(screen.queryByTestId("wa-banner")).toBeNull();
  });

  it("shows a dash in one panel when the role cannot read that list", async () => {
    vi.spyOn(wa, "getRecurrence").mockRejectedValue(forbidden());
    page();
    const panel = await screen.findByTestId("wa-recurrence");
    expect(await within(panel).findByTestId("wa-dash")).toBeTruthy();
    expect(screen.getByTestId("wa-run-change")).toBeTruthy();
  });
});
