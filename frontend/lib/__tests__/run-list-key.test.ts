// frontend/lib/__tests__/run-list-key.test.ts
// The shared run list (hooks/use-run-list) owns queryKeys.run("list"): any other query under that exact key, with
// a different fetcher (the API's default 20, one page of 100), would replace the paginated list in the cache.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const DIRS = ["app", "components", "hooks", "lib", "design"];
const SKIP = /node_modules|__tests__|\.test\.|use-run-list\.ts$/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) return [];
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("the shared run-list query key", () => {
  it("is fetched only by the shared paginated hook", () => {
    const offenders = DIRS.flatMap((d) => files(path.join(ROOT, d))).filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      // a query (not an invalidation) whose key is exactly ["run", "list"]
      return /useQuery\(\{\s*queryKey:\s*queryKeys\.run\("list"\)\s*,/.test(src)
        || /queryKey:\s*queryKeys\.run\("list"\)\s*,\s*\n\s*queryFn/.test(src);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
