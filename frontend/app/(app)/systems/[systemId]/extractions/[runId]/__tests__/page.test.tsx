import { screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as runsApi from "@/lib/api/v1/runs";
import ExtractionPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ systemId: "s1", runId: "r1" }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("extraction run page", () => {
  it("shows the decisive error line for a failed step", async () => {
    vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
      version_id: "r1",
      steps: [
        { step_number: 1, step_name: "extract_BUT000", status: "ok", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z", duration_ms: 1200, error_detail: null },
        { step_number: 2, step_name: "extract_MARA", status: "failed", started_at: "2026-01-01T00:00:01Z", finished_at: "2026-01-01T00:00:01Z", duration_ms: 400, error_detail: "RFC_COMMUNICATION_FAILURE: connection reset" },
      ],
    });
    renderWithQuery(<ExtractionPage />);
    // Plain words and the next step first; the worker's own text sits behind "Technical detail".
    expect(await screen.findByText("Meridian could not reach the SAP system")).toBeInTheDocument();
    expect(screen.getByText(/Check the host, port and network route/)).toBeInTheDocument();
    expect(screen.getByText("Technical detail").closest("details")).toHaveTextContent("RFC_COMMUNICATION_FAILURE: connection reset");
  });
});
