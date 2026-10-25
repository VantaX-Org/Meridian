// frontend/app/(app)/objects/[object]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as rulesApi from "@/lib/api/rules";
import * as fieldProfileApi from "@/lib/api/field-profile";
import * as insightsApi from "@/lib/api/insights";
import * as remediationApi from "@/lib/api/remediation";
import * as workApi from "@/lib/api/work";
import * as findingsApi from "@/lib/api/findings";
import * as settingsApi from "@/lib/api/settings";
import type { Version } from "@/types/api";
import ObjectDetailPage from "../page";

let searchParams = new URLSearchParams("run=v1");
const push = vi.fn((href: string) => {
  const q = href.split("?")[1] ?? "";
  searchParams = new URLSearchParams(q);
});
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

function version(systemId?: string): Version {
  return {
    id: "v1", label: "Oct 8", status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: systemId },
  };
}

const OBJECT: objectsApi.ObjectDetail = {
  module: "material_master",
  label: "Material master",
  composite_score: 72.5,
  readiness: "warn",
  failing_checks: 1,
  affected_records: 120,
  dimension_scores: { completeness: 80, accuracy: 90 },
  rules: [
    { check_id: "mm_missing_desc", severity: "high", dimension: "completeness", affected_count: 42, total_count: 100, pass_rate: 0.58 },
    { check_id: "mm_bad_uom", severity: "medium", dimension: "accuracy", affected_count: 10, total_count: 100, pass_rate: 0.9 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams("run=v1");
  push.mockClear();
  vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version("sys-1"));
  vi.spyOn(objectsApi, "getObject").mockResolvedValue(OBJECT);
  vi.spyOn(rulesApi, "getRuleHistoryBatch").mockResolvedValue({ version_id: "v1", module: "material_master", history: {} });
  vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue({ version_id: "v1", object: "material_master", objects: ["material_master"], tables: [], dependencies: [] });
  vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({ version_id: "v1", check_id: "mm_missing_desc", total: 0, records: [] });
  vi.spyOn(workApi, "getWorkSummary").mockResolvedValue({ version_id: "v1", scope: "s", built: true, objects: [], totals: { records: 0, open: 0, issues: 0, critical: 0, proposed: 0, overdue: 0 } });
  vi.spyOn(workApi, "getWorkGroups").mockResolvedValue({ version_id: "v1", built: true, total: 0, groups: [] });
  vi.spyOn(workApi, "getWorkRecords").mockResolvedValue({ version_id: "v1", total: 0, total_capped: false, next: null, items: [] });
});

describe("ObjectDetailPage", () => {
  it("without ?run= opens this object's latest finished run, never another object's newer run, and names it", async () => {
    searchParams = new URLSearchParams("");
    const at = (id: string, label: string, day: string, module: string, status: Version["status"] = "complete"): Version => ({
      id, label, status, run_at: `2026-10-${day}T05:00:00Z`, dqs_summary: null, metadata: { modules: [module] },
    });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
      at("bp-new", "business_partner_100k", "16", "business_partner"),
      at("mm-running", "material_master_50k", "15", "material_master", "running"),
      at("mm-latest", "material_master_25k", "14", "material_master"),
      at("mm-old", "material_master_10k", "10", "material_master"),
    ], total: 4 });
    const getObject = vi.spyOn(objectsApi, "getObject").mockResolvedValue(OBJECT);
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByRole("img", { name: "Score 73" })).toBeInTheDocument();
    expect(getObject).toHaveBeenCalledWith("material_master", "mm-latest");
    expect(getObject).not.toHaveBeenCalledWith("material_master", "bp-new");
    // The header names the run (the scope bar picks it), and nothing is pinned, so there is no "Back to latest".
    expect(screen.getByTestId("run-scope")).toHaveTextContent("As of material_master_25k, 14 Oct 2026");
    expect(screen.queryByRole("link", { name: "Back to latest" })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("follows a ?run= deep link to an older run and offers Back to latest", async () => {
    searchParams = new URLSearchParams("run=mm-old&tab=rules");
    const at = (id: string, label: string, day: string): Version => ({
      id, label, status: "complete", run_at: `2026-10-${day}T05:00:00Z`, dqs_summary: null, metadata: { modules: ["material_master"] },
    });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [at("mm-latest", "material_master_25k", "14"), at("mm-old", "material_master_10k", "10")], total: 2 });
    const getObject = vi.spyOn(objectsApi, "getObject").mockResolvedValue(OBJECT);
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByRole("link", { name: "Back to latest" })).toHaveAttribute("href", "/objects/material_master?tab=rules");
    expect(getObject).toHaveBeenCalledWith("material_master", "mm-old");
  });

  it("a ?run= that did not measure the object shows a not-in-this-run state with the object's latest run, not an error", async () => {
    searchParams = new URLSearchParams("run=co-1k");
    const at = (id: string, label: string, day: string, module: string): Version => ({
      id, label, status: "complete", run_at: `2026-10-${day}T05:00:00Z`, dqs_summary: null, metadata: { modules: [module] },
    });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
      at("co-1k", "controlling_1k", "16", "controlling"),
      at("mm-latest", "material_master_25k", "14", "material_master"),
    ], total: 2 });
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(at("co-1k", "controlling_1k", "16", "controlling"));
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Material master is not in this run")).toBeInTheDocument();
    expect(screen.getByText("controlling_1k, 16 Oct 2026 did not measure Material master.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show latest run of Material master" })).toHaveAttribute("href", "/objects/material_master");
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a ?run= the server has no such object in (404) reads as not in this run, not as an unreachable server", async () => {
    searchParams = new URLSearchParams("run=v1");
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [version("sys-1")], total: 1 });
    const { AxiosError, AxiosHeaders } = await import("axios");
    vi.spyOn(objectsApi, "getObject").mockRejectedValue(new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 404, data: { detail: "Object not found for this run" }, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
    }));
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Material master is not in this run", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });

  it("renders the overview workbench: the score, the stats, the failing rules ranked by records and the dimension bars", async () => {
    searchParams = new URLSearchParams("run=v1&tab=overview");
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByRole("img", { name: "Score 73" })).toBeInTheDocument();
    expect(screen.getByText("Material master")).toBeInTheDocument();
    for (const label of ["Failing rules", "Critical and high", "Records affected", "Auto-fixable"]) expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    const rules = await screen.findAllByTestId("workbench-rule-row");
    expect(rules.map((r) => r.textContent)).toEqual([expect.stringContaining("mm_missing_desc"), expect.stringContaining("mm_bad_uom")]);
    expect(rules[0]).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("dimension-bars")).toBeInTheDocument();
  });

  it("selects a rule from ?rule= and fetches that rule's failing records; selecting writes the URL", async () => {
    searchParams = new URLSearchParams("run=v1&rule=mm_bad_uom");
    const records = vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1", check_id: "mm_bad_uom", total: 1,
      records: [{ record_key: "MATNR=7", grain: "MATNR", module: "material_master", field_values: null }],
    });
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("MATNR=7")).toBeInTheDocument();
    expect(records).toHaveBeenCalledWith("v1", "mm_bad_uom", { limit: 50, offset: 0 });
    const rows = screen.getAllByTestId("workbench-rule-row");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveAttribute("href", "/objects/material_master?run=v1&rule=mm_missing_desc");
    expect(screen.getByRole("button", { name: "Propose fix" })).toBeEnabled();
  });

  it("Propose fix drafts a fix batch for the selected rule in this run and offers to open it", async () => {
    searchParams = new URLSearchParams("run=v1&rule=mm_bad_uom");
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1", check_id: "mm_bad_uom", total: 1,
      records: [{ record_key: "MATNR=7", grain: "MATNR", module: "material_master", field_values: null }],
    });
    const create = vi.spyOn(remediationApi, "createBatch").mockResolvedValue({ id: "b1", name: "mm_bad_uom material_master", status: "draft", item_count: 10 });
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("MATNR=7");
    fireEvent.click(screen.getByRole("button", { name: "Propose fix" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("mm_bad_uom material_master", { check_id: "mm_bad_uom", module: "material_master", version_id: "v1" }));
  });

  it("ticking records offers to add them to a fix batch", async () => {
    searchParams = new URLSearchParams("run=v1&rule=mm_bad_uom");
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1", check_id: "mm_bad_uom", total: 1,
      records: [{ record_key: "MATNR=7", grain: "MATNR", module: "material_master", field_values: null }],
    });
    const create = vi.spyOn(remediationApi, "createBatch").mockResolvedValue({ id: "b1", name: "n", status: "draft", item_count: 1 });
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("MATNR=7");
    fireEvent.click(screen.getByLabelText("Select MATNR=7"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to fix batch" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("mm_bad_uom material_master", expect.objectContaining({ record_keys: ["MATNR=7"] })));
  });

  it("names the rule beside its id on the rules tab, without printing the id twice", async () => {
    searchParams = new URLSearchParams("run=v1&tab=rules");
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ rows: [{ check_id: "mm_missing_desc", name: "Description is mandatory" }] } as never);
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Description is mandatory")).toBeInTheDocument();
    expect(screen.getAllByText("mm_missing_desc")).toHaveLength(1);
  });

  it("lists rules on the rules tab and navigates to the records tab on row click", async () => {
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Rules" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
    fireEvent.click(screen.getByText("mm_missing_desc"));
    expect(push).toHaveBeenCalledWith("/objects/material_master?run=v1&tab=records&check_id=mm_missing_desc");
  });

  it("fetches rule history on the rules tab with a single batch call, not one per rule", async () => {
    const batch = vi.spyOn(rulesApi, "getRuleHistoryBatch").mockResolvedValue({
      version_id: "v1",
      module: "material_master",
      history: {
        mm_missing_desc: [
          { version_id: "v1", run_at: "2026-10-08T00:00:00Z", severity: "high", affected_count: 42, total_count: 100, pass_rate: 0.58, suppressed: false, hit_rate: 42 },
          { version_id: "v0", run_at: "2026-10-01T00:00:00Z", severity: "high", affected_count: 50, total_count: 100, pass_rate: 0.5, suppressed: false, hit_rate: 50 },
        ],
      },
    });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText(/^[+-]?\d+\.\d$/)).toBeInTheDocument());
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith({ version_id: "v1", module: "material_master", limit_runs: 8 });
  });

  it("shows an error state when the rule history batch request fails", async () => {
    vi.spyOn(rulesApi, "getRuleHistoryBatch").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("shows an empty rules state when the run has no rules for this object", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({ ...OBJECT, rules: [] });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText(/no rules ran for this object/i)).toBeInTheDocument());
  });

  it("renders profile rows on the fields tab for an upload-sourced run (no system_id)", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version(undefined));
    const getProfile = vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue({
      version_id: "v1",
      object: "material_master",
      objects: ["material_master"],
      dependencies: [],
      tables: [
        {
          table: "MARA",
          rows: 100,
          table_rows: 100,
          sampled: false,
          fields: [
            {
              field: "MTART",
              stats: {
                rows: 100, table_rows: 100, sampled: false, blank: 0, blank_pct: 0, distinct: 4,
                min_length: 4, max_length: 4, ddic_type: "CHAR", ddic_length: 4, description: null,
                numeric: null, dates: null,
                shapes: [], shape_count: 0, masked: false, mask_reason: null,
                top_values: null,
              },
            },
          ],
        },
      ],
    });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Fields" }));
    await waitFor(() => expect(screen.getByText("MARA.MTART")).toBeInTheDocument());
    expect(getProfile).toHaveBeenCalledWith("v1", "material_master");
  });

  it("prompts to pick a rule on the records tab when no check_id is set", async () => {
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Records by rule" }));
    await waitFor(() =>
      expect(screen.getByText(/choose a rule to see its failing records/i)).toBeInTheDocument(),
    );
  });

  it("renders failing records on the records tab when check_id is set", async () => {
    searchParams = new URLSearchParams("run=v1&tab=records&check_id=mm_missing_desc");
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1",
      check_id: "mm_missing_desc",
      total: 1,
      records: [{ record_key: "MATNR=100001", grain: "MATNR", module: "material_master", field_values: null }],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("MATNR=100001")).toBeInTheDocument());
    for (const link of screen.getAllByRole("link", { name: /open record/i })) {
      expect(link).toHaveAttribute("href", "/objects/material_master/records/MATNR%3D100001?run=v1");
    }
  });

  it("shows an error state when the object request fails", async () => {
    vi.spyOn(objectsApi, "getObject").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("filters the rules tab by the dimension query param", async () => {
    searchParams = new URLSearchParams("run=v1&tab=rules&dimension=accuracy");
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("mm_bad_uom")).toBeInTheDocument());
    expect(screen.queryByText("mm_missing_desc")).not.toBeInTheDocument();
  });

  it("names dimensions in sentence case on the rules tab and keeps the raw id in the URL", async () => {
    searchParams = new URLSearchParams("run=v1&tab=rules");
    replace.mockClear();
    renderWithQuery(<ObjectDetailPage />);
    const group = await screen.findByRole("group", { name: "Dimension" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent).sort()).toEqual(["Accuracy", "Completeness"]);
    expect(within(group).queryByRole("button", { name: "accuracy" })).toBeNull();
    expect(screen.getAllByRole("cell", { name: "Completeness" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("cell", { name: "completeness" })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Accuracy" }));
    expect(replace.mock.calls.at(-1)?.[0]).toContain("dimension=accuracy");
  });

  it("offers to clear the dimension filter when it matches no rules", async () => {
    searchParams = new URLSearchParams("run=v1&tab=rules&dimension=timeliness");
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText(/no rule fits the current filters/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(replace).toHaveBeenCalledWith("/objects/material_master?run=v1&tab=rules", { scroll: false });
  });

  it("reads the shared `check` parameter that rule tables link with, as well as the older check_id", async () => {
    searchParams = new URLSearchParams("run=v1&tab=records&check=mm_missing_desc");
    const records = vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1", check_id: "mm_missing_desc", total: 1,
      records: [{ record_key: "MATNR=100001", grain: "MATNR", module: "material_master", field_values: null }],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("MATNR=100001")).toBeInTheDocument());
    expect(records).toHaveBeenCalledWith("v1", "mm_missing_desc", expect.anything());
    expect(screen.queryByText(/choose a rule to see its failing records/i)).toBeNull();
  });

  it("preserves check_id when switching tabs away from and back to records", async () => {
    searchParams = new URLSearchParams("run=v1&tab=records&check_id=mm_missing_desc");
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Records by rule", selected: true })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(push).toHaveBeenLastCalledWith("/objects/material_master?run=v1&tab=overview&check_id=mm_missing_desc");
  });

  it("renders one mono column per field_values key on the records tab", async () => {
    searchParams = new URLSearchParams("run=v1&tab=records&check_id=mm_missing_desc");
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1",
      check_id: "mm_missing_desc",
      total: 1,
      records: [
        { record_key: "MATNR=100001", grain: "MATNR", module: "material_master", field_values: { MAKTX: "Widget", MTART: "FERT" } },
      ],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("MAKTX")).toBeInTheDocument());
    expect(screen.getByText("MTART")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("FERT")).toBeInTheDocument();
  });

  it("shows top shape, top values, masked reason, the blank count and the field in TABLE.FIELD mono on the fields tab", async () => {
    searchParams = new URLSearchParams("run=v1&tab=fields");
    vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue({
      version_id: "v1",
      object: "material_master",
      objects: ["material_master"],
      dependencies: [],
      tables: [
        {
          table: "MARA",
          rows: 100,
          table_rows: 100,
          sampled: false,
          fields: [
            {
              field: "MTART",
              stats: {
                rows: 100, table_rows: 100, sampled: false, blank: 5, blank_pct: 0.05, distinct: 4,
                min_length: 4, max_length: 4, ddic_type: "CHAR", ddic_length: 4, description: null,
                numeric: null, dates: null,
                shapes: [{ shape: "AAAA", count: 90, share: 0.9 }],
                shape_count: 1, masked: false, mask_reason: null,
                top_values: [{ value: "FERT", count: 90 }],
              },
            },
            {
              field: "ERNAM",
              stats: {
                rows: 100, table_rows: 100, sampled: false, blank: 0, blank_pct: 0, distinct: 50,
                min_length: 3, max_length: 12, ddic_type: "CHAR", ddic_length: 12, description: null,
                numeric: null, dates: null,
                shapes: [], shape_count: 0, masked: true, mask_reason: "privacy",
                top_values: null,
              },
            },
          ],
        },
      ],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("AAAA (90%)")).toBeInTheDocument());
    expect(screen.getByText("AAAA (90%)")).toHaveStyle({ fontFamily: "var(--m-font-mono)" });
    expect(screen.getByText("FERT (90)")).toBeInTheDocument();
    expect(screen.getByText("Masked").closest("[title]")).toHaveAttribute("title", "privacy");
    expect(screen.getByText("5 (5%)")).toBeInTheDocument();
    expect(screen.getByText("MARA.MTART")).toBeInTheDocument();
    expect(screen.getByText("MARA.MTART")).toHaveStyle({ fontFamily: "var(--m-font-mono)" });
  });

  it("shows a loading skeleton while the object loads", async () => {
    vi.spyOn(objectsApi, "getObject").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
  });

  describe("?blocking= filter on the rules tab", () => {
    it("blocking=true keeps only critical and high rules and pressed Critical and high chip", async () => {
      searchParams = new URLSearchParams("run=v1&tab=rules&blocking=true");
      renderWithQuery(<ObjectDetailPage />);
      await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
      expect(screen.queryByText("mm_bad_uom")).toBeNull();
      expect(screen.getByRole("button", { name: "Critical and high", pressed: true })).toBeInTheDocument();
    });
    it.each(["constructor", "__proto__", "false", "1", "TRUE"])("blocking=%s applies no filter and shows no pressed chip", async (g) => {
      searchParams = new URLSearchParams(`run=v1&tab=rules&blocking=${g}`);
      renderWithQuery(<ObjectDetailPage />);
      await waitFor(() => expect(screen.getByText("mm_bad_uom")).toBeInTheDocument());
      expect(screen.getByText("mm_missing_desc")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Critical and high", pressed: false })).toBeInTheDocument();
    });
  });
});

describe("ObjectDetailPage keyboard and gating", () => {
  it("keys 1-5 switch tabs", async () => {
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("Material master");
    fireEvent.keyDown(document.body, { key: "2" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("tab=overview"));
    fireEvent.keyDown(document.body, { key: "3" });
    expect(push).toHaveBeenLastCalledWith(expect.stringContaining("tab=rules"));
    fireEvent.keyDown(document.body, { key: "5" });
    expect(push).toHaveBeenLastCalledWith(expect.stringContaining("tab=records"));
  });

  it("1-5 ignored while typing in an input", async () => {
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("Material master");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "2" });
    expect(push).not.toHaveBeenCalled();
    input.remove();
  });

  it("f opens the first fix sheet, ignores repeat and dialogs", async () => {
    searchParams = new URLSearchParams("run=v1&tab=records&check_id=mm_missing_desc");
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1", check_id: "mm_missing_desc", total: 1,
      records: [{ record_key: "K1", grain: "G", module: "material_master", field_values: null }],
    });
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("K1");
    fireEvent.keyDown(document.body, { key: "f", repeat: true });
    expect(push).not.toHaveBeenCalled();
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    document.body.appendChild(dlg);
    fireEvent.keyDown(dlg, { key: "f" });
    expect(push).not.toHaveBeenCalled();
    dlg.remove();
    fireEvent.keyDown(document.body, { key: "f" });
    expect(push).toHaveBeenCalledWith("/objects/material_master/records/K1?run=v1");
  });

  it("does not fetch records on the Records tab without check_id", async () => {
    searchParams = new URLSearchParams("run=v1&tab=records");
    const spy = vi.spyOn(versionsApi, "getFindingRecords");
    renderWithQuery(<ObjectDetailPage />);
    await screen.findByText("Material master");
    expect(spy).not.toHaveBeenCalled();
  });

  it("empty-state copy: no run, no rule, all records pass", async () => {
    searchParams = new URLSearchParams("");
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [], total: 0 });
    const a = renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("No run has measured this object")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open runs" })).toBeInTheDocument();
    a.unmount();
    searchParams = new URLSearchParams("run=v1&tab=records&check_id=mm_missing_desc");
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("All records pass this rule")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open rules" })).toBeInTheDocument();
  });

  it("shows the header counts and affected records from a complete payload", async () => {
    searchParams = new URLSearchParams("run=v1&tab=overview");
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Records affected")).toBeInTheDocument();
    expect(screen.getAllByText("120").length).toBeGreaterThan(0);
    // Each header count opens what it counts.
    // One rule, singular; the summed affected count is rule failures, not records.
    expect((await screen.findByText("1 failing rule")).closest("a")).toHaveAttribute("href", "/objects/material_master?run=v1&tab=rules");
    expect(screen.getByText("120 rule failures").closest("a")).toHaveAttribute("href", "/objects/material_master?run=v1&tab=fix");
    expect(screen.queryByText(/affected records/)).toBeNull();
  });

  it("opens the score explainer with the cap, its reason and this run's history", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue({ dqs_weights: { completeness: 0.5, accuracy: 0.5 } } as never);
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({ ...OBJECT, composite_score: 70, raw_score: 82.4, capped: true, cap_reason: "MM001: material type missing — score capped at 70" });
    searchParams = new URLSearchParams("run=v1&tab=overview");
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Explain score 82/ }));
    expect((await screen.findAllByText(/Capped at 70/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/MM001/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Score history/i })).toHaveAttribute("href", "/objects/material_master?run=v1&tab=history");
  });

  it("plots this system's runs only, each as scored at the time", async () => {
    vi.spyOn(findingsApi, "getScoreHistory").mockResolvedValue({
      history: [
        { version_id: "v1", run_at: "2026-10-08T00:00:00Z", system_id: "sys-1", scoring_recorded: true, at_the_time: { composite: 70, tier: "warn", scoring: null }, under_current: { composite: 75, tier: "warn", modules: {} } },
        { version_id: "other", run_at: "2026-10-07T00:00:00Z", system_id: "sys-2", scoring_recorded: true, at_the_time: { composite: 10, tier: "fail", scoring: null }, under_current: { composite: 10, tier: "fail", modules: {} } },
        { version_id: "v0", run_at: "2026-10-01T00:00:00Z", system_id: "sys-1", scoring_recorded: true, at_the_time: { composite: 60, tier: "fail", scoring: null }, under_current: { composite: 65, tier: "fail", modules: {} } },
      ],
      modules: { material_master: [
        { version_id: "v1", composite: 77.7, at_the_time: 72.5 },
        { version_id: "other", composite: 11.1, at_the_time: 11.1 },
        { version_id: "v0", composite: 66.6, at_the_time: 61.5 },
      ] },
    });
    searchParams = new URLSearchParams("run=v1&tab=history");
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("2 runs, 61.5 to 72.5")).toBeInTheDocument();
    expect(screen.queryByText("11.1")).toBeNull();
    expect(screen.queryByText("77.7")).toBeNull();
  });

  it("does not throw when composite_score is null and dimension_scores is empty", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({
      ...OBJECT, composite_score: null, readiness: null, dimension_scores: {},
    });
    searchParams = new URLSearchParams("run=v1&tab=overview");
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("No dimension scores")).toBeInTheDocument();
    expect(screen.getByText("Records affected")).toBeInTheDocument();
  });
});

