import { beforeEach, describe, expect, it } from "vitest";
import { fixtureResponse, fixtureWrite, resetWorkFixture } from "./index";
import type { WorkPage } from "../types";
import type { WorkGroup, WorkSummary } from "@/lib/api/work";
import type { DecideResult, GroupResult, UndoResult } from "../work";

const records = (p: Record<string, string | number | boolean | undefined> = {}) => fixtureResponse<WorkPage>("/work/records", p);
const summary = () => fixtureResponse<WorkSummary>("/work/summary", {});
const KEY = "MATNR=000000000000000100";
const item = (action: string, extra: object = {}) => ({ module: "material_master", record_key: KEY, check_id: "MM014", action, ...extra });

beforeEach(() => resetWorkFixture());

describe("the work fixture", () => {
  it("has the prototype's headline numbers: 25,712 to fix, 3,418 with a suggested value, 612 waiting, 48 exceptions", () => {
    const s = summary();
    expect(s.objects[0].statuses).toEqual({ to_fix: 25712, proposed: 612, approved: 180, sent: 96, not_an_issue: 48 });
    expect(s.objects[0].proposed).toBe(3418);
    expect(records().total).toBe(25712);
    expect(records({ status: "to_fix", proposed: true }).total).toBe(3418);
    expect(records({ status: "proposed" }).total).toBe(612);
    expect(records({ status: "not_an_issue" }).total).toBe(48);
  });

  it("the groups' suggested values add up to the 3,418, the top rule first", () => {
    const g = fixtureResponse<{ groups: WorkGroup[] }>("/work/groups", {}).groups;
    expect(g[0].check_id).toBe("MM014");
    expect(g[0].proposed).toBe(112);
    expect(g.reduce((n, x) => n + x.proposed, 0)).toBe(3418);
  });

  it("pages with a cursor and filters by rule, severity and assignment", () => {
    const first = records({ limit: 30, sort: "-value" });
    expect(first.items).toHaveLength(30);
    expect(first.next).not.toBeNull();
    const second = records({ limit: 30, sort: "-value", after: first.next ?? undefined });
    expect(second.items[0].record_key).not.toBe(first.items[0].record_key);
    expect(records({ check_id: "MM031", limit: 100 }).items.every((r) => r.checks[0] === "MM031")).toBe(true);
    expect(records({ severity: "critical", limit: 100 }).items.every((r) => r.severity === "critical")).toBe(true);
    expect(records({ assigned: "unassigned", limit: 100 }).items.every((r) => !r.assigned_to)).toBe(true);
  });

  it("a decision moves the counts, undo moves them back, and undoing twice is refused with a sentence", () => {
    const res = fixtureWrite<DecideResult>("POST", "/work/decide", { items: [item("accept")] }, {});
    expect(res.action_id).toMatch(/^fx-action-/);
    let s = summary();
    expect(s.objects[0].statuses.to_fix).toBe(25711);
    expect(s.objects[0].statuses.proposed).toBe(613);
    expect(s.objects[0].proposed).toBe(3417);
    expect(records({ limit: 200 }).items.some((r) => r.record_key === KEY)).toBe(false);
    expect(fixtureResponse<{ cells: { module: string; open_work: number | null }[] }>("/landscape", {}).cells[0].open_work).toBe(25712);
    fixtureWrite<UndoResult>("POST", "/actions/undo", { action_id: res.action_id }, {});
    s = summary();
    expect(s.objects[0].statuses.to_fix).toBe(25712);
    expect(() => fixtureWrite("POST", "/actions/undo", { action_id: res.action_id }, {})).toThrowError("This change was already undone.");
    expect(() => fixtureWrite("POST", "/actions/undo", { action_id: "nope" }, {})).toThrowError("No such change to undo.");
  });

  it("a sign-off moves the open work (landscape and shell counts follow) and needs a reason", () => {
    expect(() => fixtureWrite("POST", "/work/decide", { items: [item("not_an_issue")] }, {})).toThrowError("Say why: a sign-off needs a reason.");
    fixtureWrite("POST", "/work/decide", { items: [item("not_an_issue", { note: "Legacy" })] }, {});
    expect(summary().objects[0].statuses.not_an_issue).toBe(49);
    expect(fixtureResponse<{ cells: { open_work: number | null }[] }>("/landscape", {}).cells[0].open_work).toBe(25711);
    expect(fixtureResponse("/shell/counts", {})).toEqual({ fix: 25711, inbox: 7 });
  });

  it("accepting a value that does not exist is a 409 with the server's sentence", () => {
    try {
      fixtureWrite("POST", "/work/decide", { items: [{ ...item("accept"), record_key: "MATNR=000000000000000232", check_id: "MM031" }] }, {});
      expect.unreachable();
    } catch (e) {
      expect((e as { response: { status: number; data: { detail: string } } }).response).toEqual({ status: 409, data: { detail: "No proposed value to accept: enter one." } });
    }
  });

  it("accept-all takes the group's suggested values and undo gives them back", () => {
    const res = fixtureWrite<GroupResult>("POST", "/work/groups/MM014/accept-all", undefined, {});
    expect(res.accepted).toBe(112);
    expect(summary().objects[0].proposed).toBe(3418 - 112);
    expect(fixtureResponse<{ groups: WorkGroup[] }>("/work/groups", {}).groups[0].proposed).toBe(0);
    fixtureWrite("POST", "/actions/undo", { action_id: res.action_id }, {});
    expect(fixtureResponse<{ groups: WorkGroup[] }>("/work/groups", {}).groups[0].proposed).toBe(112);
  });

  it("saves a view by name and refuses a built-in name", () => {
    const body = { route: "work", name: "Mine", filters: { status: "open" }, columns: null, density: null };
    const saved = fixtureWrite<{ id: string }>("PUT", "/views", body, {});
    expect(fixtureResponse<{ views: { id: string; builtin: boolean }[] }>("/views", { route: "work" }).views.map((v) => v.builtin)).toEqual([true, true, true, false]);
    expect(fixtureWrite<{ id: string }>("PUT", "/views", { ...body, filters: { status: "to_fix" } }, {}).id).toBe(saved.id);
    expect(() => fixtureWrite("PUT", "/views", { ...body, name: "Overdue" }, {})).toThrowError(/built-in view/);
  });

  it("a record that fails nothing is a 404", () => {
    expect(() => fixtureResponse("/work/records/material_master/MATNR%3D9", {})).toThrowError("This record does not fail any check in this run.");
  });
});
