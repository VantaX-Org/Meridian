import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as versionsApi from "@/lib/api/versions";
import * as uploadApi from "@/lib/api/upload";
import * as jobsApi from "@/lib/api/jobs";
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

describe("a failed import in Recent imports", () => {
  it("says why it failed, offers a retry and links to the job history", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ ...VERSION, status: "failed" }] });
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([{
      id: "j1", kind: "analysis", status: "failed", label: "vendors.csv", stage: null, stages: [], percent: 40, rows_done: 0, rows_total: 0,
      message: "Failed", tables: [], error: "SoftTimeLimitExceeded()", result: null, started_at: 1, updated_at: 2, finished_at: 2, version_id: "v1",
    }]);
    renderWithQuery(<ImportPage />);
    expect(await screen.findByText("The job ran out of time before it finished")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry vendors.csv" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Job history" })).toHaveAttribute("href", "/admin/jobs");
  });

  it("still links to the job history when no reason was recorded", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ ...VERSION, status: "failed" }] });
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);
    renderWithQuery(<ImportPage />);
    expect(await screen.findByText("No reason was recorded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Job history" })).toBeInTheDocument();
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

describe("column mapping follows the chosen object", () => {
  const BP: uploadApi.MatchResponse = {
    detected_module: "business_partner", module_confidence: 0.9, module_label: "Business partner",
    mappings: [
      { source_column: "PARTNER", target_field: "BUT000.PARTNER", confidence: 0.95, is_required: true, match_type: "exact" },
      { source_column: "NAME", target_field: null, confidence: 0, is_required: false, match_type: "unmatched" },
    ],
    unmapped_required: ["BUT000.BU_TYPE"],
    available_modules: [{ value: "business_partner", label: "Business partner" }, { value: "material_master", label: "Material master" }],
  };
  const MM: uploadApi.MatchResponse = {
    ...BP, detected_module: "material_master", module_label: "Material master",
    mappings: [
      { source_column: "PARTNER", target_field: null, confidence: 0, is_required: false, match_type: "unmatched" },
      { source_column: "NAME", target_field: "MARA.MATNR", confidence: 0.7, is_required: true, match_type: "alias" },
    ],
    unmapped_required: ["MARA.MTART", "MARA.MEINS"],
  };

  function setup() {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(preview, "readHeaderSample").mockResolvedValue({ headers: ["PARTNER", "NAME"], sample: [["1", "Acme"]] });
    const utils = renderWithQuery(<ImportPage />);
    const input = utils.container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["PARTNER,NAME\n1,Acme\n"], "data.csv", { type: "text/csv" })] } });
  }

  it("re-matches the columns against the new object and recounts the required fields", async () => {
    vi.spyOn(fieldMappingsApi, "getModuleFieldMappings").mockRejectedValue(new Error("none"));
    const matchSpy = vi.spyOn(uploadApi, "matchColumns").mockImplementation(async (_h, _s, _f, hint) => (hint === "material_master" ? MM : BP));
    setup();
    expect(await screen.findByText(/1 required field has no column: BUT000.BU_TYPE/)).toBeInTheDocument();
    expect(screen.getByText("BUT000.PARTNER")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Material master" }));
    expect(await screen.findByText(/2 required fields have no column: MARA.MEINS, MARA.MTART/)).toBeInTheDocument();
    expect(matchSpy).toHaveBeenLastCalledWith(["PARTNER", "NAME"], [["1", "Acme"]], "data.csv", "material_master");
    expect(screen.queryByText("BUT000.PARTNER")).toBeNull();
    expect(screen.getByText("MARA.MATNR")).toBeInTheDocument();
    expect(screen.getByText(/set to Material master/)).toBeInTheDocument();
  });

  it("recounts the required fields when a correction leaves one without a column", async () => {
    vi.spyOn(uploadApi, "matchColumns").mockResolvedValue(BP);
    vi.spyOn(fieldMappingsApi, "getModuleFieldMappings").mockResolvedValue({
      module: "business_partner",
      mappings: [{ id: "f1", module: "business_partner", standard_field: "BUT000.PARTNER", standard_label: "Partner", customer_field: null, customer_label: null, data_type: "string", is_mapped: false, notes: null, updated_at: "" }],
    });
    setup();
    expect(await screen.findByText(/1 required field has no column/)).toBeInTheDocument();

    const user = userEvent.setup();
    const picker = await screen.findByRole("combobox", { name: "Standard field for PARTNER" });
    await user.click(picker);
    const option = await screen.findByRole("option", { name: "Not mapped" });
    await waitFor(() => expect(option.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(option);
    expect(await screen.findByText(/2 required fields have no column: BUT000.BU_TYPE, BUT000.PARTNER/)).toBeInTheDocument();
  });

  it("when the columns cannot be read, offers a retry and lets the object be chosen by hand", async () => {
    vi.spyOn(fieldMappingsApi, "getModuleFieldMappings").mockRejectedValue(new Error("none"));
    const matchSpy = vi.spyOn(uploadApi, "matchColumns").mockRejectedValue(new Error("down"));
    const upload = vi.spyOn(uploadApi, "uploadFile").mockResolvedValue({ version_id: "v9", job_id: "j9", status: "pending" });
    vi.spyOn(uploadApi, "pollAnalysisStatus").mockResolvedValue({
      task_id: "j9", status: "completed", progress: { current_step: "complete", step_number: 5, total_steps: 5, rows_processed: 1, total_rows: 1, percent_complete: 100 },
      result: null, error: null, db_status: "complete",
    });
    setup();
    expect(await screen.findByText(/The columns could not be read/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(matchSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/The columns could not be read/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Object" }));
    const option = await screen.findByRole("option", { name: "Material master" });
    await waitFor(() => expect(option.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(option);
    const run = await screen.findByRole("button", { name: "Run import" });
    expect(run).toBeEnabled();
    await user.click(run);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][1]).toBe("material_master");
    expect(upload.mock.calls[0][2]).toBeNull();
  });
});
