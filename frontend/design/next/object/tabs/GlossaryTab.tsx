"use client";

import "./tabs-g.css";
import { useDeferredValue, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { populateGlossary, type TermRow } from "@/lib/api/v2/mdm";
import { errorSentence } from "@/lib/api/v2/client";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { fieldsWithoutTerm } from "@/lib/v2/lineage-graph";
import { useGlossary, useObjectOwners } from "@/lib/v2/mdm-queries";
import { refreshV2, useObjectRules } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { lc, t } from "@/lib/v2/i18n";
import { ListSearch, useSubmitGuard } from "@/design/next/more/states";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, useToast, type Column } from "../../kit";
import type { ObjectRun } from "../useObjectRun";
import { Dash, ItemLink } from "./tabs-g-parts";

const STATUS_WORD: Record<string, () => string> = { active: () => t("Active"), under_review: () => t("Under review"), deprecated: () => t("Deprecated") };
const STATUS_TONE: Record<string, "good" | "warn" | "neutral"> = { active: "good", under_review: "warn" };

function TermStatus({ status }: { status: string }) {
  return <Chip tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_WORD[status]?.() ?? status}</Chip>;
}

const fieldKey = (x: { sap_table: string; sap_field: string }): string => `${x.sap_table}.${x.sap_field}`.toUpperCase();

function WithoutTerm({ o, terms }: { o: ObjectRun; terms: readonly TermRow[] }) {
  const rulesQ = useObjectRules(o.module, o.runId);
  const rows = useMemo(() => fieldsWithoutTerm(rulesQ.data ?? [], new Set(terms.map(fieldKey))), [rulesQ.data, terms]);
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Fields without a term")} data-testid="without-term">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Fields without a term")}</h2>
        {rulesQ.data ? <span className="nx-tg-sub nx-num">{int(rows.length)}</span> : null}
      </div>
      {rulesQ.isPending ? (
        <Skeleton lines={2} />
      ) : rulesQ.isError ? (
        <ErrorState sentence={t("The fields the rules read could not be read.")} error={rulesQ.error} onRetry={() => void rulesQ.refetch()} />
      ) : rows.length === 0 ? (
        <p className="nx-tg-prov">{t("Every field the failing rules of {label} read has a business term.", { label: o.label })}</p>
      ) : (
        <>
          <ul className="nx-tg-list" aria-label={t("Fields without a term")}>
            {rows.map((r) => (
              <li key={r.field}>
                <Code code={r.field} text={describeField(r.field) ?? undefined} />
                <span className="nx-tg-sub">
                  {r.rules.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      <ItemLink kind="rule" id={id} className="nx-mono" />
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="nx-tg-prov">{t("The fields are those read by the failing rules of this object in the latest run. Terms are drafted from the rule library with Add terms from the rule library, and a data owner approves each.")}</p>
        </>
      )}
    </section>
  );
}

/** The Glossary tab: the object's business terms, who owns them, which rules cite them, and the fields that have none. */
export function GlossaryTab({ o }: { o: ObjectRun }) {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const { openItem } = useOpenItem();
  const { busy, run } = useSubmitGuard();
  const label = o.label;
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const allQ = useGlossary(o.module, "");
  const q = useGlossary(o.module, deferred);
  const ownersQ = useObjectOwners();
  const canManage = session.can("approve");
  const owner = ownersQ.data?.find((x) => x.ref === o.module);
  const ownerName = owner?.owner_name ?? owner?.steward_name ?? null;
  const rows = useMemo(() => (q.data?.terms ?? []) as TermRow[], [q.data]);

  const populate = () =>
    run(async () => {
      try {
        const res = await populateGlossary();
        void refreshV2(qc);
        const title = res.created === 0 ? t("No new terms to draft") : t("{created} {created, plural, one {term} other {terms}} drafted", { created: res.created });
        toast({ text: `${title}. ${t("{linked} rule {linked, plural, one {link} other {links}} added from the rule library. Drafts wait for an owner to approve them.", { linked: res.linked })}`, tone: "good" });
      } catch (err) {
        toast({ text: errorSentence(err, t("The glossary of {label} could not be read.", { label })), tone: "bad" });
      }
    });
  const populateButton = (empty: boolean) =>
    canManage ? (
      <Button size={32} onClick={() => void populate()} loading={busy} loadingLabel={t("Drafting…")}>
        {empty ? t("Draft terms from the rule library") : t("Add terms from the rule library")}
      </Button>
    ) : null;

  if (allQ.isError) return <ErrorState sentence={t("The glossary of {label} could not be read.", { label })} error={allQ.error} onRetry={() => void allQ.refetch()} />;
  if (allQ.isPending) {
    return (
      <div aria-busy="true" data-testid="glossary-loading">
        <Skeleton lines={6} />
      </div>
    );
  }
  if (allQ.data.total === 0) {
    return (
      <EmptyState icon="info" heading={t("Glossary")} action={populateButton(true) ?? undefined}>
        {t("No business terms are linked to {label} yet. A data owner links a term to a field, or drafts them from the rules of the object, and they appear here with the rules that cite them.", { label })}
      </EmptyState>
    );
  }

  const columns: Column<TermRow>[] = [
    { id: "term", label: t("Term"), cell: (r) => r.business_name, compare: (a, b) => a.business_name.localeCompare(b.business_name) },
    { id: "def", label: t("Definition"), cell: (r) => (r.business_definition ? <span title={r.business_definition}>{r.business_definition}</span> : <Dash why={t("The glossary list does not carry the definition; open the term")} />) },
    { id: "field", label: t("SAP field"), cell: (r) => <Code code={r.technical_name} text={describeField(r.technical_name) ?? undefined} /> },
    { id: "owner", label: t("Owner"), cell: () => ownerName ?? <Dash why={t("No owner is set for this object")} /> },
    { id: "status", label: t("Status"), cell: (r) => <TermStatus status={r.status} /> },
    { id: "rules", label: t("Rules"), align: "end", cell: (r) => <span className="nx-num">{int(r.linked_rules_count)}</span>, compare: (a, b) => a.linked_rules_count - b.linked_rules_count },
  ];
  const total = q.data?.total ?? 0;
  return (
    <div className="nx-tg" data-testid="tab-glossary">
      <div className="nx-tg-row">
        <ListSearch value={search} onChange={setSearch} label={t("Search terms")} />
        {populateButton(false)}
      </div>
      <section className="nx-card nx-tg-sec" aria-label={t("Business terms")}>
        <div className="nx-tg-head">
          <h2 className="nx-sec-h">{t("Business terms")}</h2>
          {q.data ? (
            <span className="nx-tg-sub">
              {deferred ? t("{total} found of {total2}", { total: int(total), total2: int(allQ.data.total) }) : t("{total} {total2, plural, one {term} other {terms}}", { total: int(total), total2: total })}
            </span>
          ) : null}
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.business_name}
          caption={t("Business terms of {label}", { label })}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The glossary of {label} could not be read.", { label }), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No term matches that search.") }}
          onOpenRow={(r) => openItem({ kind: "term", id: r.id })}
          density="compact"
        />
        <p className="nx-tg-prov">{t("Owner is the owner of the {label} object. Rules counts the rules that cite the term.", { label: lc(label) })}</p>
      </section>
      <WithoutTerm o={o} terms={allQ.data.terms as TermRow[]} />
    </div>
  );
}
