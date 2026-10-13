/**
 * Unit tests fail on any console.error. A test that expects one (an error boundary, a rejected
 * query) calls allowConsoleError() first; the allowance resets after each test.
 */
let allowed = false;
const seen: string[] = [];

export function allowConsoleError(): void {
  allowed = true;
}

export function installConsoleErrorFailure(): { before: () => void; after: () => void } {
  const original = console.error;
  return {
    before() {
      allowed = false;
      seen.length = 0;
      console.error = (...args: unknown[]) => {
        if (allowed) return;
        const text = args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" ");
        seen.push(text);
        throw new Error(`console.error in a unit test (call allowConsoleError() if expected): ${text}`);
      };
    },
    after() {
      console.error = original;
      const hits = [...seen];
      seen.length = 0;
      if (hits.length) throw new Error(`console.error was called during the test:\n${hits.join("\n")}`);
    },
  };
}
