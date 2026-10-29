"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { GOLDEN_PAGE, type GoldenRow, type SurvivorshipRule } from "@/lib/api/v2/mdm";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useGoldenRecords, useMatchPairs, useSurvivorship } from "@/lib/v2/mdm-queries";
import { useNarrow } from "@/lib/v2/narrow";
import { useLandscape } from "@/lib/v2/queries";
import { int, moduleFromSlug } from "@/lib/v2/score";
import { type GridColumn } from "../../Grid";
import "../../mdm.css";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { ToolGrid } from "../../GridTools";
import { t } from "@/lib/v2/i18n";

export const RULE_LABEL: Record<string, string> = {
  get most_recent() { return t("Most recent"); },
  get most_complete() { return t("Most complete"); },
  get most_frequent() { return t("Most frequent"); },
  get trusted_source() { return t("Trusted source"); },
  get chain() { return t("Source chain"); },
  get manual_override() { return t("Steward choice"); },
};

/** The rule that decides most fields of the object, with how many other rules sit beside it. */
export function dominantRule(rules: readonly SurvivorshipRule[]): { text: string; title: string } | null {
  const active = rules.filter((r) => r.active);
  if (active.length === 0) return null;
  const count = new Map<string, number>();
  for (const r of active) count.set(r.rule_type, (count.get(r.rule_type) ?? 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0][0];
  const others = ranked.length - 1;
  return {
    text: `${RULE_LABEL[top] ?? top}${others > 0 ? t(", {others} more", { others }) : ""}`,
    title: ranked.map(([k, n]) => t("{RULE_LABEL}: {n} {n, plural, one {field} other {fields}}", { RULE_LABEL: RULE_LABEL[k] ?? k, n })).join("; "),
  };
}

/** MATNR=000000000000005000 reads MATNR=5000: the leading zeros of a SAP key say nothing. */
export const shortKey = (k: string): string => k.replace(/=0+(?=\d)/, "=");

export const confidencePct = (c: number): string => `${Math.round(c * 100)}%`;

function Survivorship({ module }: { module: string }) {
  const { hrefFor } = useOpenItem();
  const q = useSurvivorship(module);
  if (q.isPending) return <Skeleton width="50%" height={14} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The survivorship rules could not be read.")}</ErrorFrame>;
  const rules = q.data.filter((r) => r.active);
  return (
    <section aria-label={t("Survivorship rules")} className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Survivorship rules")}</h2>
        <V2Link href={hrefFor({ kind: "survivorship", id: module })}>{t("Edit the rules")}</V2Link>
      </div>
      {rules.length === 0 ? (
        <p className="m2-rp m2-meta">{t("No survivorship rule is set for this object, so a merge keeps the survivor's value for every field. Add one with Edit the rules.")}</p>
      ) : (
        <ul className="m2-flist" aria-label={t("Survivorship rules by field")}>
          {rules.map((r) => (
            <li key={r.id}>
              <Mono>{r.field}</Mono>
              <span className="m2-meta">
                {RULE_LABEL[r.rule_type] ?? r.rule_type}
                {r.trusted_sources?.length ? `, ${r.trusted_sources.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Candidates({ module, label }: { module: string; label: string }) {
  const { hrefFor, open } = useOpenItem();
  const [limit, setLimit] = useState(5);
  const q = useMatchPairs(module, limit);
  const waiting = q.data?.bands.review ?? q.data?.total ?? 0;
  return (
    <section aria-label={t("Match candidates")} className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Match candidates")}</h2>
        {q.data ? <span className="m2-sub">{waiting === 1 ? t("1 pair to review") : t("{waiting} pairs to review", { waiting: int(waiting) })}</span> : null}
      </div>
      {q.isPending ? (
        <Skeleton width="60%" height={14} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The match candidates could not be read.")}</ErrorFrame>
      ) : q.data.pairs.length === 0 ? (
        <p className="m2-rp m2-meta">{t("No pair of {label} records is waiting for a steward. Pairs appear when a match run scores two records between the review floor and the auto-merge score.", { label: label.toLowerCase() })}</p>
      ) : (
        <>
          <ul className="m2-pairs" aria-label={t("Pairs to review")}>
            {q.data.pairs.map((p) => (
              <li key={p.id} data-open={open?.kind === "golden" && open.id === `pair:${p.id}` ? "true" : undefined}>
                <span className="m2-pscore">{p.total.toFixed(2)}</span>
                <span className="m2-pkeys">
                  <Mono>{shortKey(p.a)}</Mono> <span className="m2-meta">{t("and")}</span> <Mono>{shortKey(p.b)}</Mono>
                </span>
                <V2Link href={hrefFor({ kind: "golden", id: `pair:${p.id}` })} className="m2-btn m2-sm" aria-label={t("Review the pair {a} and {b}", { a: p.a, b: p.b })}>
                  {t("Review")}
                </V2Link>
              </li>
            ))}
          </ul>
          <p className="m2-prov">
            {waiting > q.data.pairs.length ? t("Showing the first {pairsCount} of {waiting}, best score first. ", { pairsCount: q.data.pairs.length, waiting: int(waiting) }) : ""}
            {waiting > q.data.pairs.length ? (
              <button type="button" className="m2-linkbtn" onClick={() => setLimit((n) => n + 20)}>
                {t("Show 20 more")}
              </button>
            ) : null}
          </p>
        </>
      )}
    </section>
  );
}

function rowName(r: GoldenRow) {
  return r.name ? r.name : <Dash why={t("The golden records list does not carry the name; open the record")} />;
}

/** The Golden records tab: the object's golden records, the pairs waiting for a steward, and how survivors are chosen. */
export function GoldenTab({ module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run);
  const label = L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const [page, setPage] = useState(1);
  const q = useGoldenRecords(apiModule, page);
  const rulesQ = useSurvivorship(apiModule);
  const pairsQ = useMatchPairs(apiModule, 5);
  const { openItem, open } = useOpenItem();
  const narrow = useNarrow();
  const dom = useMemo(() => dominantRule(rulesQ.data ?? []), [rulesQ.data]);
  const rows = useMemo(() => (q.data?.records ?? []) as GoldenRow[], [q.data]);
  const total = q.data?.total ?? 0;
  const openId = open?.kind === "golden" ? open.id : null;

  const columns = useMemo<GridColumn<GoldenRow>[]>(
    () => [
      { id: "key", header: t("Golden key"), width: 220, pin: true, locked: true, cell: (r) => <Mono>{r.sap_object_key}</Mono> },
      { id: "name", header: t("Name"), width: 200, cell: rowName },
      { id: "sources", header: t("Sources"), width: 80, numeric: true, cell: (r) => int(r.source_count) },
      { id: "rule", header: t("Survivorship"), width: 170, cell: () => (dom ? <span title={dom.title}>{dom.text}</span> : <Dash why={t("No survivorship rule is set for this object")} />) },
      { id: "confidence", header: t("Confidence"), width: 100, numeric: true, cell: (r) => confidencePct(r.overall_confidence) },
      { id: "merged", header: t("Last merged"), width: 120, cell: (r) => formatDate(r.updated_at, "date") },
      { id: "conflicts", header: t("Open conflicts"), width: 130, numeric: true, cell: (r) => int(r.pending_issues) },
    ],
    [dom],
  );

  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The golden records of {label} could not be read.", { label })}</ErrorFrame>;
  const pairsWaiting = pairsQ.data?.bands.review ?? 0;
  if (!q.isPending && total === 0 && !pairsQ.isPending && pairsWaiting === 0) {
    return (
      <EmptyFrame>
        {t("No golden records for {label} yet. A match run groups the records that describe the same thing, scores each pair, and a steward approves the survivor; the golden records and the pairs to review land here.", { label })}
      </EmptyFrame>
    );
  }
  const from = (page - 1) * GOLDEN_PAGE + 1;
  const to = Math.min(total, page * GOLDEN_PAGE);
  return (
    <div className="m2-mdm">
      <Candidates module={apiModule} label={label} />
      <section aria-label={t("Golden records")} className="m2-sec">
        <div className="m2-sechead">
          <h2 className="m2-h2">{t("Golden records")}</h2>
          {q.data ? <span className="m2-sub">{t("{total} {total2, plural, one {record} other {records}}", { total: int(total), total2: total })}</span> : null}
        </div>
        {narrow ? (
          q.isPending ? (
            <Skeleton width="100%" height={160} />
          ) : (
            <ul className="m2-nlist" aria-label={t("Golden records of {label}", { label })}>
              {rows.map((r) => (
                <li key={r.id} data-open={openId === r.id ? "true" : undefined}>
                  <button type="button" onClick={() => openItem({ kind: "golden", id: r.id })} aria-label={t("Open golden record {sap_object_key}", { sap_object_key: r.sap_object_key })}>
                    <span className="m2-nl1">
                      <Mono>{r.sap_object_key}</Mono>
                    </span>
                    <span className="m2-nl2">{[r.name, t("{source_count} sources", { source_count: r.source_count }), confidencePct(r.overall_confidence), t("{pending_issues} open {pending_issues, plural, one {conflict} other {conflicts}}", { pending_issues: r.pending_issues })].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <ToolGrid<GoldenRow>
          toolsTitle={t("Golden records")}
            id="object-golden"
            ariaLabel={t("Golden records of {label}", { label })}
            columns={columns}
            rows={rows}
            rowId={(r) => r.id}
            hideBar
            fixedColumns
            loading={q.isPending}
            height={32 + Math.max(rows.length, 1) * 32 + 2}
            initialViewport={GOLDEN_PAGE}
            openRowId={openId}
            onOpen={(r) => openItem({ kind: "golden", id: r.id })}
            emptyFrame={<EmptyFrame>{t("No golden record yet for {label}. The pairs above become golden records when a steward merges them.", { label })}</EmptyFrame>}
          />
        )}
        {total > GOLDEN_PAGE ? (
          <p className="m2-prov m2-pager">
            {t("{from} to {to} of {total}", { from: int(from), to: int(to), total: int(total) })}
            <button type="button" className="m2-linkbtn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t("Previous")}
            </button>
            <button type="button" className="m2-linkbtn" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
              {t("Next")}
            </button>
          </p>
        ) : null}
        <p className="m2-prov">{t("Confidence is the match engine's score for the surviving record. Last merged is when the record last changed. Open conflicts are fields where the sources disagree and no rule has settled it.")}</p>
      </section>
      <Survivorship module={apiModule} />
    </div>
  );
}
