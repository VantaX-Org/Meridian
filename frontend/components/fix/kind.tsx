import { Mono } from "@/design";

/** The route segment of a review page that covers every run (proposals the match engine queued carry none). */
export const ALL_RUNS = "all";

/** What a group of cleaning proposals does, in words: its rule's name, a duplicate merge, a match to review or the field it fixes. */
export function KindLabel({ kind, ruleName }: { kind: string; ruleName?: string | null }) {
  if (ruleName) return <>{ruleName}</>;
  if (kind === "duplicate") return <>Duplicate records</>;
  if (kind === "match") return <>Match review</>;
  return <span className="inline-flex items-baseline gap-2"><span className="m-ink-3">Fix</span><Mono>{kind}</Mono></span>;
}

/** Plain-text form of KindLabel, for titles and names. */
export const kindText = (kind: string, ruleName?: string | null) =>
  ruleName ?? (kind === "duplicate" ? "Duplicate records" : kind === "match" ? "Match review" : `Fix ${kind}`);

/** Where one group is reviewed: duplicates merge on the Duplicates tab, everything else on its own page. */
export const groupHref = (g: { version_id: string | null; kind: string }) =>
  g.kind === "duplicate" ? "/mdm/golden/merge?source=cleaning" : `/fix/proposals/${g.version_id ?? ALL_RUNS}?kind=${encodeURIComponent(g.kind)}`;
