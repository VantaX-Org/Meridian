import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as findingsApi from "@/lib/api/findings";
import { blockingSentence, distinctReds, l1Readiness, readinessHref, useFindingHref } from "../shared";
import type { BusinessProcessL1, BusinessProcessL5Field } from "@/types/api";

afterEach(() => vi.restoreAllMocks());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useFindingHref", () => {
  it("opens the failing check's records on its object in that run, never the old finding link that lost them", async () => {
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [{ id: "f1", version_id: "v1", module: "material_master", check_id: "MM045" }],
    } as never);
    const { result } = renderHook(() => useFindingHref("v1"), { wrapper });
    await waitFor(() => expect(result.current("material_master", "MM045")).toBeDefined());
    const href = result.current("material_master", "MM045") ?? "";
    expect(href.startsWith("/objects/material_master?")).toBe(true);
    expect(href).not.toContain("/analyse/");
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("run")).toBe("v1");
    expect(q.get("tab")).toBe("records");
    expect(q.get("check_id")).toBe("MM045");
    // A check that did not fail on that object gives no link, so a caller can try the next object.
    expect(result.current("fi_gl", "MM045")).toBeUndefined();
  });
});

describe("readinessHref", () => {
  it("names the L1, an object of that L1 and the run, so the readiness page never opens another L1", () => {
    expect(readinessHref({ l1: "OTC", object: "sd_sales_orders", run: "v1" })).toBe("/insights/process?l1=OTC&object=sd_sales_orders&run=v1");
    // An object of another L1 is replaced by the L1's first object.
    expect(readinessHref({ l1: "OTC", object: "accounts_payable" })).toBe("/insights/process?l1=OTC&object=accounts_receivable");
    // An L1 with no readiness definition has no readiness page.
    expect(readinessHref({ l1: "R2R", run: "v1" })).toBeUndefined();
  });
});

describe("blocking fields, each once", () => {
  const f = (field: string, check_id: string | null, affected_count: number, dq_status: "red" | "green" = "red"): BusinessProcessL5Field => ({
    field, check_id, affected_count, dq_status, description: field, mandatory: true, config_source: "", pass_rate: 90, finding_message: "",
  });
  // AP016 on LFB1.ZTERM, written by vendor onboarding, invoice verification and the payment run: one field, one record.
  const ap016 = [f("LFB1.ZTERM", "AP016", 1), f("LFB1.ZTERM", "AP016", 1), f("LFB1.ZTERM", "AP016", 1), f("LFA1.NAME1", "AP001", 0, "green")];

  it("counts a field several steps write once, with its records, not once per step", () => {
    expect(distinctReds(ap016)).toHaveLength(1);
    expect(blockingSentence(ap016)).toBe("1 blocking field fails on 1 record.");
  });

  it("says rule failures, not records, when several rules block (a record can fail more than one)", () => {
    expect(blockingSentence([...ap016, f("LFA1.STCD1", "AP020", 40), f("LFA1.STCD1", "AP020", 40)]))
      .toBe("2 blocking fields fail: 41 rule failures between them.");
    expect(blockingSentence([f("LFA1.NAME1", "AP001", 0, "green")])).toBeNull();
  });

  it("scores the process home from the distinct fields too", () => {
    const step = (fields: BusinessProcessL5Field[]) => ({ l4_id: "x", l4_name: "x", tcode: "", description: "", config_dependency: null, step_status: "red",
      activities: [{ l5_id: "a", l5_name: "a", tcode: "", description: "", check_ids: [], activity_status: "red", fields }] });
    const l1 = { l1_id: "PTP", l1_name: "Procure to Pay", l1_description: "", system: "ECC", readiness: "red",
      l2_groups: [{ l2_id: "g", l2_name: "g", readiness: "red", l3_processes: [{ l3_id: "p", l3_name: "p", description: "", overall_readiness: "red",
        l4_subprocesses: ap016.map((x) => step([x])) }] }] } as unknown as BusinessProcessL1;
    expect(l1Readiness(l1, "accounts_payable").failing).toBe(1);
  });
});
