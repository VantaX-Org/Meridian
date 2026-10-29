// The home's verdict button, its "do next" sentence and the To do card's first row name the same item.
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as shellApi from "@/lib/api/shell";
import * as workApi from "@/lib/api/work";
import * as stewardshipApi from "@/lib/api/stewardship";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as attentionApi from "@/lib/api/attention";
import * as jobsHook from "@/hooks/use-jobs";
import * as dayOneHook from "@/hooks/use-day-one";
import { SAMPLE, item, listOf } from "@/components/attention/__tests__/fixtures";
import type { Version } from "@/types/api";
import LeadHomePage from "../lead/page";
import StewardHomePage from "../steward/page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
// The Do next cell as the real RouteInsight sets it on a home: the sentence of the step it is given, linked, no button.
vi.mock("@/components/insight/route-insight", () => ({
  RouteInsight: ({ doNext }: { doNext?: { sentence: string; href: string } }) => (doNext ? <a data-testid="do-next" href={doNext.href}>{`${doNext.sentence}.`}</a> : <p data-testid="do-next">no step</p>),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

const LATEST: Version = {
  id: "v1", label: "Oct 8", status: "complete", run_at: "2026-10-08T00:00:00Z",
  dqs_summary: { material_master: { composite_score: 72.5, dimension_scores: { completeness: 80, accuracy: 90, consistency: 70, timeliness: 60, uniqueness: 95, validity: 85 }, critical_count: 0, high_count: 1, medium_count: 0, low_count: 0, total_checks: 10, passing_checks: 9, capped: false, cap_reason: null } },
  metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
};


beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(dayOneHook, "useDayOne").mockReturnValue({ status: "ready", step: null, error: null, refetch: vi.fn() });
  vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [{ module: "material_master", label: "Material master", composite_score: 72.5, readiness: "warn", failing_checks: 1, affected_records: 120, blocking_rule_id: "MM-001" }] });
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST] });
  vi.spyOn(shellApi, "getShellCounts").mockResolvedValue({ fix: 0, inbox: 0 });
  vi.spyOn(workApi, "getWorkSummary").mockResolvedValue({ version_id: null, scope: null, built: false, objects: [], totals: { records: 0, open: 0, issues: 0, critical: 0, proposed: 0, overdue: 0 } });
  vi.spyOn(stewardshipApi, "getQueueItems").mockResolvedValue({ items: [], total: 0 } as unknown as Awaited<ReturnType<typeof stewardshipApi.getQueueItems>>);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
  vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 0 });
  vi.spyOn(jobsHook, "useJobs").mockReturnValue({ active: [], jobs: [] } as unknown as ReturnType<typeof jobsHook.useJobs>);
});

function serve(items: attentionApi.AttentionItem[]) {
  const list = listOf(items);
  vi.spyOn(attentionApi, "getAttention").mockResolvedValue(list);
  vi.spyOn(attentionApi, "getAttentionCount").mockResolvedValue({ ...list.counts, top: items[0] ?? null });
}

const nextLine = () => screen.getByTestId("home-next");

describe("home and the To do list", () => {
  it("names one item in the verdict button, the Next line, the do next sentence and the card's first row", async () => {
    serve(SAMPLE);
    renderWithQuery(<LeadHomePage />);
    const title = SAMPLE[0].title;
    const button = await screen.findByRole("link", { name: SAMPLE[0].action_label });
    expect(button).toHaveAttribute("href", SAMPLE[0].href);
    expect(button.closest("[data-testid='home-verdict-row']")).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("do-next")).toHaveTextContent(title));
    expect(nextLine()).toHaveTextContent(`Next: ${title}.`);
    expect(screen.getByTestId("do-next")).toHaveAttribute("href", SAMPLE[0].href);
    // the four sentences sit inside the hero, the To do card under it
    expect(screen.getByTestId("home-verdict-row")).toContainElement(screen.getByTestId("do-next"));
    const first = (await screen.findAllByTestId("attention-row"))[0];
    expect(within(first).getByText(title)).toBeInTheDocument();
    expect(within(first).getByRole("link")).toHaveAttribute("href", SAMPLE[0].href);
  });

  it("takes the score's step when the top item is hygiene or admin (tier 4 and below): button, Next line and Do next cell agree", async () => {
    serve([item({ id: "x", tier: 4, severity: "medium", title: "310 records are overdue", action_label: "Open", href: "/fix?due=overdue" })]);
    renderWithQuery(<LeadHomePage />);
    // the ledger's row also offers "Open Material master"; the hero holds the one primary button
    const hero = await screen.findByTestId("home-verdict-row");
    const button = await within(hero).findByRole("link", { name: "Open Material master" });
    expect(button).toHaveAttribute("href", "/objects/material_master");
    const cell = screen.getByTestId("do-next");
    expect(cell).toHaveTextContent("Material master comes first, the lowest score at 72.5.");
    expect(nextLine()).toHaveTextContent("Next: Material master comes first, the lowest score at 72.5.");
    expect(cell).toHaveAttribute("href", button.getAttribute("href"));
    expect(hero.querySelectorAll(".m-btn-primary")).toHaveLength(1);
    expect((await screen.findAllByTestId("attention-row"))[0]).toHaveTextContent("310 records are overdue");
  });

  it("sends the steward to Fix work, the records to fix in the Next line and the Do next cell", async () => {
    serve(SAMPLE);
    vi.spyOn(shellApi, "getShellCounts").mockResolvedValue({ fix: 24576, inbox: 0 });
    renderWithQuery(<StewardHomePage />);
    const button = await screen.findByRole("link", { name: "Start fixing" });
    expect(button).toHaveAttribute("href", "/fix");
    await waitFor(() => expect(nextLine()).toHaveTextContent("Next: 24,576 records need fixing."));
    expect(screen.getByTestId("do-next")).toHaveTextContent("24,576 records need fixing.");
    expect((await screen.findAllByTestId("attention-row")).length).toBeGreaterThan(0);
  });

  it("says nothing is waiting once the list is empty", async () => {
    serve([]);
    renderWithQuery(<LeadHomePage />);
    expect(await screen.findByText("Nothing in your scope needs a person now")).toBeInTheDocument();
    expect(within(screen.getByTestId("home-verdict-row")).getByRole("link", { name: "Open Material master" })).toBeInTheDocument();
  });
});
