// frontend/app/(app)/process/__tests__/breadcrumb-system.test.tsx
// The breadcrumb parents of a process and of a discovery run keep the system they were opened on.
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as designerApi from "@/lib/api/process-designer";
import * as pdApi from "@/lib/api/process-discovery";
import type { CatalogueRow, DiscoveryRunDetail } from "@/lib/api/process-discovery";
import type { SAPSystemExtended } from "@/types/api";
import type { ProcessModelDocument } from "@/types/process-model";

const h = vi.hoisted(() => ({ params: {} as Record<string, string>, crumbs: [] as unknown[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/process",
  useSearchParams: () => new URLSearchParams("system=sys-2"),
  useParams: () => h.params,
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-jobs", () => ({ useJobs: () => ({ jobs: [], active: [] }) }));
vi.mock("@/design", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/design")>();
  return { ...m, useBreadcrumbTitle: (t: unknown) => { h.crumbs.push(t); } };
});

const SYSTEMS = [
  { id: "sys-1", name: "KSA PRD", system_type: "S4HANA" },
  { id: "sys-2", name: "UAE PRD", system_type: "S4HANA" },
] as unknown as SAPSystemExtended[];
const ROW: CatalogueRow = {
  l1: "PTP", name: "Procure to Pay", coverage: "reference", reason: null, sources: [], last_run: null, in_progress: null, failed: null,
};
const DOC: ProcessModelDocument = { schema_version: 1, l1: [{ id: "PTP", name: "Procure to Pay", description: "", order: 1, modules: [], l2: [] }] };
const RUN: DiscoveryRunDetail = {
  id: "run-9", l1: "PTP", mode: "full", status: "failed", coverage: "discovered", window_from: null, window_to: null,
  watermark: null, extraction_version_id: null, job_id: null, filters: {}, error: "boom",
  started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:10:00Z", system_id: "sys-2", system_type: "S4HANA",
  stats: { cases: 0, variants: 0, case_types: {}, rework: {}, conformance: { fitness: null, missing: {}, out_of_order: {} },
    throughput: { median_seconds: null, p90_seconds: null } },
} as unknown as DiscoveryRunDetail;

type Crumb = { label: string; parent: { label: string; href: string } } | null;
const lastCrumb = () => h.crumbs.filter(Boolean).at(-1) as Crumb;

beforeEach(() => {
  vi.restoreAllMocks();
  h.crumbs = [];
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue(SYSTEMS);
  vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([ROW]);
  vi.spyOn(pdApi, "getRun").mockResolvedValue(RUN);
  vi.spyOn(designerApi, "getReference").mockResolvedValue(DOC);
});

describe("process breadcrumbs keep the system", () => {
  it("a process page's parent is the catalogue of its system", async () => {
    h.params = { l1: "PTP" };
    const { default: Page } = await import("../[l1]/page");
    renderWithQuery(<Page />);
    await waitFor(() => expect(lastCrumb()?.parent.href).toBe("/process?system=sys-2"));
  });

  it("a discovery run's parent is the runs list of the run's system", async () => {
    h.params = { runId: "run-9" };
    const { default: Page } = await import("../runs/[runId]/page");
    renderWithQuery(<Page />);
    await waitFor(() => expect(lastCrumb()?.parent.href).toBe("/process/runs?system=sys-2"));
  });
});
