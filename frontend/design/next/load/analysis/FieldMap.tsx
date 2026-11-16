"use client";

/** The field map: each source field, the target field it loads into, the delta between them and the transformation, with the four-eyes value map per field. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { decideValueEntry, deleteFieldMapping, deleteValueEntry, getFieldMap, getMigrationRuns, getValueCandidates, getValueMap, saveValueMap, seedFieldMap, updateFieldMapping, type FieldMapping } from "@/lib/api/v2/migration";
import { formatModuleName } from "@/lib/format";
import { fieldDelta, needsTransform, type Delta } from "@/lib/v2/field-delta";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Button, Chip, EmptyState, ErrorState, Skeleton, useToast } from "../../kit";
import { HBars, Panel, type BarRow } from "../parts";
import { DELTA, Field, Labelled, ORIGIN, Table, analysed, defText, status, useMig } from "./shared";

export function FieldMapPanel({ modules, release }: { modules: string[]; release: "s4hana" | "ecc6" }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const [module, setModule] = useUrlParam<string>("map_module", modules[0] ?? "material_master");
  const [valueField, setValueField] = useState<string | null>(null);
  const q = useMig(["field-map", module, release], () => getFieldMap(module, release));
  const done = (msg: string) => () => { toast({ text: msg, tone: "good" }); void qc.invalidateQueries({ queryKey: ["migration", "field-map"] }); };
  const fail = (msg: string) => (e: unknown) => toast({ text: errorSentence(e, msg), tone: "bad" });
  const confirm = useMutation({ mutationFn: (id: string) => updateFieldMapping(id, { is_confirmed: true }), onSuccess: done(t("The mapping is confirmed.")), onError: fail(t("The mapping could not be confirmed.")) });
  const remove = useMutation({ mutationFn: deleteFieldMapping, onSuccess: done(t("The mapping was removed.")), onError: fail(t("The mapping could not be removed.")) });
  const seed = useMutation({ mutationFn: () => seedFieldMap(module, release), onSuccess: done(t("The field map was proposed from the source.")), onError: fail(t("The field map could not be proposed.")) });
  const edit = can("analyse");
  const rows = q.data?.mappings ?? [];
  const deltas = new Map<string, Delta[]>(rows.map((m) => [m.id, fieldDelta(m)]));
  const count = (f: (d: Delta[], m: FieldMapping) => boolean) => rows.filter((m) => f(deltas.get(m.id) ?? [], m)).length;
  const bars: BarRow[] = [
    { key: "same", label: t("Load as read"), value: count((d) => d[0]?.kind === "same" || d.every((x) => x.kind === "longer")), tone: "good" as const },
    { key: "change", label: t("Definition changes"), value: count((d) => d.some((x) => x.kind !== "longer" && x.kind !== "same" && x.kind !== "dropped" && x.kind !== "unknown")), tone: "warn" as const },
    { key: "open", label: t("Change with no transformation yet"), value: count((_, m) => needsTransform(m)), tone: "bad" as const },
    { key: "values", label: t("Values translated by a value map"), value: rows.filter((m) => m.value_map).length, tone: "data" as const },
    { key: "dropped", label: t("Not carried to the target"), value: count((d) => d[0]?.kind === "dropped"), tone: "data" as const },
    { key: "unconfirmed", label: t("Not confirmed"), value: rows.filter((m) => !m.is_confirmed).length, tone: "warn" as const },
  ].map((b) => ({ ...b, text: int(b.value) }));
  const target = (m: FieldMapping) => (m.dest_table && m.dest_field ? `${m.dest_table}.${m.dest_field}` : null);
  return (
    <Panel title={t("Field map")} meta={t("Each field as read from the source, the target field it loads into, what changes between them and the transformation that bridges it")} testId="mig-field-map">
      <form className="nx-ld-filters" onSubmit={(e) => e.preventDefault()}>
        <Labelled label={t("Object")}>
          <select className="nx-input" value={module} onChange={(e) => { setModule(e.target.value); setValueField(null); }}>
            {[...new Set([...modules, module])].map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </Labelled>
        {edit ? <Button variant="secondary" loading={seed.isPending} onClick={() => seed.mutate()}>{t("Propose from the source")}</Button> : null}
      </form>
      {q.isPending ? <Skeleton /> : q.isError ? (
        status(q.error) === 403 ? <EmptyState heading={t("Your role cannot read the field map.")} /> : <ErrorState sentence={t("The field map could not be read.")} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? <EmptyState heading={t("No field is mapped for this object yet.")} /> : (
        <>
          <HBars label={t("Delta between source and target")} testId="mig-delta-bars" rows={bars} />
          <Table<FieldMapping>
            rows={rows}
            rowKey={(m) => m.id}
            rowLabel={(m) => m.source_field ?? m.id}
            caption={t("Field map")}
            columns={[
              { id: "src", label: t("Source field"), cell: (m) => <Field name={m.source_field} def={m.source_def} /> },
              { id: "sdef", label: t("Source definition"), cell: (m) => defText(m.source_def) },
              { id: "dst", label: t("Target field"), cell: (m) => (target(m) ? <Field name={target(m)} def={m.target_def} /> : t("Not migrated")) },
              { id: "ddef", label: t("Target definition"), cell: (m) => defText(m.target_def) },
              { id: "delta", label: t("Delta"), cell: (m) => <>{(deltas.get(m.id) ?? []).map((d) => <div key={d.kind}>{DELTA[d.kind](d)}</div>)}</> },
              {
                id: "tx", label: t("Transformation"), cell: (m) => (
                  <>
                    {m.transform_note ? <div>{m.transform_note}</div> : null}
                    {m.value_map ? <div>{t("Values translated by a value map")}</div> : null}
                    {needsTransform(m) ? <div><Chip tone="warn">{t("Needs a transformation")}</Chip></div> : !m.transform_note && !m.value_map ? <div>{t("Copied as read")}</div> : null}
                    {m.origin ? <div className="nx-ld-meta">{ORIGIN[m.origin]?.() ?? m.origin}</div> : null}
                  </>
                ),
              },
              { id: "ok", label: t("Confirmed"), cell: (m) => (m.is_confirmed ? t("Yes") : t("No")) },
              {
                id: "act", label: t("Actions"), cell: (m) => {
                  const tg = target(m);
                  return (
                    <div className="nx-ld-actions">
                      {m.value_map && tg ? <Chip pressed={valueField === tg} onClick={() => setValueField(tg)}>{t("Values")}</Chip> : null}
                      {edit && !m.is_confirmed ? <Button variant="secondary" size={32} disabled={confirm.isPending} onClick={() => confirm.mutate(m.id)}>{t("Confirm")}</Button> : null}
                      {edit ? <Button variant="secondary" size={32} disabled={remove.isPending} onClick={() => remove.mutate(m.id)}>{t("Remove")}</Button> : null}
                    </div>
                  );
                },
              },
            ]}
          />
        </>
      )}
      {valueField ? <ValueMap module={module} field={valueField} /> : null}
    </Panel>
  );
}

interface ValueRow { source_value: string; records: number | null }

function ValueMap({ module, field }: { module: string; field: string }) {
  const { can, id: me } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const runs = useMig(["runs"], getMigrationRuns);
  const runId = runs.data?.runs.find((r) => analysed(r) && r.modules.includes(module))?.id ?? null;
  const saved = useMig(["value-map", module, field], () => getValueMap(module, field));
  const cands = useMig(["candidates", runId, field], () => getValueCandidates(runId as string, field), runId !== null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const done = (msg: string) => { toast({ text: msg, tone: "good" }); setDraft({}); void qc.invalidateQueries({ queryKey: ["migration", "value-map"] }); };
  const fail = (msg: string) => (e: unknown) => toast({ text: errorSentence(e, msg), tone: "bad" });
  const save = useMutation({
    mutationFn: () => saveValueMap(module, field, Object.entries(draft).filter(([, v]) => v.trim()).map(([source_value, target_value]) => ({ source_value, target_value: target_value.trim() }))),
    onSuccess: () => done(t("The values were proposed. A second person approves them before the load uses them.")),
    onError: fail(t("The value map could not be saved.")),
  });
  const remove = useMutation({ mutationFn: deleteValueEntry, onSuccess: () => done(t("The value was removed from the map.")), onError: fail(t("The value could not be removed.")) });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => decideValueEntry(id, decision),
    onSuccess: (r) => done(r.status === "confirmed" ? t("The value is approved. The next load uses it.") : t("The proposed value was rejected.")),
    onError: fail(t("The decision could not be saved.")),
  });
  // Four eyes: analysts propose values, a different approver confirms them; the load reads confirmed values only.
  const edit = can("analyse");
  const approver = can("approve");
  const byValue = new Map((saved.data?.entries ?? []).map((e) => [e.source_value, e]));
  const values: ValueRow[] = cands.data?.values ?? (saved.data?.entries ?? []).map((e) => ({ source_value: e.source_value, records: null }));
  const title = t("Value map for {field}", { field });
  return (
    <section aria-label={title} data-testid="mig-value-map">
      <h3 className="nx-ld-lede">{title}</h3>
      {saved.isPending ? <Skeleton /> : saved.isError ? <ErrorState sentence={t("The value map could not be read.")} onRetry={() => void saved.refetch()} /> : values.length === 0 ? (
        <EmptyState heading={t("No source values are known for this field yet.")} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Table<ValueRow>
            rows={values}
            rowKey={(v) => v.source_value}
            rowLabel={(v) => v.source_value}
            caption={title}
            columns={[
              { id: "src", label: t("Source value"), cell: (v) => v.source_value },
              { id: "n", label: t("Records"), cell: (v) => int(v.records) },
              {
                id: "dst", label: t("Target value"), cell: (v) => {
                  const e = byValue.get(v.source_value);
                  return edit ? (
                    <input className="nx-input" aria-label={t("Target value for {v}", { v: v.source_value })} value={draft[v.source_value] ?? e?.target_value ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, [v.source_value]: ev.target.value }))} />
                  ) : e?.target_value ?? f1(null);
                },
              },
              {
                id: "st", label: t("Status"), cell: (v) => {
                  const e = byValue.get(v.source_value);
                  return <span data-testid={`mig-vm-status-${v.source_value}`}>{!e ? t("Not mapped") : e.status === "proposed" ? t("Waits for a second person") : t("Approved")}</span>;
                },
              },
              {
                id: "act", label: t("Actions"), cell: (v) => {
                  const e = byValue.get(v.source_value);
                  if (!approver || !e) return null;
                  return (
                    <div className="nx-ld-actions">
                      {e.status === "proposed" && e.proposed_by !== me ? (
                        <>
                          <Button variant="primary" size={32} data-testid={`mig-vm-approve-${v.source_value}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, decision: "approve" })}>{t("Approve")}</Button>
                          <Button variant="secondary" size={32} data-testid={`mig-vm-reject-${v.source_value}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, decision: "reject" })}>{t("Reject")}</Button>
                        </>
                      ) : null}
                      <Button variant="secondary" size={32} disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>{t("Remove")}</Button>
                    </div>
                  );
                },
              },
            ]}
          />
          {edit ? <div className="nx-ld-actions"><Button type="submit" variant="primary" loading={save.isPending} disabled={Object.keys(draft).length === 0}>{t("Propose these values")}</Button></div> : null}
        </form>
      )}
    </section>
  );
}
