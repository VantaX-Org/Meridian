import { beforeEach, describe, expect, it } from "vitest";
import { adminFixtureResponse, adminFixtureWrite, resetAdminFixture } from "./admin";

type Waves = { waves: { id: string; modules: string[] }[] };

describe("wave cockpit fixtures", () => {
  beforeEach(() => resetAdminFixture());

  it("queues an analysis of the whole wave", () => {
    const w = (adminFixtureResponse("/migration/waves", {}) as Waves).waves.find((x) => x.modules.length > 0)!;
    const r = adminFixtureWrite("POST", `/migration/waves/${w.id}/run`, undefined, {}) as { status: string; modules: string[] };
    expect(r.status).toBe("queued");
    expect(r.modules).toEqual(w.modules);
  });

  it("refuses a wave that does not exist", () => {
    expect(() => adminFixtureWrite("POST", "/migration/waves/nope/run", undefined, {})).toThrow();
  });
});
