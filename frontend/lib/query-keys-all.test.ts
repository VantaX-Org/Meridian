import { describe, expect, it } from "vitest";
import { queryKeys } from "./query-keys";

// hooks/use-jobs.ts invalidates by the first element of a key, so every factory must lead with a stable entity prefix.
describe("every queryKeys factory", () => {
  const entries = Object.entries(queryKeys) as [string, (...args: unknown[]) => readonly unknown[]][];

  it.each(entries)("%s leads with a kebab-case prefix and is stable", (_name, make) => {
    const args = Array.from({ length: make.length }, (_, i) => `arg${i}`);
    const key = make(...args);
    expect(Array.isArray(key)).toBe(true);
    expect(key[0]).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(make(...args)).toEqual(key);
  });

  it("normalises filters: key order and undefined values do not split the cache", () => {
    const a = queryKeys.records("material_master", { b: 2, a: 1, c: undefined });
    const b = queryKeys.records("material_master", { a: 1, b: 2 });
    expect(a).toEqual(b);
    expect(Object.keys(a[2] as object)).toEqual(["a", "b"]);
  });
});
