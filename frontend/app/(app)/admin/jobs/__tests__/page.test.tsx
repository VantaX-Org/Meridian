import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as jobsApi from "@/lib/api/jobs";
import * as connectivityApi from "@/lib/api/connectivity";
import type { Job } from "@/types/jobs";
import JobsPage from "../page";

let perms = new Set<string>();
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.has(a), loading: false }) }));

const BASE: Job = {
  id: "j1", kind: "analysis", status: "failed", label: "Re-analysis", stage: null, stages: [], percent: 40,
  rows_done: 0, rows_total: 0, message: "Failed", tables: [], error: "Worker lost", result: null,
  started_at: 1, updated_at: 2, finished_at: 2, system_id: "s-1", version_id: "v-1",
};

describe("admin jobs page", () => {
  beforeEach(() => {
    perms = new Set();
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s-1", name: "ECC PRD" }] as never);
  });

  it("retries a failed analysis for a user who may analyse", async () => {
    perms = new Set(["analyse"]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([BASE]);
    const retry = vi.spyOn(jobsApi, "retryJob").mockResolvedValue({ job_id: "v-1", status: "pending" });
    renderWithQuery(<JobsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry Re-analysis" }));
    expect(await screen.findByText("Analyse the ECC PRD data again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("j1"));
  });

  it("shows no Retry to a user without the start permission, nor on an upload", async () => {
    perms = new Set(["trigger_sync"]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([BASE, { ...BASE, id: "j2", kind: "upload", label: "file.csv" }]);
    renderWithQuery(<JobsPage />);
    await screen.findByText("file.csv");
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("sends a failed extraction without a recorded request to its system's Extract drawer", async () => {
    perms = new Set(["trigger_sync"]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([{ ...BASE, kind: "extraction", label: "material_master" }]);
    renderWithQuery(<JobsPage />);
    expect(await screen.findByRole("link", { name: "Extract material_master again" })).toHaveAttribute("href", "/systems/s-1?extract=1");
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
  });
});
