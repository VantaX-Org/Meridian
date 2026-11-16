import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { Survivorship, SurvivorshipAccuracy, SurvivorshipPick } from "@/lib/api/v2/aletheia-survivorship";
import { AletheiaSurvivorship } from "../AletheiaSurvivorship";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ data: null as unknown, fail: false, can: ((_: string) => true) as (a: string) => boolean, decision: vi.fn(), bulk: vi.fn() }));
vi.mock("@/lib/api/v2/aletheia-survivorship", async (orig) => ({
  ...(await orig<object>()),
  getSurvivorship: () => (Q.fail ? Promise.reject(new Error("down")) : Promise.resolve(Q.data)),
  getSurvivorshipAccuracy: (): Promise<SurvivorshipAccuracy> => Promise.resolve({
    accepted: 3, overridden: 1, pending: 1, acceptance_rate: 0.75, override_rate: 0.25, by_object: [], reason_codes: [],
    by_week: [{ week: "2026-10-01", accepted: 1, overridden: 1, pending: 0, acceptance_rate: 0.5, override_rate: 0.5 }, { week: "2026-10-08", accepted: 2, overridden: 0, pending: 1, acceptance_rate: 1, override_rate: 0 }],
    by_field: [{ domain: "material_master", field: "MEINS", field_text: "Base unit", accepted: 3, overridden: 1, pending: 1, acceptance_rate: 0.75, override_rate: 0.25 }],
  }),
  getApprovalSetting: () => Promise.resolve({ required: true }),
  putApprovalSetting: (b: { required: boolean }) => Promise.resolve(b),
  postSurvivorshipDecision: (b: unknown) => { Q.decision(b); return Promise.resolve({}); },
  postSurvivorshipBulkApprove: (b: unknown) => { Q.bulk(b); return Promise.resolve({ approved: 1, failed: [] }); },
}));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "u-me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const pick = (over: Partial<SurvivorshipPick>): SurvivorshipPick => ({
  domain: "material_master", sap_object_key: "M-1", field: "MEINS", field_text: "Base unit", recommended_source: "ECC", confidence: 0.9,
  reasoning: "Most complete shape", verified: true, checks: [{ code: "SOURCE_KNOWN", passed: true }], applied: false, state: "pending",
  candidates: [{ source_system: "ECC", shape: "AAA", length: 3, blank: false, picked: true }, { source_system: "CRM", shape: "AA", length: 2, blank: false, picked: false }],
  ...over,
});

const data = (): Survivorship => ({
  domains: [{ domain: "material_master", verified: 2, rejected: 1 }],
  counts: { proposed: 1, approved: 1, rejected: 0, auto_applied: 0 },
  picks: [pick({}), pick({ sap_object_key: "M-2", applied: true, state: "accepted" })],
});

beforeEach(() => {
  setUrl("/more/aletheia?tab=survivorship&fixture=1");
  Q.data = data();
  Q.fail = false;
  Q.can = () => true;
  Q.decision.mockReset();
  Q.bulk.mockReset();
});

describe("Aletheia survivorship", () => {
  it("shows the banner, queue, decided picks, accuracy and setting", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    expect(await screen.findByTestId("aletheia-survivorship")).toBeInTheDocument();
    expect(screen.getByTestId("surv-queue-M-1-MEINS")).toBeInTheDocument();
    expect(screen.getByTestId("surv-state-M-2-MEINS")).toHaveTextContent("Accepted by a steward");
    expect(await screen.findByTestId("surv-rates")).toHaveTextContent("75");
    expect(await screen.findByTestId("surv-approval-current")).toHaveTextContent("required");
    expect(screen.getByTestId("surv-count-proposed")).toBeInTheDocument();
  });
  it("rejects a queued pick with a reason and bulk-approves the selection", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const row = await screen.findByTestId("surv-queue-M-1-MEINS");
    fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
    fireEvent.change(within(row).getByLabelText("Reason for the rejection"), { target: { value: "Old unit" } });
    fireEvent.click(within(row).getByRole("button", { name: "Reject this pick" }));
    await waitFor(() => expect(Q.decision).toHaveBeenCalledWith(expect.objectContaining({ decision: "reject", note: "Old unit" })));
    fireEvent.click(within(row).getByLabelText("Select MEINS on M-1"));
    fireEvent.click(screen.getByRole("button", { name: /Approve selected/ }));
    await waitFor(() => expect(Q.bulk).toHaveBeenCalledWith([{ domain: "material_master", sap_object_key: "M-1", field: "MEINS" }]));
  });
  it("explains a read-only queue without the approve permission", async () => {
    Q.can = () => false;
    renderWithQuery(<AletheiaSurvivorship />);
    expect(await screen.findByTestId("surv-queue-reason")).toBeInTheDocument();
    expect(await screen.findByTestId("surv-approval-reason")).toBeInTheDocument();
  });
  it("offers a retry when the picks fail to load", async () => {
    Q.fail = true;
    renderWithQuery(<AletheiaSurvivorship />);
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
