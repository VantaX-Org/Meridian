import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as discovery from "@/lib/api/process-discovery";
import type { CatalogueRow } from "@/lib/api/process-discovery";
import { NewRunDialog } from "../new-run-dialog";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const row = (l1: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  l1, name: l1, coverage: "reference", reason: null, licence_blocked: false,
  last_run: null, in_progress: null, failed: null, sources: [], ...over,
});

// A pilot customer's reality: ECC licensed for everything except the quality_management and project_system modules.
const rows = [
  row("PTP"), row("OTC"), row("R2R"),
  row("QM", { licence_blocked: true }),
  row("PS", { licence_blocked: true }),
  row("SFX", { reason: "Connect the SuccessFactors / Ariba / Concur system to discover this process." }),
];

const mount = () => renderWithQuery(
  <NewRunDialog open onOpenChange={() => {}} systemId="s1" systemName="Sanbox (ERP)" rows={rows} />,
);

beforeEach(() => vi.restoreAllMocks());

describe("process NewRunDialog licence gates", () => {
  it("shows blocked processes disabled and never selected by default", () => {
    mount();
    expect(screen.getByLabelText("Include QM")).toBeDisabled();
    expect(screen.getByLabelText("Include QM")).not.toBeChecked();
    expect(screen.getByLabelText("Include PS")).toBeDisabled();
    expect(screen.getByLabelText("Include PTP")).toBeChecked(); // the rest still default on
    expect(screen.getAllByText(/not in this licence/i)).toHaveLength(2); // QM and PS both say so
  });

  it("starts the run with only the licensed processes — no default selection can 402", async () => {
    const start = vi.spyOn(discovery, "startRuns").mockResolvedValue({ job_id: null, run_ids: ["r1", "r2"] });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][1].l1s).toEqual(["PTP", "OTC", "R2R", "SFX"]);
  });

  it("names the licence refusal in words, not \"Could not reach the server.\"", async () => {
    const sentence = "This deployment's licence does not include: quality_management. Ask your administrator to add it in Meridian HQ.";
    const err = new AxiosError("x", "ERR", undefined, undefined, {
      status: 402, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
      data: { detail: { error: "module_not_licenced", detail: sentence, modules: ["quality_management"] } },
    });
    vi.spyOn(discovery, "startRuns").mockRejectedValue(err);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByText("Could not start the run")).toBeInTheDocument();
    expect(screen.queryByText(/Could not reach the server/i)).not.toBeInTheDocument();
  });
});
