import { describe, expect, it } from "vitest";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import type { MigrationWave } from "@/types/api";
import { daysUntil, groupByWave, nextWave, reassign, sortWaves, waveOf } from "./waves";

const wave = (id: string, name: string, modules: string[], target_date: string | null, signed = false): MigrationWave => ({
  id, name, source_system_id: null, target_system_id: null, target_release: "2025", modules, target_date, stage: "plan", min_readiness: 95, min_dqs: null,
  signed_off_by: signed ? "u-1" : null, signed_off_at: signed ? "2026-10-01T00:00:00Z" : null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
});

const W1 = wave("w1", "Wave 1", ["fi_gl", "asset_accounting", "controlling", "accounts_payable"], "2026-11-16");
const W2 = wave("w2", "Wave 2", ["material_master", "business_partner"], "2026-12-01");
const W3 = wave("w3", "Wave 3", ["mm_purchasing"], null);

describe("waves", () => {
  it("orders dated waves by date, then the undated ones", () => {
    expect(sortWaves([W3, W2, W1]).map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("an object is in the first wave that lists it", () => {
    expect(waveOf("controlling", [W3, W2, W1])?.id).toBe("w1");
    expect(waveOf("hcm", [W1, W2, W3])).toBeNull();
    const twice = wave("w0", "Early", ["controlling"], "2026-10-01");
    expect(waveOf("controlling", [W1, twice])?.id).toBe("w0");
  });

  it("groups the objects of the landscape by wave, with the verdicts of their cells, and the rest under no wave", () => {
    const groups = groupByWave(landscapeFixture, [W1, W2, W3], landscapeFixture.cells);
    expect(groups.map((g) => g.wave?.id ?? null)).toEqual(["w1", "w2", "w3", null]);
    expect(groups[0].modules).toEqual(["accounts_payable", "fi_gl", "asset_accounting", "controlling"]);
    expect(groups[0].counts).toEqual({ go: 1, "at-risk": 0, "no-go": 3 });
    expect(groups[1].counts).toEqual({ go: 0, "at-risk": 0, "no-go": 2 });
    const none = groups[3];
    expect(none.wave).toBeNull();
    expect(none.modules).toContain("hcm");
    const total = groups.reduce((n, g) => n + g.counts.go + g.counts["at-risk"] + g.counts["no-go"], 0);
    expect(total).toBe(landscapeFixture.cells.length);
  });

  it("keeps a wave with no objects, and shows no 'not in a wave' group when every object is in one", () => {
    const empty = wave("e", "Empty", [], null);
    expect(groupByWave(landscapeFixture, [empty], landscapeFixture.cells)[0]).toMatchObject({ modules: [], counts: { go: 0, "at-risk": 0, "no-go": 0 } });
    const all = wave("all", "Everything", landscapeFixture.objects.map((o) => o.module), "2027-01-01");
    expect(groupByWave(landscapeFixture, [all], landscapeFixture.cells)).toHaveLength(1);
  });

  it("the next wave is the earliest dated one that is not signed off", () => {
    expect(nextWave([W3, W2, W1])?.id).toBe("w1");
    expect(nextWave([wave("s", "Signed", [], "2026-11-01", true), W2, W3])?.id).toBe("w2");
    expect(nextWave([W3])?.id).toBe("w3");
    expect(nextWave([])).toBeNull();
  });

  it("counts days to a date", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(daysUntil("2026-11-16", now)).toBe(18);
    expect(daysUntil("2026-10-29", now)).toBe(0);
    expect(daysUntil("2026-10-20", now)).toBe(-9);
    expect(daysUntil(null, now)).toBeNull();
  });

  it("moves an object to another wave and returns only the waves that changed", () => {
    expect(reassign([W1, W2, W3], { mm_purchasing: "w1" })).toEqual({
      w1: ["fi_gl", "asset_accounting", "controlling", "accounts_payable", "mm_purchasing"],
      w3: [],
    });
    expect(reassign([W1, W2, W3], { controlling: "" })).toEqual({ w1: ["fi_gl", "asset_accounting", "accounts_payable"] });
    expect(reassign([W1, W2, W3], { controlling: "w1" })).toEqual({});
    expect(reassign([W1, W2, W3], { hcm: "w2" })).toEqual({ w2: ["material_master", "business_partner", "hcm"] });
  });
});
