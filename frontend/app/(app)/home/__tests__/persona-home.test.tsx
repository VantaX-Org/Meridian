// frontend/app/(app)/home/__tests__/persona-home.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as shellApi from "@/lib/api/shell";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as downloadApi from "@/lib/api/download";
import * as jobsHook from "@/hooks/use-jobs";
import * as dayOneHook from "@/hooks/use-day-one";
import type { Version } from "@/types/api";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import LeadHomePage from "../lead/page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const OBJECTS: ObjectSummary[] = [
  { module: "material_master", label: "Material Master", composite_score: 72.5, readiness: "warn", failing_checks: 1, affected_records: 120 },
];

const LATEST: Version = {
  id: "v1",
  label: "Oct 8",
  status: "complete",
  run_at: "2026-10-08T00:00:00Z",
  dqs_summary: {
    material_master: {
      composite_score: 72.5,
      dimension_scores: { completeness: 80, accuracy: 90, consistency: 70, timeliness: 60, uniqueness: 95, validity: 85 },
      critical_count: 0,
      high_count: 1,
      medium_count: 0,
      low_count: 0,
      total_checks: 10,
      passing_checks: 9,
      capped: false,
      cap_reason: null,
    },
  },
  metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
};

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom has no matchMedia; the trend chart's reduced-motion check needs a stub.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: OBJECTS });
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST] });
  vi.spyOn(shellApi, "getShellCounts").mockResolvedValue({ fix: 0, inbox: 0 });
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
  vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 0 });
  vi.spyOn(jobsHook, "useJobs").mockReturnValue({ active: [], jobs: [] } as unknown as ReturnType<typeof jobsHook.useJobs>);
  vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue(undefined);
});

describe("PersonaHomePage 404 handling", () => {
  it("treats a 404 from the objects list as empty, not an error", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(objectsApi, "getObjects").mockRejectedValue(new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse));

    renderWithQuery(<LeadHomePage />);

    await waitFor(() => expect(objectsApi.getObjects).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });
});

describe("PersonaHomePage header actions (T20)", () => {
  it("offers the executive PDF in the header when a run is ready", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });

    renderWithQuery(<LeadHomePage />);

    const exportButton = await screen.findByRole("button", { name: "Export" });
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(downloadApi.downloadAuthenticated).toHaveBeenCalledWith(
        "/api/v1/reports/executive/v1.pdf",
        "meridian-executive-Oct 8.pdf",
      ),
    );
  });

  it("does not render the header export action while gated by useDayOne's day-one journey", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({
      step: { key: "connect", href: "/systems", label: "Connect a system.", detail: "", actionable: true },
      status: "ready",
    });

    renderWithQuery(<LeadHomePage />);

    await waitFor(() => expect(screen.getByText(/analysed yet|objects are not ready/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });
});
