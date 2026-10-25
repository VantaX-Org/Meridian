import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as findings from "@/lib/api/findings";
import * as settings from "@/lib/api/settings";
import type { FindingsAggregate } from "@/lib/api/findings";
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

  it("names the run's own cap reason and links history to Trends", async () => {
    vi.spyOn(settings, "getSettings").mockResolvedValue({ dqs_weights: { completeness: 0.5, validity: 0.5 } } as Awaited<ReturnType<typeof settings.getSettings>>);
    vi.spyOn(findings, "getFindings").mockResolvedValue({ findings: [], total: 0, filters_applied: {} });
    renderWithQuery(<DqsScore agg={agg} versionId="v1" cap={70} capReason="MM001: material type missing — score capped at 70" />);
    fireEvent.click(await screen.findByRole("button", { name: /explain score 82/i }));
    expect(await screen.findByText(/MM001: material type missing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /history/i })).toHaveAttribute("href", "/insights/trends?run=v1");
  });
});
