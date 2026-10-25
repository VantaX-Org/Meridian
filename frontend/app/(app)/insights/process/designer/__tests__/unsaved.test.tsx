// frontend/app/(app)/insights/process/designer/__tests__/unsaved.test.tsx
// Every way off the on-screen draft asks first or keeps the draft: the Versions menu, the model picker and New model.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as designerApi from "@/lib/api/process-designer";
import * as versionsApi from "@/lib/api/versions";
import type { ProcessModelDocument } from "@/types/process-model";
import type { TreeActions } from "../_components/tree";
import ProcessDesigner from "../page";

const h = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: h.replace }),
  usePathname: () => "/insights/process/designer",
  useSearchParams: () => new URLSearchParams("model=m1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
// The editor's heavy parts are stubbed: the tree offers one edit, the Versions menu one pick.
vi.mock("../_components/tree", () => ({
  ProcessTree: ({ actions }: { actions: TreeActions }) => <button type="button" onClick={() => actions.rename("PTP", "Edited")}>Edit the draft</button>,
}));
vi.mock("../_components/versions", () => ({
  VersionsMenu: ({ onPick }: { onPick: (no: number | null) => void }) => <button type="button" onClick={() => onPick(1)}>Open version 1</button>,
  OldVersionBanner: () => null,
}));
vi.mock("../_components/canvas", () => ({ DesignerCanvas: () => null }));
vi.mock("../_components/level-table", () => ({ LevelTable: () => null }));
vi.mock("../_components/attributes", () => ({ AttributeDrawer: () => null }));
vi.mock("../_components/discovered", () => ({ Discovered: () => null, skeletonFrom: (d: ProcessModelDocument) => d }));

const DOC: ProcessModelDocument = { schema_version: 1, l1: [{ id: "PTP", name: "Procure to pay", description: "", order: 1, modules: [], l2: [] }] };
const RECORD = { id: "m1", name: "Mine", current_version: 2 } as unknown as designerApi.ModelWithDocument["model"];

beforeEach(() => {
  vi.restoreAllMocks();
  h.replace = vi.fn();
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
  vi.spyOn(designerApi, "listModels").mockResolvedValue([{ id: "m1", name: "Mine" }, { id: "m2", name: "Other" }] as never);
  vi.spyOn(designerApi, "getModel").mockResolvedValue({ model: RECORD, version_no: 2, document: DOC });
});

const edit = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Edit the draft" }));
  await screen.findByText("Unsaved changes");
};

describe("process designer unsaved edits", () => {
  it("asks before a Versions pick drops the draft, and keeps editing on Keep editing", async () => {
    renderWithQuery(<ProcessDesigner />);
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Open version 1" }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Discard unsaved changes?")).toBeNull());
    expect(h.replace).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("opens the picked version after Discard and open", async () => {
    renderWithQuery(<ProcessDesigner />);
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Open version 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and open" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    expect(String(h.replace.mock.calls.at(-1)![0])).toContain("v=1");
  });

  it("opens a version straight away when nothing is unsaved", async () => {
    renderWithQuery(<ProcessDesigner />);
    fireEvent.click(await screen.findByRole("button", { name: "Open version 1" }));
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(String(h.replace.mock.calls.at(-1)![0])).toContain("v=1");
  });

  it("creates a new model from the on-screen draft, not the last saved version", async () => {
    const create = vi.spyOn(designerApi, "createModel").mockResolvedValue({ model: { ...RECORD, id: "m3" }, version_no: 1 });
    const save = vi.spyOn(designerApi, "saveModel").mockResolvedValue({ model: { ...RECORD, id: "m3" }, version_no: 2, warnings: [] });
    renderWithQuery(<ProcessDesigner />);
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "New model" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Model name" }), { target: { value: "Draft copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Create from this model, with your unsaved edits" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith("Draft copy", "m1");
    const [id, body] = save.mock.calls[0];
    expect(id).toBe("m3");
    expect(body.document.l1[0].name).toBe("Edited");
    expect(body.base_version).toBe(1);
  });
});
