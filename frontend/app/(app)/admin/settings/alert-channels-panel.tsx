"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, EmptyState, Field, Input, Notice, Pill, Select, Async } from "@/design";
import {
  createAlertChannel, deleteAlertChannel, getAlertChannels, testAlertChannel,
  type AlertChannel, type AlertChannelKind, type AlertDigest,
} from "@/lib/api/notifications";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const KIND_LABEL: Record<AlertChannelKind, string> = {
  slack: "Slack", teams: "Microsoft Teams", webhook: "Webhook (signed)", email: "Email",
};
const DIGEST_LABEL: Record<AlertDigest, string> = { daily: "Daily digest", weekly: "Weekly digest", off: "No digest" };
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const DIGEST_OPTIONS = Object.entries(DIGEST_LABEL).map(([value, label]) => ({ value, label }));
const isKind = (v: string): v is AlertChannelKind => Object.hasOwn(KIND_LABEL, v);
const isDigest = (v: string): v is AlertDigest => Object.hasOwn(DIGEST_LABEL, v);

/** Where data-quality alerts go: per-system score drops, new critical rules, SLA breaches. */
export function AlertChannelsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.alertChannels(), queryFn: getAlertChannels });
  const [kind, setKind] = useState<AlertChannelKind>("slack");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const [immediate, setImmediate] = useState(false);
  const targetRef = useRef<HTMLDivElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.alertChannels() });
  const fail = (fallback: string) => (e: unknown) => toast.error(apiErrorMessage(e) || fallback);

  const create = useMutation({
    mutationFn: () => createAlertChannel({
      kind, target: target.trim(), secret: kind === "webhook" && secret ? secret : undefined,
      digest, immediate_critical: immediate,
    }),
    onSuccess: () => { setTarget(""); setSecret(""); toast("Channel added"); refresh(); },
    onError: fail("The channel could not be added"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAlertChannel(id),
    onSuccess: () => { setConfirmId(null); refresh(); },
    onError: (e: unknown) => { setConfirmId(null); fail("The channel could not be removed")(e); },
  });
  const test = useMutation({
    mutationFn: (id: string) => testAlertChannel(id),
    onSuccess: (r) => (r.delivered
      ? toast("Test alert delivered")
      : toast.error("The test alert was not delivered, check the target and secret")),
    onError: fail("The test alert could not be sent"),
  });

  const columns: ColumnDef<AlertChannel, unknown>[] = [
    { id: "kind", header: "Kind", cell: ({ row }) => KIND_LABEL[row.original.kind] },
    { id: "target", header: "Target", cell: ({ row }) => row.original.target },
    { id: "digest", header: "Digest", cell: ({ row }) => DIGEST_LABEL[row.original.digest] },
    { id: "crit", header: "Critical findings", cell: ({ row }) => (row.original.immediate_critical ? <Pill tone="go">Immediate</Pill> : <Pill tone="neutral">In digest</Pill>) },
    {
      id: "act", header: "",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <span className="flex gap-2 justify-end">
            <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(c.id)}>Send test</Button>
            {confirmId === c.id ? (
              <>
                <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>Confirm remove</Button>
                <Button variant="ghost" onClick={() => setConfirmId(null)}>Keep channel</Button>
              </>
            ) : (
              <Button variant="ghost" disabled={remove.isPending} onClick={() => setConfirmId(c.id)}>Remove</Button>
            )}
          </span>
        );
      },
    },
  ];

  const secretTooShort = kind === "webhook" && secret.length > 0 && secret.length < 16;
  const neverFires = digest === "off" && !immediate;
  const canAdd = target.trim().length >= 3 && !secretTooShort && !neverFires && !create.isPending;

  return (
    <Card title="Alert channels" meta="Each system is compared with its own previous run. Alerts carry counts, rule ids and links, never record values">
      <div className="flex flex-col gap-3">
        <Async query={q} skeleton={64} notFoundIsEmpty>{!q.data?.length ? (
          <EmptyState title="No alert channel yet" detail="Add Slack, Teams, email or a signed webhook below" action={<Button onClick={() => targetRef.current?.querySelector("input")?.focus()}>Add channel</Button>} />
        ) : (
          <DataTable columns={columns} data={q.data} getRowId={(c) => c.id} />
        )}</Async>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Kind">
            <Select options={KIND_OPTIONS} value={kind} onValueChange={(v) => { if (isKind(v)) setKind(v); }} />
          </Field>
          <div ref={targetRef}><Field label="Target">
            <Input
              placeholder={kind === "email" ? "team@example.com" : "https://"} value={target}
              onChange={(e) => setTarget(e.target.value)} />
          </Field></div>
          {kind === "webhook" ? (
            <Field label="Signing secret" error={secretTooShort ? "At least 16 characters" : undefined}>
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Digest">
            <Select options={DIGEST_OPTIONS} value={digest} onValueChange={(v) => { if (isDigest(v)) setDigest(v); }} />
          </Field>
          <label className="flex items-center gap-2 m-text-body">
            <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
            Send new critical findings immediately
          </label>
          <Button disabled={!canAdd} onClick={() => create.mutate()}>Add channel</Button>
        </div>
        {neverFires ? <Notice tone="warning">Choose a digest or immediate delivery</Notice> : null}
      </div>
    </Card>
  );
}
