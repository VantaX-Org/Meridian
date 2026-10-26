// frontend/app/(app)/insights/process/designer/__tests__/rename-delete.test.tsx
// Rename and delete of the open model: both behind `analyse`, both confirmed, delete by typing the name.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as designerApi from "@/lib/api/process-designer";
import * as versionsApi from "@/lib/api/versions";
import type { ProcessModelDocument } from "@/types/process-model";
import ProcessDesigner from "../page";

const h = vi.hoisted(() => ({ replace: vi.fn(), can: (action: string): boolean => action.length > 0, model: "m1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: h.replace }),
  usePathname: () => "/insights/process/designer",
  useSearchParams: () => new URLSearchParams(`model=${h.model}`),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.can(a) }) }));
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
  h.replace = vi.fn();
  h.can = (): boolean => true;
  h.model = "m1";
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
  vi.spyOn(designerApi, "listModels").mockResolvedValue([{ id: "m1", name: "Mine" }, { id: "m2", name: "Other" }] as never);
  vi.spyOn(designerApi, "getModel").mockResolvedValue({ model: RECORD, version_no: 2, document: DOC });
  vi.spyOn(designerApi, "getReference").mockResolvedValue(DOC);
});

describe("process designer rename and delete", () => {
  it("renames the open model after the confirm", async () => {
    const patch = vi.spyOn(designerApi, "patchModel").mockResolvedValue({ ...RECORD, name: "Procure plan" });
    renderWithQuery(<ProcessDesigner />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save name" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Procure plan" } });
    fireEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledWith("m1", { name: "Procure plan" }));
  });

  it("deletes the open model once its name is typed, then opens the reference model", async () => {
    const del = vi.spyOn(designerApi, "deleteModel").mockResolvedValue();
    renderWithQuery(<ProcessDesigner />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete model" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Type to confirm"), { target: { value: "Mine" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(del).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(String(h.replace.mock.calls.at(-1)?.[0])).toContain("model=reference"));
  });

  it("offers neither without analyse, nor on the reference model", async () => {
    h.can = (a) => a !== "analyse";
    const { unmount } = renderWithQuery(<ProcessDesigner />);
    await screen.findByText(/Version 2 of 2/);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    unmount();
    h.can = () => true;
    h.model = "reference";
    renderWithQuery(<ProcessDesigner />);
    await screen.findByText(/reference model is read-only/);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
