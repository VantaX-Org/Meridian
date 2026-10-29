"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { populateGlossary, type TermRow } from "@/lib/api/v2/mdm";
import { useOpenItem, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { fieldsWithoutTerm } from "@/lib/v2/lineage-graph";
import { useGlossary, useObjectOwners } from "@/lib/v2/mdm-queries";
import { useNarrow } from "@/lib/v2/narrow";
import { refreshV2, useLandscape, useObjectRules } from "@/lib/v2/queries";
import { int, moduleFromSlug } from "@/lib/v2/score";
import { Grid, type GridColumn } from "../../Grid";
import { VerdictMark } from "../../marks";
import "../../mdm.css";
import { ResultFrame, useOutcome } from "../../inspector/shared";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";

export const STATUS_WORD: Record<string, string> = { active: "Active", under_review: "Under review", deprecated: "Deprecated" };

export function TermStatus({ status }: { status: string }) {
  return (
    <span className="m2-v">
      {status === "active" ? <VerdictMark verdict="go" /> : status === "under_review" ? <VerdictMark verdict="at-risk" /> : null}
      {STATUS_WORD[status] ?? status}
    </span>
  );
}

const fieldKey = (t: { sap_table: string; sap_field: string }): string => `${t.sap_table}.${t.sap_field}`.toUpperCase();

function WithoutTerm({ module, terms, label }: { module: string; terms: readonly TermRow[]; label: string }) {
  const { hrefFor } = useOpenItem();
  const rulesQ = useObjectRules(module, useRunParam());
  const rows = useMemo(() => fieldsWithoutTerm(rulesQ.data ?? [], new Set(terms.map(fieldKey))), [rulesQ.data, terms]);
  return (
    <section aria-label="Fields without a term" className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">Fields without a term</h2>
        {rulesQ.data ? <span className="m2-sub">{int(rows.length)}</span> : null}
      </div>
      {rulesQ.isPending ? (
        <Skeleton width="50%" height={14} />
      ) : rulesQ.isError ? (
        <ErrorFrame onRetry={() => void rulesQ.refetch()}>The fields the rules read could not be read.</ErrorFrame>
      ) : rows.length === 0 ? (
        <p className="m2-rp m2-meta">{`Every field the failing rules of ${label} read has a business term.`}</p>
      ) : (
        <>
          <ul className="m2-flist" aria-label="Fields without a term">
            {rows.map((r) => (
              <li key={r.field}>
                <Mono>{r.field}</Mono>
                <span className="m2-meta">
                  {r.rules.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">
                        {id}
                      </V2Link>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="m2-prov">The fields are those read by the failing rules of this object in the latest run. A data owner links a term to each in the current interface, or drafts them from the rule library above.</p>
        </>
      )}
    </section>
  );
}

/** The Glossary tab: the object's business terms, who owns them, which rules cite them, and the fields that have none. */
export function GlossaryTab({ module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const qc = useQueryClient();
  const session = useV2Session();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run);
  const label = L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const allQ = useGlossary(apiModule, "");
  const q = useGlossary(apiModule, deferred);
  const ownersQ = useObjectOwners();
  const { openItem, open } = useOpenItem();
  const narrow = useNarrow();
  const { outcome, pending, run: act } = useOutcome();
  const canManage = session.can("approve");
  const owner = ownersQ.data?.find((o) => o.ref === apiModule);
  const ownerName = owner?.owner_name ?? owner?.steward_name ?? null;
  const rows = useMemo(() => (q.data?.terms ?? []) as TermRow[], [q.data]);
  const openId = open?.kind === "term" ? open.id : null;

  const columns = useMemo<GridColumn<TermRow>[]>(
    () => [
      { id: "term", header: "Term", width: 200, pin: true, locked: true, cell: (r) => r.business_name },
      { id: "def", header: "Definition", width: 360, cell: (r) => (r.business_definition ? <span title={r.business_definition}>{r.business_definition}</span> : <Dash why="The glossary list does not carry the definition; open the term" />) },
      { id: "field", header: "SAP field", width: 140, cell: (r) => <Mono>{r.technical_name}</Mono> },
      { id: "owner", header: "Owner", width: 150, cell: () => (ownerName ?? <Dash why="No owner is set for this object" />) },
      { id: "status", header: "Status", width: 130, cell: (r) => <TermStatus status={r.status} /> },
      { id: "rules", header: "Rules", width: 80, numeric: true, title: "Linked rules", cell: (r) => int(r.linked_rules_count) },
    ],
    [ownerName],
  );

  const populate = () =>
    void act("populate", async () => {
      const res = await populateGlossary();
      void refreshV2(qc);
      return { tone: "ok", title: res.created === 0 ? "No new terms to draft" : `${res.created} ${res.created === 1 ? "term" : "terms"} drafted`, detail: `${res.linked} rule ${res.linked === 1 ? "link" : "links"} added from the rule library. Drafts wait for an owner to approve them.` };
    });

  if (allQ.isError) return <ErrorFrame onRetry={() => void allQ.refetch()}>{`The glossary of ${label} could not be read.`}</ErrorFrame>;
  if (allQ.data && allQ.data.total === 0) {
    return (
      <EmptyFrame
        action={
          canManage ? (
            <button type="button" className="m2-btn" onClick={populate} disabled={pending !== null}>
              {pending === "populate" ? "Drafting…" : "Draft terms from the rule library"}
            </button>
          ) : (
            <V2Link href="/mdm/glossary" className="m2-btn">Open the glossary</V2Link>
          )
        }
      >
        {`No business terms are linked to ${label} yet. A data owner links a term to a field, or drafts them from the rules of the object, and they appear here with the rules that cite them.`}
      </EmptyFrame>
    );
  }
  return (
    <div className="m2-mdm">
      <div className="m2-rbar">
        <label className="m2-sin">
          <span className="m2-sr">Search terms</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search terms or fields" aria-label="Search terms" />
        </label>
        <div className="m2-acts">
          {canManage ? (
            <button type="button" className="m2-btn" onClick={populate} disabled={pending !== null}>
              {pending === "populate" ? "Drafting…" : "Add terms from the rule library"}
            </button>
          ) : null}
          <V2Link href="/mdm/glossary" className="m2-btn m2-ghost">Open the glossary</V2Link>
        </div>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <section aria-label="Business terms" className="m2-sec">
        <div className="m2-sechead">
          <h2 className="m2-h2">Business terms</h2>
          {q.data ? <span className="m2-sub">{deferred ? `${int(q.data.total)} found of ${int(allQ.data?.total ?? q.data.total)}` : `${int(q.data.total)} ${q.data.total === 1 ? "term" : "terms"}`}</span> : null}
        </div>
        {narrow ? (
          q.isPending ? (
            <Skeleton width="100%" height={160} />
          ) : rows.length === 0 ? (
            <p className="m2-rp m2-meta">No term matches that search.</p>
          ) : (
            <ul className="m2-nlist" aria-label={`Business terms of ${label}`}>
              {rows.map((r) => (
                <li key={r.id} data-open={openId === r.id ? "true" : undefined}>
                  <button type="button" onClick={() => openItem({ kind: "term", id: r.id })} aria-label={`Open the term ${r.business_name}`}>
                    <span className="m2-nl1">{r.business_name}</span>
                    <span className="m2-nl2">{[r.technical_name, STATUS_WORD[r.status] ?? r.status, `${r.linked_rules_count} ${r.linked_rules_count === 1 ? "rule" : "rules"}`].join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <Grid<TermRow>
            id="object-glossary"
            ariaLabel={`Business terms of ${label}`}
            columns={columns}
            rows={rows}
            rowId={(r) => r.id}
            hideBar
            fixedColumns
            loading={q.isPending}
            height={32 + Math.max(rows.length, 1) * 32 + 2}
            initialViewport={Math.max(rows.length, 8)}
            openRowId={openId}
            onOpen={(r) => openItem({ kind: "term", id: r.id })}
            emptyFrame={<EmptyFrame>No term matches that search.</EmptyFrame>}
          />
        )}
        <p className="m2-prov">{`Owner is the owner of the ${label.toLowerCase()} object. Rules counts the rules that cite the term.`}</p>
      </section>
      <WithoutTerm module={apiModule} terms={(allQ.data?.terms ?? []) as TermRow[]} label={label} />
    </div>
  );
}
