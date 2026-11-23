"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { detectZ, feedbackZAnomaly, updateZEntry } from "@/lib/api/v2/sys";
import type { ZAnomaly, ZAnomalyVerdict, ZRegistryEntry, ZRegistryPatch, ZRegistryStatus } from "@/lib/api/z-objects";
import { useZAnomalies, useZDormant, useZDrift, useZGhost, useZEntry, useZMapping, useZRegistry } from "@/lib/v2/sys-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, DataTable, Field, FieldChip, Input, Select, Sheet, SeverityPill, Textarea, useToast, EmptyState } from "@/ui/kit";
import { errMsg, Gate } from "./shared";

export function CustomTab({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const reg = useZRegistry();
  const an = useZAnomalies();
  const ghost = useZGhost();
  const dormant = useZDormant();
  const drift = useZDrift();
  const map = useZMapping();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["v2"] });
  const verdict = async (id: string, v: ZAnomalyVerdict) => {
    setBusy(true);
    try { await feedbackZAnomaly(id, v); toast(v === "confirmed" ? t("Anomaly confirmed.") : t("Anomaly dismissed."), "good"); await refresh(); } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  const detect = async () => {
    setBusy(true);
    try { await detectZ(id); toast(t("Custom object detection queued."), "good"); await qc.invalidateQueries({ queryKey: ["v2"] }); } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  return (
    <div className="mx-col">
      <Card title={t("Custom objects")} sub={t("Z objects found in this landscape. The lists cover every system.")} action={me.can("trigger_sync") ? <Button variant="secondary" disabled={busy} onClick={() => void detect()}>{t("Detect custom objects")}</Button> : undefined}>
        <Gate q={reg} empty={{ heading: t("No custom objects found yet"), body: t("Run detection to list them.") }}>
          {(d) => d.entries.length === 0 ? <EmptyState heading={t("No custom objects found yet.")} body={t("Run an extraction to find the custom objects.")} /> : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} description={r.description ?? undefined} /> },
              { key: "module", label: t("Module"), render: (r) => r.module },
              { key: "category", label: t("Category"), render: (r) => r.category },
              { key: "standard_equivalent", label: t("Standard equivalent"), render: (r) => (r.standard_equivalent ? <FieldChip code={r.standard_equivalent ?? ""} /> : "-") },
              { key: "status", label: t("Status"), render: (r) => r.status },
              { key: "transaction_count_total", label: t("Uses"), align: "end" as const, render: (r) => whole(r.transaction_count_total) },
              ...(me.can("manage_rules") ? [{ key: "edit", label: t("Edit"), render: (r: ZRegistryEntry) => <Button variant="secondary" onClick={() => setEdit(r.id)}>{t("Edit {name}", { name: r.object_name })}</Button> }] : []),
            ]} rows={d.entries} rowKey={(r) => String(r.id)} label={t("Custom object registry")} height={300} />
          )}
        </Gate>
      </Card>
      <Card title={t("Anomalies")}>
        <Gate q={an} empty={{ heading: t("No anomalies") }}>
          {(d) => d.anomalies.length === 0 ? <EmptyState heading={t("No anomalies.")} body={t("Nothing unusual was found in the custom objects.")} /> : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} description={r.description ?? undefined} /> },
              { key: "anomaly_type", label: t("Type"), render: (r) => r.anomaly_type },
              { key: "severity", label: t("Severity"), render: (r) => <SeverityPill sev={r.severity === "critical" ? "critical" : r.severity === "high" ? "high" : "info"} label={r.severity} /> },
              { key: "deviation_pct", label: t("Deviation"), align: "end" as const, render: (r) => `${whole(r.deviation_pct)}%` },
              { key: "status", label: t("Status"), render: (r) => r.status },
              ...(me.can("ai_feedback") ? [{ key: "verdict", label: t("Verdict"), render: (r: ZAnomaly) => r.id && r.status === "active" ? (
                <span className="mx-row">
                  <Button variant="secondary" disabled={busy} onClick={() => void verdict(r.id ?? "", "confirmed")}>{t("Confirm {name}", { name: r.object_name })}</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void verdict(r.id ?? "", "dismissed")}>{t("Dismiss {name}", { name: r.object_name })}</Button>
                </span>
              ) : null }] : []),
            ]} rows={d.anomalies} rowKey={(r) => String(r.id)} label={t("Custom object anomalies")} height={240} />
          )}
        </Gate>
      </Card>
      <Card title={t("Ghost and dormant")}>
        <Gate q={ghost} empty={{ heading: t("No ghost objects") }}>
          {(g) => (
            <Gate q={dormant} empty={{ heading: t("No dormant objects") }}>
              {(dm) => g.length + dm.length === 0 ? <EmptyState heading={t("No ghost or dormant objects.")} body={t("Every custom object is in use.")} /> : (
                <DataTable columns={[
                  { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} /> },
                  { key: "kind", label: t("Kind"), render: (r) => r.kind },
                  { key: "module", label: t("Module"), render: (r) => r.module },
                ]} rows={[...g.map((x) => ({ ...x, kind: t("Ghost") })), ...dm.map((x) => ({ ...x, kind: t("Dormant") }))]} rowKey={(r) => `${r.kind}-${r.object_name}`} label={t("Ghost and dormant objects")} height={240} />
              )}
            </Gate>
          )}
        </Gate>
      </Card>
      <Card title={t("Drift and standard mapping")}>
        <Gate q={drift} empty={{ heading: t("No drift") }}>
          {(d) => d.length === 0 ? <EmptyState heading={t("No custom object drift.")} body={t("Custom objects match the last run.")} /> : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} /> },
              { key: "change_type", label: t("Change"), render: (r) => r.change_type },
              { key: "module", label: t("Module"), render: (r) => r.module },
            ]} rows={d} rowKey={(r) => `${r.object_name}-${r.change_type}`} label={t("Custom object drift")} height={200} />
          )}
        </Gate>
        <Gate q={map} empty={{ heading: t("No standard mapping") }}>
          {(d) => d.mappings.length === 0 ? null : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} /> },
              { key: "standard_equivalent", label: t("Standard equivalent"), render: (r) => (r.standard_equivalent ? <FieldChip code={r.standard_equivalent} /> : null) },
              { key: "confidence", label: t("Confidence"), align: "end" as const, render: (r) => `${Math.round(r.confidence * 100)}%` },
            ]} rows={d.mappings} rowKey={(r) => r.object_name} label={t("Standard mapping")} height={200} />
          )}
        </Gate>
      </Card>
      <Sheet open={!!edit} onClose={() => setEdit("")} label={t("Edit custom object")} closeLabel={t("Close")}>
        {edit ? <EditEntry key={edit} id={edit} onDone={() => { setEdit(""); void refresh(); }} /> : null}
      </Sheet>
    </div>
  );
}

/** Reads the entry fresh, then PUTs only the fields that changed. The route keeps every field left out. */
function EditEntry({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useZEntry(id);
  return <Gate q={q}>{(e) => <EntryForm e={e} onDone={onDone} />}</Gate>;
}

function EntryForm({ e, onDone }: { e: ZRegistryEntry; onDone: () => void }) {
  const toast = useToast();
  const [owner, setOwner] = useState(e.owner ?? "");
  const [desc, setDesc] = useState(e.description ?? "");
  const [std, setStd] = useState(e.standard_equivalent ?? "");
  const [status, setStatus] = useState<ZRegistryStatus>(e.status as ZRegistryStatus);
  const [notes, setNotes] = useState(e.notes ?? "");
  const [busy, setBusy] = useState(false);
  const patch: ZRegistryPatch = {};
  if (owner !== (e.owner ?? "")) patch.owner = owner;
  if (desc !== (e.description ?? "")) patch.description = desc;
  if (std !== (e.standard_equivalent ?? "")) patch.standard_equivalent = std;
  if (status !== e.status) patch.status = status;
  if (notes !== (e.notes ?? "")) patch.notes = notes;
  const save = async () => {
    setBusy(true);
    try { await updateZEntry(e.id, patch); toast(t("Custom object saved."), "good"); onDone(); } catch (x) { toast(errMsg(x), "bad"); } finally { setBusy(false); }
  };
  return (
    <form className="mx-col" onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
      <p className="mx-muted"><FieldChip code={e.object_name} /></p>
      <Field label={t("Owner")}><Input value={owner} onChange={(ev) => setOwner(ev.target.value)} /></Field>
      <Field label={t("Description")}><Textarea value={desc} onChange={(ev) => setDesc(ev.target.value)} /></Field>
      <Field label={t("Standard equivalent")}><Input value={std} onChange={(ev) => setStd(ev.target.value)} /></Field>
      <Field label={t("Status")}><Select value={status} onChange={(ev) => setStatus(ev.target.value as ZRegistryStatus)} options={[{ value: "active", label: t("Active") }, { value: "dormant", label: t("Dormant") }, { value: "deprecated", label: t("Deprecated") }, { value: "under_review", label: t("Under review") }]} /></Field>
      <Field label={t("Notes")}><Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
      <div><Button variant="primary" type="submit" disabled={busy || Object.keys(patch).length === 0}>{t("Save custom object")}</Button></div>
    </form>
  );
}
