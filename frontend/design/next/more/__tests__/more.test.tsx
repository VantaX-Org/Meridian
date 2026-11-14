import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { push, replace, setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { ChartCard, cardState, compact } from "../ChartCard";
import { PassRateCard, RulesCard, filesPerWeek } from "../cards";
import { SheetHost, useSheets, type SheetsApi } from "../../shell/SheetHost";
import { MORE_SHEETS } from "../../shell/sheets";
import { redirectFor } from "@/lib/next/nav-defaults";
import { Denied, LongText, VirtualList, useSubmitGuard, QueryView } from "../states";
import { Rules } from "../Rules";
import { Reports } from "../Reports";
import { Systems } from "../Systems";
import { People } from "../People";
import { ReportSheet } from "../ReportSheet";
import { ConnectFlow } from "../../flows/ConnectFlow";
import { UpdateFlow } from "../../flows/UpdateFlow";
import { LicenceFlow } from "../../flows/LicenceFlow";
import { NotifyFlow } from "../../flows/NotifyFlow";
import { More } from "../../screens/More";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/screens/system/ConnectionForm", () => ({ ConnectionForm: () => <div data-testid="connection-form" /> }));
vi.mock("@/design/v2/admin/tenant", () => ({ LicenceSection: () => <div data-testid="licence-section" /> }));
vi.mock("@/design/v2/admin/notify", () => ({ NotificationsSection: () => <div data-testid="notify-section" /> }));
vi.mock("@/design/v2/admin/Admin", () => ({ AdminCanvas: () => <div /> }));

const Q = vi.hoisted(() => {
  const st = (data: unknown = undefined, over: object = {}) => ({ data, isLoading: false, error: null, refetch: () => Promise.resolve(), ...over });
  return { rules: st(), drafts: st(), reports: st(), schedules: st(), systems: st(), people: st(), opts: st({ modules: ["material_master"], systems: [], types: [] }), update: st(), can: (): boolean => true, st };
});
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
vi.mock("@/lib/v2/sys-queries", () => ({ useRuleList: () => Q.rules, useAllDrafts: () => Q.drafts, useRefreshV2: () => () => undefined }));
vi.mock("@/lib/v2/admin-queries", () => ({
  useReportHistory: () => Q.reports,
  useSchedules: () => Q.schedules,
  useScheduleOptions: () => Q.opts,
  useUpdateStatus: () => Q.update,
  refreshAdmin: () => Promise.resolve(),
  useUsers: () => Q.st({ users: [] }),
  useRoles: () => ({ data: [] }),
  useGrants: () => ({ data: [] }),
  useLicence: () => Q.st(undefined),
}));
vi.mock("@/lib/v2/runs-queries", () => ({ useSystemsExtended: () => Q.systems, useSystemObjectList: () => Q.st([]), useSystemProfiles: () => Q.st([]), useSystemExtractions: () => Q.st([]), useSystemConfigLoad: () => Q.st(undefined) }));
vi.mock("@/lib/v2/approvals-queries", () => ({ usePeople: () => Q.people }));
vi.mock("@/lib/api/v2/reports", () => ({ createSchedule: vi.fn(), runScheduleNow: vi.fn(), downloadReportFile: vi.fn() }));
vi.mock("@/lib/api/v2/admin", () => ({ getUpdateProgress: vi.fn(() => Promise.resolve({})), triggerUpdate: vi.fn() }));
vi.mock("@/lib/api/v2/sys", () => ({ createProfile: vi.fn() }));
vi.mock("@/lib/api/v2/runs", () => ({ testSystemConnection: vi.fn() }));

let undo: () => void = () => undefined;
const reset = () => {
  Q.rules = Q.st({ rules: [] });
  Q.drafts = Q.st([]);
  Q.reports = Q.st({ items: [] });
  Q.schedules = Q.st([]);
  Q.systems = Q.st([]);
  Q.people = Q.st({ people: [] });
  Q.update = Q.st(undefined);
  Q.can = () => true;
};
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more?fixture=1");
  push.mockClear();
  replace.mockClear();
  reset();
});
afterEach(() => undo());
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);
const ctx = (step = 1, setStep = vi.fn()) => ({ id: "new", step, setStep, close: vi.fn(), dismiss: vi.fn(), open: vi.fn(), under: false });

describe("sheet registry", () => {
  it("registers every More sheet kind even though SheetHost imports sheets before its registry exists", async () => {
    // The registrations are deferred; opening each kind after they settle must render something, not nothing.
    await new Promise((r) => setTimeout(r, 20));
    for (const kind of MORE_SHEETS) {
      setUrl(`/more?sheet=${kind}:x`);
      const { unmount } = wrap(<p>page</p>);
      await waitFor(() => expect(document.querySelector('[role="dialog"], .nx-sheet')).not.toBeNull());
      unmount();
    }
  });

  it("opens the connect sheet from ?sheet=connect with no id", async () => {
    setUrl("/more/systems?sheet=connect");
    wrap(<p>page</p>);
    expect(await screen.findByText("Connect a system", { selector: "h2, h1, [role=dialog] *" })).toBeInTheDocument();
  });

  it("sends the old /s/new address to the connect sheet", () => {
    expect(redirectFor("/s/new")).toBe("/more/systems?sheet=connect");
  });

  it("sends /admin and its sections under More", () => {
    expect(redirectFor("/admin")).toBe("/more/admin");
    expect(redirectFor("/admin/users")).toBe("/more/admin/users");
  });
});

describe("chart cards", () => {
  const forbidden = Object.assign(new Error("403"), { isAxiosError: true, response: { status: 403 } });
  it("cardState covers every state", () => {
    const q = (o: object) => ({ isLoading: false, error: null, data: {}, ...o });
    expect(cardState(q({ isLoading: true, data: undefined }), false)).toBe("loading");
    expect(cardState(q({}), false)).toBe("ready");
    expect(cardState(q({}), true)).toBe("empty");
    expect(cardState(q({ error: new Error("x"), data: undefined }), false)).toBe("failed");
    expect(cardState(q({ error: new Error("x") }), false)).toBe("stale");
    expect(cardState(q({ error: forbidden }), false)).toBe("denied");
    expect(cardState(q({}), false, false)).toBe("denied");
  });
  it("compact keeps small counts exact and shortens huge ones", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1234567)).toMatch(/^1\.2\s?M$/);
  });
  it("filesPerWeek buckets eight weeks, oldest first, and drops dates outside them", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const day = 86_400_000;
    const pts = filesPerWeek([new Date(now - day).toISOString(), new Date(now - 2 * day).toISOString(), new Date(now - 50 * day).toISOString(), new Date(now - 90 * day).toISOString(), "not a date"], now);
    expect(pts).toHaveLength(8);
    expect(pts[7].value).toBe(2);
    expect(pts[0].value).toBe(1);
    expect(pts.reduce((a, p) => a + p.value, 0)).toBe(3);
  });
  it("a stale card keeps its chart, says the refresh failed and offers Try again", () => {
    const retry = vi.fn();
    render(<ChartCard title="Rules" state="stale" chart={<svg data-testid="chart" />} emptyLine="none" onRetry={retry} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByTestId("stale")).toHaveTextContent("The latest refresh failed.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
  it("empty, failed and denied draw the shape with one line, never the chart", () => {
    for (const [state, line] of [["empty", "Nothing yet."], ["failed", "These figures could not be loaded."], ["denied", "You do not have access to these figures."]] as const) {
      const { unmount } = render(<ChartCard title="T" state={state} chart={<svg data-testid="chart" />} emptyLine="Nothing yet." />);
      expect(screen.queryByTestId("chart")).toBeNull();
      expect(screen.getByLabelText(line)).toBeInTheDocument();
      unmount();
    }
  });
  it("rules and pass rate cards read partial data honestly", () => {
    Q.rules = Q.st({ rules: [
      { id: "a", enabled: true, severity: "critical", last_pass_rate: 80 },
      { id: "b", enabled: true, severity: "high", last_pass_rate: 60 },
      { id: "c", enabled: false, severity: "low" },
    ] });
    wrap(<><RulesCard /><PassRateCard /></>);
    expect(screen.getByTestId("card-rules")).toHaveTextContent("2 of 3 rules are on");
    expect(screen.getByTestId("card-pass")).toHaveTextContent("70%");
    expect(screen.getByTestId("card-pass")).toHaveTextContent("From 2 of 3 rules; the rest have not run yet.");
  });
});

describe("shared states", () => {
  it("Denied is an alert", () => {
    render(<Denied what="Users" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it("LongText keeps the full text in the tooltip", () => {
    render(<LongText text={"x".repeat(200)} />);
    expect(screen.getByTitle("x".repeat(200))).toBeInTheDocument();
  });
  it("VirtualList draws a window of a huge list", () => {
    render(<VirtualList rows={Array.from({ length: 20000 }, (_, i) => i)} rowKey={String} render={(i) => <span>row {i}</span>} label="Rows" />);
    expect(document.querySelectorAll("[role=listitem]").length).toBeLessThan(40);
  });
  it("QueryView picks loading, error, empty then content", () => {
    const base = { onRetry: vi.fn(), emptyHeading: "None", label: "Loading it" };
    const a = render(<QueryView {...base} loading error={null} empty={false}>content</QueryView>);
    expect(screen.getByText("Loading it")).toBeInTheDocument();
    a.unmount();
    const b = render(<QueryView {...base} loading={false} error={new Error("x")} empty={false}>content</QueryView>);
    expect(screen.getAllByRole("button", { name: /retry|try again/i }).length).toBeGreaterThan(0);
    b.unmount();
    const c = render(<QueryView {...base} loading={false} error={null} empty>content</QueryView>);
    expect(screen.getByText("None")).toBeInTheDocument();
    c.unmount();
    render(<QueryView {...base} loading={false} error={null} empty={false}>content</QueryView>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });
  it("useSubmitGuard drops a second call while the first runs", async () => {
    let n = 0;
    let release: () => void = () => undefined;
    function P() {
      const g = useSubmitGuard();
      return <button onClick={() => { void g.run(() => { n++; return new Promise<void>((r) => (release = r)); }); void g.run(() => { n++; return Promise.resolve(); }); }}>go</button>;
    }
    render(<P />);
    fireEvent.click(screen.getByText("go"));
    expect(n).toBe(1);
    await act(async () => release());
  });
});

describe("More screens: loading, error, empty", () => {
  it("rules: loading, error, empty", () => {
    Q.rules = Q.st(undefined, { isLoading: true });
    const a = wrap(<Rules />);
    expect(screen.getByText("Loading rules")).toBeInTheDocument();
    a.unmount();
    Q.rules = Q.st(undefined, { error: new Error("x") });
    const b = wrap(<Rules />);
    expect(screen.getAllByRole("button", { name: /retry|try again/i }).length).toBeGreaterThan(0);
    b.unmount();
    Q.rules = Q.st({ rules: [] });
    wrap(<Rules />);
    expect(screen.getByText("No rules yet")).toBeInTheDocument();
  });
  it("reports: loading, error, empty", () => {
    Q.reports = Q.st(undefined, { isLoading: true });
    const a = wrap(<Reports />);
    expect(screen.getByText("Loading reports")).toBeInTheDocument();
    a.unmount();
    Q.reports = Q.st(undefined, { error: new Error("x") });
    const b = wrap(<Reports />);
    expect(screen.getAllByRole("button", { name: /retry|try again/i }).length).toBeGreaterThan(0);
    b.unmount();
    Q.reports = Q.st({ items: [] });
    wrap(<Reports />);
    expect(screen.getByText("No reports yet")).toBeInTheDocument();
  });
  it("systems: loading, error, empty with a Connect action", () => {
    Q.systems = Q.st(undefined, { isLoading: true });
    const a = wrap(<Systems />);
    expect(document.querySelector(".nx-skeleton")).not.toBeNull();
    a.unmount();
    Q.systems = Q.st(undefined, { error: new Error("x") });
    const b = wrap(<Systems />);
    expect(screen.getAllByRole("button", { name: /retry|try again/i }).length).toBeGreaterThan(0);
    b.unmount();
    Q.systems = Q.st([]);
    wrap(<Systems />);
    expect(screen.getAllByRole("button", { name: "Connect a system" }).length).toBeGreaterThan(0);
  });
  it("systems: a very large list is windowed and searchable, long names are cut with a tooltip", () => {
    const row = (i: number, name = `Production ERP ${i}`) => ({ id: `s${i}`, name, system_type: "sap_ecc", host: "erp.example.com", health_status: "healthy", environment: "prod" });
    const long = "L".repeat(150);
    Q.systems = Q.st([...Array.from({ length: 3000 }, (_, i) => row(i)), row(9999, long)]);
    wrap(<Systems />);
    expect(document.querySelectorAll("[role=listitem]").length).toBeLessThan(40);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "LLLL" } });
    expect(screen.getByTitle(long)).toBeInTheDocument();
  });
  it("people: loading, error, empty", () => {
    Q.people = Q.st(undefined, { isLoading: true });
    const a = wrap(<People />);
    expect(document.querySelector(".nx-skeleton")).not.toBeNull();
    a.unmount();
    Q.people = Q.st(undefined, { error: new Error("x") });
    const b = wrap(<People />);
    expect(screen.getAllByRole("button", { name: /retry|try again/i }).length).toBeGreaterThan(0);
    b.unmount();
    Q.people = Q.st({ people: [] });
    wrap(<People />);
    expect(document.querySelector(".nx-emptystate, [data-testid=empty]") ?? screen.getByRole("heading")).toBeTruthy();
  });
});

describe("flows as steppers", () => {
  it("connect: six steps, the details step is the secure form", () => {
    const c = ctx(3);
    wrap(<ConnectFlow ctx={c} />);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(6);
  });
  it("connect: first step offers system types and moves on", () => {
    const c = ctx(1);
    wrap(<ConnectFlow ctx={c} />);
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });
  it("report: step one asks for a name and holds Next until it has one", () => {
    const c = ctx(1);
    wrap(<ReportSheet ctx={c} />);
    expect(screen.getAllByRole("button", { name: /next/i })[0]).toHaveAttribute("aria-disabled", "true");
  });
  it("licence, notify and update mount their sheet", () => {
    for (const F of [LicenceFlow, NotifyFlow, UpdateFlow]) {
      const { unmount } = wrap(<F ctx={ctx()} />);
      expect(document.querySelector('[role="dialog"], .nx-sheet')).not.toBeNull();
      unmount();
    }
    expect(screen.queryByTestId("denied")).toBeNull();
  });
});

describe("More home and routing", () => {
  it("shows tiles and hides the admin tile from a non-admin", () => {
    const a = wrap(<More slug={[]} />);
    expect(screen.getByTestId("more-tiles")).toBeInTheDocument();
    expect(screen.getByTestId("more-cards")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Administration/ })).toBeInTheDocument();
    a.unmount();
    Q.can = () => false;
    wrap(<More slug={[]} />);
    expect(screen.queryByRole("link", { name: /Administration/ })).toBeNull();
  });
  it("routes systems and the admin landing", () => {
    setUrl("/more/systems?fixture=1");
    const a = wrap(<More slug={["systems"]} />);
    expect(screen.getAllByRole("button", { name: "Connect a system" }).length).toBeGreaterThan(0);
    a.unmount();
    setUrl("/more/admin?fixture=1");
    wrap(<More slug={["admin"]} />);
    expect(screen.getByTestId("admin-cards")).toBeInTheDocument();
  });
});

void useSheets;
export type _Unused = SheetsApi;
