"use client";

/**
 * What to fix in this object: the records that need a fix, how many already have a proposed fix and how many have none
 * and need a person. Sums of the work groups of the shown run. A count the work groups do not carry is not shown.
 */
import { EmptyState, ErrorState, SegBar, Skeleton } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { useWorkGroups } from "@/lib/v2/object-queries";
import { t } from "@/lib/v2/i18n";
import { compactCount, Count, Denied, isDenied } from "./edge";
import type { ObjectRun } from "./useObjectRun";

export function FixSection({ o }: { o: ObjectRun }) {
  const groups = useWorkGroups(o.module, o.runId);
  const href = (seg: string) => `/next/work?module=${encodeURIComponent(o.module)}&seg=${seg}`;
  const rows = groups.data ?? [];
  const open = rows.reduce((n, g) => n + g.open, 0);
  const proposed = rows.reduce((n, g) => n + Math.min(g.proposed, g.open), 0);
  const person = open - proposed;
  return (
    <section className="nx-fix" aria-labelledby="nx-fix-h" data-testid="fix-section">
      <h2 id="nx-fix-h" className="nx-sec-h">{t("What to fix")}</h2>
      {groups.isLoading ? <Skeleton lines={3} label={t("Loading what to fix")} /> : null}
      {groups.isError && isDenied(groups.error) ? <Denied what={t("what to fix in this object")} /> : null}
      {groups.isError && !isDenied(groups.error) ? <ErrorState sentence={t("What to fix could not be loaded.")} error={groups.error} onRetry={() => void groups.refetch()} /> : null}
      {groups.data && open === 0 ? <EmptyState heading={t("Nothing to fix")}>{t("No record of this object has an open fix.")}</EmptyState> : null}
      {groups.data && open > 0 ? (
        <div className="nx-card nx-fix-card">
          <SegBar label={t("Records that need a fix")} format={compactCount} segments={[{ label: t("Proposed"), value: proposed }, { label: t("Needs a person"), value: person }]} />
          <p className="nx-fix-total"><strong><Count n={open} /></strong> {t("records need a fix")}</p>
          <ul className="nx-fix-rows">
            <li>
              <span><strong><Count n={proposed} /></strong> {t("have a proposed fix")}</span>
              <V2Link className="nx-btn nx-btn-secondary" href={href("proposed")}>{t("Review proposals")}</V2Link>
            </li>
            <li>
              <span><strong><Count n={person} /></strong> {t("need a person")}</span>
              <V2Link className="nx-btn nx-btn-secondary" href={href("manual")}>{t("Assign")}</V2Link>
            </li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}
