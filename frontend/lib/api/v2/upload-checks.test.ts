import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/v2/i18n/en";
import { de } from "@/lib/v2/i18n/de";
import { ja } from "@/lib/v2/i18n/ja";
import { blocks, CHECK_ORDER, CHECK_SENTENCE, fixtureWorkbookChecks, holdReason, worstOf } from "./upload-checks";

/** The check ids the server can return, read from the service itself so the two cannot drift apart. */
const serverIds = (): string[] => {
  const py = readFileSync(resolve(__dirname, "../../../../api/services/upload_checks.py"), "utf8");
  const m = /^CHECK_IDS\s*=\s*\(([^)]*)\)/m.exec(py);
  return [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
};

describe("upload checks client", () => {
  it("knows every check id upload_checks.py returns, in its order", () => {
    expect(serverIds()).toEqual([...CHECK_ORDER]);
    for (const id of serverIds()) expect(typeof (CHECK_SENTENCE as Record<string, unknown>)[id]).toBe("function");
  });
  it("maps every check id to a sentence that is a key in en, de and ja", () => {
    for (const id of serverIds()) {
      const s = (CHECK_SENTENCE as Record<string, () => string>)[id]!();
      expect(Object.keys(en)).toContain(s);
      expect((de as Record<string, string>)[s]).toBeTruthy();
      expect((ja as Record<string, string>)[s]).toBeTruthy();
    }
  });
  it("answers a clean, a warned and a blocked file in fixture mode", () => {
    const clean = fixtureWorkbookChecks("cleaned.xlsx", "r1");
    const warn = fixtureWorkbookChecks("warn.xlsx", "r1");
    const bad = fixtureWorkbookChecks("bad.xlsx", "r1");
    expect(clean.checks.map((c) => c.id)).toEqual([...CHECK_ORDER]);
    expect([worstOf(clean.checks), worstOf(warn.checks), worstOf(bad.checks)]).toEqual(["pass", "warn", "fail"]);
    expect(blocks(bad.checks)).toBe(true);
    expect(bad.checks.find((c) => c.status === "fail")?.id).toBe("fingerprint");
  });
  it("holds a fail always and a warning until it is confirmed", () => {
    const warn = fixtureWorkbookChecks("warn.xlsx", "r1").checks;
    const bad = fixtureWorkbookChecks("bad.xlsx", "r1").checks;
    expect(holdReason(bad, true)).not.toBeNull();
    expect(holdReason(warn, false)).not.toBeNull();
    expect(holdReason(warn, true)).toBeNull();
  });
});
