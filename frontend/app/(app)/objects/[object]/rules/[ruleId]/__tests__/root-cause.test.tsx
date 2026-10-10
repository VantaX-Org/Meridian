import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as versionsApi from "@/lib/api/versions";
import { RootCauseSection } from "../root-cause";

const base = { version_id: "v1", check_id: "MMTEST", field: "MARC.DISMM", analysed: 4, total: 4, detail: "" };

describe("RootCauseSection", () => {
  it("shows the headline and the top origins", async () => {
    vi.spyOn(versionsApi, "getFindingRootCause").mockResolvedValue({
      ...base, status: "computed",
      summary: "50% of failing MARC.DISMM values were last set by interface/batch user BATCH_IF01 via MM02.",
      origins: [
        { origin: "interface", username: "BATCH_IF01", tcode: "MM02", records: 2, share: 50 },
        { origin: "migration", username: "JDOE", tcode: "MM01", records: 1, share: 25 },
      ],
    });
    renderWithQuery(<RootCauseSection run="v1" ruleId="MMTEST" />);
    expect(await screen.findByText(/last set by interface\/batch user BATCH_IF01/)).toBeInTheDocument();
    expect(screen.getByText("BATCH_IF01")).toBeInTheDocument();
    expect(screen.getByText("Interface / batch")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("explains a root cause that is not computed yet", async () => {
    vi.spyOn(versionsApi, "getFindingRootCause").mockResolvedValue({
      ...base, status: "not_computed", summary: "", origins: [], field: null,
    });
    renderWithQuery(<RootCauseSection run="v1" ruleId="MMTEST" />);
    expect(await screen.findByText(/not computed for this run yet/i)).toBeInTheDocument();
  });
});
