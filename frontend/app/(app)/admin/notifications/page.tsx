"use client";

/** Admin › Notifications: outbound alert channels and the digest settings. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, DataTable, Dialog, ExplorerPage, Field, Pill, Select } from "@/design";
import {
  createAlertChannel, deleteAlertChannel, getAlertChannels, testAlertChannel,
  type AlertChannel, type AlertChannelKind, type AlertDigest,
} from "@/lib/api/notifications";
import { getSettings, saveNotificationSettings } from "@/lib/api/settings";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { usePermissions } from "@/lib/permissions";

const KINDS: { value: AlertChannelKind; label: string }[] = [
  { value: "email", label: "Email" }, { value: "slack", label: "Slack" },
  { value: "teams", label: "Teams" }, { value: "webhook", label: "Webhook" },
];
const DIGESTS: { value: AlertDigest; label: string }[] = [
  { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "off", label: "Off" },
];

function AddChannel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AlertChannelKind>("email");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const m = useMutation({
    mutationFn: () => createAlertChannel({ kind, target, digest, immediate_critical: true, ...(kind === "webhook" && secret ? { secret } : {}) }),
    onSuccess: () => { toast.success("Channel added"); void qc.invalidateQueries({ queryKey: ["alert-channels"] }); setTarget(""); setSecret(""); onOpenChange(false); },
    onError: (e) => toast.error(`Not added. ${apiErrorMessage(e)}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a channel">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Type"><Select value={kind} onValueChange={(v) => setKind(v as AlertChannelKind)} options={KINDS} /></Field>
        <Field label={kind === "email" ? "Address" : "Address or URL"}><input className="m-input" value={target} onChange={(e) => setTarget(e.target.value)} required /></Field>
        {kind === "webhook" && <Field label="Signing secret (16 to 256 characters)"><input className="m-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>}
        <Field label="Digest"><Select value={digest} onValueChange={(v) => setDigest(v as AlertDigest)} options={DIGESTS} /></Field>
        <div className="flex gap-2">
          <Button type="submit" pending={m.isPending}>Add channel</Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Keep channels as they are</Button>
        </div>
      </form>
    </Dialog>
  );
}

function DigestSettings({ canEdit }: { canEdit: boolean }) {
  const s = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [draft, setDraft] = useState<Partial<NonNullable<ReturnType<typeof initial>>>>({});
  const base = initial(s.data?.notification_config);
  const cfg = { ...base, ...draft };
  const m = useMutation({
    mutationFn: () => saveNotificationSettings(cfg),
    onSuccess: () => toast.success("Digest settings saved"),
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  const box = (key: "daily_digest" | "weekly_summary" | "monthly_report", label: string) => (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" disabled={!canEdit} checked={cfg[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <Card title="Digests">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Digest email"><input className="m-input" disabled={!canEdit} value={cfg.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
        <Field label="Teams webhook"><input className="m-input" disabled={!canEdit} value={cfg.teams_webhook} onChange={(e) => setDraft({ ...draft, teams_webhook: e.target.value })} /></Field>
        {box("daily_digest", "Daily digest")}
        {box("weekly_summary", "Weekly summary")}
        {box("monthly_report", "Monthly report")}
        {canEdit && <div><Button type="submit" pending={m.isPending}>Save digests</Button></div>}
      </form>
    </Card>
  );
}

function initial(c: { email: string; teams_webhook: string; daily_digest: boolean; weekly_summary: boolean; monthly_report: boolean } | null | undefined) {
  return c ?? { email: "", teams_webhook: "", daily_digest: false, weekly_summary: false, monthly_report: false };
}

export default function NotificationsAdminPage() {
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canEdit = has("rules", "admin");
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["alert-channels"], queryFn: getAlertChannels });
  const test = useMutation({
    mutationFn: testAlertChannel,
    onSuccess: (r) => (r.delivered ? toast.success("Test message delivered") : toast.error("The channel did not accept the test message")),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const del = useMutation({
    mutationFn: deleteAlertChannel,
    onSuccess: () => { toast.success("Channel removed"); void qc.invalidateQueries({ queryKey: ["alert-channels"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const columns: ColumnDef<AlertChannel>[] = [
    { accessorKey: "kind", header: "Type" },
    { accessorKey: "target", header: "Target" },
    { accessorKey: "digest", header: "Digest" },
    { id: "crit", header: "Critical alerts", cell: ({ row }) => (row.original.immediate_critical ? "Sent at once" : "In digest") },
    { id: "on", header: "Status", cell: ({ row }) => <Pill tone={row.original.enabled ? "go" : "at-risk"}>{row.original.enabled ? "On" : "Off"}</Pill> },
    ...(canEdit ? [{
      id: "act", header: "",
      cell: ({ row }: { row: { original: AlertChannel } }) => (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => test.mutate(row.original.id)}>Send test</Button>
          <Button variant="secondary" onClick={() => del.mutate(row.original.id)}>Remove</Button>
        </div>
      ),
    } satisfies ColumnDef<AlertChannel>] : []),
  ];
  const items = q.data ?? [];
  return (
    <>
      <ExplorerPage
        toolbarEnd={canEdit ? <Button onClick={() => setAdding(true)}>Add channel</Button> : undefined}
        summary={<DigestSettings canEdit={canEdit} />}
        state={q.isLoading ? "loading" : isListFailure(q) ? "error" : items.length === 0 ? "empty" : undefined}
        emptyProps={{ title: "No alert channels.", detail: "Add email, Slack, Teams or a webhook to send critical alerts and digests." }}
        errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
        table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
      />
      <AddChannel open={adding} onOpenChange={setAdding} />
    </>
  );
}
