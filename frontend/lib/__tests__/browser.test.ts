import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localId, writeClipboard } from "../browser";

const ROOT = path.join(__dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("secure-origin helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes an id without crypto.randomUUID, as on a plain http:// origin", () => {
    vi.stubGlobal("crypto", {});
    const a = localId();
    const b = localId();
    expect(a).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });

  it("copies through the clipboard API when there is one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await writeClipboard("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("falls back to the copy command when the clipboard API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    expect(await writeClipboard("abc")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("no page calls crypto.randomUUID or navigator.clipboard directly", () => {
    const offenders = ["app", "design", "hooks", "lib"]
      .flatMap((d) => sources(path.join(ROOT, d)))
      .filter((f) => !f.endsWith(path.join("lib", "browser.ts")))
      .filter((f) => /crypto\.randomUUID|navigator\.clipboard/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
