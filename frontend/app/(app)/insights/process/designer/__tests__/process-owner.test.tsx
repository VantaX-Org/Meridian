// A process owner (process_analyst: run_process_discovery + export_process, no `analyse` or `export`) models and
// exports in the designer; a viewer does neither. Mirrors api/routes/process_designer.py and process_export.py.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as designerApi from "@/lib/api/process-designer";
import * as versionsApi from "@/lib/api/versions";
import type { ProcessModelDocument } from "@/types/process-model";
import ProcessDesigner from "../page";

const h = vi.hoisted(() => ({ actions: new Set<string>() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/insights/process/designer",
  useSearchParams: () => new URLSearchParams("model=m1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.actions.has(a) }) }));
vi.mock("../_components/tree", () => ({ ProcessTree: () => null }));
vi.mock("../_components/versions", () => ({ VersionsMenu: () => null, OldVersionBanner: () => null }));
vi.mock("../_components/canvas", () => ({ DesignerCanvas: () => null }));
vi.mock("../_components/level-table", () => ({ LevelTable: () => null }));
vi.mock("../_components/attributes", () => ({ AttributeDrawer: () => null }));
vi.mock("../_components/discovered", () => ({ Discovered: () => null, skeletonFrom: (d: ProcessModelDocument) => d }));

const DOC: ProcessModelDocument = { schema_version: 1, l1: [{ id: "PTP", name: "Procure to pay", description: "", order: 1, modules: [], l2: [] }] };
const RECORD = { id: "m1", name: "Mine", current_version: 2 } as unknown as designerApi.ModelWithDocument["model"];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
  vi.spyOn(designerApi, "listModels").mockResolvedValue([{ id: "m1", name: "Mine" }] as never);
  vi.spyOn(designerApi, "getModel").mockResolvedValue({ model: RECORD, version_no: 2, document: DOC });
});

describe("process designer for a process owner", () => {
  it("offers modelling and both exports with run_process_discovery and export_process", async () => {
    h.actions = new Set(["view", "run_process_discovery", "export_process"]);
    renderWithQuery(<ProcessDesigner />);
    expect(await screen.findByRole("button", { name: "New model" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export to Signavio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export to PowerPoint" })).toBeInTheDocument();
  });

  it("offers neither to a viewer", async () => {
    h.actions = new Set(["view"]);
    renderWithQuery(<ProcessDesigner />);
    await screen.findAllByText("Mine");
    expect(screen.queryByRole("button", { name: "New model" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export to Signavio" })).toBeNull();
  });
});
