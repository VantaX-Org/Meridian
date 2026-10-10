import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../../__tests__/render";
import FixPage from "../page";
import { getCleaningQueue, type CleaningQueueItem } from "@/lib/api/cleaning";

const push = vi.fn();
// Stable instance across re-renders: useUrlState's sync effect depends on this
// object's identity (see app/(app)/rules/__tests__/page.test.tsx for the same pattern).
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/fix",
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/api/cleaning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cleaning")>("@/lib/api/cleaning");
  return { ...actual, getCleaningQueue: vi.fn() };
});
vi.mock("@/lib/api/connectivity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/connectivity")>("@/lib/api/connectivity");
  return { ...actual, getSystems: vi.fn().mockResolvedValue([]) };
});
vi.mock("@/lib/api/config-load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/config-load")>("@/lib/api/config-load");
  return { ...actual, getConfigLandscape: vi.fn().mockResolvedValue({ total: 0, loaded: 0, counts: {}, systems: [] }) };
});
vi.mock("@/lib/api/versions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/versions")>("@/lib/api/versions");
  return { ...actual, getVersions: vi.fn().mockResolvedValue({ versions: [] }) };
});
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/api/remediation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/remediation")>("@/lib/api/remediation");
  return { ...actual, listBatches: vi.fn().mockResolvedValue({ items: [] }), getMonitor: vi.fn().mockResolvedValue({ items: [] }) };
});

const item = (over: Partial<CleaningQueueItem>): CleaningQueueItem => ({
  id: "1", object_type: "material_master", status: "recommended", confidence: 0.9,
  record_key: "100001", priority: 1, detected_at: "", applied_at: null,
  rollback_deadline: null, rule_id: null, batch_id: "B1", version_id: null,
  merge_preview: null, record_data_before: null, record_data_after: null,
  golden_record_id: null, golden_field_value: null, golden_record_exists: false,
  ...over,
});

beforeEach(() => {
  push.mockClear();
  vi.mocked(getCleaningQueue).mockReset();
});

describe("FixPage", () => {
  it("shows one row per batch and navigates to the batch on click", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({
      items: [item({}), item({ id: "2", confidence: 0.7 })],
      total: 2, page: 1, per_page: 100,
    });
    renderWithQuery(<FixPage />);

    const cell = await screen.findByText("B1");
    await userEvent.click(cell);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/fix/B1"));
  });

  it("shows an empty state when there are no batches", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    renderWithQuery(<FixPage />);

    expect(await screen.findByText("No cleaning proposals.")).toBeInTheDocument();
  });
});
