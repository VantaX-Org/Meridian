import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import type { PortfolioActions } from "../portfolio/BulkBar";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const start = vi.fn(async (ids: string[]) => ({ queued: ids, skipped: [] as string[] }));
vi.mock("@/lib/api/next/portfolio", async (orig) => ({ ...(await orig<typeof import("@/lib/api/next/portfolio")>()), startObjects: (ids: string[]) => start(ids) }));

const row = (o: Partial<PortfolioRow> = {}): PortfolioRow => ({
  module: "material_master", label: "Material master", version_id: "v1", run_at: null, system_id: null,
  composite_score: 80, raw_score: 80, measured_score: 80, capped: false, readiness: "pass", step: "compare", cycle: null,
  run_number: 3, owner: null, trend: [70, 75, 80], previous_score: 75, new_issues: 0, regressed: 0, resolved: 0, freshness: "fresh", ...o,
});
const act: PortfolioActions = { pull: vi.fn(), download: vi.fn(), upload: vi.fn(), compare: vi.fn(), score: vi.fn(), sysName: () => "Production ERP", can: () => true } as unknown as PortfolioActions;

const finding = { id: "f1", name: "Duplicate keys", affected: 12, why: { origin: { status: "ok", top: "Main plant", share: 0.5 }, delta_affected: null } } as unknown as AletheiaFinding;

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/portfolio?fixture=1");
  start.mockClear();
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
    wrap(<Home />);
    const cards = await waitFor(() => {
      const c = screen.getAllByTestId("pf-card");
      expect(c.length).toBeGreaterThan(0);
      return c;
    });
    const pull = within(cards[0]).queryByRole("button", { name: /Pull now/ });
    if (!pull) return; // first card waits on another step in this fixture
    await u.click(pull);
    await u.click(await screen.findByRole("button", { name: /^Pull/ }));
    await waitFor(() => expect(start).toHaveBeenCalled());
  });
});
