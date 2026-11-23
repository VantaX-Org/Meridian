import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as cfg from "@/lib/api/v2/config";
import { MatchSummary, RootCauseSheet } from "./ConfigDetail";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/config", async (orig) => ({ ...(await orig<typeof cfg>()), getConfigMatchSummary: vi.fn(), getConfigRootCauseV2: vi.fn() }));

const RUN = "d3229ded-0708-4967-9dfb-1b7f4fada953";
let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/x?fixture=1"); vi.mocked(cfg.getConfigMatchSummary).mockReset(); vi.mocked(cfg.getConfigRootCauseV2).mockReset(); });
afterEach(() => undo());

describe("config detail", () => {
  it("shows the verdict counts", async () => {
    vi.mocked(cfg.getConfigMatchSummary).mockResolvedValue({ data_errors: 2, config_deviations: 1, ambiguous: 1, modules_with_deviations: ["material_master"] });
    renderWithQuery(<MatchSummary id={RUN} />);
    expect(await screen.findByRole("list", { name: "Verdicts of the run" }, { timeout: 5000 })).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
  });

  it("empty answer shows the route's message", async () => {
    vi.mocked(cfg.getConfigMatchSummary).mockResolvedValue({ message: "No summary for this run" });
    renderWithQuery(<MatchSummary id={RUN} />);
    expect(await screen.findByText("No summary for this run", undefined, { timeout: 5000 })).toBeTruthy();
  });

  it("summary error offers retry", async () => {
    vi.mocked(cfg.getConfigMatchSummary).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ data_errors: 0, config_deviations: 0, ambiguous: 0, modules_with_deviations: [] });
    renderWithQuery(<MatchSummary id={RUN} />);
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 }));
    expect(await screen.findByRole("list", { name: "Verdicts of the run" }, { timeout: 5000 })).toBeTruthy();
  });

  it("root cause sheet shows the type and fix, and retries on error", async () => {
    vi.mocked(cfg.getConfigRootCauseV2).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ finding_id: "CHK1", root_cause_type: "bad_config", data_issue: null, config_issue: "Wrong default", process_issue: null, recommendation: "Change the default" });
    renderWithQuery(<RootCauseSheet checkId="CHK1" module="material_master" onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 }));
    expect(await screen.findByText("Bad configuration", undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Change the default")).toBeTruthy();
  });
});
