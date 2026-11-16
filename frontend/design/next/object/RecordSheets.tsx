"use client";

/**
 * Native sheets for one record and the rules behind it:
 *   record-detail   (id `${versionId}~${object}~${key}`): the record's fields with their text and the rules it fails.
 *   finding-records (id `${versionId}~${checkId}`): every record that fails one rule at one run, with the values read.
 *   rule-reads      (id = checkId): what a rule reads, looks up and joins, and its glossary terms.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, Sheet, Skeleton, type ChipTone, type Column } from "@/design/next/kit";
import { useSheets } from "@/design/next/shell/SheetHost";
import { useFixture } from "@/lib/api/v2/fixture";
import { getRuleReads } from "@/lib/api/v2/lineage";
import { getRecordFindings, getRecordSheet, glossaryBatchLookup, type RecordFindings } from "@/lib/api/v2/object-records";
import { getFindingRecords, type FindingRecord } from "@/lib/api/v2/run-ops";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { describeField } from "@/lib/v2/sap-fields";
import "../runs/runs.css";

interface SheetProps { id: string; close: () => void; under?: boolean }

const enc = (s: string): string => encodeURIComponent(s).replace(/~/g, "%7E");
/** Ids join their parts with `~`; each part is URI-encoded so a key may hold any character. */
export const recordDetailId = (versionId: string | null | undefined, object: string, key: string): string => `${enc(versionId ?? "")}~${enc(object)}~${enc(key)}`;
export const findingRecordsId = (versionId: string, checkId: string): string => `${enc(versionId)}~${enc(checkId)}`;
const parts = (id: string): string[] => id.split("~").map((p) => decodeURIComponent(p));

const TONE: Record<string, ChipTone> = { critical: "bad", high: "bad", medium: "warn", low: "neutral" };
const severityText = (s: string): string => ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low") } as Record<string, string>)[s] ?? s;

/** Business names for TABLE.FIELD codes, from the glossary. A failed lookup leaves the catalogue text in place. */
function useGlossary(fields: string[]) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["next", fx, "glossary-lookup", fields], queryFn: () => glossaryBatchLookup(fields), enabled: fields.length > 0, staleTime: 300_000 });
  return (field: string): string | null => q.data?.lookup?.[field]?.business_name ?? describeField(field);
}

type Failing = RecordFindings["failing"][number];

export function RecordDetailSheet({ id, close, under }: SheetProps) {
  const [versionId, object, key] = parts(id);
  const fx = useFixture();
  const { open } = useSheets();
  const run = versionId || null;
  const sheet = useQuery({ queryKey: ["next", fx, "record-detail", object, key, run], queryFn: () => getRecordSheet(object, key, run), enabled: Boolean(object && key) });
  const findings = useQuery({ queryKey: ["next", fx, "record-findings", object, key, run], queryFn: () => getRecordFindings(object, key, run), enabled: Boolean(object && key) });
  const s = sheet.data;
  const fields = Object.entries(s?.mara ?? {}).filter(([, v]) => v !== null && v !== "");
  // The material route reads MARA; a generic object's row carries no table name, so its fields keep the catalogue text.
  const table = object === "material_master" ? "MARA" : null;
  const qualified = fields.map(([f]) => (f.includes(".") || !table ? f : `${table}.${f}`));
  const term = useGlossary(qualified);
  const at = findings.data?.version_id ?? s?.version_id ?? run;

  const cols: Column<Failing>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.check_id} text={r.message ?? undefined} /> },
    { id: "severity", label: t("Severity"), cell: (r) => <Chip tone={TONE[r.severity] ?? "neutral"}>{severityText(r.severity)}</Chip> },
    { id: "field", label: t("Field"), cell: (r) => (r.field ? <Code code={r.field} text={term(r.field) ?? undefined} /> : t("No field")) },
    {
      id: "open", label: t("Open"), cell: (r) => (
        <span className="nx-rn-sub">
          <Button variant="secondary" size={32} onClick={() => open({ kind: "rule-reads", id: r.check_id })}>{t("What it reads")}</Button>
          {at ? <Button variant="secondary" size={32} onClick={() => open({ kind: "finding-records", id: findingRecordsId(at, r.check_id) })}>{t("Every failing record")}</Button> : null}
        </span>
      ),
    },
  ];

  return (
    <Sheet open onClose={close} under={under} size="large" title={s?.description ? <Code code={key} text={s.description} /> : <Code code={key} />} meta={<Chip>{moduleText(object)}</Chip>}>
      <section data-testid="record-detail">
        <h3 className="nx-rn-h3">{t("Record fields")}</h3>
        {sheet.isLoading ? <Skeleton lines={6} label={t("Loading the record")} /> : sheet.isError ? (
          <ErrorState error={sheet.error} fallback={t("The record could not be read.")} onRetry={() => void sheet.refetch()} />
        ) : !fields.length ? (
          <EmptyState heading={t("No values")}>{t("The run holds no values for this record.")}</EmptyState>
        ) : (
          <DataTable
            caption={t("Record fields")}
            rows={fields.map(([f, v], i) => ({ f, q: qualified[i], v: v as string, label: s?.labels?.[f] ?? null }))}
            rowKey={(r) => r.f}
            rowLabel={(r) => r.f}
            columns={[
              { id: "field", label: t("Field"), cell: (r) => <Code code={r.f} text={term(r.q) ?? undefined} /> },
              { id: "value", label: t("Value"), cell: (r) => <Code code={r.v} text={r.label ?? undefined} /> },
            ]}
          />
        )}
        <h3 className="nx-rn-h3">{t("Rules this record fails")}</h3>
        <DataTable
          caption={t("Rules this record fails")}
          rows={findings.data?.failing ?? []}
          rowKey={(r) => `${r.check_id}-${r.field ?? ""}`}
          rowLabel={(r) => r.check_id}
          columns={cols}
          loading={findings.isLoading}
          error={findings.isError ? { sentence: t("The rules this record fails could not be read."), onRetry: () => void findings.refetch() } : undefined}
          empty={{ heading: t("Passes every rule"), text: t("No rule fails this record in this run.") }}
        />
      </section>
    </Sheet>
  );
}

const PAGE = 25;

export function FindingRecordsSheet({ id, close, under }: SheetProps) {
  const [versionId, checkId] = parts(id);
  const fx = useFixture();
  const { open } = useSheets();
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: ["next", fx, "finding-records", versionId, checkId, offset], queryFn: () => getFindingRecords(versionId, checkId, { limit: PAGE, offset }), enabled: Boolean(versionId && checkId) });
  const rows = q.data?.records ?? [];
  const total = q.data?.total ?? 0;
  const fieldNames = [...new Set(rows.flatMap((r) => Object.keys(r.field_values ?? {})))];
  const grain = rows[0]?.grain;
  const term = useGlossary(grain ? fieldNames.map((f) => `${grain}.${f}`) : []);

  const columns: Column<FindingRecord>[] = [
    { id: "record", label: t("Record"), cell: (r) => <Code code={r.record_key} /> },
    { id: "grain", label: t("Table"), cell: (r) => <Code code={r.grain} /> },
    { id: "module", label: t("Object"), cell: (r) => moduleText(r.module) },
    ...fieldNames.map((f): Column<FindingRecord> => ({
      id: `f-${f}`,
      label: grain ? `${f} ${term(`${grain}.${f}`) ?? ""}`.trim() : f,
      cell: (r) => {
        const v = r.field_values?.[f];
        return v === undefined || v === null || v === "" ? t("blank") : <Code code={String(v)} text={r.value_labels?.[f]} />;
      },
    })),
  ];

  return (
    <Sheet open onClose={close} under={under} size="large" title={t("Failing records, in detail")} meta={<Code code={checkId} />}>
      <section data-testid="finding-records">
        <p className="nx-rn-note">{t("The records that fail this rule, with the values it read. Sensitive values are masked.")}</p>
        <DataTable
          caption={t("Failing records, in detail")}
          rows={rows}
          rowKey={(r) => `${r.grain}-${r.record_key}`}
          rowLabel={(r) => r.record_key}
          columns={columns}
          total={total}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The failing records could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No failing records"), text: t("No record fails this rule at this run.") }}
          onOpenRow={(r) => open({ kind: "record-detail", id: recordDetailId(versionId, r.module, r.record_key) })}
        />
        {total > PAGE ? (
          <p className="nx-rn-pager">
            <Button variant="secondary" size={32} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous page")}</Button>
            <span>{t("Records {from} to {to} of {total}", { from: formatInt(offset + 1), to: formatInt(Math.min(offset + PAGE, total)), total: formatInt(total) })}</span>
            <Button variant="secondary" size={32} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t("Next page")}</Button>
          </p>
        ) : null}
      </section>
    </Sheet>
  );
}

export function RuleReadsSheet({ id, close, under }: SheetProps) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["next", fx, "rule-reads", id], queryFn: () => getRuleReads(id), enabled: Boolean(id) });
  const r = q.data;
  const term = useGlossary([...(r?.fields ?? []), ...(r?.targets ?? [])]);
  const list = (codes: string[]) => (
    <ul className="nx-rn-sub">{codes.map((c) => <li key={c}><Code code={c} text={term(c) ?? undefined} /></li>)}</ul>
  );

  return (
    <Sheet open onClose={close} under={under} title={t("What this rule reads")} meta={<Code code={id} />}>
      <section data-testid="rule-reads">
        {q.isLoading ? <Skeleton lines={5} label={t("Loading what the rule reads")} /> : q.isError || !r ? (
          <ErrorState error={q.error} fallback={t("What this rule reads could not be loaded.")} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <p className="nx-rn-note">{moduleText(r.module)}</p>
            <h3 className="nx-rn-h3">{t("Reads")}</h3>
            {r.fields.length ? list(r.fields) : <p className="nx-muted">{t("No fields are listed for this rule.")}</p>}
            {r.targets.length ? <><h3 className="nx-rn-h3">{t("Looks up")}</h3>{list(r.targets)}</> : null}
            {r.tables.length ? <><h3 className="nx-rn-h3">{t("Tables")}</h3><ul className="nx-rn-sub">{r.tables.map((tb) => <li key={tb}><Code code={tb} /></li>)}</ul></> : null}
            {r.joins.length ? (
              <>
                <h3 className="nx-rn-h3">{t("Joins")}</h3>
                <ul className="nx-rn-sub">
                  {r.joins.map((j) => (
                    <li key={`${j.parent}-${j.child}`}>{t("{parent} to {child}, {cardinality}", { parent: j.parent, child: j.child, cardinality: j.cardinality })}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {r.owners.length ? (
              <DataTable
                caption={t("Owners")}
                rows={r.owners}
                rowKey={(o) => `${o.kind}-${o.ref}`}
                rowLabel={(o) => o.ref}
                columns={[
                  { id: "ref", label: t("Applies to"), cell: (o) => (o.kind === "object" ? moduleText(o.ref) : <Code code={o.ref} />) },
                  { id: "owner", label: t("Owner"), cell: (o) => o.owner_name ?? t("Unassigned") },
                  { id: "steward", label: t("Steward"), cell: (o) => o.steward_name ?? t("Unassigned") },
                ]}
              />
            ) : null}
            {r.glossary_terms.length ? (
              <>
                <h3 className="nx-rn-h3">{t("Glossary terms")}</h3>
                <ul className="nx-rn-sub">
                  {r.glossary_terms.map((g) => (
                    <li key={g.id}>{g.sap_table && g.sap_field ? <Code code={`${g.sap_table}.${g.sap_field}`} text={g.business_name} /> : g.business_name}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>
    </Sheet>
  );
}
