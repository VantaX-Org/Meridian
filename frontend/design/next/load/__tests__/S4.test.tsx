import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/s4";
import { S4 } from "../S4";
import { setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/load/s4?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("load, S/4HANA readiness", () => {
  it("names the blocking rules and lists failing rules, blocking first", async () => {
    renderWithQuery(<S4 />);
    expect((await screen.findByTestId("s4-banner")).textContent).toMatch(/2 blocking rules stand in the way/);
    const blockers = await screen.findByTestId("s4-blockers");
    expect(blockers.textContent).toMatch(/S4R-BP-KNVK-NAME/);
    expect(within(screen.getByTestId("s4-areas")).getAllByText(/SAP Note 2265093/).length).toBeGreaterThan(0);
  });

  it("never says ready while blocking rules were not evaluated", async () => {
    vi.spyOn(api, "getS4Readiness").mockResolvedValue({
      version_id: null, status: "green", ready: false, assessment: "incomplete", rules: 24, evaluated: 3, failing: 0,
      failing_records: 0, blocking_failing: 0, warning_failing: 0, blocking_rules: 6, blocking_evaluated: 2,
      blocking_unevaluated: 4, areas: [],
    } as unknown as Awaited<ReturnType<typeof api.getS4Readiness>>);
    renderWithQuery(<S4 />);
    const banner = (await screen.findByTestId("s4-banner")).textContent ?? "";
    expect(banner).toMatch(/Not fully assessed: 4 blocking rules not evaluated/);
    expect(banner).not.toMatch(/Ready to convert/);
  });

  it("tells a role without access that it cannot read the readiness", async () => {
    vi.spyOn(api, "getS4Readiness").mockRejectedValue({ response: { status: 403 } });
    renderWithQuery(<S4 />);
    expect(await screen.findByText("Your role cannot read the S/4HANA readiness.")).toBeInTheDocument();
  });
});
