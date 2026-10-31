import { describe, expect, it } from "vitest";
import type { WorkRow } from "@/lib/api/v2/types";
import type { Person } from "@/lib/api/v2/people";
import type { Notification } from "@/types/api";
import { batchSheetCsv } from "@/lib/api/v2/batches";
import { approveBlock, batchLabel, groupByBatch, sentLine, toBatchRow, trailOf, type BatchRow } from "./batches";
import { formatOpen, parseOpen } from "./hooks";
import { groupNotifications, kindOf, linkOf, sentenceOf } from "./inbox";
import { objectsLine, roleWord, slaMet, slaWord, sortPeople, workByObject } from "./people";
import { filtersOf, readState, toParams } from "./work";

const row = (over: Partial<WorkRow>): WorkRow => ({ module: "material_master", record_key: "MATNR=1", name: null, issues: 1, severity: "high", checks: ["MM142"], proposed: 0, status: "proposed", top_message: null, top_field: null, ...over });
const batch = (over: Partial<BatchRow>): BatchRow => ({ id: "B-1", label: "B-1", name: "x", status: "draft", owner: null, ownerId: null, steward: null, records: 1, valueAtRisk: null, dueAt: null, createdAt: "2026-10-01T00:00:00Z", approvedBy: null, approvedAt: null, sentAt: null, returned: null, verification: null, ...over });
const person = (over: Partial<Person>): Person => ({ id: "u", name: "A", email: null, role: "viewer", is_me: false, objects_owned: [], open_work: 0, approvals_waiting: 0, overdue: 0, sla_hours: null, breaches_this_month: 0, last_action_at: null, ...over });

describe("batches", () => {
  it("labels a database id as B- and six characters, and keeps a label that already reads as one", () => {
    expect(batchLabel("1a2b3c4d-1111-2222-3333-444455556666")).toBe("B-1A2B3C");
    expect(batchLabel("B-241")).toBe("B-241");
  });

  it("makes the row of a batch from the API, with a dash for what the API does not send and the last send-back", () => {
    const b = toBatchRow({ id: "x", name: "N", status: "approved", filter: { returned: { by: "R", note: "fix it", at: "2026-10-02" } } as never, created_by: "u1", created_by_label: "A", created_at: "t", approved_by: null, approved_by_label: "T", approved_at: "t2", exported_at: null, items: 5, with_proposal: 5, auto_approvable: 0, fixed: 0, still_failing: 0 });
    expect(b).toMatchObject({ label: "x", owner: "A", ownerId: "u1", approvedBy: "T", records: 5, valueAtRisk: null, dueAt: null, steward: null });
    expect(b.returned).toEqual({ by: "R", note: "fix it", at: "2026-10-02" });
  });

  it("groups loaded rows under their batch, in the batch order given; the rest are loose", () => {
    const a = batch({ id: "A" });
    const b = batch({ id: "B" });
    const { groups, loose } = groupByBatch([b, a], [row({ record_key: "1", batch_id: "A" }), row({ record_key: "2", batch_id: "B" }), row({ record_key: "3" }), row({ record_key: "4", batch_id: "Z" })]);
    expect(groups.map((g) => [g.batch.id, g.rows.map((r) => r.record_key)])).toEqual([["B", ["2"]], ["A", ["1"]]]);
    expect(loose.map((r) => r.record_key)).toEqual(["3", "4"]);
  });

  it("collapses the per-record events into one step per action and person, with the reason of a send-back", () => {
    const ev = (item: string | null, action: string, user: string, at: string, to: string | null = null) => ({ item_id: item as string, action, from_value: null, to_value: to, user_label: user, version_id: null, created_at: at });
    const trail = trailOf([
      ev("1", "approved", "T", "2026-10-02T10:00:00Z"),
      ev("2", "approved", "T", "2026-10-02T10:00:00Z"),
      ev("1", "created", "A", "2026-10-01T10:00:00Z"),
      ev("2", "created", "A", "2026-10-01T10:00:00Z"),
      ev("3", "created", "A", "2026-10-01T10:00:00Z"),
      ev(null, "sent_back", "T", "2026-10-03T10:00:00Z", "Wrong plant"),
    ]);
    expect(trail.map((t) => [t.word, t.user, t.records, t.note])).toEqual([["Drafted", "A", 3, null], ["Approved", "T", 2, null], ["Sent back", "T", 0, "Wrong plant"]]);
  });

  it("words a sent batch and says why a person cannot approve", () => {
    expect(sentLine({ records: 96, sentAt: "x" }, () => "9 Oct 2026")).toBe("Sent to SAP, 96 records, 9 Oct 2026");
    expect(sentLine({ records: 1, sentAt: "x" }, () => "d")).toBe("Sent to SAP, 1 record, d");
    expect(approveBlock(batch({}), { approve: false }, "me")).toBe("Your role cannot approve.");
    expect(approveBlock(batch({ status: "approved" }), { approve: true }, "me")).toBe("This batch is already approved.");
    expect(approveBlock(batch({ ownerId: "me" }), { approve: true }, "me")).toBe("You built this batch; a second person approves it.");
    expect(approveBlock(batch({ ownerId: "x" }), { approve: true }, "me")).toBeNull();
  });

  it("builds the sheet of a batch as CSV with spreadsheet formulas defused", () => {
    const csv = batchSheetCsv([{ id: "1", batch_id: "b", issue_id: "i", scope: "s", module: "material_master", check_id: "MM142", record_key: "MATNR=1", grain: null, field: "MARA.MEINS", current_value: "=1+1", proposed_value: "EA, each", proposal_source: "steward", confidence: null, accepted: false, recon_status: null, recon_version: null, updated_at: "t", auto_approvable: false }]);
    expect(csv.split("\n")[0]).toBe("Object,Record,Rule,Field,Current value,New value,Source,Confidence");
    expect(csv.split("\n")[1]).toBe("material_master,MATNR=1,MM142,MARA.MEINS,'=1+1,\"EA, each\",steward,");
  });
});

describe("people", () => {
  it("derives SLA met from the open work not yet overdue unless the API sends one", () => {
    expect(slaMet(person({ open_work: 214, overdue: 31 }))).toBe(86);
    expect(slaMet(person({ open_work: 0 }))).toBeNull();
    expect(slaMet(person({ open_work: 10, overdue: 99 }))).toBe(0);
    expect(slaMet(person({ open_work: 10, overdue: 5, sla_met_pct: 97.4 }))).toBe(97);
  });

  it("puts the caller first, then sorts: high first, SLA met low first, a name A to Z, and reverses", () => {
    const ps = [person({ id: "1", name: "B", open_work: 5, overdue: 0 }), person({ id: "2", name: "A", open_work: 50, overdue: 25 }), person({ id: "3", name: "Me", is_me: true, open_work: 1 })];
    expect(sortPeople(ps, "open").map((p) => p.id)).toEqual(["3", "2", "1"]);
    expect(sortPeople(ps, "sla").map((p) => p.id)).toEqual(["3", "2", "1"]);
    expect(sortPeople(ps, "name").map((p) => p.id)).toEqual(["3", "2", "1"]);
    expect(sortPeople(ps, "name", true).map((p) => p.id)).toEqual(["3", "1", "2"]);
    expect(sortPeople(ps, "overdue").map((p) => p.id)).toEqual(["3", "2", "1"]);
  });

  it("sorts people with no figure last", () => {
    const ps = [person({ id: "1", name: "A", open_work: 0 }), person({ id: "2", name: "B", open_work: 10, overdue: 1 })];
    expect(sortPeople(ps, "sla").map((p) => p.id)).toEqual(["2", "1"]);
  });

  it("words roles, objects held and SLA hours, and groups work by object", () => {
    expect(roleWord("data_owner")).toBe("Data owner");
    expect(roleWord("something_new")).toBe("Something new");
    expect(objectsLine(person({ objects_owned: [{ module: "a", label: "A", as: "owner" }, { module: "b", label: "B", as: "steward" }, { module: "c", label: "C", as: "steward" }] }))).toBe("1 owned, 2 stewarded");
    expect(objectsLine(person({}))).toBeNull();
    expect(slaWord(72)).toBe("3 days");
    expect(slaWord(24)).toBe("1 day");
    expect(slaWord(4)).toBe("4 hours");
    expect(slaWord(null)).toBeNull();
    expect(workByObject([{ module: "b" }, { module: "a" }, { module: "b" }])).toEqual([{ module: "b", count: 2 }, { module: "a", count: 1 }]);
  });
});

describe("inbox", () => {
  const n = (id: string, at: string, over: Partial<Notification> = {}): Notification => ({ id, tenant_id: "t", user_id: null, type: "info", title: "T", body: "", link: null, is_read: false, created_at: at, ...over });

  it("groups into Today and Earlier by the viewer's calendar day, newest first", () => {
    const now = new Date(2026, 9, 16, 12, 0, 0);
    const g = groupNotifications([n("old", new Date(2026, 9, 15, 23, 59).toISOString()), n("a", new Date(2026, 9, 16, 8, 0).toISOString()), n("b", new Date(2026, 9, 16, 11, 0).toISOString())], now);
    expect(g.today.map((x) => x.id)).toEqual(["b", "a"]);
    expect(g.earlier.map((x) => x.id)).toEqual(["old"]);
  });

  it("gives each kind a mark and a word, and an unknown kind a notice", () => {
    expect(kindOf("sla_breached")).toEqual({ word: "SLA breached", severity: "critical" });
    expect(kindOf("approval").word).toBe("Approval");
    expect(kindOf("brand_new")).toEqual({ word: "Notice", severity: "low" });
  });

  it("writes the sentence from the title and the body without repeating either", () => {
    expect(sentenceOf({ title: "Batch waits.", body: "328 records." })).toBe("Batch waits. 328 records.");
    expect(sentenceOf({ title: "Same", body: "Same" })).toBe("Same");
    expect(sentenceOf({ title: "Only", body: "" })).toBe("Only");
  });

  it("names where a link goes: an object, a batch, the ledger, any other page, or a link outside the app", () => {
    expect(linkOf(null)).toBeNull();
    expect(linkOf("/o/ecc-production/material-master", () => "Material master")).toEqual({ href: "/o/ecc-production/material-master", label: "Material master", external: false });
    expect(linkOf("/o/ecc-production/business-partner")?.label).toBe("Business partner");
    expect(linkOf("/work?open=batch:B-1")?.label).toBe("Open the batch");
    expect(linkOf("/work?due=overdue")?.label).toBe("Open the ledger");
    expect(linkOf("/reports")).toEqual({ href: "/reports", label: "Open", external: false });
    expect(linkOf("https://example.org/a")).toEqual({ href: "https://example.org/a", label: "Open", external: true });
  });
});

describe("the address of the inspector", () => {
  it("reads batch and person like any other thing, and inbox and triage as panels with no id", () => {
    expect(parseOpen("batch:B-241")).toEqual({ kind: "batch", id: "B-241" });
    expect(parseOpen("person:u-an")).toEqual({ kind: "person", id: "u-an" });
    expect(parseOpen("inbox")).toEqual({ kind: "inbox", id: "" });
    expect(parseOpen("triage")).toEqual({ kind: "triage", id: "" });
    expect(parseOpen("inbox:1")).toBeNull();
    expect(parseOpen("nope")).toBeNull();
  });

  it("keeps a batch in the ledger's address, listing every open state, and sends it to the API as batch_id", () => {
    const s = readState(new URLSearchParams("batch=B-241"));
    expect(s).toMatchObject({ batch: "B-241", chip: null });
    expect(filtersOf(s)).toMatchObject({ batch_id: "B-241", status: "open" });
    expect(toParams(s)).toMatchObject({ batch: "B-241", filter: "open" });
    expect(readState(new URLSearchParams("batch=B-241&filter=approvals")).chip).toBe("approvals");
    expect(readState(new URLSearchParams("")).batch).toBeNull();
  });

  it("writes them back the same way", () => {
    expect(formatOpen({ kind: "batch", id: "B-1" })).toBe("batch:B-1");
    expect(formatOpen({ kind: "inbox", id: "" })).toBe("inbox");
  });
});
