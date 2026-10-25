import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as download from "@/lib/api/download";
import * as discovery from "@/lib/api/process-discovery";
import { ExportDialog } from "../_components/export-dialog";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function mount() {
  return renderWithQuery(<ExportDialog open onOpenChange={() => {}} runId="r1" l1="PTP" node={null} nodeName="PTP" filters={{}} />);
}

beforeEach(() => vi.restoreAllMocks());

describe("process ExportDialog", () => {
  it("exports the Signavio package by default", async () => {
    const signavio = vi.spyOn(discovery, "exportRun").mockResolvedValue();
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(signavio).toHaveBeenCalledWith("r1", "PTP", {}, undefined));
  });

  it("offers PowerPoint next to Signavio and downloads the reference deck", async () => {
    const pptx = vi.spyOn(download, "downloadAuthenticated").mockResolvedValue();
    const signavio = vi.spyOn(discovery, "exportRun").mockResolvedValue();
    mount();
    await userEvent.click(screen.getByLabelText("Reference model deck (.pptx)"));
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(pptx).toHaveBeenCalledWith("/api/v1/process-designer/reference/export/pptx", "meridian-PTP-reference.pptx"));
    expect(signavio).not.toHaveBeenCalled();
  });
});
