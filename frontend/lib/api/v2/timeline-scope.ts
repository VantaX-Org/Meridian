/** Score trends hold quality runs only. A process discovery run carries no quality score, so it never enters a trend. */
const DISCOVERY = /discover/i;

export function scoreRunsOnly<T extends { runs: { kind: string | null }[] }>(tl: T): T {
  return { ...tl, runs: tl.runs.filter((r) => !(r.kind && DISCOVERY.test(r.kind))) };
}
