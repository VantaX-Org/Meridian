// frontend/app/(app)/home/__tests__/persona-home.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as findingsApi from "@/lib/api/findings";
import * as versionsApi from "@/lib/api/versions";
import * as shellApi from "@/lib/api/shell";
import * as stewardshipApi from "@/lib/api/stewardship";
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

const perms = vi.hoisted(() => ({ can: (() => true) as (action: string) => boolean }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.can(a) }) }));
vi.mock("@/components/insight/route-insight", () => ({ RouteInsight: () => null }));
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
  perms.can = () => true;
  // jsdom has no matchMedia; the trend chart's reduced-motion check needs a stub.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: OBJECTS });
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST] });
  vi.spyOn(shellApi, "getShellCounts").mockResolvedValue({ fix: 0, inbox: 0 });
  vi.spyOn(stewardshipApi, "getQueueItems").mockResolvedValue({ items: [], total: 0 } as unknown as Awaited<ReturnType<typeof stewardshipApi.getQueueItems>>);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
  vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 0 });
  vi.spyOn(jobsHook, "useJobs").mockReturnValue({ active: [], jobs: [] } as unknown as ReturnType<typeof jobsHook.useJobs>);
  vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue(undefined);
});

describe("PersonaHomePage 404 handling", () => {
  it("treats a 404 from the objects list as empty, not an error", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(objectsApi, "getObjects").mockRejectedValue(new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse));

    renderWithQuery(<LeadHomePage />);

    await waitFor(() => expect(objectsApi.getObjects).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });
});

describe("PersonaHomePage data layout", () => {
  it("shows the run DQS, six linked dimension stats and the ledger of what moves the score", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });

    renderWithQuery(<LeadHomePage />);

    const dims = await screen.findByTestId("home-dimensions");
    expect(dims.querySelectorAll("a[href*='dimension=']")).toHaveLength(6);
    expect(screen.getByTestId("home-verdict-row")).toBeInTheDocument();
    expect(screen.getByText("What moves the score")).toBeInTheDocument();
    expect(screen.getAllByText("Material master").length).toBeGreaterThan(0);
    // No count tile is a button wrapping a link.
    expect(document.querySelector("button a")).toBeNull();
  });
});

describe("PersonaHomePage Brief geometry", () => {
  const SECOND = { ...LATEST.dqs_summary!.material_master, composite_score: 95 };
  const two: Version = { ...LATEST, dqs_summary: { material_master: LATEST.dqs_summary!.material_master, controlling: SECOND }, metadata: { modules: ["material_master", "controlling"], file_name: "f.csv", row_count: 5000, object_rows: { material_master: 4000, controlling: 1000 } } };
  const find = (check_id: string, module: string, extra: Record<string, unknown> = {}) => ({ id: `${module}-${check_id}`, version_id: "v1", check_id, module, severity: "critical", details: { message: "Material description is missing." }, ...extra });

  beforeEach(() => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [two] });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: OBJECTS });
  });

  it("puts the object map and the dimension bars in the hero, beside the score", async () => {
    renderWithQuery(<LeadHomePage />);
    const hero = await screen.findByTestId("home-verdict-row");
    const aside = screen.getByTestId("home-hero-aside");
    expect(hero).toContainElement(aside);
    expect(hero).toContainElement(screen.getByTestId("home-dqs"));
    expect(aside).toContainElement(screen.getByLabelText("Objects by records and verdict"));
    expect(aside).toContainElement(screen.getByTestId("home-dimensions"));
    // a tile per object: the score, the records the run holds for it, opening the object at its run
    const tile = screen.getByRole("link", { name: "Material master, 72.5, 4,000 records" });
    expect(tile).toHaveAttribute("href", "/objects/material_master?run=v1");
    expect(screen.getByRole("link", { name: "Controlling, 95.0, 1,000 records" })).toBeInTheDocument();
  });

  it("sets the ledger after the four sentences and the hero, and ranks it by records affected", async () => {
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({
      version_ids: ["v1"], total: 2, affected_records: 120, severity: { critical: 0, high: 2, medium: 0, low: 0 }, by_module: [
        { module: "material_master", findings: 1, affected: 120, critical: 0, high: 1, medium: 0, low: 0, avg_pass_rate: 0.9 },
        { module: "controlling", findings: 1, affected: 900, critical: 0, high: 1, medium: 0, low: 0, avg_pass_rate: 0.9 },
      ], by_dimension: [], avg_pass_rate: 0.9, dqs: { composite: 80, dimension_scores: {}, modules: {} }, previous_dqs: null,
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindingsAggregate>>);
    renderWithQuery(<LeadHomePage />);
    await screen.findByTestId("home-verdict-row");
    const ledger = await screen.findByText("What moves the score");
    expect(screen.getByTestId("home-verdict-row").compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveTextContent("Controlling");
      expect(rows[1]).toHaveTextContent("Material master");
    });
    for (const h of ["Object", "Blocking rule", "Rule failures", "Score", "Verdict"]) expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All 2 objects" })).toHaveAttribute("href", "/objects");
  });

  it("names the blocking rule as an id plus words and ends the row with one action, Fix when a proposal exists else Open", async () => {
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [
        find("MM-001", "material_master", { record_fixes: [{ record_id: "1" }] }),
        find("CO-002", "controlling", { details: { message: "Cost centre has no external code" } }),
      ],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);
    renderWithQuery(<LeadHomePage />);
    const link = await screen.findByRole("link", { name: "MM-001" });
    expect(link.closest("tr")).toHaveTextContent("Material description is missing");
    expect(screen.getByRole("link", { name: "Fix Material master" })).toHaveAttribute("href", "/fix?run=v1&module=material_master&check=MM-001");
    expect(screen.getByRole("link", { name: "Open Controlling" })).toHaveAttribute("href", "/objects/controlling?run=v1");
    expect(screen.queryByRole("link", { name: "Fix Controlling" })).toBeNull();
  });

  it("offers Open, never Fix, to a role that can neither apply nor approve", async () => {
    perms.can = (a) => a === "view" || a === "export";
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [find("MM-001", "material_master", { record_fixes: [{ record_id: "1" }] })],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);
    renderWithQuery(<LeadHomePage />);
    await screen.findByRole("link", { name: "MM-001" });
    expect(screen.queryByRole("link", { name: "Fix Material master" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Material master" })).toHaveAttribute("href", "/objects/material_master?run=v1");
  });

  it("keeps Fix for an approver who cannot apply", async () => {
    perms.can = (a) => a === "view" || a === "approve";
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [find("MM-001", "material_master", { record_fixes: [{ record_id: "1" }] })],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);
    renderWithQuery(<LeadHomePage />);
    expect(await screen.findByRole("link", { name: "Fix Material master" })).toBeInTheDocument();
  });

  it("keeps the onboarding as one row under the ledger, before the work row", async () => {
    renderWithQuery(<LeadHomePage />);
    const ledger = await screen.findByText("What moves the score");
    const work = screen.getByText("Objects below target");
    expect(ledger.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("home-trend")).toBeInTheDocument();
  });
});

describe("PersonaHomePage lineage and heatmap", () => {
  it("prints each dimension score in the heatmap cell with the readiness as its tone", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    renderWithQuery(<LeadHomePage />);
    const cell = await screen.findByLabelText("Material master Uniqueness: 95, go");
    expect(cell).toHaveTextContent("95");
    expect(screen.getByLabelText("Material master Completeness: 80, at risk")).toHaveTextContent("80");
    expect(screen.getByLabelText(/Material master Timeliness: 60, /)).toHaveTextContent("60");
  });

  it("calls the only run of its lineage the first run instead of comparing with another object's run", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
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
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
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
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [CAPPED] });
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [finding("MM-001"), finding("MM-002"), finding("MM-003")],
    } as unknown as Awaited<ReturnType<typeof findingsApi.getFindings>>);

    renderWithQuery(<LeadHomePage />);

    await screen.findAllByRole("link", { name: "MM-001" });
    expect(screen.getByText(/Capped at 60 by 3 critical rules/)).toHaveTextContent(/and 1 more/);
  });

  it("takes count and names from the cap reason, so the line always adds up, even before findings load", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
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
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
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
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [CAPPED] });
    vi.spyOn(findingsApi, "getFindings").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<LeadHomePage />);

    expect(await screen.findByText(/Capped at 60 by 3 critical rules/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /MM-/ })).toBeNull();
  });

  it("counts critical plus high findings and links one run's count to its findings, critical and high", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });

    renderWithQuery(<LeadHomePage />);

    const stat = (await screen.findByText("Critical and high findings")).closest("a");
    expect(stat).toHaveAttribute("href", "/runs/v1?tab=findings&severity=critical,high");
    expect(stat).toHaveTextContent("1");
  });

  it("sets the steward's work row and inbox items before the score, and the lead's after it", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(stewardshipApi, "getQueueItems").mockResolvedValue({ items: [
      { id: "q1", tenant_id: "t", item_type: "merge_decision", source_id: "s", domain: "material_master", priority: 1, due_at: null, assigned_to: null, status: "open", sla_hours: null, created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z", ai_recommendation: null, ai_confidence: null },
    ], total: 1 } as unknown as Awaited<ReturnType<typeof stewardshipApi.getQueueItems>>);

    renderWithQuery(<StewardHomePage />);

    const items = await screen.findByTestId("home-inbox-items");
    expect(items).toHaveTextContent("Merge decision, Material master");
    // Each item opens that task in the inbox, not every task of its type.
    expect(within(items).getByRole("link", { name: /Merge decision/ })).toHaveAttribute("href", "/inbox?focus=q1");
    const hero = screen.getByTestId("home-verdict-row");
    const inbox = screen.getByText("Open inbox").closest("a") as HTMLElement;
    expect(inbox.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(items.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the lead's score before the work row", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    renderWithQuery(<LeadHomePage />);
    const hero = await screen.findByTestId("home-verdict-row");
    const inbox = screen.getByText("Open inbox").closest("a") as HTMLElement;
    expect(hero.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a dash, no hint, for inbox and proposals until counts load", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(shellApi, "getShellCounts").mockReturnValue(new Promise(() => {}));

    renderWithQuery(<StewardHomePage />);

    const inbox = (await screen.findByText("Open inbox")).closest("a");
    expect(inbox).toHaveTextContent("—");
    expect(inbox).not.toHaveTextContent(/clear|0/);
    expect((await screen.findByText("Records to fix")).closest("a")).not.toHaveTextContent(/clear/);
  });

  it("labels the steward's fix tile as cleaning proposals when the latest run has no work list", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(shellApi, "getShellCounts").mockResolvedValue({ fix: 4, fix_source: "cleaning", inbox: 0 });
    renderWithQuery(<StewardHomePage />);
    const tile = (await screen.findByText("Cleaning proposals to review")).closest("a");
    expect(tile).toHaveAttribute("href", "/fix?tab=cleaning");
    expect(tile).toHaveTextContent("4");
    expect(screen.queryByText("Records to fix")).toBeNull();
  });
});

describe("PersonaHomePage header actions (T20)", () => {
  it("offers the executive PDF in the header when a run is ready", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });

    renderWithQuery(<LeadHomePage />);

    const exportButton = await screen.findByRole("button", { name: "Export" });
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(downloadApi.downloadAuthenticated).toHaveBeenCalledWith(
        "/api/v1/reports/executive/v1.pdf",
        expect.stringMatching(/^Meridian executive report – Oct 8 – \d{4}-\d{2}-\d{2}\.pdf$/),
      ),
    );
  });

  it("gives the steward one Export menu, not two side by side", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });

    renderWithQuery(<StewardHomePage />);

    await screen.findByRole("button", { name: "Export" });
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
  });

  it("does not render the header export action while gated by useDayOne's day-one journey", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({
      step: { key: "connect", href: "/systems", label: "Connect a system.", detail: "", actionable: true },
      status: "ready", error: null, refetch: vi.fn(),
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
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: RUNS });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "co2", objects: [], thresholds: { target: 90, warning: 75, critical: 60 } });
  });

  it("summarises every object at its latest run, not the newest run alone", async () => {
    renderWithQuery(<LeadHomePage />);

    // Every number names its runs: the state's sources, each linking to its run alone.
    // One line, no raw run ids: the runs sit behind a "3 runs" disclosure, each named by its object.
    const sources = await screen.findByTestId("run-sources");
    expect(sources).toHaveTextContent("Current state of 3 objects, latest run 16 Oct 2026, from 3 runs");
    expect(sources).not.toHaveTextContent("controlling_1k");
    fireEvent.click(screen.getByRole("button", { name: "3 runs" }));
    const list = await screen.findByTestId("run-source-list");
    expect(within(list).getAllByRole("link")).toHaveLength(3);
    expect(within(list).getByRole("link", { name: /^Controlling/ })).toHaveAttribute("href", "/home/lead?run=co2");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.getByTestId("home-verdict")).toHaveTextContent("1 of 3 objects is not ready for go-live, 1 at risk.");
    // (70 + 95 + 80) / 3 against the state before the newest run, (64 + 95 + 80) / 3: +2
    const dqs = screen.getByTestId("home-dqs");
    expect(dqs).toHaveTextContent("vs before the latest run");
    expect(dqs).toHaveTextContent("2.0");
    const notReady = (screen.getByText("Objects below target")).closest("a");
    // below target is at risk or no-go: controlling (no-go) and material master (at risk)
    expect(notReady).toHaveTextContent(/2\s*of 3/);
    expect(notReady).toHaveAttribute("href", "/objects?readiness=warn%2Cfail");
    // critical and high: controlling 2 + 1, material master 1, accounts payable 4
    const criticalHigh = (screen.getByText("Critical and high findings")).closest("a");
    expect(criticalHigh).toHaveTextContent("8");
    // Several runs: the current-state findings filtered to critical and high, not the objects below target.
    expect(criticalHigh).toHaveAttribute("href", "/insights?severity=critical,high");
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
    // The verdict's next step is the home's one primary button; Run analysis is secondary.
    expect(screen.getByRole("link", { name: "Open worst object" })).toHaveClass("m-btn-primary");
    expect(screen.getByRole("button", { name: "Run analysis" })).toHaveClass("m-btn-secondary");
    // the blocking rule of an object that is not in the newest run drills into that object's own run
    expect(screen.getByRole("link", { name: "MM045" })).toHaveAttribute("href", "/objects/material_master?run=mm1&tab=records&check_id=MM045");
    expect(screen.getByText("1 of 3 objects capped by critical rules")).toBeInTheDocument();
  });

  it("gives a data owner (approves, cannot apply) Open approvals as the steward home's next step", async () => {
    perms.can = (a) => a === "view" || a === "approve" || a === "export";
    renderWithQuery(<StewardHomePage />);
    const open = await screen.findByRole("link", { name: "Open approvals" });
    expect(open).toHaveAttribute("href", "/fix?tab=batches");
    expect(open).toHaveClass("m-btn-primary");
    expect(screen.queryByRole("link", { name: "Open worst object" })).toBeNull();
  });

  it("gives the auditor Open audit log, not the lead's objects below target", async () => {
    perms.can = (a) => a === "view" || a === "export" || a === "view_audit";
    renderWithQuery(<LeadHomePage />);
    expect(await screen.findByRole("link", { name: "Open audit log" })).toHaveAttribute("href", "/admin/audit");
    expect(screen.queryByRole("link", { name: "Open objects below target" })).toBeNull();
  });

  it("keeps Open objects below target for a viewer, who has no audit log", async () => {
    perms.can = (a) => a === "view";
    renderWithQuery(<LeadHomePage />);
    expect(await screen.findByRole("link", { name: "Open objects below target" })).toBeInTheDocument();
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
      expect(scope).toHaveTextContent("controlling_1k, 16 Oct 2026");
      expect(screen.queryByTestId("run-sources")).toBeNull();
      expect(screen.getByRole("link", { name: "Back to current state" })).toHaveAttribute("href", "/home/lead");
      expect(screen.getByTestId("home-verdict")).toHaveTextContent("1 of 1 object is not ready for go-live.");
      expect(screen.getByTestId("home-dqs")).toHaveTextContent("First run for this object");
      expect((screen.getByText("Objects below target")).closest("a")).toHaveAttribute("href", "/objects?run=co1&readiness=warn%2Cfail");
    } finally {
      nav.search = "";
    }
  });
});

describe("PersonaHomePage error state", () => {
  const http = (status: number) => new AxiosError("x", "ERR_BAD_RESPONSE", undefined, undefined, { status, data: {} } as AxiosResponse);
  const callCount = (f: unknown) => (f as { mock: { calls: unknown[] } }).mock.calls.length;

  it("names the failing source's error and Retry reads objects, runs, systems and the landscape again", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockRejectedValue(http(500));
    renderWithQuery(<LeadHomePage />);

    expect(await screen.findByText("The server could not complete the request.")).toBeInTheDocument();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
    const sources = [objectsApi.getObjects, versionsApi.getVersions, connectivityApi.getSystems, configLoadApi.getConfigLandscape];
    const before = sources.map(callCount);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => sources.forEach((f, i) => expect(callCount(f)).toBeGreaterThan(before[i])));
  });

  it("shows an inline error with Retry on the steward's inbox card, never \"Nothing waits in the inbox\"", async () => {
    vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
    const queue = vi.spyOn(stewardshipApi, "getQueueItems").mockRejectedValue(http(503));
    renderWithQuery(<StewardHomePage />);

    const alert = await screen.findByTestId("home-inbox-error");
    expect(alert).toHaveTextContent("The inbox did not load");
    expect(screen.queryByText("Nothing waits in the inbox")).toBeNull();
    const calls = queue.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(queue.mock.calls.length).toBeGreaterThan(calls));
  });
});
