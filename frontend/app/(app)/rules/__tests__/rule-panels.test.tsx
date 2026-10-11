import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import { FeedbackPanel, SuppressionsPanel } from "../rule-panels";

const can = vi.fn(() => true);
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can }) }));

afterEach(() => vi.restoreAllMocks());

describe("rule panels", () => {
  it("lists suppressions and hides End now without approve", async () => {
    can.mockReturnValue(false);
    vi.spyOn(api, "getRuleSuppressions").mockResolvedValue({
      suppressions: [{ id: "s1", check_id: "MM-001", record_key: null, reason: "Known gap", expires_at: "2027-01-01T00:00:00Z", created_by: "a", created_at: "2026-10-01T00:00:00Z", active: true }],
    });
    renderWithQuery(<SuppressionsPanel />);
    expect(await screen.findByText("MM-001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End now" })).toBeNull();
  });

  it("shows false-positive rate per rule", async () => {
    vi.spyOn(api, "getRuleFeedback").mockResolvedValue({ rules: [{ check_id: "MM-002", flagged: 10, real: 5, false_positive: 5, false_positive_rate: 0.5 }] });
    renderWithQuery(<FeedbackPanel />);
    expect(await screen.findByText("50%")).toBeInTheDocument();
  });
});
