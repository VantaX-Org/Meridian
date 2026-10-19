// frontend/app/(app)/objects/__tests__/current-state.test.tsx
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as findingsApi from "@/lib/api/findings";
import * as versionsApi from "@/lib/api/versions";
import * as objectsApi from "@/lib/api/v1/objects";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import type { DQSSummary, Version } from "@/types/api";
import ObjectsPage from "../page";

let currentSearch = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const summary = (score: number, worst: keyof DQSSummary["dimension_scores"], critical = 0): DQSSummary => ({
  composite_score: score,
  dimension_scores: { completeness: 90, accuracy: 90, consistency: 90, timeliness: 90, uniqueness: 90, validity: 90, [worst]: score - 10 },
  critical_count: critical, high_count: 1, medium_count: 0, low_count: 0, total_checks: 10, passing_checks: 8, capped: false, cap_reason: null,
});
const version = (id: string, runAt: string, scores: Record<string, DQSSummary>, metadata: Version["metadata"]): Version =>
  ({ id, run_at: runAt, label: `${id} run`, status: "agents_complete", dqs_summary: scores, metadata });
const row = (module: string, label: string, score: number, readiness: ObjectSummary["readiness"], worst: string, affected: number): ObjectSummary =>
  ({ module, label, composite_score: score, readiness, failing_checks: 2, affected_records: affected, critical_checks: 0, high_checks: 1, worst_dimension: worst });

// Three lineages: two uploads of controlling (only the newest is current), one material master upload, and a
// system run that measured business partner. The newest run alone holds one object.
const VERSIONS = [
  version("co2", "2026-10-16T05:00:00Z", { controlling: summary(60, "accuracy") }, { modules: ["controlling"] }),
  version("co1", "2026-10-15T05:00:00Z", { controlling: summary(99, "accuracy") }, { modules: ["controlling"] }),
  version("mm", "2026-10-14T05:00:00Z", { material_master: summary(95, "completeness") }, { modules: ["material_master"] }),
  version("sys", "2026-10-02T05:00:00Z", { business_partner: summary(80, "accuracy") }, { system_id: "s1" }),
];
const LISTS: Record<string, ObjectSummary[]> = {
  co2: [row("controlling", "Controlling", 60, "fail", "accuracy", 120)],
  co1: [row("controlling", "Controlling", 99, "pass", "accuracy", 1)],
  mm: [row("material_master", "Material master", 95, "pass", "completeness", 0)],
  sys: [row("business_partner", "Business partner", 80, "warn", "accuracy", 4500)],
};

const bodyRows = () => screen.getAllByRole("row").slice(1);
/** The drill link of a table cell showing `text` (a stat may show the same number). */
const cellLink = (text: string) =>
  screen.getAllByText(text).map((e) => e.closest("a")).find((a) => a?.getAttribute("href")?.startsWith("/objects/"));

describe("ObjectsPage without ?run=: the current state", () => {
  let getObjects: MockInstance<typeof objectsApi.getObjects>;
  beforeEach(() => {
    currentSearch = "";
    vi.restoreAllMocks();
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: VERSIONS, total: VERSIONS.length });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ total: 0, loaded: 0, counts: {}, systems: [] });
    getObjects = vi.spyOn(objectsApi, "getObjects").mockImplementation(async (run: string) => ({ run_id: run, objects: LISTS[run] ?? [] }));
  });

  it("lists every object at its own latest run, each row linking to the object without ?run=", async () => {
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Business partner")).toBeInTheDocument());
    expect(screen.getByText("Controlling")).toBeInTheDocument();
    expect(screen.getByText("Material master")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(3);
    // one list per lineage, never the superseded controlling upload and never run=latest
    expect(getObjects.mock.calls.map((c) => c[0]).sort()).toEqual(["co2", "mm", "sys"]);
    expect(cellLink("60")).toHaveAttribute("href", "/objects/controlling?tab=rules");
    expect(cellLink("4,500")).toHaveAttribute("href", "/objects/business_partner?tab=rules");
    expect(screen.getByTestId("run-scope")).toHaveTextContent("Current state of 3 objects, latest run 16 Oct 2026");
    expect(screen.queryByText("Back to latest")).toBeNull();
    // the stats read the merged list: one not ready, one at risk, one go, 0 critical + 3 high blocking
    expect(screen.getByText("Not ready").closest("a")).toHaveAttribute("href", "/objects?readiness=fail");
    expect(screen.getByText("each at its latest run")).toBeInTheDocument();
    expect(within(screen.getByText("Blocking findings").closest("a, div") as HTMLElement).getByText("3")).toBeInTheDocument();
  });

  it("?readiness=fail keeps only the not-ready objects of the merged list", async () => {
    currentSearch = "readiness=fail";
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Controlling")).toBeInTheDocument());
    expect(bodyRows()).toHaveLength(1);
    expect(screen.queryByText("Business partner")).toBeNull();
    expect(screen.queryByText("Material master")).toBeNull();
  });

  it("?dimension= keeps the objects whose worst dimension it is, across runs", async () => {
    currentSearch = "dimension=accuracy";
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Business partner")).toBeInTheDocument());
    expect(screen.getByText("Controlling")).toBeInTheDocument();
    expect(screen.queryByText("Material master")).toBeNull();
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Accuracy", pressed: true })).toBeInTheDocument();
  });

  it("lists a run's objects from its summary when its list cannot be read", async () => {
    getObjects.mockImplementation(async (run: string) => {
      if (run === "sys") throw new Error("network error");
      return { run_id: run, objects: LISTS[run] ?? [] };
    });
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({
      version_ids: ["co2", "mm", "sys"], total: 3, affected_records: 4620, severity: { critical: 0, high: 3, medium: 0, low: 0 },
      by_module: [{ module: "business_partner", findings: 1, affected: 4500, critical: 0, high: 1, medium: 0, low: 0, avg_pass_rate: null }],
      by_dimension: [], avg_pass_rate: null, dqs: { composite: null, dimension_scores: {}, modules: {} }, previous_dqs: null,
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Business partner")).toBeInTheDocument());
    expect(bodyRows()).toHaveLength(3);
    expect(cellLink("4,500")).toHaveAttribute("href", "/objects/business_partner?tab=rules");
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });

  it("with ?run= keeps the single run and its As of header", async () => {
    currentSearch = "run=sys";
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(VERSIONS[3]);
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Business partner")).toBeInTheDocument());
    expect(bodyRows()).toHaveLength(1);
    expect(getObjects.mock.calls.map((c) => c[0])).toEqual(["sys"]);
    expect(cellLink("4,500")).toHaveAttribute("href", "/objects/business_partner?run=sys&tab=rules");
    await waitFor(() => expect(screen.getByTestId("run-scope")).toHaveTextContent("As of sys run"));
    expect(screen.getByText("Back to latest")).toBeInTheDocument();
  });
});
