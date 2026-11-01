"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  deleteFieldMapping, deleteValueEntry, exportMigrationFindings, getFieldMap, getMigrationFindings, getMigrationRecords,
  getMigrationRun, getMigrationRuns, getValueCandidates, getValueMap, saveValueMap, seedFieldMap, startMigration,
  updateFieldMapping, type FieldDef, type MigrationMode, type MigrationRun,
} from "@/lib/api/v2/migration";
import { formatDate, formatModuleName } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { fieldDelta, needsTransform, type Delta, type DeltaKind } from "@/lib/v2/field-delta";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Migration analysis: how ready the source data is to load into the target system (api/routes/migration.py). Every
 * figure is read from the backend; a figure it has not computed shows as a dash.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
const PAGE = 50;

const VERDICT = { go: "go", conditional: "at-risk", "no-go": "no-go" } as const;
const VERDICT_TEXT: Record<string, () => string> = {
  go: () => t("Ready to load"),
  conditional: () => t("Ready with conditions"),
  "no-go": () => t("Not ready to load"),
};
const MODE: Record<MigrationMode, () => string> = {
  source_to_destination: () => t("Source to target system"),
  source_to_source: () => t("Source to source"),
  s4_dry_run: () => t("S/4HANA dry run"),
};
const GAP: Record<string, () => string> = {
  unmapped_field: () => t("Field with no mapping"),
  obsolete_target: () => t("Target field no longer exists"),
  target_field_missing: () => t("Target field missing"),
  value_unmapped: () => t("Value with no target value"),
  target_mandatory: () => t("Mandatory target field empty"),
  key_missing: () => t("Key missing"),
  key_collision: () => t("Two records get the same key"),
  target_key_exists: () => t("Key already in the target"),
  length_truncation: () => t("Value longer than the target field"),
  type_conversion: () => t("Type does not convert"),
  precision_loss: () => t("Decimals lost"),
  case_change: () => t("Case changes"),
  domain_value: () => t("Value outside the field's domain"),
  check_table_value: () => t("Value not in the check table"),
  target_config_unverified: () => t("Target configuration not verified"),
};
const gapText = (g: string) => GAP[g]?.() ?? (g.startsWith("field_status_") ? t("Field status in the target: {kind}", { kind: g.slice(13) }) : g);
const tone = (sev: string) => (sev === "critical" ? "crit" : sev === "high" || sev === "medium" ? "warn" : "data");
const SEVERITIES = ["critical", "high", "medium", "low"];

function useMig<T>(key: unknown[], fn: () => Promise<T>, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["migration", ...key, fixture], queryFn: fn, staleTime: 60_000, retry, enabled });
}

function Table({ title, head, children }: { title: string; head: string[]; children: ReactNode }) {
  return (
    <ScrollFrame label={title}>
      <table className="m2-tbl m2-cards">
        <caption className="m2-sr">{title}</caption>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollFrame>
  );
}

const DELTA: Record<DeltaKind, (d: Delta) => string> = {
  dropped: () => t("Not carried to the target"),
  unknown: () => t("Definition not in the dictionary"),
  type: (d) => t("Type changes from {a} to {b}", { a: String(d.from), b: String(d.to) }),
  shorter: (d) => t("Shortened from {a} to {b} characters", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  longer: (d) => t("Lengthened from {a} to {b} characters", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  decimals: (d) => t("Decimals change from {a} to {b}", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  check_table: (d) => t("Checked against {b} instead of {a}", { a: d.from ? String(d.from) : t("no table"), b: d.to ? String(d.to) : t("no table") }),
  same: () => t("Same definition"),
};
const ORIGIN: Record<string, () => string> = {
  identity: () => t("Same field name"),
  sap_standard: () => t("SAP standard conversion"),
  steward: () => t("Set by a steward"),
};
const defText = (d: FieldDef | null) => d?.type ? [d.type, int(d.length), d.decimals ? t("{n} decimals", { n: int(d.decimals) }) : null, d.check_table].filter(Boolean).join(" ") : f1(null);

/** TABLE.FIELD with its dictionary description beside it. */
function Field({ name, def }: { name: string | null; def?: FieldDef | null }) {
  if (!name) return <>{f1(null)}</>;
  return <Coded code={name} text={def?.description ?? undefined} first />;
}

export function Migration() {
  const runs = useMig(["runs"], getMigrationRuns);
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { can } = useV2Session();

  if (runs.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (runs.isError) {
    return (
      <CcPage>
        {status(runs.error) === 403 ? <EmptyFrame>{t("Your role cannot read the migration analyses.")}</EmptyFrame> : (
          <ErrorFrame onRetry={() => void runs.refetch()}>{t("The migration analyses could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const list = runs.data.runs;
  const latest = list.find((r) => r.status === "completed") ?? null;
  const current = list.find((r) => r.id === picked) ?? latest;
  const startBtn = can("analyse") ? (
    <button type="button" className="m2-btn m2-next" aria-expanded={starting} onClick={() => setStarting((s) => !s)}>{t("Start an analysis")}</button>
  ) : undefined;
  return (
    <CcPage>
      {latest ? (
        <CcBanner
          eyebrow={t("Migration analysis of {date}", { date: formatDate(latest.completed_at ?? latest.created_at, "date") })}
          verdict={latest.readiness_verdict ? VERDICT[latest.readiness_verdict] : undefined}
          headline={latest.readiness_verdict ? VERDICT_TEXT[latest.readiness_verdict]() : t("No verdict")}
          why={t("{blocked} of {total} records would not load, with {n} critical gaps.", { blocked: int(latest.records_blocked), total: int(latest.records_total), n: int(latest.critical_count) })}
          figs={[
            { label: t("Readiness"), value: f1(latest.readiness_score) },
            { label: t("Records that would not load"), value: int(latest.records_blocked) },
            { label: t("Objects"), value: int(latest.modules.length), note: MODE[latest.mode]?.() },
          ]}
          action={startBtn}
          testId="mig-banner"
          label={t("Migration analysis")}
        />
      ) : (
        <CcBanner eyebrow={t("Migration analysis")} headline={t("No analysis has finished yet")} why={t("Start one to see which records would not load into the target system.")} action={startBtn} testId="mig-banner" label={t("Migration analysis")} />
      )}
      {starting ? <StartForm onDone={() => setStarting(false)} /> : null}
      <Panel title={t("Analyses")} meta={t("{n} analyses, newest first", { n: int(list.length) })} testId="mig-runs">
        {list.length === 0 ? <EmptyFrame>{t("No analysis has been started.")}</EmptyFrame> : (
          <Table title={t("Analyses")} head={[t("Started"), t("Kind"), t("Objects"), t("Status"), t("Verdict"), t("Readiness"), t("Would not load"), ""]}>
            {list.map((r) => (
              <tr key={r.id} aria-current={r.id === current?.id ? "true" : undefined}>
                <th scope="row" className="m2-card-lead">{formatDate(r.created_at, "datetime")}</th>
                <td data-label={t("Kind")}>{MODE[r.mode]?.() ?? r.mode}</td>
                <td data-label={t("Objects")}>{r.modules.map(formatModuleName).join(", ")}</td>
                <td data-label={t("Status")}>{r.status === "failed" && r.error_detail ? <>{r.status} <span className="m2-meta">{r.error_detail}</span></> : r.status}</td>
                <td data-label={t("Verdict")}>{r.readiness_verdict ? VERDICT_TEXT[r.readiness_verdict]() : f1(null)}</td>
                <td data-label={t("Readiness")} className="m2-num">{f1(r.readiness_score)}</td>
                <td data-label={t("Would not load")} className="m2-num">{int(r.records_blocked)}</td>
                <td>{r.status === "completed" ? <button type="button" className="m2-btn" aria-pressed={r.id === current?.id} onClick={() => setPicked(r.id)}>{t("Open")}</button> : null}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {current && current.status === "completed" ? <RunDetail run={current} /> : null}
      <FieldMapPanel modules={current?.modules ?? []} />
    </CcPage>
  );
}

function StartForm({ onDone }: { onDone: () => void }) {
  const land = useLandscape(null);
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<MigrationMode>("s4_dry_run");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const [mods, setMods] = useState<string[]>([]);
  const start = useMutation({
    mutationFn: startMigration,
    onSuccess: () => {
      toast.show(t("The analysis is queued. It appears in the list when it starts."));
      void qc.invalidateQueries({ queryKey: ["migration"] });
      onDone();
    },
    onError: (e) => toast.show(errorSentence(e, t("The analysis could not be started.")), "error"),
  });
  const systems = land.data?.systems ?? [];
  const objects = land.data?.objects ?? [];
  const needsDest = mode !== "s4_dry_run";
  const ok = src !== "" && mods.length > 0 && (!needsDest || dest !== "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) start.mutate({ mode, source_system_id: src, dest_system_id: needsDest ? dest : undefined, target_release: "s4hana", modules: mods });
  };
  return (
    <Panel title={t("Start an analysis")} testId="mig-start">
      <form className="m2-rfilters" onSubmit={submit}>
        <label>{t("Kind")}
          <select className="m2-sel" value={mode} onChange={(e) => setMode(e.target.value as MigrationMode)}>
            {(Object.keys(MODE) as MigrationMode[]).map((m) => <option key={m} value={m}>{MODE[m]()}</option>)}
          </select>
        </label>
        <label>{t("Source system")}
          <select className="m2-sel" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">{t("Choose a system")}</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {needsDest ? (
          <label>{t("Target system")}
            <select className="m2-sel" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">{t("Choose a system")}</option>
              {systems.filter((s) => s.id !== src).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        ) : null}
        <fieldset>
          <legend>{t("Objects")}</legend>
          {objects.map((o) => (
            <label key={o.module}>
              <input type="checkbox" checked={mods.includes(o.module)} onChange={(e) => setMods((m) => (e.target.checked ? [...m, o.module] : m.filter((x) => x !== o.module)))} /> {o.label}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="m2-btn m2-next" disabled={!ok || start.isPending}>{t("Start")}</button>
      </form>
    </Panel>
  );
}

function RunDetail({ run }: { run: MigrationRun }) {
  const q = useMig(["run", run.id], () => getMigrationRun(run.id));
  const title = t("Gaps by kind");
  return (
    <>
      <Panel title={title} meta={t("Analysis of {date}", { date: formatDate(run.created_at, "date") })} testId="mig-gaps">
        {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This analysis could not be read.")}</ErrorFrame> : q.data.gap_breakdown.length === 0 ? (
          <EmptyFrame>{t("The analysis found no gaps.")}</EmptyFrame>
        ) : (
          <>
            {q.data.structural_critical > 0 ? <p className="m2-meta">{t("{n} critical gaps are in the structure (fields and keys), not in the records.", { n: int(q.data.structural_critical) })}</p> : null}
            <CcHBars
              label={title}
              testId="mig-gap-bars"
              rows={q.data.gap_breakdown.map((g) => ({
                key: `${g.module}-${g.gap_type}-${g.severity}`,
                label: `${gapText(g.gap_type)}, ${formatModuleName(g.module)}`,
                value: g.n,
                text: g.records ? t("{n} gaps, {r} records", { n: int(g.n), r: int(g.records) }) : t("{n} gaps", { n: int(g.n) }),
                tone: tone(g.severity),
              }))}
            />
          </>
        )}
      </Panel>
      <FindingsPanel run={run} gapTypes={[...new Set((q.data?.gap_breakdown ?? []).map((g) => g.gap_type))]} />
      <RecordsPanel run={run} />
    </>
  );
}

function FindingsPanel({ run, gapTypes }: { run: MigrationRun; gapTypes: string[] }) {
  const { can } = useV2Session();
  const toast = useToast();
  const [module, setModule] = useUrlParam<string>("gap_module", "");
  const [gap, setGap] = useState("");
  const [sev, setSev] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const filt = { module: module || undefined, gap_type: gap || undefined, severity: sev || undefined, search: search || undefined };
  const q = useMig(["findings", run.id, filt, offset], () => getMigrationFindings(run.id, { ...filt, limit: PAGE, offset }));
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };
  const exp = useMutation({
    mutationFn: () => exportMigrationFindings(run.id, filt),
    onError: (e) => toast.show(errorSentence(e, t("The gaps could not be exported.")), "error"),
  });
  const title = t("Field-level gaps");
  const total = q.data?.total ?? 0;
  return (
    <Panel title={title} meta={q.data ? t("{n} gaps", { n: int(total) }) : undefined} testId="mig-findings">
      <form className="m2-rfilters" onSubmit={(e) => e.preventDefault()}>
        <label>{t("Object")}
          <select className="m2-sel" value={module} onChange={(e) => reset(setModule)(e.target.value)}>
            <option value="">{t("All")}</option>
            {run.modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
        <label>{t("Kind of gap")}
          <select className="m2-sel" value={gap} onChange={(e) => reset(setGap)(e.target.value)}>
            <option value="">{t("All")}</option>
            {gapTypes.map((g) => <option key={g} value={g}>{gapText(g)}</option>)}
          </select>
        </label>
        <label>{t("Severity")}
          <select className="m2-sel" value={sev} onChange={(e) => reset(setSev)(e.target.value)}>
            <option value="">{t("All")}</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>{t("Search")}
          <input className="m2-inp" type="search" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
        </label>
        {can("export") ? <button type="button" className="m2-btn" disabled={exp.isPending} onClick={() => exp.mutate()}>{t("Export to Excel")}</button> : null}
      </form>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This list could not be read.")}</ErrorFrame> : q.data.items.length === 0 ? (
        <EmptyFrame>{t("No gap matches these filters.")}</EmptyFrame>
      ) : (
        <>
          <Table title={title} head={[t("Record"), t("Gap"), t("Severity"), t("Source field"), t("Source value"), t("Target field"), t("Target value"), t("Why")]}>
            {q.data.items.map((f, i) => (
              <tr key={`${f.record_key}-${f.source_field}-${i}`}>
                <th scope="row" className="m2-card-lead">{f.record_key ? <Coded code={f.record_key} text={formatModuleName(f.module)} first /> : formatModuleName(f.module)}</th>
                <td data-label={t("Gap")}>{gapText(f.gap_type)}</td>
                <td data-label={t("Severity")}><Sev severity={f.severity} /></td>
                <td data-label={t("Source field")}><Field name={f.source_field} /></td>
                <td data-label={t("Source value")}>{f.source_value ?? f1(null)}</td>
                <td data-label={t("Target field")}><Field name={f.target_field} /></td>
                <td data-label={t("Target value")}>{f.target_value ?? f1(null)}</td>
                <td data-label={t("Why")}>{f.detail ?? f1(null)}</td>
              </tr>
            ))}
          </Table>
          <Pager offset={offset} total={total} onMove={setOffset} />
        </>
      )}
    </Panel>
  );
}

function Pager({ offset, total, onMove }: { offset: number; total: number; onMove: (n: number) => void }) {
  if (total <= PAGE) return null;
  return (
    <p className="m2-meta">
      <button type="button" className="m2-btn" disabled={offset === 0} onClick={() => onMove(Math.max(0, offset - PAGE))}>{t("Previous")}</button>{" "}
      {t("{from} to {to} of {n}", { from: int(offset + 1), to: int(Math.min(total, offset + PAGE)), n: int(total) })}{" "}
      <button type="button" className="m2-btn" disabled={offset + PAGE >= total} onClick={() => onMove(offset + PAGE)}>{t("Next")}</button>
    </p>
  );
}

function RecordsPanel({ run }: { run: MigrationRun }) {
  const [which, setWhich] = useState<"load_fail" | "load_ready">("load_fail");
  const [offset, setOffset] = useState(0);
  const q = useMig(["records", run.id, which, offset], () => getMigrationRecords(run.id, which, offset));
  const title = which === "load_fail" ? t("Records that would not load") : t("Records ready to load");
  return (
    <Panel title={t("Records")} meta={q.data ? t("{n} records", { n: int(q.data.total) }) : undefined} testId="mig-records">
      <p>
        <button type="button" className="m2-btn" aria-pressed={which === "load_fail"} onClick={() => { setWhich("load_fail"); setOffset(0); }}>{t("Would not load")}</button>{" "}
        <button type="button" className="m2-btn" aria-pressed={which === "load_ready"} onClick={() => { setWhich("load_ready"); setOffset(0); }}>{t("Ready to load")}</button>
      </p>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This list could not be read.")}</ErrorFrame> : q.data.rows.length === 0 ? (
        <EmptyFrame>{t("No records in this list.")}</EmptyFrame>
      ) : (
        <>
          <Table title={title} head={[t("Record"), t("Object"), t("Table"), t("Reasons")]}>
            {q.data.rows.map((r) => (
              <tr key={`${r.source_table}-${r.record_key}`}>
                <th scope="row" className="m2-card-lead"><Coded code={r.record_key} text={undefined} first /></th>
                <td data-label={t("Object")}>{formatModuleName(r.module)}</td>
                <td data-label={t("Table")}>{r.source_table ?? f1(null)}</td>
                <td data-label={t("Reasons")}>{r.reasons.length === 0 ? f1(null) : <ul className="m2-plain">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}</td>
              </tr>
            ))}
          </Table>
          <Pager offset={offset} total={q.data.total} onMove={setOffset} />
        </>
      )}
    </Panel>
  );
}

function FieldMapPanel({ modules }: { modules: string[] }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const [module, setModule] = useUrlParam<string>("map_module", modules[0] ?? "material_master");
  const [valueField, setValueField] = useState<string | null>(null);
  const q = useMig(["field-map", module], () => getFieldMap(module, "s4hana"));
  const done = (msg: string) => () => { toast.show(msg); void qc.invalidateQueries({ queryKey: ["migration", "field-map"] }); };
  const fail = (msg: string) => (e: unknown) => toast.show(errorSentence(e, msg), "error");
  const confirm = useMutation({ mutationFn: (id: string) => updateFieldMapping(id, { is_confirmed: true }), onSuccess: done(t("The mapping is confirmed.")), onError: fail(t("The mapping could not be confirmed.")) });
  const remove = useMutation({ mutationFn: deleteFieldMapping, onSuccess: done(t("The mapping was removed.")), onError: fail(t("The mapping could not be removed.")) });
  const seed = useMutation({ mutationFn: () => seedFieldMap(module, "s4hana"), onSuccess: done(t("The field map was proposed from the source.")), onError: fail(t("The field map could not be proposed.")) });
  const edit = can("analyse");
  const title = t("Field map");
  const rows = q.data?.mappings ?? [];
  const deltas = rows.map(fieldDelta);
  const count = (f: (d: Delta[], i: number) => boolean) => deltas.filter(f).length;
  const bars = [
    { key: "same", label: t("Load as read"), value: count((d) => d[0].kind === "same" || d.every((x) => x.kind === "longer")), tone: "pass" as const },
    { key: "change", label: t("Definition changes"), value: count((d) => d.some((x) => x.kind !== "longer" && x.kind !== "same" && x.kind !== "dropped" && x.kind !== "unknown")), tone: "warn" as const },
    { key: "open", label: t("Change with no transformation yet"), value: count((_, i) => needsTransform(rows[i])), tone: "crit" as const },
    { key: "values", label: t("Values translated by a value map"), value: rows.filter((m) => m.value_map).length, tone: "data" as const },
    { key: "dropped", label: t("Not carried to the target"), value: count((d) => d[0].kind === "dropped"), tone: "data" as const },
    { key: "unconfirmed", label: t("Not confirmed"), value: rows.filter((m) => !m.is_confirmed).length, tone: "warn" as const },
  ].map((b) => ({ ...b, text: int(b.value) }));
  return (
    <Panel title={title} meta={t("Each field as read from the source, the target field it loads into, what changes between them and the transformation that bridges it")} testId="mig-field-map">
      <form className="m2-rfilters" onSubmit={(e) => e.preventDefault()}>
        <label>{t("Object")}
          <select className="m2-sel" value={module} onChange={(e) => { setModule(e.target.value); setValueField(null); }}>
            {[...new Set([...modules, module])].map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
        {edit ? <button type="button" className="m2-btn" disabled={seed.isPending} onClick={() => seed.mutate()}>{t("Propose from the source")}</button> : null}
      </form>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? (
        status(q.error) === 403 ? <EmptyFrame>{t("Your role cannot read the field map.")}</EmptyFrame> : <ErrorFrame onRetry={() => void q.refetch()}>{t("The field map could not be read.")}</ErrorFrame>
      ) : rows.length === 0 ? <EmptyFrame>{t("No field is mapped for this object yet.")}</EmptyFrame> : (
        <>
        <CcHBars label={t("Delta between source and target")} testId="mig-delta-bars" rows={bars} />
        <Table title={title} head={[t("Source field"), t("Source definition"), t("Target field"), t("Target definition"), t("Delta"), t("Transformation"), t("Confirmed"), ""]}>
          {rows.map((m, i) => {
            const target = m.dest_table && m.dest_field ? `${m.dest_table}.${m.dest_field}` : null;
            const open = needsTransform(m);
            return (
              <tr key={m.id}>
                <th scope="row" className="m2-card-lead"><Field name={m.source_field} def={m.source_def} /></th>
                <td data-label={t("Source definition")} className="m2-mono">{defText(m.source_def)}</td>
                <td data-label={t("Target field")}>{target ? <Field name={target} def={m.target_def} /> : t("Not migrated")}</td>
                <td data-label={t("Target definition")} className="m2-mono">{defText(m.target_def)}</td>
                <td data-label={t("Delta")}><ul className="m2-plain">{deltas[i].map((d) => <li key={d.kind}>{DELTA[d.kind](d)}</li>)}</ul></td>
                <td data-label={t("Transformation")}>
                  <ul className="m2-plain">
                    {m.transform_note ? <li>{m.transform_note}</li> : null}
                    {m.value_map ? <li>{t("Values translated by a value map")}</li> : null}
                    {open ? <li><Sev severity="high" /> {t("Needs a transformation")}</li> : !m.transform_note && !m.value_map ? <li>{t("Copied as read")}</li> : null}
                    {m.origin ? <li className="m2-meta">{ORIGIN[m.origin]?.() ?? m.origin}</li> : null}
                  </ul>
                </td>
                <td data-label={t("Confirmed")}>{m.is_confirmed ? t("Yes") : t("No")}</td>
                <td>
                  {m.value_map && target ? <button type="button" className="m2-btn" aria-pressed={valueField === target} onClick={() => setValueField(target)}>{t("Values")}</button> : null}{" "}
                  {edit && !m.is_confirmed ? <button type="button" className="m2-btn" onClick={() => confirm.mutate(m.id)}>{t("Confirm")}</button> : null}{" "}
                  {edit ? <button type="button" className="m2-btn" onClick={() => remove.mutate(m.id)}>{t("Remove")}</button> : null}
                </td>
              </tr>
            );
          })}
        </Table>
        </>
      )}
      {valueField ? <ValueMap module={module} field={valueField} /> : null}
    </Panel>
  );
}

function ValueMap({ module, field }: { module: string; field: string }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const runs = useMig(["runs"], getMigrationRuns);
  const runId = runs.data?.runs.find((r) => r.status === "completed" && r.modules.includes(module))?.id ?? null;
  const saved = useMig(["value-map", module, field], () => getValueMap(module, field));
  const cands = useMig(["candidates", runId, field], () => getValueCandidates(runId!, field), runId !== null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const done = (msg: string) => () => { toast.show(msg); setDraft({}); void qc.invalidateQueries({ queryKey: ["migration", "value-map"] }); };
  const save = useMutation({
    mutationFn: () => saveValueMap(module, field, Object.entries(draft).filter(([, v]) => v.trim()).map(([source_value, target_value]) => ({ source_value, target_value: target_value.trim() }))),
    onSuccess: done(t("The value map was saved.")),
    onError: (e) => toast.show(errorSentence(e, t("The value map could not be saved.")), "error"),
  });
  const remove = useMutation({ mutationFn: deleteValueEntry, onSuccess: done(t("The value was removed from the map.")), onError: (e) => toast.show(errorSentence(e, t("The value could not be removed.")), "error") });
  const edit = can("analyse");
  const byValue = new Map((saved.data?.entries ?? []).map((e) => [e.source_value, e]));
  const values = cands.data?.values ?? (saved.data?.entries ?? []).map((e) => ({ source_value: e.source_value, records: null as number | null }));
  const title = t("Value map for {field}", { field });
  return (
    <section aria-label={title} data-testid="mig-value-map">
      <h3 className="m2-h3">{title}</h3>
      {saved.isPending ? <Skeleton width="100%" height={80} /> : saved.isError ? <ErrorFrame onRetry={() => void saved.refetch()}>{t("The value map could not be read.")}</ErrorFrame> : values.length === 0 ? (
        <EmptyFrame>{t("No source values are known for this field yet.")}</EmptyFrame>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Table title={title} head={[t("Source value"), t("Records"), t("Target value"), ""]}>
            {values.map((v) => {
              const e = byValue.get(v.source_value);
              return (
                <tr key={v.source_value}>
                  <th scope="row" className="m2-card-lead">{v.source_value}</th>
                  <td data-label={t("Records")} className="m2-num">{int(v.records)}</td>
                  <td data-label={t("Target value")}>
                    {edit ? (
                      <input className="m2-inp" aria-label={t("Target value for {v}", { v: v.source_value })} value={draft[v.source_value] ?? e?.target_value ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, [v.source_value]: ev.target.value }))} />
                    ) : e?.target_value ?? f1(null)}
                  </td>
                  <td>{edit && e ? <button type="button" className="m2-btn" onClick={() => remove.mutate(e.id)}>{t("Remove")}</button> : null}</td>
                </tr>
              );
            })}
          </Table>
          {edit ? <button type="submit" className="m2-btn m2-next" disabled={save.isPending || Object.keys(draft).length === 0}>{t("Save the value map")}</button> : null}
        </form>
      )}
    </section>
  );
}
