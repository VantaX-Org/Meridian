"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDigest, deleteDigest, getDigestNumbers, listDigestDeliveries, listDigests, sendDigestNow, updateDigest, type Digest, type DigestBody } from "@/lib/api/v2/step10";
import { CUSTOM, PRESETS, cronError, describeCron, isPreset } from "@/lib/v2/cron";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, Field, FieldChip, Input, PageHeader, Select, Split, StatTile, Toggle, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { Gate, day, refreshV2, useQ } from "./common";

const BLANK: DigestBody = { name: "", audience: "role", role: "", wave_id: null, cron: PRESETS[1].value, timezone: "UTC", channel: "email", recipients: [], recipient_user_ids: [], alert_channel_id: null, attach_pdf: false, enabled: true };

function Form({ initial, id, onDone }: { initial: DigestBody; id?: string; onDone: (d?: Digest) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [b, setB] = useState<DigestBody>(initial);
  const [custom, setCustom] = useState(!isPreset(initial.cron));
  const [mail, setMail] = useState(initial.recipients.join(", "));
  const err = cronError(b.cron);
  const set = <K extends keyof DigestBody>(k: K, v: DigestBody[K]) => setB((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...b, recipients: mail.split(/[,\s]+/).filter(Boolean), role: b.audience === "role" ? b.role || null : null, wave_id: b.audience === "wave" ? b.wave_id || null : null };
      return id ? updateDigest(id, body) : createDigest(body);
    },
    onSuccess: (d) => { toast(t("Digest saved"), "good"); void refreshV2(qc); onDone(d); },
  });
  const ok = b.name.trim() && !err && (b.channel !== "email" || mail.trim());
  return (
    <Card title={id ? t("Edit digest") : t("New digest")}>
      <div className="mx-col">
        <Field label={t("Name")}><Input value={b.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={t("Audience")}>
          <Select disabled={!!id} value={b.audience} onChange={(e) => set("audience", e.target.value as DigestBody["audience"])} options={[{ value: "role", label: t("A role") }, { value: "wave", label: t("A migration wave") }]} />
        </Field>
        {b.audience === "role"
          ? <Field label={t("Role")}><Input value={b.role ?? ""} onChange={(e) => set("role", e.target.value)} /></Field>
          : <Field label={t("Wave")}><Input value={b.wave_id ?? ""} onChange={(e) => set("wave_id", e.target.value)} /></Field>}
        <Field label={t("Schedule")} hint={t("Times are UTC")}>
          <Select value={custom ? CUSTOM : b.cron} onChange={(e) => { if (e.target.value === CUSTOM) setCustom(true); else { setCustom(false); set("cron", e.target.value); } }} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} />
        </Field>
        {custom ? <Field label={t("Custom cron")} error={err}><Input value={b.cron} onChange={(e) => set("cron", e.target.value)} /></Field> : null}
        <Field label={t("Channel")}>
          <Select value={b.channel} onChange={(e) => set("channel", e.target.value as DigestBody["channel"])} options={[{ value: "email", label: t("Email") }, { value: "webhook", label: t("Webhook") }, { value: "alert_channel", label: t("Alert channel") }]} />
        </Field>
        {b.channel === "email" ? <Field label={t("Recipients")} hint={t("Separate addresses with commas")}><Input value={mail} onChange={(e) => setMail(e.target.value)} /></Field> : null}
        <Toggle label={t("Attach a PDF")} checked={b.attach_pdf} onChange={(v) => set("attach_pdf", v)} />
        <Toggle label={t("Enabled")} checked={b.enabled} onChange={(v) => set("enabled", v)} />
        {save.isError ? <p role="alert" className="mx-muted">{t("The digest could not be saved")}</p> : null}
        <div className="mx-head-actions">
          <Button variant="primary" disabled={!ok || save.isPending} onClick={() => save.mutate()}>{t("Save digest")}</Button>
          <Button variant="ghost" onClick={() => onDone()}>{t("Cancel")}</Button>
        </div>
      </div>
    </Card>
  );
}

function Detail({ d, onEdit, onGone }: { d: Digest; onEdit: () => void; onGone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const deliveries = useQ(["digest-deliveries", d.id], () => listDigestDeliveries(d.id));
  const nums = useQ(["digest-numbers", d.id], () => getDigestNumbers(d.id));
  const send = useMutation({ mutationFn: () => sendDigestNow(d.id), onSuccess: (r) => { toast(t("Send {status}: {n} delivered", { status: r.status, n: r.delivered }), r.failed ? "bad" : "good"); void refreshV2(qc); } });
  const flip = useMutation({ mutationFn: (v: boolean) => updateDigest(d.id, { enabled: v }), onSuccess: () => void refreshV2(qc) });
  const del = useMutation({ mutationFn: () => deleteDigest(d.id), onSuccess: () => { setConfirm(false); void refreshV2(qc); onGone(); } });
  return (
    <div className="mx-col">
      <h2 className="mx-card-t">{d.name}</h2>
      <p className="mx-muted">{describeCron(d.cron)}, {d.channel.replace(/_/g, " ")}, {d.audience === "role" ? (d.role ?? "") : (d.wave_id ?? "")}</p>
      <Toggle label={t("Enabled")} checked={d.enabled} onChange={(v) => flip.mutate(v)} />
      <dl className="mx-tiles">
        <StatTile label={t("Last sent")} value={d.last_sent_at ? relTime(d.last_sent_at) : t("Never")} />
        <StatTile label={t("Next run")} value={d.next_run_at ? day(d.next_run_at) : t("Not scheduled")} />
      </dl>
      <div className="mx-head-actions">
        <Button variant="primary" disabled={send.isPending} onClick={() => send.mutate()}>{t("Send now")}</Button>
        <Button variant="secondary" onClick={onEdit}>{t("Edit")}</Button>
        <Button variant="ghost" onClick={() => setConfirm(true)}>{t("Delete")}</Button>
      </div>
      <Card title={t("What it says now")} sub={t("The numbers the next digest is built from")}>
        <Gate q={nums} label={t("Loading the numbers")}>
          {(n) => (
            <div className="mx-col">
              <p>{n.landscape.text}</p>
              <dl className="mx-tiles">
                <StatTile label={t("Objects under 85")} value={n.landscape.held_under_85} />
                <StatTile label={t("Approvals waiting")} value={n.approvals_waiting} />
                <StatTile label={t("SLA breaches")} value={n.sla_breaches} />
              </dl>
              {n.score_moves.length ? (
                <ul className="mx-list" aria-label={t("Score moves")}>
                  {n.score_moves.map((m) => <li key={`${m.system}-${m.module}`}><FieldChip code={m.module} /> {m.before} {t("to")} {m.after}</li>)}
                </ul>
              ) : null}
            </div>
          )}
        </Gate>
      </Card>
      <Card title={t("Deliveries")}>
        <Gate q={deliveries} label={t("Loading deliveries")}>
          {(r) => r.deliveries.length === 0 ? <EmptyState heading={t("Nothing sent yet")} body={t("A message appears here after the first notification is sent.")} /> : (
            <DataTable label={t("Deliveries")} rows={r.deliveries} rowKey={(x) => x.id} height={220} columns={[
              { key: "at", label: t("When"), render: (x) => relTime(x.created_at) },
              { key: "how", label: t("How"), render: (x) => (x.manual ? t("Sent by hand") : t("Scheduled")) },
              { key: "st", label: t("Result"), render: (x) => x.status },
              { key: "n", label: t("Delivered"), align: "end", render: (x) => x.delivered },
              { key: "f", label: t("Failed"), align: "end", render: (x) => x.failed },
            ]} />
          )}
        </Gate>
      </Card>
      <Confirm open={confirm} danger title={t("Delete this digest?")} confirmLabel={t("Delete")} cancelLabel={t("Cancel")} onConfirm={() => del.mutate()} onCancel={() => setConfirm(false)}>
        {t("{name} stops sending and its delivery history is removed.", { name: d.name })}
      </Confirm>
    </div>
  );
}

export function Digests() {
  const q = useQ(["digests"], () => listDigests());
  const chat = useAletheia();
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "new" | "edit">("view");
  const rows = q.data?.digests ?? [];
  const cur = rows.find((r) => r.id === sel) ?? null;
  useAletheiaScope({
    key: "digests",
    label: t("Digests"),
    suggestions: [t("Which digests are switched off?")],
    answer: () => {
      const off = rows.filter((r) => !r.enabled);
      return { text: off.length ? t("{n} digests are off: {names}.", { n: off.length, names: off.map((r) => r.name).join(", ") }) : t("Every digest is on.") };
    },
  });
  const left = (
    <Gate q={q} label={t("Loading digests")}>
      {() => rows.length === 0 ? <EmptyState heading={t("No digests")} body={t("A digest sends the landscape numbers to a role or a wave on a schedule.")} /> : (
        <DataTable<Digest> label={t("Digests")} rows={rows} rowKey={(r) => r.id} selected={sel ?? undefined} onSelect={(r) => { setSel(r.id); setMode("view"); }} columns={[
          { key: "name", label: t("Digest"), sort: (r) => r.name, render: (r) => r.name },
          { key: "when", label: t("Schedule"), render: (r) => describeCron(r.cron) },
          { key: "on", label: t("Enabled"), render: (r) => (r.enabled ? t("On") : t("Off")) },
          { key: "last", label: t("Last sent"), render: (r) => (r.last_sent_at ? relTime(r.last_sent_at) : t("Never")) },
        ]} />
      )}
    </Gate>
  );
  const right = mode === "new" ? <Form initial={BLANK} onDone={(d) => { setMode("view"); if (d) setSel(d.id); }} />
    : mode === "edit" && cur ? <Form id={cur.id} initial={{ ...BLANK, ...cur, role: cur.role ?? "" }} onDone={() => setMode("view")} />
    : cur ? <Detail d={cur} onEdit={() => setMode("edit")} onGone={() => setSel(null)} />
    : <EmptyState heading={t("Select a digest")} body={t("Its schedule, numbers and deliveries appear here.")} />;
  return (
    <>
      <PageHeader title={t("Digests")} context={t("Scheduled summaries for roles and waves")} actions={<>
        <Button variant="primary" onClick={() => setMode("new")}>{t("New digest")}</Button>
        <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
      </>} />
      <Split left={left} right={right} leftLabel={t("Digests")} rightLabel={t("Digest detail")} />
    </>
  );
}
