// frontend/app/(app)/insights/process/designer/__tests__/overlay-runs.test.tsx
// The designer shows the data the readiness page shows: each object of the model from its own latest run, not one
// run that may not cover the model's objects. The No-go and At risk tiles and the table agree, in one row of tiles.
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as designerApi from "@/lib/api/process-designer";
import type { ModelOverlay, ProcessModelDocument } from "@/types/process-model";
import ProcessDesigner from "../page";

const h = vi.hoisted(() => ({ search: "model=m1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/insights/process/designer",
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/components/process/shared", async (orig) => ({
  ...(await orig<typeof import("@/components/process/shared")>()),
  useLatestVersion: () => ({ latest: { id: "run-new", run_at: "2026-10-20T00:00:00Z", dqs_summary: {} }, isLoading: false, error: null, refetch: vi.fn() }),
  useFindingHref: () => () => undefined,
}));
vi.mock("../../../_components/useCurrentState", () => ({
  useCurrentState: () => ({
    objects: [{ module: "accounts_payable", run: { id: "run-ap" } }, { module: "material_master", run: { id: "run-new" } }],
    loading: false, error: null, runs: [], finished: [], newest: undefined, modules: null, refetch: vi.fn(),
  }),
}));
vi.mock("../_components/tree", () => ({ ProcessTree: () => null }));
vi.mock("../_components/versions", () => ({ VersionsMenu: () => null, OldVersionBanner: () => null }));
vi.mock("../_components/canvas", () => ({ DesignerCanvas: () => null }));
vi.mock("../_components/attributes", () => ({ AttributeDrawer: () => null }));
vi.mock("../_components/discovered", () => ({ Discovered: () => null, skeletonFrom: (d: ProcessModelDocument) => d }));

const act = (id: string) => ({ id, name: id });
const DOC = {
  schema_version: 1,
  l1: [{
    id: "PTP", name: "Procure to pay", description: "", order: 0, modules: ["accounts_payable", "material_master"],
    l2: [{ id: "L2", name: "Buy", description: "", order: 0, l3: [{ id: "L3", name: "Order", description: "", order: 0, l4: [{
      id: "L4", name: "Create PO", description: "", order: 0, tcode: null, config_dependency: null, diagram: {}, variants: [],
      activities: [act("a1"), act("a2")],
    }] }] }],
  }],
} as unknown as ProcessModelDocument;
const RECORD = { id: "m1", name: "Mine", current_version: 1 } as unknown as designerApi.ModelWithDocument["model"];
const status = (dq_status: "green" | "amber" | "red") => ({ dq_status, pass_rate: null, affected_count: 0, finding_count: 0 });
const overlayOf = (a1: "green" | "amber" | "red", a2: "green" | "amber" | "red"): ModelOverlay => ({ activities: { a1: status(a1), a2: status(a2) }, l4: {}, variants: [] });

beforeEach(() => {
  vi.restoreAllMocks();
  h.search = "model=m1";
  vi.spyOn(designerApi, "listModels").mockResolvedValue([{ id: "m1", name: "Mine" }] as never);
  vi.spyOn(designerApi, "getModel").mockResolvedValue({ model: RECORD, version_no: 1, document: DOC });
  vi.spyOn(designerApi, "listVariants").mockResolvedValue([]);
});

const tile = (label: string) => within(screen.getByTestId("designer-stats")).getByText(label).closest(".m-stat") as HTMLElement;

describe("process designer data", () => {
  it("reads the model's objects from their own latest runs and shows the worst colour of each step", async () => {
    const overlay = vi.spyOn(designerApi, "getOverlay").mockImplementation(async (_m, run) => (run === "run-ap" ? overlayOf("red", "green") : overlayOf("green", "amber")));
    renderWithQuery(<ProcessDesigner />);
    await waitFor(() => expect(within(tile("No-go")).getByText("1")).toBeInTheDocument());
    expect(overlay).toHaveBeenCalledWith("m1", "run-ap");
    expect(within(tile("At risk")).getByText("1")).toBeInTheDocument();
  });

  it("reads only the chosen run when ?run= is given", async () => {
    h.search = "model=m1&run=run-new";
    const overlay = vi.spyOn(designerApi, "getOverlay").mockResolvedValue(overlayOf("green", "green"));
    renderWithQuery(<ProcessDesigner />);
    await waitFor(() => expect(overlay).toHaveBeenCalled());
    expect(overlay.mock.calls.every(([, run]) => run === "run-new")).toBe(true);
  });

  it("puts the five tiles in one row and counts the same in the table", async () => {
    vi.spyOn(designerApi, "getOverlay").mockResolvedValue(overlayOf("red", "green"));
    renderWithQuery(<ProcessDesigner />);
    const tiles = await screen.findByTestId("designer-stats");
    expect(tiles).toHaveClass("m-stat-grid");
    expect(tiles.children).toHaveLength(5);
    await waitFor(() => expect(within(tile("No-go")).getByText("1")).toBeInTheDocument());
    const row = screen.getByRole("button", { name: "Procure to pay" }).closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent).slice(1, 4)).toEqual(["2", "1", "0"]);
  });
});
