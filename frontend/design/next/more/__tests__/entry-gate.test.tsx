import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { FirewallSummary, FirewallVerdict } from "@/lib/api/v2/dq-firewall";
import { EntryGate } from "../EntryGate";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ err: null as unknown, can: ((p: string) => p.length > 0) as (a: string) => boolean, shared: false, sent: [] as unknown[] }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

const summary: FirewallSummary = {
  modules: ["material_master"], max_records: 100, block_severity: "critical", calls_24h: 4, calls_7d: 12, last_call_at: null,
  days: [{ day: "2026-11-14", checked: 10, blocked: 2, warned: null, passed: null }, { day: "2026-11-15", checked: 8, blocked: 1, warned: 3, passed: 4 }],
  top_rules: [{ rule_id: "MM-001", description: "Material type is set", blocked: 3 }],
  by_module: [{ module: "material_master", checked: 18, blocked: 3, warned: 3, passed: 4 }],
  requests: [{ id: "r1", object: "material", title: "Create ENTRY-TEST-1", status: "in_approval", created_at: "2026-11-15T10:00:00Z" }],
  holds: { held: 1, released: 0, rejected: 0, written: 0, oldest_held_hours: 5, median_decision_hours: null, latest: [{ id: "r1", object: "material", title: "Create ENTRY-TEST-1", status: "in_approval", created_at: "2026-11-15T10:00:00Z" }] },
} as FirewallSummary;
const verdict: FirewallVerdict = {
  verdict: "block", block_severity: "critical", module: "material_master", rules_run: 7, save: "stop",
  records: [{ index: 0, verdict: "block", failures: [{ rule_id: "MM-001", description: "Material type is set", field: "MARA.MTART", severity: "critical", dimension: "completeness", reason: "empty" }] }],
} as FirewallVerdict;

vi.mock("@/lib/api/v2/dq-firewall", async (orig) => ({
  ...(await orig<object>()),
  getFirewallSummary: () => (Q.err ? Promise.reject(Q.err) : Promise.resolve(summary)),
  validateRecords: (...a: unknown[]) => { Q.sent.push(a); return Promise.resolve(verdict); },
}));

beforeEach(() => {
  setUrl("/more/entry-gate?fixture=1");
  Q.err = null;
  Q.can = (p: string) => p.length > 0;
  Q.shared = false;
  Q.sent = [];
});

describe("Entry gate", () => {
  it("shows the traffic, the rules, the objects, the holds and the requests", async () => {
    renderWithQuery(<EntryGate />);
    expect(await screen.findByTestId("entry-gate")).toHaveTextContent("3 of 18 records");
    expect(screen.getByTestId("entry-gate-rules")).toHaveTextContent("MM-001");
    expect(screen.getByTestId("entry-gate-module-material_master")).toBeInTheDocument();
    expect(screen.getByTestId("entry-gate-hold-held")).toHaveTextContent("1");
    expect(screen.getByTestId("entry-gate-held-r1")).toBeInTheDocument();
    expect(screen.getByTestId("entry-gate-request-r1")).toBeInTheDocument();
  });
  it("checks records and shows the failing rules and the save outcome", async () => {
    renderWithQuery(<EntryGate />);
    fireEvent.change(await screen.findByTestId("entry-gate-hold"), { target: { value: "blocked" } });
    fireEvent.click(screen.getByTestId("entry-gate-run"));
    expect(await screen.findByTestId("entry-gate-save")).toHaveTextContent("The SAP save stops.");
    expect(screen.getByTestId("entry-gate-result")).toHaveTextContent("1 of 1 records blocked, 7 rules run.");
    expect(Q.sent[0]).toEqual(["material_master", [{ "MARA.MATNR": "ENTRY-TEST-1", "MARA.MTART": "", "MARA.MEINS": "KG" }], { suggest: true, duplicates: false, route_to_steward: false, hold: "blocked" }]);
  });
  it("refuses records that are not a JSON list", async () => {
    renderWithQuery(<EntryGate />);
    fireEvent.change(await screen.findByTestId("entry-gate-json"), { target: { value: "{}" } });
    fireEvent.click(screen.getByTestId("entry-gate-run"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The records must be a JSON list of objects");
    expect(Q.sent).toHaveLength(0);
  });
  it("says which permission checking needs", async () => {
    Q.can = () => false;
    renderWithQuery(<EntryGate />);
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
    expect(screen.queryByTestId("entry-gate-run")).toBeNull();
  });
  it("retries after an error", async () => {
    Q.err = Object.assign(new Error("down"), { status: 500 });
    renderWithQuery(<EntryGate />);
    expect(await screen.findByText("The firewall traffic could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    Q.err = null;
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("entry-gate")).toBeInTheDocument();
  });
});
