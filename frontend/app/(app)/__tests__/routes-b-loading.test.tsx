import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import apiClient, { longApiClient, uploadApiClient } from "@/lib/api/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams({ run: "r1", id: "x", a: "x", b: "x" }),
  useParams: () => ({ id: "x", batchId: "x" }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
}));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u1", role: "admin" } }) }));
vi.mock("@/context/update-modal-context", () => ({ useUpdateModal: () => ({ open: vi.fn() }) }));
vi.mock("@/design/shell/useDrill", async (orig) => ({ ...(await orig<object>()) }));

const never = () => new Promise<never>(() => {});
beforeAll(() => {
  for (const c of [apiClient, longApiClient, uploadApiClient]) c.defaults.adapter = never;
});

// useDayOne is "ready" above so a skeleton can only come from a pending query. Every wave 10 route. Each must show a designed loading state while its data is pending.
const ROUTES: ReadonlyArray<readonly [string, () => Promise<{ default: ComponentType }>]> = [
  ["/insights", () => import("../insights/page")],
  ["/insights/readiness", () => import("../insights/readiness/page")],
  ["/insights/exec", () => import("../insights/exec/page")],
  ["/insights/impact", () => import("../insights/impact/page")],
  ["/insights/owners", () => import("../insights/owners/page")],
  ["/insights/duplicates", () => import("../insights/duplicates/page")],
  ["/insights/forecast", () => import("../insights/forecast/page")],
  ["/insights/lineage", () => import("../insights/lineage/page")],
  ["/insights/mining", () => import("../insights/mining/page")],
  ["/insights/process", () => import("../insights/process/page")],
  ["/insights/process/designer", () => import("../insights/process/designer/page")],
  ["/mdm/golden", () => import("../mdm/golden/page")],
  ["/mdm/golden/[id]", () => import("../mdm/golden/[id]/page")],
  ["/mdm/golden/merge", () => import("../mdm/golden/merge/page")],
  ["/mdm/glossary", () => import("../mdm/glossary/page")],
  ["/mdm/glossary/[id]", () => import("../mdm/glossary/[id]/page")],
  ["/mdm/match-rules", () => import("../mdm/match-rules/page")],
  ["/inbox", () => import("../inbox/page")],
  ["/fix", () => import("../fix/page")],
  ["/fix/proposals/[runId]", () => import("../fix/proposals/[runId]/page")],
  ["/admin/ai", () => import("../admin/ai/page")],
  ["/admin/billing", () => import("../admin/billing/page")],
  ["/admin/licence", () => import("../admin/licence/page")],
  ["/admin/mappings", () => import("../admin/mappings/page")],
  ["/admin/settings", () => import("../admin/settings/page")],
  ["/admin/triage", () => import("../admin/triage/page")],
  ["/admin/users", () => import("../admin/users/page")],
];

describe("wave 10 loading skeletons", () => {
  it.each(ROUTES)("%s shows a skeleton while data loads", async (_path, load) => {
    const { default: Page } = await load();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><Page /></QueryClientProvider>);
    expect(container.querySelector('[aria-busy="true"], [data-state="loading"], .m-skeleton-sweep')).not.toBeNull();
  });
});
