"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLearnedReview, type DdicAnchor, type OutOfDictionary } from "@/lib/api/v2/object";
import { t } from "@/lib/v2/i18n";
import { Card, EmptyState, ErrorState, FieldChip, Sheet, Skeleton, StatTile } from "@/ui/kit";
import { compactCount, pct } from "./format";

const anchorText = (a: DdicAnchor) => (a.known ? a.description : t("Not in the data dictionary"));

function Dictionary({ label, o }: { label: string; o: OutOfDictionary | null | undefined }) {
  if (!o) return null;
  return (
    <p>
      <strong>{label}</strong>{" "}
      {o.source === "no_reference" || o.source === "unverified"
        ? t("Not checked: no reference list to compare with.")
        : o.values.length ? t("{n} of {m} values are not in the dictionary: {list}", { n: o.values.length, m: o.checked, list: o.values.join(", ") }) : t("All {m} values are in the dictionary.", { m: o.checked })}
    </p>
  );
}

/** What backs one learned rule: lift over the base rate, the dictionary entry of each field, and values the dictionary does not know. */
export function LearnedReview({ target, onClose }: { target: { id: string; module: string } | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onClose={onClose} label={t("Review learned rule")} closeLabel={t("Close")}>
      {target ? <Body key={target.id} target={target} /> : null}
    </Sheet>
  );
}

function Body({ target }: { target: { id: string; module: string } }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["rules", "learned-review", fx, target.module], queryFn: () => getLearnedReview(target.module) });
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading")} />;
  if (q.isError) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const p = q.data?.find((x) => x.id === target.id);
  if (!p) return <EmptyState heading={t("No review for this rule")} body={t("It may already be approved or rejected.")} />;
  return (
    <Card title={t("Learned rule")} sub={p.determinant ? t("Follows {d}", { d: p.determinant }) : p.kind.replace(/_/g, " ")}>
      <p><FieldChip code={p.field_anchor.column} description={anchorText(p.field_anchor)} /></p>
      <dl className="mx-rules-row">
        <StatTile label={t("Confidence")} value={p.confidence == null ? t("n/a") : pct(p.confidence)} />
        <StatTile label={t("Lift over chance")} value={p.lift.lift == null ? t("n/a") : `${p.lift.lift.toFixed(1)}x`} />
        <StatTile label={t("Rows backing it")} value={compactCount(p.support_rows ?? 0)} />
        <StatTile label={t("Rows breaking it")} value={compactCount(p.violations ?? 0)} />
      </dl>
      {p.lift.lift == null && p.lift.reason ? <p>{p.lift.reason}</p> : null}
      {p.determinant_anchor ? <p><FieldChip code={p.determinant_anchor.column} description={anchorText(p.determinant_anchor)} /></p> : null}
      <Dictionary label={p.field} o={p.out_of_dictionary} />
      <Dictionary label={p.determinant ?? ""} o={p.determinant_out_of_dictionary} />
      {p.redundant ? <p>{t("The dictionary already enforces this: {why}", { why: p.redundant_reason })}</p> : null}
    </Card>
  );
}
