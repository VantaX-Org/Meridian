"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { addFieldMapping, decideValueEntry, deleteFieldMapping, deleteValueEntry, seedFieldMap, updateFieldMapping, type FieldMapping, type ValueEntry } from "@/lib/api/v2/migration";
import { Button, Card, DataTable, EmptyState, FieldChip, Input, PageHeader, Select, Tabs, Toggle, useAletheiaScope, useToast } from "@/ui/kit";
import { AskButton, Gate, humanize, when } from "./common";
import { invalidateLoad, useFieldMap, useLoadPlan, useValueMap } from "./hooks";

const DEST = [{ value: "s4hana", label: "S/4HANA" }, { value: "ecc", label: "ECC" }];

/** Field map and value map between source and target: confirm, add, seed, approve, delete. */
export function Maps() {
  useInterfaceLang();
  const qc = useQueryClient();
  const toast = useToast();
  const plan = useLoadPlan();
  const mods = (plan.data?.objects ?? []).map((o) => o.module);
  const [pick, setPick] = useState("");
  const mod = pick || (mods.includes("material_master") ? "material_master" : mods[0]) || "material_master";
  const [dest, setDest] = useState("s4hana");
  const [tab, setTab] = useState("fields");
  const [vf, setVf] = useState("MARA.MTART");
  const [add, setAdd] = useState({ source: "", table: "", field: "" });
  const fm = useFieldMap(mod, dest);
  const vm = useValueMap(mod, vf);
  const bad = () => toast(t("The action failed"), "bad");
  const done = (msg: string) => () => { toast(msg, "good"); invalidateLoad(qc); };
  const confirm = useMutation({ mutationFn: (x: { id: string; on: boolean }) => updateFieldMapping(x.id, { is_confirmed: x.on }), onSuccess: () => invalidateLoad(qc), onError: bad });
  const drop = useMutation({ mutationFn: (id: string) => deleteFieldMapping(id), onSuccess: done(t("Mapping deleted")), onError: bad });
  const seed = useMutation({ mutationFn: () => seedFieldMap(mod, dest), onSuccess: done(t("Map proposed from the dictionary")), onError: bad });
  const create = useMutation({ mutationFn: () => addFieldMapping({ module: mod, dest_system_type: dest, source_field: add.source, dest_table: add.table, dest_field: add.field }), onSuccess: () => { setAdd({ source: "", table: "", field: "" }); done(t("Mapping added"))(); }, onError: bad });
  const decide = useMutation({ mutationFn: (x: { id: string; d: "approve" | "reject" }) => decideValueEntry(x.id, x.d), onSuccess: done(t("Decision saved")), onError: bad });
  const dropV = useMutation({ mutationFn: (id: string) => deleteValueEntry(id), onSuccess: done(t("Value deleted")), onError: bad });
  const maps = fm.data?.mappings ?? [];
  const values = vm.data?.entries ?? [];
  const open = maps.filter((m) => !m.is_confirmed).length;

  useAletheiaScope({
    key: "load/maps",
    label: t("Asking about the field map"),
    suggestions: [t("Which mappings still need a decision?")],
    answer: () => ({ text: t("{n} mappings wait for confirmation.", { n: open }), evidence: maps.filter((m) => !m.is_confirmed).slice(0, 5).map((m) => m.source_field) }),
  });

  return (
    <>
      <PageHeader title={t("Field and value maps")} context={t("How source fields and values become target fields and values")} actions={<><Button onClick={() => seed.mutate()} disabled={seed.isPending}>{t("Propose from the dictionary")}</Button><AskButton /></>} />
      <div className="mx-links">
        <Select aria-label={t("Object")} value={mod} onChange={(e) => setPick(e.target.value)} options={(mods.length ? mods : [mod]).map((m) => ({ value: m, label: `${m} ${humanize(m)}` }))} />
        <Select aria-label={t("Target system")} value={dest} onChange={(e) => setDest(e.target.value)} options={DEST} />
      </div>
      <Card title={t("Maps")}>
        <Tabs idBase="mx-maps" label={t("Map type")} value={tab} onChange={setTab} items={[{ id: "fields", label: t("Field map"), badge: String(maps.length) }, { id: "values", label: t("Value map"), badge: String(values.length) }]} />
        <div id={`mx-maps-panel-${tab}`} role="tabpanel">
          {tab === "fields" ? (
            <Gate loading={fm.isLoading} error={fm.isError} retry={() => void fm.refetch()} what={t("the field map")}>
              {maps.length ? (
                <DataTable<FieldMapping>
                  label={t("Field map")}
                  rows={maps}
                  rowKey={(m) => m.id}
                  columns={[
                    { key: "s", label: t("Source field"), sort: (m) => m.source_field, render: (m) => <FieldChip code={m.source_field} description={m.source_def?.description ?? undefined} /> },
                    { key: "d", label: t("Target field"), sort: (m) => m.dest_field ?? "", render: (m) => (m.dest_table && m.dest_field ? <FieldChip code={`${m.dest_table}.${m.dest_field}`} description={m.target_def?.description ?? undefined} /> : t("Not migrated")) },
                    { key: "o", label: t("Origin"), render: (m) => humanize(m.origin ?? "") },
                    { key: "n", label: t("Note"), render: (m) => m.transform_note ?? "" },
                    { key: "c", label: t("Confirmed"), render: (m) => <Toggle label={t("Confirmed {f}", { f: m.source_field })} checked={m.is_confirmed} onChange={(on) => confirm.mutate({ id: m.id, on })} /> },
                    { key: "x", label: "", render: (m) => <Button variant="ghost" onClick={() => drop.mutate(m.id)} aria-label={t("Delete mapping {f}", { f: m.source_field })}>{t("Delete")}</Button> },
                  ]}
                />
              ) : <EmptyState heading={t("No mappings yet. Propose them from the dictionary.")} />}
              <div className="mx-links">
                <Input aria-label={t("Source field")} placeholder="MARA.MTART" value={add.source} onChange={(e) => setAdd({ ...add, source: e.target.value })} />
                <Input aria-label={t("Target table")} placeholder="MARA" value={add.table} onChange={(e) => setAdd({ ...add, table: e.target.value })} />
                <Input aria-label={t("Target field")} placeholder="MTART" value={add.field} onChange={(e) => setAdd({ ...add, field: e.target.value })} />
                <Button variant="primary" onClick={() => create.mutate()} disabled={!add.source || !add.table || !add.field || create.isPending}>{t("Add mapping")}</Button>
              </div>
            </Gate>
          ) : (
            <Gate loading={vm.isLoading} error={vm.isError} retry={() => void vm.refetch()} what={t("the value map")}>
              <Select aria-label={t("Target field")} value={vf} onChange={(e) => setVf(e.target.value)} options={[...new Set([vf, ...maps.filter((m) => m.value_map && m.dest_table).map((m) => `${m.dest_table}.${m.dest_field}`)])].map((f) => ({ value: f, label: f }))} />
              {values.length ? (
                <DataTable<ValueEntry>
                  label={t("Value map")}
                  rows={values}
                  rowKey={(v) => v.id}
                  columns={[
                    { key: "s", label: t("Source value"), sort: (v) => v.source_value, render: (v) => <code className="mx-code">{v.source_value}</code> },
                    { key: "t", label: t("Target value"), sort: (v) => v.target_value, render: (v) => <code className="mx-code">{v.target_value}</code> },
                    { key: "n", label: t("Note"), render: (v) => v.note ?? "" },
                    { key: "st", label: t("Status"), render: (v) => (v.status === "proposed" ? t("Proposed") : t("Confirmed")) },
                    { key: "u", label: t("Updated"), sort: (v) => v.updated_at ?? "", render: (v) => when(v.updated_at) },
                    { key: "x", label: "", render: (v) => (
                      <>
                        {v.status === "proposed" ? <Button onClick={() => decide.mutate({ id: v.id, d: "approve" })}>{t("Approve")}</Button> : null}
                        {v.status === "proposed" ? <Button onClick={() => decide.mutate({ id: v.id, d: "reject" })}>{t("Reject")}</Button> : null}
                        <Button variant="ghost" onClick={() => dropV.mutate(v.id)} aria-label={t("Delete value {v}", { v: v.source_value })}>{t("Delete")}</Button>
                      </>
                    ) },
                  ]}
                />
              ) : <EmptyState heading={t("No value mappings for this field")} />}
            </Gate>
          )}
        </div>
      </Card>
    </>
  );
}
