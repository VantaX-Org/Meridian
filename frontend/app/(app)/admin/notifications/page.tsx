"use client";

/** Admin › Notifications: outbound alert channels. Digest email and schedule live in Rules › Scoring. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, Dialog, ExplorerPage, Field, Menu, PageHeader, Pill, Select, Input, asyncStateOf } from "@/design";
import {
  createAlertChannel, deleteAlertChannel, getAlertChannels, testAlertChannel, updateAlertChannel,
  type AlertChannel, type AlertChannelKind, type AlertDigest, type AlertReportPack,
} from "@/lib/api/notifications";
import { actionColumn } from "@/components/mdm/ledger";
import { apiErrorMessage } from "@/lib/error";
import { usePermissions } from "@/lib/permissions";
import { email, length, oneOf, pattern, required, url, useFormErrors, type Schema } from "@/lib/forms";

const KINDS: { value: AlertChannelKind; label: string }[] = [
  { value: "email", label: "Email" }, { value: "slack", label: "Slack" },
  { value: "teams", label: "Teams" }, { value: "webhook", label: "Webhook" },
];
const DIGESTS: { value: AlertDigest; label: string }[] = [
  { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "off", label: "Off" },
];

const REPORT_PACKS: { value: AlertReportPack; label: string }[] = [
  { value: "off", label: "Board pack: off" }, { value: "weekly", label: "Board pack: weekly" },
  { value: "monthly", label: "Board pack: monthly" },
];

function AddChannel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AlertChannelKind>("email");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const [reportPack, setReportPack] = useState<AlertReportPack>("off");
  const values = { kind, target, secret, digest, reportPack };
  const schema = useMemo<Schema<typeof values>>(() => ({
    kind: oneOf(KINDS.map((k) => k.value)),
    target: kind === "email"
      ? [required("Enter an email address"), email()]
      : [required("Enter an https:// URL"), url(), pattern(/^https:\/\//i, "Enter an https:// URL")],
    secret: kind === "webhook" ? length(16, 256, "Use 16 to 256 characters") : undefined,
    digest: oneOf(DIGESTS.map((d) => d.value)),
    reportPack: oneOf(REPORT_PACKS.map((r) => r.value)),
  }), [kind]);
  const form = useFormErrors(schema, values);
  const m = useMutation({
    mutationFn: () => createAlertChannel({
      kind, target, digest, immediate_critical: true,
      ...(kind === "email" && reportPack !== "off" ? { report_pack: reportPack } : {}),
      ...(kind === "webhook" && secret ? { secret } : {}),
    }),
    onSuccess: () => { toast.success("Channel added"); void qc.invalidateQueries({ queryKey: ["alert-channels"] }); setTarget(""); setSecret(""); onOpenChange(false); },
    onError: (e) => toast.error(`Not added. ${apiErrorMessage(e)}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a channel">
      <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (form.valid) m.mutate(); }}>
        <Field label="Type"><Select value={kind} onValueChange={(v) => setKind(v as AlertChannelKind)} options={KINDS} /></Field>
        <Field label={kind === "email" ? "Address" : "URL"} error={form.error("target")}><Input type={kind === "email" ? "email" : "url"} value={target} onChange={(e) => setTarget(e.target.value)} onBlur={() => form.blur("target")} /></Field>
        {kind === "webhook" && <Field label="Signing secret (16 to 256 characters)" error={form.error("secret")}><Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} onBlur={() => form.blur("secret")} /></Field>}
        <Field label="Digest"><Select value={digest} onValueChange={(v) => setDigest(v as AlertDigest)} options={DIGESTS} /></Field>
        {kind === "email" && <Field label="Board pack"><Select value={reportPack} onValueChange={(v) => setReportPack(v as AlertReportPack)} options={REPORT_PACKS} /></Field>}
        <div className="flex gap-2">
          <Button type="submit" pending={m.isPending} disabled={!form.valid}>Add channel</Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function NotificationsAdminPage() {
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canEdit = has("rules", "admin");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AlertChannel | null>(null);
  const q = useQuery({ queryKey: ["alert-channels"], queryFn: getAlertChannels });
  const test = useMutation({
    mutationFn: testAlertChannel,
    onSuccess: (r) => (r.delivered ? toast.success("Test message delivered") : toast.error("The channel did not accept the test message")),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const setPack = useMutation({
    mutationFn: ({ id, report_pack }: { id: string; report_pack: AlertReportPack }) => updateAlertChannel(id, { report_pack }),
    onSuccess: () => { toast.success("Board pack setting saved"); void qc.invalidateQueries({ queryKey: ["alert-channels"] }); },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  const del = useMutation({
    mutationFn: deleteAlertChannel,
    onSuccess: () => { toast.success("Channel removed"); void qc.invalidateQueries({ queryKey: ["alert-channels"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const columns: ColumnDef<AlertChannel>[] = [
    { accessorKey: "kind", header: "Type", cell: ({ row }) => KINDS.find((k) => k.value === row.original.kind)?.label ?? row.original.kind },
    { accessorKey: "target", header: "Sends to" },
    { accessorKey: "digest", header: "Digest", cell: ({ row }) => DIGESTS.find((d) => d.value === row.original.digest)?.label ?? row.original.digest },
    {
      id: "pack", header: "Board pack",
      cell: ({ row }) => {
        const c = row.original;
        if (c.kind !== "email") return <span className="m-ink-3">Email only</span>;
        const pack = c.report_pack ?? "off";
        if (!canEdit) return REPORT_PACKS.find((r) => r.value === pack)?.label ?? "Board pack: off";
        return (
          <Select
            label={`Board pack for ${c.target}`}
            value={pack}
            onValueChange={(v) => setPack.mutate({ id: c.id, report_pack: v as AlertReportPack })}
            options={REPORT_PACKS}
          />
        );
      },
    },
    { id: "crit", header: "Critical alerts", cell: ({ row }) => (row.original.immediate_critical ? "Sent at once" : "In digest") },
    { id: "on", header: "Status", cell: ({ row }) => <Pill tone={row.original.enabled ? "go" : "at-risk"}>{row.original.enabled ? "On" : "Off"}</Pill> },
    ...(canEdit ? [actionColumn<AlertChannel>((c) => (
      <Menu
        trigger={<button type="button" aria-label={`Actions for ${c.kind} channel`} className="m-text-body font-medium m-ink-accent-ink hover:underline">Manage</button>}
        items={[
          { label: "Send test", onSelect: () => test.mutate(c.id) },
          { label: "Remove", onSelect: () => setRemoving(c) },
        ]}
      />
    ))] : []),
  ];
  const items = q.data ?? [];
  return (
    <>
      <ExplorerPage
        header={<PageHeader title="Notifications" meta="Where Meridian sends alerts and digests outside the app: email, Slack, Teams or a webhook. Add a channel, then send it a test" actions={canEdit ? <Button onClick={() => setAdding(true)}>Add channel</Button> : undefined} />}
        summary={<p className="m-text-body m-ink-3">Digest email and the report schedule are set in <Link className="underline" href="/rules/scoring">Rules › Scoring</Link>. A board pack channel gets the board pack and the analyst workbook for the latest finished run: weekly on Monday mornings, or monthly on the 1st.</p>}
        state={asyncStateOf(q, () => items.length === 0, true)}
        emptyProps={{ title: "No alert channels", detail: "Add email, Slack, Teams or a webhook to send critical alerts and digests.", action: canEdit ? <Button onClick={() => setAdding(true)}>Add channel</Button> : undefined }}
        errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
        table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
      />
      <AddChannel open={adding} onOpenChange={setAdding} />
      <Dialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null); }} title={`Remove ${removing?.kind ?? ""} channel?`} destructive>
        <p className="m-text-body">{removing?.target} stops receiving alerts and digests.</p>
        <div className="mt-4 flex gap-2">
          <Button pending={del.isPending} onClick={() => removing && del.mutate(removing.id, { onSettled: () => setRemoving(null) })}>Remove channel</Button>
          <Button variant="secondary" onClick={() => setRemoving(null)}>Keep channel</Button>
        </div>
      </Dialog>
    </>
  );
}
