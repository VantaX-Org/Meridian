"use client";

/**
 * A golden record as one field × source grid: a row per field, the golden value, then a column per source with
 * the value that source holds; the value survivorship kept is washed in the selection tone. The last columns say
 * why that value won, in words ("Source priority from PRD"), with the raw record key and provenance label
 * (`upload:64afe257`) kept beside it in Mono, and the steward override: an approver sets a field's value by hand,
 * with a reason, and survivorship keeps it until the override is cleared (POST /master-records/{id}/overrides).
 *
 * The sources: a merged cluster (the explanation lists members) has a column per record, the surviving record
 * first; a record never merged has a column per source system its fields came from (source_contributions is
 * keyed by field, each with the one system its value came from).
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog, EmptyState, Field, Input, Mono, Pill, Textarea, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { getMergeExplanation, setStewardOverrides, type ExplainResponse } from "@/lib/api/merge-explain";
import { getVersions } from "@/lib/api/versions";
import { getDdicFields } from "@/lib/api/rules";
import { apiErrorMessage } from "@/lib/error";
import { labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { runScopeLabel } from "@/lib/run-scope";
import type { MasterRecordDetail, Version } from "@/types/api";
import { CompareTable, TD, TD_KEPT, TH } from "./compare-table";
import { RowButton } from "./ledger";
import { show } from "./match-review-model";

/** The query key MergedRecords shares, so the page reads the explanation once. */
export const mergeExplainKey = (id: string) => ["mdm", "merge-explain", id] as const;

type Contribution = MasterRecordDetail["source_contributions"][string];

/** What names a source: the connected systems by id, and the runs an `upload:<run>` label points at. */
export interface SourceLookups {
  systems: ReadonlyMap<string, string>;
  runs: readonly Version[];
}

/**
 * A source's name in words, never a raw id: a connected system's name (looked up by id), "Steward override",
 * "Merged from <key>", or the upload's run ("Upload, material_master_25k, 16 Oct 2026"; "File upload" when the
 * run is not listed). Anything else is already a name (a system's name, or a legacy label such as "ECC").
 */
export function sourceName(raw: string | null | undefined, lookups: SourceLookups): string | null {
  if (!raw) return null;
  const system = lookups.systems.get(raw);
  if (system) return system;
  if (raw === "steward_override") return "Steward override";
  if (raw.startsWith("merge:")) return `Merged from ${raw.slice(6)}`;
  if (raw.startsWith("upload:")) {
    const prefix = raw.slice(7).toLowerCase();
    const run = prefix ? lookups.runs.find((v) => v.id.toLowerCase().startsWith(prefix)) : undefined;
    return run ? `Upload, ${runScopeLabel(run)}` : "File upload";
  }
  return raw;
}

/** One contribution's source: its name in words and the raw provenance label it was stored under. */
function contributionSource(c: Contribution | undefined, lookups: SourceLookups): { name: string | null; raw: string | null } {
  if (!c) return { name: null, raw: null };
  const name = c.source_system_name || sourceName(c.source_system_id, lookups) || sourceName(c.source_system, lookups);
  return { name, raw: c.source_system || null };
}

export interface GridSource {
  id: string;
  /** The source in words (a system, an upload's run), or null when nothing names it. */
  name: string | null;
  /** The raw ids under the name: the record key in a cluster, the provenance label otherwise. */
  raw: string[];
}

export interface GridCell { value: unknown; kept: boolean; reason?: string }

export interface GridRow {
  field: string;
  value: unknown;
  /** Why the golden value won, in words, and the raw ids it names. */
  rule: string | null;
  from: string | null;
  fromRaw: string[];
  overridden: boolean;
  confidence: number | null;
  ai: string | null;
  cells: Record<string, GridCell>;
}

/** The grid's columns and rows, from the record, its merge explanation (when it reads) and the source lookups. */
export function buildGoldenGrid(record: MasterRecordDetail, ex: ExplainResponse | undefined, lookups: SourceLookups): { sources: GridSource[]; rows: GridRow[] } {
  const head = record.sap_object_key;
  const clustered = (ex?.members.length ?? 0) > 0;
  const overrides = ex?.steward_overrides ?? {};
  const sources = new Map<string, GridSource>();
  if (clustered && ex) for (const k of [head, ...ex.members]) sources.set(k, { id: k, name: null, raw: [k] });

  /** The column a value sits in: its record in a cluster, its source system otherwise. */
  const column = (key: string | null, name: string | null, raw: string | null): string | null => {
    if (clustered) {
      if (!key) return null;
      const s = sources.get(key) ?? { id: key, name: null, raw: [key] };
      if (!s.name && name) s.name = name;
      sources.set(key, s);
      return key;
    }
    const id = raw ?? name ?? "unrecorded";
    if (!sources.has(id)) sources.set(id, { id, name, raw: raw && raw !== name ? [raw] : [] });
    return id;
  };

  const fields = Array.from(new Set([...Object.keys(record.golden_fields), ...Object.keys(overrides)]));
  const rows = fields.map((field): GridRow => {
    const value = field in record.golden_fields ? record.golden_fields[field] : overrides[field];
    const c = record.source_contributions[field];
    const sv = ex?.survivorship[field];
    const overridden = field in overrides || sv?.rule === "steward_override";
    const src = contributionSource(c, lookups);
    const winnerKey = sv?.winner_key ?? c?.merged_from ?? (overridden ? null : head);
    const winnerName = src.name ?? sourceName(sv?.winner_system, lookups);
    const cells: Record<string, GridCell> = {};
    if (!overridden || winnerKey) {
      const col = column(winnerKey, winnerName, src.raw);
      if (col) cells[col] = { value: sv ? sv.value : value, kept: !overridden };
    }
    for (const l of sv?.losers ?? []) {
      const col = column(l.key, sourceName(l.system, lookups), null);
      if (col && !cells[col]) cells[col] = { value: l.value, kept: false, reason: l.reason };
    }
    const rule = overridden ? "Steward override" : sv?.rule ? labelOf(sv.rule) : null;
    const fromRaw = [clustered || winnerKey !== head ? winnerKey : null, src.raw && src.raw !== winnerName ? src.raw : null].filter((x): x is string => !!x);
    return {
      field, value, rule, overridden, cells,
      from: overridden ? null : winnerName,
      fromRaw: overridden ? [] : fromRaw,
      confidence: c?.confidence ?? null,
      ai: c?.ai_recommendation ?? null,
    };
  });
  return { sources: [...sources.values()], rows };
}

/** The connected systems and recent runs that name the record's sources; each read only when a label needs it. */
function useSourceLookups(record: MasterRecordDetail, ex: ExplainResponse | undefined): SourceLookups {
  const labels = [
    ...Object.values(record.source_contributions).flatMap((c) => [c.source_system, c.source_system_id ?? ""]),
    ...Object.values(ex?.survivorship ?? {}).flatMap((s) => [s.winner_system ?? "", ...s.losers.map((l) => l.system ?? "")]),
  ];
  const needsRuns = labels.some((l) => l.startsWith("upload:"));
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, staleTime: 300_000, meta: { ignoreError: true } });
  const runs = useQuery({
    queryKey: queryKeys.versionsList({ limit: 100, for: "golden-sources" }),
    queryFn: () => getVersions({ limit: 100 }),
    enabled: needsRuns,
    staleTime: 300_000,
    meta: { ignoreError: true },
  });
  return useMemo(() => ({
    systems: new Map((systems.data ?? []).map((s) => [String(s.id), s.name])),
    runs: runs.data?.versions ?? [],
  }), [systems.data, runs.data]);
}

/** One editing session: the field, and whether the steward is setting a value or clearing their override. */
type Editing = { field: string; current: unknown; clear: boolean };

/** Code → label of each TABLE.FIELD whose dictionary domain has fixed values. */
type ValueLabels = ReadonlyMap<string, ReadonlyMap<string, string>>;
const TABLE_FIELD = /^[A-Z0-9_/]+\.[A-Z0-9_/]+$/;

/**
 * The value labels of the grid's fields from the data dictionary (GET /ddic/fields, the domain's fixed values), so a
 * code reads as words: BUT000.TYPE 1 is "Person". Fields without fixed values, or a failed read, keep the raw code.
 */
export function useValueLabels(fields: readonly string[]): ValueLabels {
  const names = [...new Set(fields.map((f) => f.toUpperCase()).filter((f) => TABLE_FIELD.test(f)))].sort().slice(0, 100);
  const q = useQuery({
    queryKey: ["ddic-fields", names],
    queryFn: () => getDdicFields(names),
    enabled: names.length > 0,
    staleTime: 60 * 60_000,
    retry: false,
    meta: { ignoreError: true },
  });
  return useMemo(() => new Map((q.data ?? [])
    .filter((f) => f.fixed_values?.length)
    .map((f) => [`${f.table}.${f.field}`, new Map(f.fixed_values!.map((v) => [v.value, v.label]))])), [q.data]);
}

/** A value as the grid shows it: its dictionary label with the code beside it in Mono, else the value; "blank" when empty. */
export function valueText(v: unknown, labels?: ReadonlyMap<string, string>): ReactNode {
  const text = show(v);
  if (!text) return <span className="m-ink-3">blank</span>;
  const label = labels?.get(text.trim());
  return label ? <span className="inline-flex flex-wrap items-baseline gap-x-2"><span>{label}</span><Mono>{text}</Mono></span> : text;
}

export function GoldenGrid({ record, toolbar, onChanged }: { record: MasterRecordDetail; toolbar?: ReactNode; onChanged: () => void }) {
  const qc = useQueryClient();
  const canOverride = useRole().can("approve");
  // Without the explanation the values still read; only the losing values and the override stay empty.
  const ex = useQuery({ queryKey: mergeExplainKey(record.id), queryFn: () => getMergeExplanation(record.id), retry: false, meta: { ignoreError: true } });
  const lookups = useSourceLookups(record, ex.data);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const close = () => { setEditing(null); setValue(""); setReason(""); };

  const save = useMutation({
    mutationFn: (e: Editing) => setStewardOverrides(record.id, { [e.field]: e.clear ? null : value }, reason.trim()),
    onSuccess: (_r, e) => {
      toast.success(e.clear ? `Override on ${e.field} cleared; survivorship picks its value again` : `${e.field} set by steward override`);
      close();
      void qc.invalidateQueries({ queryKey: mergeExplainKey(record.id) });
      onChanged();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const { sources, rows } = buildGoldenGrid(record, ex.data, lookups);
  const valueLabels = useValueLabels(rows.map((r) => r.field));
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.field.toLowerCase().includes(q) || show(r.value).toLowerCase().includes(q)) : rows;
  const editable = canOverride && ex.isSuccess;
  const ready = editing ? !!reason.trim() && (editing.clear || !!value.trim()) : false;
  const named = sources.filter((s) => s.name).length;

  return (
    <section aria-label="Golden fields" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Golden record">
        {toolbar}
        <span className="flex-1" />
        {rows.length > 6 ? (
          <Input className="w-56" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter fields" aria-label="Filter fields" />
        ) : null}
        <span className="m-text-meta m-ink-3">
          {rows.length.toLocaleString()} {rows.length === 1 ? "field" : "fields"} from {sources.length.toLocaleString()} {sources.length === 1 ? "source" : "sources"}
          {named < sources.length ? `, ${(sources.length - named).toLocaleString()} not named` : ""}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState variant="inline" title="No golden fields recorded" detail="Fields fill in when the golden record is built from its sources." action={<Link className="m-ink-accent-ink hover:underline" href="/mdm/survivorship">Survivorship rules</Link>} />
      ) : (
        <CompareTable
          label="Fields by source"
          head={<>
            <th scope="col" className={TH}>Field</th>
            <th scope="col" className={TH}>Golden value</th>
            {sources.map((s) => (
              <th key={s.id} scope="col" className={TH}>
                <span className="flex flex-col gap-0.5">
                  <span className="m-ink-2">{s.name ?? "Source not recorded"}</span>
                  {s.raw.map((r) => <Mono key={r}>{r}</Mono>)}
                </span>
              </th>
            ))}
            <th scope="col" className={TH}>Chosen by</th>
            <th scope="col" className={TH}><span className="sr-only">Action</span></th>
          </>}
        >
          <tbody>
            {shown.map((r) => (
              <tr key={r.field}>
                <th scope="row" className={`${TD} text-left font-normal`}><Mono>{r.field}</Mono></th>
                <td className={TD}>{valueText(r.value, valueLabels.get(r.field.toUpperCase()))}</td>
                {sources.map((s) => {
                  const cell = r.cells[s.id];
                  if (!cell) return <td key={s.id} className={TD}><span className="m-ink-3">Not held</span></td>;
                  return (
                    <td key={s.id} className={`${TD} ${cell.kept ? TD_KEPT : ""}`} title={cell.reason ? `Not kept: ${cell.reason}` : undefined}>
                      {valueText(cell.value, valueLabels.get(r.field.toUpperCase()))}
                      {cell.kept ? <span className="sr-only"> (kept)</span> : null}
                    </td>
                  );
                })}
                <td className={TD}>
                  <span className="flex flex-col gap-0.5">
                    {r.overridden ? <span><Pill tone="info">Steward override</Pill></span> : (
                      <span className="m-ink-2">{r.rule ?? "Source"}{r.from ? ` from ${r.from}` : ""}</span>
                    )}
                    {r.fromRaw.length || r.confidence != null || r.ai ? (
                      <span className="inline-flex flex-wrap items-center gap-2 m-text-meta m-ink-3">
                        {r.fromRaw.map((x) => <Mono key={x}>{x}</Mono>)}
                        {r.confidence != null ? <span>{Math.round(r.confidence * 100)}% confidence</span> : null}
                        {r.ai ? <span>Model suggests {r.ai}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className={`${TD} text-right`}>
                  {editable ? (
                    <RowButton label={r.overridden ? `Clear the override on ${r.field}` : `Override ${r.field}`}
                      onClick={() => { setValue(r.overridden ? "" : show(r.value)); setEditing({ field: r.field, current: r.value, clear: r.overridden }); }}>
                      {r.overridden ? "Clear override" : "Override"}
                    </RowButton>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </CompareTable>
      )}
      <ConfirmDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) close(); }}
        title={editing ? (editing.clear ? `Clear the override on ${editing.field}?` : `Override ${editing.field}`) : ""}
        confirmLabel={editing?.clear ? "Clear override" : "Save override"}
        cancelLabel="Keep"
        pending={save.isPending}
        confirmDisabled={!ready}
        onConfirm={() => { if (editing && ready) save.mutate(editing); }}
        body={editing ? (
          <div className="flex flex-col gap-3 m-text-body">
            <p className="m-ink-2">
              {editing.clear
                ? <>The survivorship rule picks <Mono inline>{editing.field}</Mono> from the merged records again.</>
                : <>Survivorship keeps this value for <Mono inline>{editing.field}</Mono> until the override is cleared. Now: <Mono inline>{show(editing.current) || "None"}</Mono></>}
            </p>
            {editing.clear ? null : (
              <Field label="New value">
                <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-required="true" />
              </Field>
            )}
            <Field label="Reason (required), kept in the merge history">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Confirmed with the vendor master owner" aria-required="true" />
            </Field>
            {ready ? null : <p className="m-text-meta m-ink-3">{editing.clear || value.trim() ? "Give a reason" : "Give a value and a reason"}</p>}
          </div>
        ) : null}
      />
    </section>
  );
}
