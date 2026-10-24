import { Mono } from "@/design";

/** What a group of cleaning proposals does, in words: its rule's name, a duplicate merge or the field it fixes. */
export function KindLabel({ kind, ruleName }: { kind: string; ruleName?: string | null }) {
  if (ruleName) return <>{ruleName}</>;
  if (kind === "duplicate") return <>Duplicate records</>;
  if (kind === "other") return <span className="m-ink-3">Other</span>;
  return <span className="inline-flex items-baseline gap-2"><span className="m-ink-3">Fix</span><Mono>{kind}</Mono></span>;
}

/** Plain-text form of KindLabel, for titles and names. */
export const kindText = (kind: string, ruleName?: string | null) =>
  ruleName ?? (kind === "duplicate" ? "Duplicate records" : kind === "other" ? "Other" : `Fix ${kind}`);

/** Where one group is reviewed: duplicates merge on the Duplicates tab, everything else on its own page. */
export const groupHref = (g: { version_id: string; kind: string }) =>
  g.kind === "duplicate" ? "/fix?tab=dedup" : `/fix/${g.version_id}?kind=${encodeURIComponent(g.kind)}`;
