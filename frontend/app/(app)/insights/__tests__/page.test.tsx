// frontend/app/(app)/insights/__tests__/page.test.tsx
// The Insights overview repeated Home and was retired: /insights opens the viewer's home, an old ?run= link that run's
// page and an old ?severity= drill Fix work's critical and high records.
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InsightsOverviewRedirect from "../page";
import { insightsOverviewTarget } from "../_components/overviewTarget";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), role: "admin", can: (() => true) as (a: string) => boolean, loading: false }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, prefetch: vi.fn() }),
  usePathname: () => "/insights",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ homeRole: nav.role, can: nav.can, loading: nav.loading }) }));

afterEach(() => {
  nav.query = "";
  nav.role = "admin";
  nav.can = () => true;
  nav.loading = false;
  nav.replace.mockClear();
});

describe("insightsOverviewTarget", () => {
  it("sends a run to its page, a severity drill to Fix work, and anything else home", () => {
    expect(insightsOverviewTarget(new URLSearchParams("run=co1"))).toBe("/runs/co1");
    expect(insightsOverviewTarget(new URLSearchParams("severity=critical,high"))).toBe("/fix?sev=blocking");
    expect(insightsOverviewTarget(new URLSearchParams("severity=critical"))).toBe("/fix?sev=critical");
    expect(insightsOverviewTarget(new URLSearchParams(""))).toBeNull();
    expect(insightsOverviewTarget(new URLSearchParams("module=material_master"))).toBeNull();
  });
});

describe("/insights", () => {
  it("opens the lead's home for an admin", async () => {
    render(<InsightsOverviewRedirect />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/home/lead"));
  });

  it("opens each role's own home: SAP Basis lands on its home, the data owner on Approvals", async () => {
    nav.role = "sap_basis";
    const { unmount } = render(<InsightsOverviewRedirect />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/home/basis"));
    unmount();
    nav.role = "data_owner";
    nav.can = (a) => a === "approve" || a === "view";
    render(<InsightsOverviewRedirect />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/inbox?kind=approvals"));
  });

  it("waits for the role before choosing a home", () => {
    nav.loading = true;
    render(<InsightsOverviewRedirect />);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("keeps an old ?run= link working: it opens that run", async () => {
    nav.query = "run=v1";
    render(<InsightsOverviewRedirect />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/runs/v1"));
  });
});
