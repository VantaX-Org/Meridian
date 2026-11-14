import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../kit";
import { SheetHost } from "../shell/SheetHost";
import { Home } from "../feed/Home";
import { Greeting } from "../feed/Greeting";
import { QuietRow } from "../feed/QuietRow";
import { StoryCard } from "../feed/StoryCard";
import { StoryCardSkeleton } from "../feed/StoryCardSkeleton";
import { ObjectsSheet } from "../feed/ObjectsSheet";
import { deltaSentence, greetingWord, lede, needsYou, orderFeed } from "../feed/model";
import type { AletheiaFinding } from "@/lib/api/v2/insights";
import { getPortfolioAll, type PortfolioPage, type PortfolioRow } from "@/lib/api/next/portfolio";
import type { PortfolioActions } from "../portfolio/BulkBar";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const start = vi.fn(async (ids: string[]) => ({ queued: ids, skipped: [] as string[] }));
// A test may set `page` or `systems` to drive Home past the fixture; null keeps the fixture data.
let page: PortfolioPage | null = null;
let systems: { id: string; name: string }[] | null = null;
vi.mock("@/lib/api/next/portfolio", async (orig) => {
  const m = await orig<typeof import("@/lib/api/next/portfolio")>();
  return {
    ...m,
    startObjects: (ids: string[]) => start(ids),
    usePortfolio: (q: Parameters<typeof m.usePortfolio>[0], all?: boolean) => (page ? { data: page, isLoading: false, isError: false, isFetching: false, error: null, refetch: vi.fn() } : m.usePortfolio(q, all)),
  };
});
vi.mock("@/lib/v2/runs-queries", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/runs-queries")>();
  return { ...m, useSystemsExtended: () => (systems ? { data: systems } : m.useSystemsExtended()) };
});

const row = (o: Partial<PortfolioRow> = {}): PortfolioRow => ({
  module: "material_master", label: "Material master", version_id: "v1", run_at: null, system_id: null,
  composite_score: 80, raw_score: 80, measured_score: 80, capped: false, readiness: "pass", step: "compare", cycle: null,
  run_number: 3, owner: null, trend: [70, 75, 80], previous_score: 75, new_issues: 0, regressed: 0, resolved: 0, freshness: "fresh", ...o,
});
const act: PortfolioActions = { pull: vi.fn(), download: vi.fn(), upload: vi.fn(), compare: vi.fn(), score: vi.fn(), sysName: () => "Production ERP", can: () => true, scoring: new Set<string>() } as unknown as PortfolioActions;
const pageOf = (objects: PortfolioRow[], total = objects.length): PortfolioPage => ({ objects, total, limit: 500, offset: 0, next_offset: objects.length < total ? objects.length : null });

const finding = { id: "f1", name: "Duplicate keys", affected: 12, why: { origin: { status: "ok", top: "Main plant", share: 0.5 }, delta_affected: null } } as unknown as AletheiaFinding;

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/portfolio?fixture=1");
  start.mockClear();
  page = null;
  systems = null;
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});
const wrap = (ui: React.ReactNode) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

describe("feed model", () => {
  it("flags cards that need you and orders them", () => {
    const bad = row({ version_id: "b", regressed: 2, composite_score: 40 });
    const ok = row({ version_id: "o" });
    expect(needsYou(bad)).toBe(true);
    expect(needsYou(ok)).toBe(false);
    const f = orderFeed([ok, bad], "owner");
    expect(f.needs.map((r) => r.version_id)).toEqual(["b"]);
    expect(f.quiet.map((r) => r.version_id)).toEqual(["o"]);
  });
  it("puts waiting steps first for a steward", () => {
    const wait = row({ version_id: "w", step: "clean", cycle: null });
    const fail = row({ version_id: "f", readiness: "fail", composite_score: 20 });
    const ids = (p: "owner" | "steward") => orderFeed([wait, fail], p).needs.map((r) => r.version_id);
    expect(ids("owner")[0]).toBe("f");
    expect(ids("steward")).toContain("w");
  });
  it("words the delta, greeting and lede", () => {
    expect(deltaSentence(row({ previous_score: null }))).toBe("First run");
    expect(deltaSentence(row({ previous_score: 80 }))).toMatch(/No change/);
    expect(deltaSentence(row({ previous_score: 70 }))).toMatch(/Up 10/);
    expect(deltaSentence(row({ previous_score: 90 }))).toMatch(/Down 10/);
    expect(greetingWord(8)).toBe("Good morning");
    expect(greetingWord(13)).toBe("Good afternoon");
    expect(greetingWord(20)).toBe("Good evening");
    expect(lede(0, 0)).toBe("Nothing needs you today.");
    expect(lede(1, 1)).toBe("1 object needs you today. One run is in progress.");
    expect(lede(3, 2)).toBe("3 objects need you today. 2 runs are in progress.");
  });
});

describe("feed parts", () => {
  it("renders the greeting and fires its buttons", async () => {
    const u = userEvent.setup();
    const c = vi.fn(), o = vi.fn();
    wrap(<Greeting name="Ada" needs={2} running={0} hour={9} onCompare={c} onObjects={o} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning, Ada");
    expect(screen.getByText("2 objects need you today.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Objects/ }));
    await u.click(screen.getByRole("button", { name: /Compare/ }));
    expect(o).toHaveBeenCalled();
    expect(c).toHaveBeenCalled();
  });
  it("renders the skeleton as busy", () => {
    wrap(<StoryCardSkeleton />);
    expect(screen.getByTestId("story-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(within(screen.getByTestId("story-skeleton-visual")).getAllByText("", { selector: ".nx-skeleton-bar" })).toHaveLength(3);
  });
  it("renders the quiet row", () => {
    wrap(<QuietRow rows={[row()]} sysName={() => "Production ERP"} />);
    expect(screen.getByRole("heading", { name: "Quiet today" })).toBeInTheDocument();
    expect(screen.getAllByTestId("quiet-card")).toHaveLength(1);
  });
  it("renders a story card with score, delta, verdict and the primary action per step", async () => {
    const u = userEvent.setup();
    wrap(<StoryCard row={row({ step: "pull" })} act={act} />);
    const card = screen.getByTestId("pf-card");
    expect(within(card).getByText("Up 5.0 since the last run")).toBeInTheDocument();
    expect(within(card).getByText("Ready to load")).toBeInTheDocument();
    await u.click(within(card).getByRole("button", { name: /Pull now/ }));
    expect(act.pull).toHaveBeenCalled();
  });
  it("shows the cap line and the evidence button", async () => {
    const u = userEvent.setup();
    const ev = vi.fn();
    wrap(<StoryCard row={row({ capped: true, readiness: "fail" })} act={act} finding={finding} evidence={4} onEvidence={ev} />);
    expect(screen.getByText("Capped by a critical rule")).toBeInTheDocument();
    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByText("Duplicate keys: 12 records affected, most in Main plant.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Evidence (4)" }));
    expect(ev).toHaveBeenCalled();
  });
});

describe("card charts", () => {
  it("leads with a ring, a trend with a tooltip per run, and the records bar", () => {
    wrap(<StoryCard row={row({ new_issues: 3, regressed: 1, resolved: 2 })} act={act} />);
    expect(screen.getByRole("img", { name: "DQS 80.0" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "DQS trend of Material master" })).toBeInTheDocument();
    const tips = [...document.querySelectorAll(".nx-area-dot title")].map((n) => n.textContent);
    expect(tips).toEqual(["Run 1: 70", "Run 2: 75", "Run 3: 80"]);
    expect(screen.getByRole("img", { name: "Records that need a fix: New issues 3, Failing again 1, Fixed 2" })).toBeInTheDocument();
  });
  it("names the cap in the ring label", () => {
    wrap(<StoryCard row={row({ capped: true, composite_score: 40, measured_score: 72 })} act={act} />);
    expect(screen.getByRole("img", { name: "DQS 40.0, capped from 72.0 by a critical rule" })).toBeInTheDocument();
  });
  it("draws the empty shapes for an unscored first run", () => {
    wrap(<StoryCard row={row({ composite_score: null, trend: [], previous_score: null, readiness: null })} act={act} />);
    expect(screen.getByRole("img", { name: "Not scored yet" })).toBeInTheDocument();
    expect(screen.getByText("Score this run to see its quality.")).toBeInTheDocument();
    expect(screen.getByText("The trend shows after the second run.")).toBeInTheDocument();
    expect(screen.getByText("Record counts show once the run is scored.")).toBeInTheDocument();
  });
  it("shows a failed pull with a Retry that pulls again", async () => {
    const u = userEvent.setup();
    const pull = vi.fn();
    wrap(<StoryCard row={row({ freshness: "failed" })} act={{ ...act, pull }} />);
    expect(screen.getByText("The last pull failed.")).toHaveAttribute("role", "status");
    await u.click(screen.getByRole("button", { name: /Retry/ }));
    expect(pull).toHaveBeenCalled();
  });
  it("hides the evidence button when there is no evidence", () => {
    wrap(<StoryCard row={row()} act={act} finding={finding} evidence={0} onEvidence={() => undefined} />);
    expect(screen.queryByRole("button", { name: /Evidence/ })).toBeNull();
  });
});

describe("getPortfolioAll", () => {
  it("joins every page until the total", async () => {
    const get = vi.fn(async (q: { offset?: number }) => {
      const off = q.offset ?? 0;
      const objects = off < 1000 ? Array.from({ length: 500 }, (_, i) => row({ version_id: `v${off + i}` })) : [row({ version_id: "last" })];
      return { objects, total: 1001, limit: 500, offset: off, next_offset: off + objects.length < 1001 ? off + objects.length : null };
    });
    const all = await getPortfolioAll({}, get);
    expect(all.objects).toHaveLength(1001);
    expect(all.next_offset).toBeNull();
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("stops on an empty page", async () => {
    const get = vi.fn(async () => ({ objects: [], total: 9, limit: 500, offset: 0, next_offset: 0 }));
    expect((await getPortfolioAll({}, get)).objects).toHaveLength(0);
  });
});

describe("Objects sheet", () => {
  it("groups by system and filters by search", async () => {
    const u = userEvent.setup();
    wrap(<ObjectsSheet onClose={() => undefined} />);
    await waitFor(() => expect(screen.getAllByTestId("os-system").length).toBeGreaterThan(0));
    await u.type(screen.getByRole("searchbox"), "zzzz-no-such");
    expect(await screen.findByText("No object matches this search.")).toBeInTheDocument();
  });
});

describe("Home", () => {
  for (const p of ["owner", "steward", "lead", "admin"] as const) {
    it(`shows a feed for the ${p} persona`, async () => {
      setUrl(`/portfolio?fixture=1&persona=${p}`);
      wrap(<Home />);
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByTestId("pf-card").length + screen.queryAllByTestId("quiet-card").length).toBeGreaterThan(0));
    });
  }
  it("pulls after the confirm", async () => {
    const u = userEvent.setup();
    page = pageOf([row({ step: "pull", readiness: "fail", composite_score: 30 })]);
    wrap(<Home />);
    await u.click(within(screen.getByTestId("pf-card")).getByRole("button", { name: /Pull now/ }));
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: "Pull now" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(["material_master"]));
  });
  it("starts one pull when the confirm is pressed twice", async () => {
    const u = userEvent.setup();
    start.mockImplementationOnce(() => new Promise(() => undefined));
    page = pageOf([row({ step: "pull", readiness: "fail", composite_score: 30 })]);
    wrap(<Home />);
    await u.click(within(screen.getByTestId("pf-card")).getByRole("button", { name: /Pull now/ }));
    const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Pull now" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });
  it("offers the first pull when a system is connected but no run exists", async () => {
    page = pageOf([]);
    systems = [{ id: "sys1", name: "Test system" }];
    wrap(<Home />);
    expect(screen.getByRole("heading", { name: "No run yet." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run your first pull" })).toHaveAttribute("href", expect.stringContaining("/s/sys1"));
  });
  it("says when the feed is capped and offers to show all", async () => {
    page = pageOf([row()], 640);
    wrap(<Home />);
    expect(screen.getByTestId("cap-notice")).toHaveTextContent("Showing 1 of 640 objects.");
    expect(screen.getByRole("button", { name: "Show all 640" })).toBeInTheDocument();
  });
});
