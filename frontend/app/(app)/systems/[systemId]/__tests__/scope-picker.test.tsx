import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { ScopePicker } from "../scope-picker";
import * as systemObjectsApi from "@/lib/api/system-objects";
import type { SystemObject } from "@/lib/api/system-objects";

const object = (over: Partial<SystemObject> = {}): SystemObject => ({
  object: "material_master",
  tables: ["MARA", "MARC"],
  config_tables: [],
  scope_filters: [],
  date_window: [],
  last_download: null,
  ...over,
});

describe("ScopePicker exclude-deleted scope (#exclude_deleted)", () => {
  it("defaults off and only puts exclude_deleted in the payload once checked", async () => {
    vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({ system_type: "ecc", objects: [object()] });
    const startDownload = vi.spyOn(systemObjectsApi, "startDownload").mockResolvedValue({ job_id: "dl-1", status: "queued" });

    renderWithQuery(<ScopePicker id="sys1" onDownloaded={vi.fn()} />);

    const row = await screen.findByText("Material Master");
    fireEvent.click(row);

    const checkbox = await screen.findByRole("checkbox", { name: "Skip records flagged for deletion" });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByText("Extract 1 object"));
    fireEvent.click(await screen.findByText("Confirm"));
    await waitFor(() =>
      expect(startDownload).toHaveBeenCalledWith("sys1", expect.objectContaining({ scope: {} })),
    );

    // onSuccess clears the selection; re-pick the object before the second extraction.
    fireEvent.click(await screen.findByText("Material Master"));
    const checkboxAgain = await screen.findByRole("checkbox", { name: "Skip records flagged for deletion" });
    fireEvent.click(checkboxAgain);
    expect(checkboxAgain).toBeChecked();
    fireEvent.click(screen.getByText("Extract 1 object"));
    fireEvent.click(await screen.findByText("Confirm"));
    await waitFor(() =>
      expect(startDownload).toHaveBeenLastCalledWith(
        "sys1",
        expect.objectContaining({ scope: { exclude_deleted: true } }),
      ),
    );
  });
});
