// frontend/app/(app)/objects/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as versionsApi from "@/lib/api/versions";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectsPage from "../page";

let currentSearch = "run=v1";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("ObjectsPage", () => {
  it.each([["ready", "Ready Obj", "Blocked Obj"]])("legacy ?verdict=%s maps to the readiness filter", async (v, shown, hidden) => {
    currentSearch = `run=v1&verdict=${v}`;
    const mk = (module: string, label: string, readiness: "pass" | "warn") => ({ module, label, composite_score: 80, readiness, failing_checks: 0, affected_records: 0 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "Ready Obj", "pass"), mk("b", "Blocked Obj", "warn")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(shown)).toBeInTheDocument());
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("Material Master")).toBeInTheDocument());
    expect(screen.getByText("72.5").closest("a")).toHaveAttribute("href", "/objects/material_master?run=v1&tab=rules");
    expect(screen.getByText("Not ready")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("Ready Obj")).toBeInTheDocument());
    expect(screen.getByText("Blocked Obj")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all objects" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    currentSearch = "run=v1";
  });
});

describe("ObjectsPage sort, filter and enrichment", () => {
  const mk = (module: string, label: string, readiness: "pass" | "warn" | "fail", score: number, extra = {}) =>
    ({ module, label, composite_score: score, readiness, failing_checks: 1, affected_records: 1, ...extra });
  const rowLabels = () => screen.getAllByRole("row").map((r) => r.textContent ?? "");

  it("sorts worst readiness first, then lowest DQS", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "pass", 99), mk("b", "BBB", "warn", 70), mk("c", "CCC", "fail", 50), mk("d", "DDD", "fail", 40)] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("DDD")).toBeInTheDocument());
    const order = rowLabels().join("|");
    expect(order.indexOf("DDD")).toBeLessThan(order.indexOf("CCC"));
    expect(order.indexOf("CCC")).toBeLessThan(order.indexOf("BBB"));
    expect(order.indexOf("BBB")).toBeLessThan(order.indexOf("AAA"));
  });

  it("?readiness=fail keeps only no-go objects; Not ready Stat links to it", async () => {
    currentSearch = "run=v1&readiness=fail";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "pass", 99), mk("c", "CCC", "fail", 50)] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("CCC")).toBeInTheDocument());
    expect(screen.queryByText("AAA")).not.toBeInTheDocument();
    expect(screen.getByText("Not ready").closest("a")).toHaveAttribute("href", "/objects?run=v1&readiness=fail");
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
    await waitFor(() => expect(screen.getByText("mm_bad")).toBeInTheDocument());
    expect(screen.getByText("mm_bad").closest("a")).toHaveAttribute("href", "/objects/a?run=v1&tab=records&check_id=mm_bad");
    expect(screen.getByText("Blocking findings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "accuracy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ann" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Trend" })).toBeInTheDocument();
  });

  it("omits Trend and Blocking rule columns when no row has the fields", async () => {
    currentSearch = "run=v1";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA", "fail", 50)] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("AAA")).toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: "Trend" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Blocking rule" })).toBeNull();
  });

  it("row click seeds the object summary cache under the resolved run id", async () => {
    currentSearch = "run=latest";
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v9", objects: [mk("a", "AAA", "fail", 50)] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ObjectsPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByText("AAA"));
    expect(qc.getQueryData(queryKeys.objectSummary("a", "v9"))).toMatchObject({ module: "a" });
    currentSearch = "run=v1";
  });
});
