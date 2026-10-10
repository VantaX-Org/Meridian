// frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as versionsApi from "@/lib/api/versions";
import RuleDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master", ruleId: "mm_missing_desc" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("RuleDetailPage", () => {
  it("renders failing records with a link into each record's fix sheet", async () => {
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1",
      check_id: "mm_missing_desc",
      total: 1,
      records: [{ record_key: "MATNR=100001", grain: "MATNR", module: "material_master", field_values: null }],
    });
    renderWithQuery(<RuleDetailPage />);
    await waitFor(() => expect(screen.getByText("MATNR=100001")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /open fix sheet/i });
    expect(link).toHaveAttribute(
      "href",
      "/objects/material_master/records/MATNR%3D100001?run=v1",
    );
  });

  it("shows an empty state when there are no failing records", async () => {
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({
      version_id: "v1",
      check_id: "mm_missing_desc",
      total: 0,
      records: [],
    });
    renderWithQuery(<RuleDetailPage />);
    await waitFor(() => expect(screen.getByText(/no failing records/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(versionsApi, "getFindingRecords").mockRejectedValue(new Error("network error"));
    renderWithQuery(<RuleDetailPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });
});
