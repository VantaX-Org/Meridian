// frontend/app/(app)/objects/[object]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as rulesApi from "@/lib/api/rules";
import * as fieldProfileApi from "@/lib/api/field-profile";
import type { Version } from "@/types/api";
import ObjectDetailPage from "../page";

let searchParams = new URLSearchParams("run=v1");
const push = vi.fn((href: string) => {
  const q = href.split("?")[1] ?? "";
  searchParams = new URLSearchParams(q);
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master" }),
  useRouter: () => ({ push, replace: vi.fn() }),
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
  label: "Material Master",
  composite_score: 72.5,
  readiness: "warn",
  failing_checks: 1,
  affected_records: 120,
  dimension_scores: { completeness: 80, accuracy: 90 },
  rules: [
    { check_id: "mm_missing_desc", severity: "high", dimension: "completeness", affected_count: 42, total_count: 100, pass_rate: 0.58 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams("run=v1");
  push.mockClear();
  vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version("sys-1"));
  vi.spyOn(objectsApi, "getObject").mockResolvedValue(OBJECT);
  vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "mm_missing_desc", runs: [] });
  vi.spyOn(fieldProfileApi, "getVersionProfile").mockResolvedValue({ version_id: "v1", object: "material_master", objects: ["material_master"], tables: [], dependencies: [] });
  vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({ version_id: "v1", check_id: "mm_missing_desc", total: 0, records: [] });
});

describe("ObjectDetailPage", () => {
  it("renders the overview tab's stats and dimension chart", async () => {
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("Material Master")).toBeInTheDocument());
    expect(screen.getByText("72.5")).toBeInTheDocument();
  });

  it("lists rules on the rules tab and navigates to the records tab on row click", async () => {
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Rules" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
    fireEvent.click(screen.getByText("mm_missing_desc"));
    expect(push).toHaveBeenCalledWith("/objects/material_master?run=v1&tab=records&check_id=mm_missing_desc");
  });

  it("shows an empty rules state when the run has no rules for this object", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({ ...OBJECT, rules: [] });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText(/no results for this object in this run/i)).toBeInTheDocument());
  });

  it("shows the G3 empty state on the fields tab for an upload-sourced run", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version(undefined));
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Fields" }));
    await waitFor(() => expect(screen.getByText(/no field profile for this run/i)).toBeInTheDocument());
  });

  it("prompts to pick a rule on the records tab when no check_id is set", async () => {
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Records" }));
    await waitFor(() =>
      expect(screen.getByText(/open the rules tab and choose a rule/i)).toBeInTheDocument(),
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
    expect(screen.getByRole("link", { name: /open fix sheet/i })).toHaveAttribute(
      "href",
      "/objects/material_master/records/MATNR%3D100001?run=v1",
    );
  });

  it("shows an error state when the object request fails", async () => {
    vi.spyOn(objectsApi, "getObject").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });
});
