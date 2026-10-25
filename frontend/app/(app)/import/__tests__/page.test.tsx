import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as versionsApi from "@/lib/api/versions";
import * as uploadApi from "@/lib/api/upload";
import * as fieldMappingsApi from "@/lib/api/field-mappings";
import * as preview from "@/lib/upload-preview";
import type { SAPSystemExtended } from "@/types/api";
import type { Version } from "@/types/api";
import ImportPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const VERSION: Version = {
  id: "v1", run_at: "2026-01-01T00:00:00Z", label: null, status: "complete",
  dqs_summary: null, metadata: { modules: ["business_partner"], file_name: "vendors.csv", row_count: 10 },
} as Version;

describe("import page", () => {
  it("renders recent imports once loaded", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [VERSION] });
    renderWithQuery(<ImportPage />);
    await waitFor(() => expect(screen.getByText("vendors.csv")).toBeInTheDocument());
  });

  it("shows an empty state when nothing has been imported", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<ImportPage />);
    await waitFor(() => expect(screen.getByText(/No imports yet/)).toBeInTheDocument());
  });
});

describe("import page errors", () => {
  it("says why recent imports could not load and offers a retry", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockRejectedValue(new Error("down"));
    renderWithQuery(<ImportPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No imports yet/)).toBeNull();
  });
});

describe("import attached to a system", () => {
  it("sends the picked system with the file so the run joins its lineage", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "sys-1", name: "ECC production" } as SAPSystemExtended]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(preview, "readHeaderSample").mockResolvedValue({ headers: ["PARTNER"], sample: [["1"]] });
    vi.spyOn(fieldMappingsApi, "getModuleFieldMappings").mockRejectedValue(new Error("none"));
    vi.spyOn(uploadApi, "matchColumns").mockResolvedValue({
      detected_module: "business_partner", module_confidence: 0.9, module_label: "Business partner",
      mappings: [{ source_column: "PARTNER", target_field: "BUT000.PARTNER", confidence: 0.95, is_required: true, match_type: "exact" }],
      unmapped_required: [], available_modules: [{ value: "business_partner", label: "Business partner" }],
    });
    const upload = vi.spyOn(uploadApi, "uploadFile").mockResolvedValue({ version_id: "v9", job_id: "j9", status: "pending" });
    vi.spyOn(uploadApi, "pollAnalysisStatus").mockResolvedValue({
      task_id: "j9", status: "completed", progress: { current_step: "complete", step_number: 5, total_steps: 5, rows_processed: 1, total_rows: 1, percent_complete: 100 },
      result: null, error: null, db_status: "complete",
    });
    const { container } = renderWithQuery(<ImportPage />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["PARTNER\n1\n"], "partners.csv", { type: "text/csv" })] } });

    const user = userEvent.setup();
    const picker = await screen.findByRole("combobox", { name: "System" });
    expect(picker).toHaveTextContent("No system: a one-off file");
    expect(screen.getByText("Attach the file to a system so its runs compare with that system's extractions")).toBeInTheDocument();
    await user.click(picker);
    const option = await screen.findByRole("option", { name: "ECC production" });
    await waitFor(() => expect(option.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(option);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "System" })).toHaveTextContent("ECC production"));

    await user.click(screen.getByRole("button", { name: "Run import" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][0].name).toBe("partners.csv");
    expect(upload.mock.calls[0][1]).toBe("business_partner");
    expect(upload.mock.calls[0][4]).toEqual({ systemId: "sys-1" });
  });

  it("offers no system picker when no system is connected", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<ImportPage />);
    await waitFor(() => expect(screen.getByText(/No imports yet/)).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "System" })).toBeNull();
  });
});
