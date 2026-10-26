import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as findings from "@/lib/api/findings";
import * as settings from "@/lib/api/settings";
import type { FindingsAggregate } from "@/lib/api/findings";
import type { Finding } from "@/types/api";
import { DqsScore } from "../dqs-score";

afterEach(() => vi.restoreAllMocks());

const agg = {
  dqs: { composite: 82, dimension_scores: { completeness: 90, validity: 70 }, tier: "warn" },
} as unknown as FindingsAggregate;

describe("DqsScore", () => {
  it("opens an explainer once tenant weights load", async () => {
    vi.spyOn(settings, "getSettings").mockResolvedValue({ dqs_weights: { completeness: 0.5, validity: 0.5 } } as Awaited<ReturnType<typeof settings.getSettings>>);
    vi.spyOn(findings, "getFindings").mockResolvedValue({ findings: [], total: 0, filters_applied: {} });
    renderWithQuery(<DqsScore agg={agg} versionId="v1" />);
    expect(await screen.findByRole("button", { name: /explain score 82/i })).toBeInTheDocument();
  });

  it("links Score history to the run's trend, not the executive summary", async () => {
    vi.spyOn(settings, "getSettings").mockResolvedValue({ dqs_weights: { completeness: 0.5, validity: 0.5 } } as Awaited<ReturnType<typeof settings.getSettings>>);
    vi.spyOn(findings, "getFindings").mockResolvedValue({ findings: [], total: 0, filters_applied: {} });
    renderWithQuery(<DqsScore agg={agg} versionId="v1" />);
    fireEvent.click(await screen.findByRole("button", { name: /explain score 82/i }));
    expect(await screen.findByRole("link", { name: "Score history" })).toHaveAttribute("href", "/insights/trends?run=v1");
  });

  it("lists the failing checks with pass rates and opens the run's failing records", async () => {
    vi.spyOn(settings, "getSettings").mockResolvedValue({ dqs_weights: { completeness: 0.25, validity: 0.1 } } as Awaited<ReturnType<typeof settings.getSettings>>);
    vi.spyOn(findings, "getFindings").mockResolvedValue({
      findings: [
        { id: "f1", version_id: "v1", module: "material_master", check_id: "MM003", severity: "critical", dimension: "completeness", affected_count: 120, total_count: 1000, pass_rate: 88, details: {} } as Finding,
        { id: "f2", version_id: "v1", module: "fi_gl", check_id: "GL002", severity: "medium", dimension: "validity", affected_count: 9, total_count: 100, pass_rate: 0.91, details: {} } as Finding,
      ],
      total: 2,
      filters_applied: {},
    });
    renderWithQuery(<DqsScore agg={agg} versionId="v1" />);
    fireEvent.click(await screen.findByRole("button", { name: /explain score 82/i }));
    const mm = await screen.findByRole("link", { name: "MM003" });
    expect(mm).toHaveAttribute("href", "/objects/material_master?run=v1&tab=records&check_id=MM003");
    expect(mm.closest("li")).toHaveTextContent("120 records, 88.0% pass");
    // a 0..1 share from an older row reads as a percentage too
    expect(screen.getByRole("link", { name: "GL002" }).closest("li")).toHaveTextContent("9 records, 91.0% pass");
    // the tenant's weights, normalised over the measured dimensions (0.25 and 0.1 of 0.35)
    expect(screen.getByRole("cell", { name: "71%" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "29%" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open failing records" })).toHaveAttribute("href", "/runs/v1?tab=findings");
    expect(screen.getByTestId("score-caps")).toHaveTextContent("No cap applied");
  });

  it("names the run's own cap reason", async () => {
    vi.spyOn(settings, "getSettings").mockResolvedValue({ dqs_weights: { completeness: 0.5, validity: 0.5 } } as Awaited<ReturnType<typeof settings.getSettings>>);
    vi.spyOn(findings, "getFindings").mockResolvedValue({ findings: [], total: 0, filters_applied: {} });
    renderWithQuery(<DqsScore agg={agg} versionId="v1" cap={70} capReason="MM001: material type missing — score capped at 70" />);
    fireEvent.click(await screen.findByRole("button", { name: /explain score 82/i }));
    expect(await screen.findByText(/MM001: material type missing/)).toBeInTheDocument();
  });
});
