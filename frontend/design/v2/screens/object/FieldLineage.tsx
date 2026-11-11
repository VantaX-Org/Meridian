"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFieldLineage } from "@/lib/api/v2/field-lineage";
import { useFixture } from "@/lib/api/v2/fixture";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Coded, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { ScrollFrame } from "./ScrollFrame";

const SHOWN_RULES = 3;

/** Field lineage: every field the object extracts, its business term, the check table it points to and who owns that
 *  table, with the rules that read the field. From the SAP data dictionary, never guessed. */
export function FieldLineagePanel({ module, labelOf }: { module: string; labelOf: (module: string) => string }) {
  const fixture = useFixture();
  const { hrefFor } = useOpenItem();
  const [filter, setFilter] = useState("");
  const q = useQuery({
    queryKey: ["field-lineage", module, fixture],
    queryFn: () => getFieldLineage(module),
    staleTime: 300_000,
  });
  const rows = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return (q.data?.tables ?? []).flatMap((tb) =>
      tb.fields
        .filter((r) => !f || `${tb.table}.${r.field}`.includes(f) || r.text.toUpperCase().includes(f) || r.glossary_terms.some((g) => g.toUpperCase().includes(f)))
        .map((r) => ({ tb, r })),
    );
  }, [q.data, filter]);

  const title = t("Field lineage");
  if (q.isPending) return <section aria-label={title} className="m2-sec" data-testid="field-lineage-loading"><Skeleton width="100%" height={160} /></section>;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The field lineage could not be read.")}</ErrorFrame>;
  const d = q.data;
  if (d.tables.length === 0) return <EmptyFrame>{t("No extracted tables are registered for this object, so there is no field lineage to show.")}</EmptyFrame>;
  const owner = (o: string | null | undefined): string => (o == null ? "" : o === "configuration" ? t("Configuration") : labelOf(o));
  return (
    <section aria-label={title} className="m2-sec" data-testid="field-lineage">
      <div className="m2-sechead">
        <h2 className="m2-h2">{title}</h2>
        <span className="m2-sub">
          {t("{fields} {fields, plural, one {field} other {fields}} in {tables} {tables, plural, one {table} other {tables}}, {fks} {fks, plural, one {check table link} other {check table links}}, dictionary {release}", { fields: d.totals.fields, tables: d.totals.tables, fks: d.totals.foreign_keys, release: d.release })}
        </span>
      </div>
      <div className="m2-rbar">
        <label className="m2-sin">
          <span className="m2-sr">{t("Filter fields")}</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Filter by table, field or term")} aria-label={t("Filter fields")} data-testid="field-lineage-filter" />
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="m2-rp m2-meta">{t("No field matches that filter.")}</p>
      ) : (
        <ScrollFrame label={title}>
          <table className="m2-tbl">
            <caption className="m2-sr">{t("Table, field, business term, check table, owner and the rules that read each field")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Table")}</th>
                <th scope="col">{t("Field")}</th>
                <th scope="col">{t("Business term")}</th>
                <th scope="col">{t("Check table")}</th>
                <th scope="col">{t("Owner")}</th>
                <th scope="col" className="m2-num">{t("Rules")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tb, r }) => (
                <tr key={`${tb.table}.${r.field}`} data-testid={`fl-${tb.table}-${r.field}`}>
                  <td><Coded code={tb.table} text={tb.text} /></td>
                  <td>
                    <Mono>{r.field}</Mono>
                    {r.key ? <span className="m2-meta"> {t("key")}</span> : null}
                    {!r.in_dictionary ? <span className="m2-meta"> {t("not in the dictionary")}</span> : null}
                  </td>
                  <td>
                    {r.glossary_terms.length ? r.glossary_terms.join(", ") : r.text || "-"}
                    {r.glossary_terms.length && r.text ? <span className="m2-meta"> ({r.text})</span> : null}
                  </td>
                  <td>{r.check_table ? <Coded code={r.check_table} text={r.check_table_text} /> : <span className="m2-meta">-</span>}</td>
                  <td>{owner(r.owner) || <span className="m2-meta">-</span>}</td>
                  <td className="m2-num">
                    {r.rule_count ? (
                      <>
                        {int(r.rule_count)}{" "}
                        {r.rule_ids.slice(0, SHOWN_RULES).map((id) => (
                          <V2Link key={id} href={hrefFor({ kind: "rule", id })} className="m2-mono">{id} </V2Link>
                        ))}
                      </>
                    ) : (
                      <span className="m2-meta">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      <p className="m2-meta">{t("{n} {n, plural, one {field is} other {fields are}} read by rules. A check table owned by configuration is customizing; one owned by an object is master data that must load first.", { n: d.totals.fields_with_rules })}</p>
    </section>
  );
}
