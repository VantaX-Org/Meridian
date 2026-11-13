import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { push, replace, setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { groupByRun, type Finding } from "@/lib/api/next/monitor";
import { Work, resolveWork, WORK_PARTS } from "../screens/Work";
import { Monitor } from "../screens/Monitor";
import { More } from "../screens/More";
import { NextRedirect } from "../shell/NextRedirect";
import { GROUPS, LINKS } from "../more/groups";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

// The v2 screens are mounted unchanged; here each is a stub that proves which one was mounted.
vi.mock("@/design/v2/screens/Attention", async () => (await import("./stub")).stub("Attention"));
vi.mock("@/design/v2/screens/Work", async () => (await import("./stub")).stub("WorkCanvas"));
vi.mock("@/design/v2/screens/WorkAnalytics", async () => (await import("./stub")).stub("WorkAnalytics"));
vi.mock("@/design/v2/screens/FixDrafts", async () => (await import("./stub")).stub("FixDrafts"));
vi.mock("@/design/v2/screens/DataRequests", async () => (await import("./stub")).stub("DataRequests"));
vi.mock("@/design/v2/screens/Cleansing", async () => (await import("./stub")).stub("Cleansing"));
vi.mock("@/design/v2/screens/Requests", async () => (await import("./stub")).stub("RequestsCanvas"));
vi.mock("@/design/v2/screens/RequestForm", async () => (await import("./stub")).stub("RequestFormCanvas"));
vi.mock("@/design/v2/screens/ProcessAnalytics", async () => (await import("./stub")).stub("ProcessAnalytics"));
vi.mock("@/design/v2/screens/People", async () => (await import("./stub")).stub("PeopleCanvas"));
vi.mock("@/design/v2/screens/LearnedMonitors", async () => (await import("./stub")).stub("LearnedMonitors"));
vi.mock("@/design/v2/screens/RulesLibrary", async () => (await import("./stub")).stub("RulesLibrary"));
vi.mock("@/design/v2/screens/RulePromotion", async () => (await import("./stub")).stub("RulePromotion"));
vi.mock("@/design/v2/screens/RuleDryRun", async () => (await import("./stub")).stub("RuleDryRun"));
vi.mock("@/design/v2/screens/AnomalyRules", async () => (await import("./stub")).stub("AnomalyRules"));
vi.mock("@/design/v2/screens/AletheiaEvidence", async () => (await import("./stub")).stub("AletheiaEvidence"));
vi.mock("@/design/v2/screens/AletheiaForesight", async () => (await import("./stub")).stub("AletheiaForesight"));
vi.mock("@/design/v2/screens/AletheiaReason", async () => (await import("./stub")).stub("AletheiaReason"));
vi.mock("@/design/v2/screens/AletheiaSurvivorship", async () => (await import("./stub")).stub("AletheiaSurvivorship"));
vi.mock("@/design/v2/screens/MdmHealth", async () => (await import("./stub")).stub("MdmHealth"));
vi.mock("@/design/v2/screens/EntryGate", async () => (await import("./stub")).stub("EntryGate"));
vi.mock("@/design/v2/screens/ReferenceData", async () => (await import("./stub")).stub("ReferenceData"));
vi.mock("@/design/v2/screens/Links", async () => (await import("./stub")).stub("Links"));
vi.mock("@/design/v2/screens/Catalogue", async () => (await import("./stub")).stub("Catalogue"));
vi.mock("@/design/v2/screens/Issues", async () => (await import("./stub")).stub("Issues"));
vi.mock("@/design/v2/screens/Mining", async () => (await import("./stub")).stub("Mining"));
vi.mock("@/design/v2/screens/ProcessDiscovery", async () => (await import("./stub")).stub("ProcessDiscovery"));
vi.mock("@/design/v2/screens/ScoreLens", async () => (await import("./stub")).stub("ScoreLens"));
vi.mock("@/design/v2/screens/Insights", async () => (await import("./stub")).stub("Insights"));
vi.mock("@/design/v2/screens/Forecast", async () => (await import("./stub")).stub("Forecast"));
vi.mock("@/design/v2/screens/Value", async () => (await import("./stub")).stub("Value"));
vi.mock("@/design/v2/screens/Config", async () => (await import("./stub")).stub("Config"));
vi.mock("@/design/v2/screens/Runs", async () => (await import("./stub")).stub("RunsCanvas"));
vi.mock("@/design/v2/screens/system/SystemsCanvas", async () => (await import("./stub")).stub("SystemsCanvas"));
vi.mock("@/design/v2/screens/Reports", async () => (await import("./stub")).stub("ReportsCanvas"));
vi.mock("@/design/v2/screens/Atlas", async () => (await import("./stub")).stub("Atlas"));
vi.mock("@/design/v2/admin/Admin", () => ({ AdminHome: () => <div data-testid="mounted">AdminHome</div>, AdminCanvas: ({ section }: { section: string }) => <div data-testid="mounted">Admin {section}</div> }));

const prefs = { value: { ui_next: true } as Record<string, unknown> };
vi.mock("@/hooks/use-preferences", () => ({ usePreferences: () => ({ prefs: prefs.value, setPref: () => undefined, loading: false }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/next/work?fixture=1");
  push.mockClear();
  replace.mockClear();
  prefs.value = { ui_next: true };
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

describe("Work", () => {
  it("mounts the queue (Attention and Work) at the root", () => {
    renderWithQuery(<Work />);
    expect(screen.getAllByTestId("mounted").map((e) => e.textContent)).toEqual(["Attention", "WorkCanvas"]);
  });

  it("mounts each part at its address and keeps the part's tab selected for deeper pages", () => {
    for (const [slug, text, tab] of [
      [["fix-drafts"], "FixDrafts", "Fix drafts"],
      [["approve"], "Cleansing", "Approve"],
      [["requests", "new"], "RequestFormCanvas", "Requests"],
      [["people"], "PeopleCanvas", "People"],
    ] as const) {
      const { unmount } = renderWithQuery(<Work slug={[...slug]} />);
      expect(screen.getByTestId("mounted")).toHaveTextContent(text);
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      unmount();
    }
  });

  it("moves between parts through the strip", async () => {
    const u = userEvent.setup();
    renderWithQuery(<Work />);
    await u.click(screen.getByRole("tab", { name: "People" }));
    expect(push).toHaveBeenCalledWith("/next/work/people");
  });

  it("resolves every part and says so for an unknown address", () => {
    for (const p of WORK_PARTS) expect(resolveWork(p.slug ? p.slug.split("/") : [])).not.toBeNull();
    expect(resolveWork(["nope"])).toBeNull();
    renderWithQuery(<Work slug={["nope"]} />);
    expect(screen.getByText("Nothing at this address")).toBeInTheDocument();
  });
});

describe("Monitor", () => {
  const f = (over: Partial<Finding>): Finding => ({ module: "material_master", label: "Material master", check_id: "MM1", change: "new", records: 3, reason: "r", version_id: "v1", baseline_version_id: "b1", detected_at: "2026-11-01T00:00:00Z", severity: "high", owner: null, ...over });

  it("groups findings by run and totals new and regressed records", () => {
    const g = groupByRun([f({}), f({ check_id: "MM2", change: "regressed", records: 5 }), f({ version_id: "v2", module: "customer_master", label: "Customer master" })]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ version_id: "v1", newCount: 3, regressedCount: 5 });
    expect(g[0].findings).toHaveLength(2);
  });

  it("shows the heading, the sentence and a Compare link per run", async () => {
    setUrl("/monitor?fixture=1");
    renderWithQuery(<Monitor />);
    expect(screen.getByRole("heading", { name: "Monitor" })).toBeInTheDocument();
    expect(screen.getByText("Everything new, resolved or regressed, across every object, run by run.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    const links = screen.queryAllByRole("link", { name: "Open all in Compare" });
    for (const l of links) expect(l.getAttribute("href")).toMatch(/\/run\/.+\/vs\/.+/);
  });

  it("mounts learned monitors on the second tab", () => {
    setUrl("/monitor?tab=learned&fixture=1");
    renderWithQuery(<Monitor />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("LearnedMonitors");
    expect(screen.getByRole("tab", { name: "Learned monitors" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("More", () => {
  it("lists every group and every screen that stays at its own address", () => {
    setUrl("/more?fixture=1");
    renderWithQuery(<More />);
    for (const g of GROUPS) expect(screen.getByRole("link", { name: new RegExp(g.title()) })).toBeInTheDocument();
    for (const l of LINKS) expect(screen.getByRole("link", { name: new RegExp(l.title()) })).toBeInTheDocument();
  });

  it("mounts the tab named in the address and defaults to the first", () => {
    setUrl("/more/rules?tab=dry-run&fixture=1");
    const a = renderWithQuery(<More slug={["rules"]} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("RuleDryRun");
    a.unmount();
    setUrl("/more/rules?fixture=1");
    renderWithQuery(<More slug={["rules"]} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("RulesLibrary");
  });

  it("mounts all eight master data tabs", () => {
    const master = GROUPS.find((g) => g.id === "master-data")!;
    expect(master.tabs).toHaveLength(8);
    for (const tab of master.tabs) {
      setUrl(`/more/master-data?tab=${tab.id}&fixture=1`);
      const { unmount } = renderWithQuery(<More slug={["master-data"]} />);
      expect(screen.getByRole("tab", { name: tab.label() })).toHaveAttribute("aria-selected", "true");
      unmount();
    }
  });

  it("mounts admin sections and single screens", () => {
    setUrl("/more/admin/users?fixture=1");
    const a = renderWithQuery(<More slug={["admin", "users"]} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("Admin users");
    a.unmount();
    setUrl("/more/systems/config?fixture=1");
    renderWithQuery(<More slug={["systems", "config"]} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("Config");
  });
});

describe("NextRedirect", () => {
  it("sends an old address to its new home and keeps the query", () => {
    setUrl("/cleansing?fixture=1&run=r1");
    render(<NextRedirect />);
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/work\/approvals\?/));
    expect(replace.mock.calls[0][0]).toContain("run=r1");
  });

  it("does nothing with the flag off or on a screen that stays", () => {
    prefs.value = { ui_next: false };
    setUrl("/cleansing");
    render(<NextRedirect />);
    expect(replace).not.toHaveBeenCalled();
    prefs.value = { ui_next: true };
    setUrl("/run/abc");
    render(<NextRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });
});
