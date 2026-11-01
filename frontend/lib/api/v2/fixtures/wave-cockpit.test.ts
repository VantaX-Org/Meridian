import { beforeEach, describe, expect, it } from "vitest";
import { adminFixtureResponse, adminFixtureWrite, resetAdminFixture } from "./admin";

type Waves = { waves: { id: string; modules: string[]; last_run_id?: string | null }[] };

describe("wave cockpit fixtures", () => {
  beforeEach(() => resetAdminFixture());

  it("queues an analysis of the whole wave", () => {
    const w = (adminFixtureResponse("/migration/waves", {}) as Waves).waves.find((x) => x.modules.length > 0)!;
    const r = adminFixtureWrite("POST", `/migration/waves/${w.id}/run`, undefined, {}) as { status: string; modules: string[] };
    expect(r.status).toBe("queued");
    expect(r.modules).toEqual(w.modules);
  });

  it("reads a cockpit whose blockers belong to blocked objects", () => {
    const w = (adminFixtureResponse("/migration/waves", {}) as Waves).waves.find((x) => x.modules.length > 1)!;
    const c = adminFixtureResponse(`/migration/waves/${w.id}/cockpit`, {}) as { run_id: string | null; objects: { module: string; blocker_count: number }[]; blockers: { module: string }[] };
    if (!c.run_id) return expect(c.objects).toEqual([]);
    expect(c.blockers.map((b) => b.module).sort()).toEqual(c.objects.filter((o) => o.blocker_count > 0).map((o) => o.module).sort());
  });

  it("drafts a fix batch for a blocker of an analysed wave and refuses an unanalysed one", () => {
    const waves = (adminFixtureResponse("/migration/waves", {}) as Waves).waves;
    const done = waves.find((x) => x.last_run_id)!;
    const body = { module: done.modules[0], gap_type: "value_unmapped", field: null };
    const r = adminFixtureWrite("POST", `/migration/waves/${done.id}/blockers/fix-batch`, body, {}) as { id: string; status: string };
    expect(r.status).toBe("draft");
    const fresh = waves.find((x) => !x.last_run_id);
    if (fresh) expect(() => adminFixtureWrite("POST", `/migration/waves/${fresh.id}/blockers/fix-batch`, body, {})).toThrow();
  });

  it("refuses a wave that does not exist", () => {
    expect(() => adminFixtureWrite("POST", "/migration/waves/nope/run", undefined, {})).toThrow();
  });
});
