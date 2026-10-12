// frontend/app/(app)/home/__tests__/persona-home.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as findingsApi from "@/lib/api/findings";
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
import StewardHomePage from "../steward/page";
import BasisHomePage from "../basis/page";

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

describe("PersonaHomePage data layout", () => {
  it("shows the run DQS, six linked dimension stats and a worst-first objects table", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });

    renderWithQuery(<LeadHomePage />);

    const dims = await screen.findByTestId("home-dimensions");
    expect(dims.querySelectorAll("a[href*='dimension=']")).toHaveLength(6);
    expect(screen.getByTestId("home-verdict-row")).toBeInTheDocument();
    expect(screen.getByText("Objects, worst first")).toBeInTheDocument();
    expect(screen.getAllByText("Material Master").length).toBeGreaterThan(0);
    // No count tile is a button wrapping a link.
    expect(document.querySelector("button a")).toBeNull();
  });
});

describe("PersonaHomePage blocking and loading states", () => {
  const CAPPED: Version = {
    ...LATEST,
    dqs_summary: { material_master: { ...LATEST.dqs_summary!.material_master, critical_count: 3, capped: true, cap_reason: "capped at 60 by critical rules" } },
  };
  const finding = (check_id: string) => ({ id: check_id, check_id, module: "material_master", severity: "critical" });

  it("names up to two distinct critical rules in the cap line as drill links, never /findings", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [CAPPED] });
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [finding("MM-001"), finding("MM-001"), finding("MM-002"), finding("MM-003")],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);

    const { container } = renderWithQuery(<LeadHomePage />);

    const [link] = await screen.findAllByRole("link", { name: "MM-001" });
    expect(link).toHaveAttribute("href", "/objects/material_master/rules/MM-001?run=v1");
    expect(screen.getByRole("link", { name: "MM-002" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "MM-003" })).toBeNull();
    expect(container.querySelector("a[href^='/findings']")).toBeNull();
  });

  it("shows plain cap text while findings load", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [CAPPED] });
    vi.spyOn(findingsApi, "getFindings").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<LeadHomePage />);

    expect(await screen.findByText(/Capped at 60 by 3 critical rules/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /MM-/ })).toBeNull();
  });

  it("counts critical plus high as blocking and links it to the objects list", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });

    renderWithQuery(<LeadHomePage />);

    const stat = (await screen.findByText("Blocking findings")).closest("a");
    expect(stat).toHaveAttribute("href", "/objects?run=v1&readiness=fail");
    expect(stat).toHaveTextContent("1");
  });

  it("shows a dash, no hint, for inbox and proposals until counts load", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(shellApi, "getShellCounts").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<StewardHomePage />);

    const inbox = (await screen.findByText("Open inbox")).closest("a");
    expect(inbox).toHaveTextContent("—");
    expect(inbox).not.toHaveTextContent(/clear|0/);
    expect((await screen.findByText("Cleaning proposals")).closest("a")).not.toHaveTextContent(/clear/);
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

    await waitFor(() => expect(screen.getByText(/no analysis yet|analysed yet|objects are not ready/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });
});

describe("PersonaHomePage empty mode (all list APIs 404)", () => {
  it.each([["lead", LeadHomePage], ["steward", StewardHomePage], ["basis", BasisHomePage]])(
    "%s logs no duplicate-key warning",
    async (_role, Page) => {
      const nf = () => new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse);
      vi.spyOn(objectsApi, "getObjects").mockRejectedValue(nf());
      vi.spyOn(versionsApi, "getVersions").mockRejectedValue(nf());
      vi.spyOn(connectivityApi, "getSystems").mockRejectedValue(nf());
      vi.spyOn(configLoadApi, "getConfigLandscape").mockRejectedValue(nf());
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      renderWithQuery(<Page />);
      await new Promise((r) => setTimeout(r, 100));

      const dup = err.mock.calls.filter((c) => String(c[0]).includes("same key") || c.some((a) => String(a).includes("same key")));
      expect(dup.map((c) => c.map(String).join(" ").slice(0, 200))).toEqual([]);
    },
  );
});
