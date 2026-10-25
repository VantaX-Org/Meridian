// frontend/app/(app)/objects/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as versionsApi from "@/lib/api/versions";
import * as objectsApi from "@/lib/api/v1/objects";
import * as workApi from "@/lib/api/work";
import ObjectsPage from "../page";

let currentSearch = "run=v1";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

/** The ledger: the object map above it repeats every label, so rows are read inside the grid. */
const ledger = () => within(screen.getByRole("grid"));

describe("ObjectsPage", () => {
  it.each([["ready", "Ready Obj", "Blocked Obj"]])("legacy ?verdict=%s maps to the readiness filter", async (v, shown, hidden) => {
    currentSearch = `run=v1&verdict=${v}`;
    const mk = (module: string, label: string, readiness: "pass" | "warn") => ({ module, label, composite_score: 80, readiness, failing_checks: 0, affected_records: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "Ready Obj", "pass"), mk("b", "Blocked Obj", "warn")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText(shown)).toBeInTheDocument());
    expect(ledger().queryByText(hidden)).not.toBeInTheDocument();
    currentSearch = "run=v1";
  });

  it("renders one row per object with its readiness", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [
        {
          module: "material_master",
          label: "Material Master",
          composite_score: 72.5,
          readiness: "warn",
          failing_checks: 3,
          affected_records: 120,
        },
      ],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("Material Master")).toBeInTheDocument());
    expect(ledger().getByText("72.5").closest("a")).toHaveAttribute("href", "/objects/material_master?run=v1&tab=rules");
    expect(screen.getAllByText("No-go").length).toBeGreaterThan(0);
  });

  it("shows an empty state when the run has no objects", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(/no objects/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(objectsApi, "getObjects").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("shows the day-one empty state when the tenant has no run yet", async () => {
    currentSearch = "";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: null, objects: [] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ total: 0, loaded: 0, counts: {}, systems: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("No objects measured yet")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Connect a system" })).toBeInTheDocument();
    currentSearch = "run=v1";
  });
});

describe("ObjectsPage verdict param", () => {
  it.each(["garbage", "constructor"])("ignores ?verdict=%s: every object, no banner", async (v) => {
    currentSearch = `run=v1&verdict=${v}`;
    const mk = (module: string, label: string, readiness: "pass" | "warn") => ({ module, label, composite_score: 80, readiness, failing_checks: 0, affected_records: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "Ready Obj", "pass"), mk("b", "Blocked Obj", "warn")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("Ready Obj")).toBeInTheDocument());
    expect(ledger().getByText("Blocked Obj")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all objects" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    currentSearch = "run=v1";
  });
});

describe("ObjectsPage sort, filter and enrichment", () => {
  const mk = (module: string, label: string, readiness: "pass" | "warn" | "fail", score: number, extra = {}) =>
    ({ module, label, composite_score: score, readiness, failing_checks: 1, affected_records: 1, ...extra });
  const rowLabels = () => screen.getAllByRole("row").map((r) => r.textContent ?? "");

  it("ranks the most blocking findings first, then the most records, then the lowest DQS", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [
      mk("a", "AAA", "pass", 99, { critical_checks: 0, high_checks: 1, affected_records: 500 }),
      mk("b", "BBB", "warn", 70, { critical_checks: 1, high_checks: 1, affected_records: 10 }),
      mk("c", "CCC", "fail", 50, { critical_checks: 1, high_checks: 1, affected_records: 90 }),
      mk("d", "DDD", "fail", 40, { critical_checks: 0, high_checks: 0, affected_records: 900 }),
    ] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("DDD")).toBeInTheDocument());
    const order = rowLabels().join("|");
    // two blocking findings (CCC before BBB on records), then one (AAA), then none (DDD)
    expect(order.indexOf("CCC")).toBeLessThan(order.indexOf("BBB"));
    expect(order.indexOf("BBB")).toBeLessThan(order.indexOf("AAA"));
    expect(order.indexOf("AAA")).toBeLessThan(order.indexOf("DDD"));
  });

  it("draws the object map from the rows the ledger shows, each tile opening its object", async () => {
    currentSearch = "run=v1&readiness=fail";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "pass", 99), mk("c", "CCC", "fail", 50, { blocking_rule_id: "mm_bad", blocking_rule_name: "Bad" })] });
    renderWithQuery(<ObjectsPage />);
    const map = await screen.findByRole("list", { name: "Objects by records and verdict" });
    const tiles = within(map).getAllByRole("link");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute("data-verdict", "no-go");
    expect(tiles[0]).toHaveAttribute("href", "/objects/c?run=v1&tab=fix");
    currentSearch = "run=v1";
  });

  it("?readiness=fail keeps only no-go objects; Not ready Stat links to it", async () => {
    currentSearch = "run=v1&readiness=fail";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "pass", 99), mk("c", "CCC", "fail", 50)] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("CCC")).toBeInTheDocument());
    expect(ledger().queryByText("AAA")).not.toBeInTheDocument();
    expect(screen.getAllByText("No-go").map((e) => e.closest("a")).find((a) => a?.getAttribute("href")?.includes("readiness=fail"))).toHaveAttribute("href", "/objects?run=v1&readiness=fail");
    currentSearch = "run=v1";
  });

  it("renders blocking rule, trend, stat and chips when the API supplies them, and degrades when absent", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      blocking_findings_total: 7,
      objects: [
        mk("a", "AAA", "fail", 50, { blocking_rule_id: "mm_bad", blocking_rule_name: "Bad", trend: [40, 50], worst_dimension: "accuracy", owner: "ann" }),
        mk("b", "BBB", "warn", 60, { worst_dimension: "completeness", owner: "bob" }),
      ],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("mm_bad")).toBeInTheDocument());
    expect(ledger().getByText("mm_bad").closest("a")).toHaveAttribute("href", "/objects/a?run=v1&tab=fix&issue=mm_bad");
    expect(screen.getByText("Critical and high findings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accuracy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ann" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Trend" })).toBeInTheDocument();
  });

  it("names Dimension chips in sentence case and keeps the raw id in the URL", async () => {
    currentSearch = "run=v1";
    replace.mockClear();
    const dims = ["accuracy", "consistency", "timeliness", "uniqueness", "validity"];
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: dims.map((d, i) => mk(`m${i}`, `Obj ${i}`, "fail", 50, { worst_dimension: d })),
    });
    renderWithQuery(<ObjectsPage />);
    const group = await screen.findByRole("group", { name: "Dimension" });
    const chips = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(["Accuracy", "Consistency", "Timeliness", "Uniqueness", "Validity"]);
    for (const d of dims) expect(within(group).queryByRole("button", { name: d })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Timeliness" }));
    expect(replace).toHaveBeenCalledWith("/objects?run=v1&dimension=timeliness");
  });

  it("selects the Dimension chip from a raw ?dimension= id", async () => {
    currentSearch = "run=v1&dimension=validity";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [mk("a", "AAA", "fail", 50, { worst_dimension: "validity" }), mk("b", "BBB", "warn", 60, { worst_dimension: "accuracy" })],
    });
    renderWithQuery(<ObjectsPage />);
    const group = await screen.findByRole("group", { name: "Dimension" });
    expect(within(group).getByRole("button", { name: "Validity" })).toHaveAttribute("aria-pressed", "true");
    expect(ledger().queryByText("BBB")).not.toBeInTheDocument();
    currentSearch = "run=v1";
  });

  it("keeps a long blocking check id on one line, cut with an ellipsis and named in full by its title", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [mk("a", "AAA", "fail", 50, { blocking_rule_id: "DDIC-ADR6-TYPE", blocking_rule_name: "Type" })],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("DDIC-ADR6-TYPE")).toBeInTheDocument());
    const id = ledger().getByText("DDIC-ADR6-TYPE");
    const wrap = id.closest("[data-testid='blocking-rule-id']");
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveAttribute("title", "DDIC-ADR6-TYPE");
    expect(wrap).toHaveClass("block", "truncate", "whitespace-nowrap");
    expect(wrap?.getAttribute("style")).toBeNull();
    expect(id.closest("a")).toHaveAttribute("href", "/objects/a?run=v1&tab=fix&issue=DDIC-ADR6-TYPE");
  });

  it("lists the ledger columns in order and closes each row with an Open link to its records to fix", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [mk("a", "AAA", "fail", 50, { trend: [40, 50], blocking_rule_id: "mm_bad", blocking_rule_name: "Bad data", dimension_scores: { completeness: 97 } })],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("AAA")).toBeInTheDocument());
    expect(ledger().getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual(["Object", "Blocking rule", "Records", "Score", "Verdict", "Trend", "Action"]);
    expect(ledger().getByText("Bad data")).toBeInTheDocument();
    expect(ledger().getByRole("link", { name: "Open AAA" })).toHaveAttribute("href", "/objects/a?run=v1&tab=fix");
  });

  it("shows a sparkline for two or more runs and a muted \"1 run\" for an object's first run", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [mk("a", "AAA", "fail", 50, { trend: [40, 50] }), mk("b", "BBB", "warn", 70, { trend: [70] }), mk("c", "CCC", "pass", 95)],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("BBB")).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Trend" })).toBeInTheDocument();
    const cells = (label: string) => ledger().getByText(label).closest("tr") as HTMLElement;
    expect(within(cells("BBB")).getByTestId("trend-first-run")).toHaveTextContent("1 run");
    expect(within(cells("AAA")).queryByTestId("trend-first-run")).toBeNull();
    await waitFor(() => expect(cells("AAA").querySelector(".recharts-wrapper")).toBeInTheDocument());
    expect(cells("BBB").querySelector(".recharts-wrapper")).toBeNull();
    expect(within(cells("CCC")).queryByTestId("trend-first-run")).toBeNull();
    expect(cells("CCC").querySelector(".recharts-wrapper")).toBeNull();
  });

  it("omits Trend and Blocking rule columns when no row has the fields", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "fail", 50)] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("AAA")).toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: "Trend" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Blocking rule" })).toBeNull();
  });

  it("shows each object's records to fix, critical, with a suggestion and overdue from the work list, worst first, each opening Records to fix", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [
      mk("a", "AAA", "fail", 40, { critical_checks: 3, high_checks: 0 }),
      mk("b", "BBB", "warn", 70, { critical_checks: 0, high_checks: 0 }),
      mk("c", "CCC", "pass", 99),
    ] });
    const work = (module: string, open: number, critical: number, proposed: number, overdue: number) =>
      ({ module, records: open, open, issues: open, critical, proposed, overdue, statuses: { to_fix: open } });
    const summary = vi.spyOn(workApi, "getWorkSummary").mockResolvedValue({
      version_id: "v1", scope: "s", built: true,
      objects: [work("b", 2_400, 900, 1_200, 7), work("a", 10, 1, 0, 0)],
      totals: { records: 2_410, open: 2_410, issues: 2_410, critical: 901, proposed: 1_200, overdue: 7 },
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByRole("columnheader", { name: "To fix" })).toBeInTheDocument());
    expect(summary).toHaveBeenCalledWith("v1");
    for (const h of ["Critical", "With a suggestion", "Overdue"]) expect(ledger().getByRole("columnheader", { name: h })).toBeInTheDocument();
    // BBB has the most critical records to fix, so it leads although AAA has more blocking checks; CCC has none.
    const order = rowLabels().join("|");
    expect(order.indexOf("BBB")).toBeLessThan(order.indexOf("AAA"));
    expect(order.indexOf("AAA")).toBeLessThan(order.indexOf("CCC"));
    expect(ledger().getByRole("link", { name: "Open the 2,400 records to fix of BBB" })).toHaveAttribute("href", "/objects/b?run=v1&tab=fix");
    expect(ledger().getByRole("link", { name: "Open the 900 critical records of BBB" })).toHaveAttribute("href", "/objects/b?run=v1&tab=fix&sev=critical");
    expect(ledger().getByRole("link", { name: "Open the 1,200 records with a suggestion of BBB" })).toHaveAttribute("href", "/objects/b?run=v1&tab=fix&suggested=1");
    expect(ledger().getByRole("link", { name: "Open the 7 overdue records of BBB" })).toHaveAttribute("href", "/objects/b?run=v1&tab=fix&due=overdue");
  });

  it("leaves the work-list columns out when the run's work list is not built", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "fail", 40)] });
    vi.spyOn(workApi, "getWorkSummary").mockResolvedValue({
      version_id: "v1", scope: "s", built: false, objects: [], totals: { records: 0, open: 0, issues: 0, critical: 0, proposed: 0, overdue: 0 },
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("AAA")).toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: "To fix" })).toBeNull();
  });

  it("row click seeds the object summary cache under the resolved run id", async () => {
    currentSearch = "run=latest";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v9", objects: [mk("a", "AAA", "fail", 50)] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ObjectsPage /></QueryClientProvider>);
    await waitFor(() => expect(ledger().getByText("AAA")).toBeInTheDocument());
    fireEvent.click(ledger().getByText("AAA"));
    expect(qc.getQueryData(queryKeys.objectSummary("a", "v9"))).toMatchObject({ module: "a" });
    currentSearch = "run=v1";
  });
});
