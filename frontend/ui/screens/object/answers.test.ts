import { describe, expect, it, vi } from "vitest";
import { answerFor } from "./answers";
import type { ObjectData } from "./useObjectData";

const base = { failing: [], capped: false, capLevel: null, capIds: [], open: 10, proposed: 6, person: 4, pair: null } as unknown as ObjectData;
const href = (seg: string, rule?: string) => `/work?seg=${seg}${rule ? `&rule=${rule}` : ""}`;

describe("answerFor", () => {
  it("says so when nothing fails", () => {
    expect(answerFor("worst", base, href, () => {}).actions).toEqual([]);
  });
  it("names the worst rule with evidence and an open-rule action", () => {
    const open = vi.fn();
    const d = { ...base, failing: [{ check_id: "MM003", name: "Base unit set", severity: "critical", affected_count: 12, total_count: 100 }] } as unknown as ObjectData;
    const a = answerFor("worst", d, href, open);
    expect(a.text).toContain("MM003");
    expect(a.evidence).toContain("Base unit set");
    a.actions[0].onClick?.();
    expect(open).toHaveBeenCalledWith("MM003");
    expect(a.actions[1].href).toBe("/work?seg=proposed&rule=MM003");
  });
  it("splits open records into proposed and needs-a-person", () => {
    expect(answerFor("fix", base, href, () => {}).text).toContain("6 have a proposed fix");
  });
  it("reports the cap and a missing target pair", () => {
    expect(answerFor("cap", { ...base, capped: true, capLevel: 60, capIds: ["MM003"] } as unknown as ObjectData, href, () => {}).evidence).toEqual(["MM003"]);
    expect(answerFor("target", base, href, () => {}).text).toContain("No target system");
  });
});
