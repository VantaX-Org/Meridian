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
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(nav.search) }));

const OBJECTS: ObjectSummary[] = [
  { module: "material_master", label: "Material master", composite_score: 72.5, readiness: "warn", failing_checks: 1, affected_records: 120 },
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
    expect(screen.getAllByText("Material master").length).toBeGreaterThan(0);
    // No count tile is a button wrapping a link.
    expect(document.querySelector("button a")).toBeNull();
  });
});

describe("PersonaHomePage lineage and heatmap", () => {
  it("prints each dimension score in the heatmap cell with the readiness as its tone", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    renderWithQuery(<LeadHomePage />);
    const cell = await screen.findByLabelText("Material master Uniqueness: 95, go");
    expect(cell).toHaveTextContent("95");
    expect(screen.getByLabelText("Material master Completeness: 80, at risk")).toHaveTextContent("80");
    expect(screen.getByLabelText(/Material master Timeliness: 60, /)).toHaveTextContent("60");
  });

  it("calls the only run of its lineage the first run instead of comparing with another object's run", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    const other: Version = {
      ...LATEST, id: "v0", label: "Controlling", run_at: "2026-10-01T00:00:00Z",
      dqs_summary: { controlling: { ...LATEST.dqs_summary!.material_master, composite_score: 95 } },
      metadata: { modules: ["controlling"], file_name: "c.csv", row_count: 1 },
    };
    const upload: Version = { ...LATEST, metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1 } };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [upload, other] });
    renderWithQuery(<LeadHomePage />);
    const dqs = await screen.findByTestId("home-dqs");
    expect(dqs).toHaveTextContent("First run of Material master");
    expect(dqs).not.toHaveTextContent("vs Controlling");
  });
});

describe("PersonaHomePage blocking and loading states", () => {
  const CAPPED: Version = {
    ...LATEST,
    dqs_summary: { material_master: { ...LATEST.dqs_summary!.material_master, critical_count: 3, capped: true, cap_reason: "capped at 60 by critical rules" } },
  };
  const finding = (check_id: string) => ({ id: check_id, version_id: "v1", check_id, module: "material_master", severity: "critical" });

  it("names up to two distinct critical rules in the cap line as drill links, never /findings", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [CAPPED] });
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [finding("MM-001"), finding("MM-001"), finding("MM-002"), finding("MM-003")],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);

    const { container } = renderWithQuery(<LeadHomePage />);

    const [link] = await screen.findAllByRole("link", { name: "MM-001" });
    expect(link).toHaveAttribute("href", "/objects/material_master?run=v1&tab=records&check_id=MM-001");
    expect(screen.getByRole("link", { name: "MM-002" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "MM-003" })).toBeNull();
    expect(container.querySelector("a[href^='/findings']")).toBeNull();
  });

  it("counts the critical rules it does not name", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [CAPPED] });
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [finding("MM-001"), finding("MM-002"), finding("MM-003")],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);

    renderWithQuery(<LeadHomePage />);

    await screen.findAllByRole("link", { name: "MM-001" });
    expect(screen.getByText(/Capped at 60 by 3 critical rules/)).toHaveTextContent(/and 1 more/);
  });

  it("takes count and names from the cap reason, so the line always adds up, even before findings load", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    const reason = "4 critical failures over tolerance (BP019: 4% of BUT000 rows; BP002: 3% of BUT000 rows; BP007: 2% of BUT000 rows; BP011: 2% of BUT000 rows) — score capped at 70";
    const bp: Version = { ...LATEST, dqs_summary: { material_master: { ...LATEST.dqs_summary!.material_master, composite_score: 70, critical_count: 6, capped: true, cap_reason: reason } } };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [bp] });
    vi.spyOn(findingsApi, "getFindings").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<LeadHomePage />);

    const line = await screen.findByText(/Capped at 70 by 4 critical rules/);
    expect(line).toHaveTextContent("Capped at 70 by 4 critical rules: BP019, BP002 and 2 more");
    // the cap line, and the objects table's blocking rule until the findings name a higher-impact one
    for (const link of screen.getAllByRole("link", { name: "BP019" })) {
      expect(link).toHaveAttribute("href", "/objects/material_master?run=v1&tab=records&check_id=BP019");
    }
  });

  it("counts an object whose cap reason names no rule by its critical count", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    const mm = LATEST.dqs_summary!.material_master;
    const two: Version = { ...LATEST, dqs_summary: {
      material_master: { ...mm, composite_score: 85, critical_count: 1, capped: true, cap_reason: "1 critical failure over tolerance (BP019: 4% of BUT000 rows) — score capped at 85" },
      business_partner: { ...mm, composite_score: 85, critical_count: 1, capped: true, cap_reason: "1 critical failure — score capped at 85" },
    } };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [two] });
    vi.spyOn(findingsApi, "getFindings").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<LeadHomePage />);

    expect(await screen.findByText(/Capped at 85 by 2 critical rules/)).toHaveTextContent("Capped at 85 by 2 critical rules: BP019 and 1 more");
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
    expect(stat).toHaveAttribute("href", "/objects?readiness=fail");
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

  it("gives the steward one Export menu, not two side by side", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });

    renderWithQuery(<StewardHomePage />);

    await screen.findByRole("button", { name: "Export" });
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
  });

  it("does not render the header export action while gated by useDayOne's day-one journey", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({
      step: { key: "connect", href: "/systems", label: "Connect a system.", detail: "", actionable: true },
      status: "ready",
    });

    renderWithQuery(<LeadHomePage />);

    await waitFor(() => expect(screen.getByText(/no analysis yet|analysed yet|ready for go-live/i)).toBeInTheDocument());
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

describe("PersonaHomePage current state across objects", () => {
  const summary = LATEST.dqs_summary!.material_master;
  const upload = (id: string, run_at: string, module: string, score: number, extra: Partial<typeof summary> = {}): Version => ({
    id, label: `${module}_1k`, status: "agents_complete", run_at,
    dqs_summary: { [module]: { ...summary, composite_score: score, ...extra } },
    metadata: { modules: [module], file_name: `${module}.csv`, row_count: 1000 },
  });
  // Two uploads of controlling (the newest runs) and one each of material master and accounts payable.
  const RUNS = [
    upload("co2", "2026-10-16T05:17:46Z", "controlling", 70, { critical_count: 2, high_count: 1 }),
    upload("co1", "2026-10-16T05:17:40Z", "controlling", 64),
    upload("mm1", "2026-10-16T03:05:18Z", "material_master", 95),
    upload("ap1", "2026-10-16T03:01:18Z", "accounts_payable", 80, { high_count: 4 }),
  ];

  beforeEach(() => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: RUNS });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "co2", objects: [], thresholds: { target: 90, warning: 75, critical: 60 } });
  });

  it("summarises every object at its latest run, not the newest run alone", async () => {
    renderWithQuery(<LeadHomePage />);

    expect(await screen.findByTestId("run-scope")).toHaveTextContent("Current state of 3 objects, latest run 16 Oct 2026");
    expect(screen.getByTestId("home-verdict")).toHaveTextContent("1 of 3 objects is not ready for go-live.");
    // (70 + 95 + 80) / 3 against the state before the newest run, (64 + 95 + 80) / 3: +2
    const dqs = screen.getByTestId("home-dqs");
    expect(dqs).toHaveTextContent("vs before the latest run");
    expect(dqs).toHaveTextContent("2.0");
    const notReady = (screen.getByText("Objects not ready")).closest("a");
    expect(notReady).toHaveTextContent("of 3");
    expect(notReady).toHaveAttribute("href", "/objects?readiness=fail");
    // critical and high: controlling 2 + 1, material master 1, accounts payable 4
    expect((screen.getByText("Blocking findings")).closest("a")).toHaveTextContent("8");
    expect(screen.getByText("All objects, each at its latest run by then")).toBeInTheDocument();
  });

  it("opens each object at the run its numbers come from", async () => {
    const reason = "1 critical failure over tolerance (MM045: 4% of MARA rows) — score capped at 85";
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({
      versions: RUNS.map((r) => (r.id === "mm1" ? upload("mm1", r.run_at, "material_master", 85, { critical_count: 1, capped: true, cap_reason: reason }) : r)),
    });

    renderWithQuery(<StewardHomePage />);

    await screen.findByTestId("run-scope");
    expect((screen.getByText("Worst object")).closest("a")).toHaveAttribute("href", "/objects/controlling?run=co2");
    expect(screen.getByRole("link", { name: "Open worst object" })).toHaveAttribute("href", "/objects/controlling?run=co2");
    // the blocking rule of an object that is not in the newest run drills into that object's own run
    expect(screen.getByRole("link", { name: "MM045" })).toHaveAttribute("href", "/objects/material_master?run=mm1&tab=records&check_id=MM045");
    expect(screen.getByText("1 of 3 objects capped by critical rules")).toBeInTheDocument();
  });

  it("asks the findings endpoints for the current state, not one run", async () => {
    const top = vi.spyOn(findingsApi, "getFindings").mockResolvedValue({ findings: [] } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);
    const agg = vi.spyOn(findingsApi, "getFindingsAggregate").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<LeadHomePage />);

    await screen.findByTestId("run-scope");
    await waitFor(() => expect(top).toHaveBeenCalledWith({ sort: "impact", limit: 100 }));
    expect(agg).toHaveBeenCalledWith(undefined);
  });

  it("with ?run= shows that one run, names it, and offers the way back", async () => {
    nav.search = "run=co1";
    try {
      renderWithQuery(<LeadHomePage />);

      const scope = await screen.findByTestId("run-scope");
      expect(scope).toHaveTextContent("As of controlling_1k, 16 Oct 2026");
      expect(screen.getByRole("link", { name: "Back to latest" })).toHaveAttribute("href", "/home/lead");
      expect(screen.getByTestId("home-verdict")).toHaveTextContent("1 of 1 object is not ready for go-live.");
      expect(screen.getByTestId("home-dqs")).toHaveTextContent("First run for this object");
      expect((screen.getByText("Objects not ready")).closest("a")).toHaveAttribute("href", "/objects?run=co1&readiness=fail");
    } finally {
      nav.search = "";
    }
  });
});
