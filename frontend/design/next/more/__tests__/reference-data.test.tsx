import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { RefList, RefUsage } from "@/lib/api/v2/reference-data";
import { ReferenceData } from "../ReferenceData";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ err: null as unknown, can: (() => true) as (p: string) => boolean, decided: [] as string[], proposed: [] as unknown[] }));

vi.mock("@/lib/v2/hooks", async (orig) => ({
  ...(await orig<object>()),
  useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }),
}));

const cov = { same: 1, approved: 0, proposed: 1, rejected: 0, open: 2 };
const list: RefList = {
  id: "country", table: "T005", module: "customer_master", target_fields: ["LAND1"], target_label: "S/4HANA", version_id: "L2",
  versions: [{ load_id: "L2", origin: "rfc", finished_at: "2026-11-02", codes: 4 }, { load_id: "L1", origin: "rfc", finished_at: "2026-11-01", codes: 3 }],
  source: [{ code: "DE", text: "Germany" }, { code: "UK", text: "United Kingdom" }, { code: "ZZ", text: "Unknown" }, { code: "XX" }],
  target: [{ code: "DE", text: "Germany" }, { code: "GB", text: "United Kingdom" }],
  mappings: [{ id: "m1", target_field: "LAND1", source_code: "UK", source_text: "United Kingdom", target_code: "GB", target_text: "United Kingdom", status: "proposed", proposed_by: "other" }],
  coverage: cov,
};
const usage: RefUsage = {
  id: "country", table: "T005", version_id: "L2", run_at: "2026-11-03", orphans_complete: true, unused: ["XX"], unused_certain: true,
  fields: [{ field: "KNA1.LAND1", profiled: true, rows: 100, filled: 90, covered: 80, orphan_rows: 5, masked: false, truncated: false, sampled: false }],
  orphans: [{ value: "YU", count: 5, fields: ["KNA1.LAND1"] }], codes: 4, used: 3, filled: 90, covered: 80, covered_share: 0.889, covered_at_least: false,
};

vi.mock("@/lib/api/v2/runs", async (orig) => ({ ...(await orig<object>()), getSystemsExtended: () => Promise.resolve([{ id: "s1", name: "ECC" }]) }));
vi.mock("@/lib/api/v2/reference-data", async (orig) => ({
  ...(await orig<object>()),
  getRefLists: () => (Q.err ? Promise.reject(Q.err) : Promise.resolve({ target_label: "S/4HANA", lists: [{ id: "country", table: "T005", module: "customer_master", target_fields: ["LAND1"], source_codes: 4, target_codes: 2, versions: 2, coverage: cov }] })),
  getRefList: () => Promise.resolve(list),
  getRefUsage: () => Promise.resolve(usage),
  decideMapping: (id: string, d: string) => { Q.decided.push(`${id}:${d}`); return Promise.resolve({ id, status: "confirmed" }); },
  proposeMapping: (b: unknown) => { Q.proposed.push(b); return Promise.resolve({ id: "m2" }); },
  suggestMapping: () => Promise.resolve({ suggestion: { source_code: "ZZ", target_code: "DE", target_text: "Germany", confidence: 0.4, reasoning: "Closest description", checks: [{ code: "SOURCE_KNOWN", passed: true }, { code: "TARGET_EXISTS", passed: true }] } }),
}));

beforeEach(() => {
  setUrl("/more/reference?fixture=1");
  Q.err = null;
  Q.can = () => true;
  Q.decided = [];
  Q.proposed = [];
});

describe("Reference data", () => {
  it("shows the banner, the lists, the codes, the mappings and the usage", async () => {
    renderWithQuery(<ReferenceData />);
    expect(await screen.findByTestId("reference-data")).toHaveTextContent("2 source codes have no target yet");
    expect(screen.getByTestId("ref-list-country")).toHaveTextContent("T005");
    expect(await screen.findByTestId("ref-code-DE")).toBeInTheDocument();
    expect(screen.getByTestId("ref-map-UK")).toBeInTheDocument();
    expect(screen.getByTestId("ref-versions")).toHaveTextContent("Codes per version");
    expect(await screen.findByTestId("ref-orphan-YU")).toBeInTheDocument();
    expect(screen.getByTestId("ref-unused")).toHaveTextContent("XX");
  });
  it("approves a mapping", async () => {
    renderWithQuery(<ReferenceData />);
    await screen.findByTestId("ref-map-UK");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(Q.decided).toEqual(["m1:approve"]));
  });
  it("asks Aletheia and shows the suggestion with its checks, then proposes it", async () => {
    renderWithQuery(<ReferenceData />);
    await screen.findByTestId("ref-propose");
    fireEvent.change(screen.getAllByLabelText("Source code").find((e) => e.tagName === "SELECT")!, { target: { value: "ZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" }));
    const s = await screen.findByTestId("ref-suggestion");
    expect(s).toHaveTextContent("Closest description");
    expect(s).toHaveTextContent("Passed");
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    await waitFor(() => expect(Q.proposed).toEqual([{ system_id: "s1", list_id: "country", target_field: "LAND1", source_code: "ZZ", target_code: "DE" }]));
  });
  it("hides the proposal form without the analyse permission", async () => {
    Q.can = (p) => p !== "analyse";
    renderWithQuery(<ReferenceData />);
    await screen.findByTestId("ref-mappings");
    expect(screen.queryByTestId("ref-propose")).toBeNull();
  });
  it("retries after an error", async () => {
    Q.err = new Error("down");
    renderWithQuery(<ReferenceData />);
    expect(await screen.findByText("The reference data could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    Q.err = null;
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("reference-data")).toBeInTheDocument();
  });
});
