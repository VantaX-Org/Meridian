"use client";

/**
 * Alert channels: where digests and immediate critical alerts go. Secrets
 * (webhook signing keys) are write-only; the server returns only whether one
 * is set, and the target comes back redacted to its host or address.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, EmptyState, Field, Input, SectionCard, Select, StatusBadge, TableSkeleton } from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { createAlertChannel, deleteAlertChannel, getAlertChannels, type ChannelKind, type Digest } from "@/lib/api/rule-lifecycle";

const KINDS: { value: ChannelKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "slack", label: "Slack" },
  { value: "webhook", label: "Webhook" },
];
const DIGESTS: { value: Digest; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "No digest" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<ChannelKind, string>;
const DIGEST_LABEL = Object.fromEntries(DIGESTS.map((k) => [k.value, k.label])) as Record<Digest, string>;

function targetError(kind: ChannelKind, target: string): string | undefined {
  const t = target.trim();
  if (!t) return undefined;
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? undefined : "Enter an email address.";
  return t.startsWith("https://") ? undefined : "Enter an https:// URL.";
}

export function AlertChannels() {
  const qc = useQueryClient();
  const write = useRole().can("manage_settings");
  const q = useQuery({ queryKey: ["alert-channels"], queryFn: getAlertChannels, retry: false, meta: { ignoreError: true } });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ChannelKind>("email");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<Digest>("daily");
  const [immediate, setImmediate] = useState(true);

  const refresh = () => qc.invalidateQueries({ queryKey: ["alert-channels"] });
  const add = useMutation({
    mutationFn: () => createAlertChannel({ kind, target: target.trim(), secret: secret || undefined, digest, immediate_critical: immediate }),
    onSuccess: () => { toast.success("Channel added"); setAdding(false); setTarget(""); setSecret(""); refresh(); },
    onError: (e) => toast.error(`Channel not added. ${apiErrorMessage(e)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAlertChannel(id),
    onSuccess: () => { toast.success("Channel removed"); refresh(); },
    onError: (e) => toast.error(`Channel not removed. ${apiErrorMessage(e)}`),
  });

  const tErr = targetError(kind, target);
  const sErr = secret && (secret.length < 16 || secret.length > 256) ? "A signing secret is 16 to 256 characters." : undefined;
  const silent = digest === "off" && !immediate ? "A channel with no digest must at least receive critical alerts." : undefined;
  const channels = q.data?.channels ?? [];

  return (
    <SectionCard title="Alert channels" meta={q.data ? `${channels.length} configured` : undefined}
      action={write && q.data && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add channel</Button> : null}>
      {q.isLoading ? <TableSkeleton rows={3} label="Loading channels" />
        : q.error ? <Banner tone="danger" title="Channels could not be read">{apiErrorMessage(q.error)}</Banner>
        : !q.data ? <EmptyState>Alert channels are not available on this server. Use the email and Teams fields below.</EmptyState>
        : (
          <div className="ui-stack" style={{ gap: "var(--aurora-space-4)" }}>
            {channels.length ? (
              <table className="ui-mini-table">
                <thead><tr><th>Channel</th><th>Sends to</th><th>Digest</th><th>Critical alerts</th><th>Signing secret</th><th><span className="ui-visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.id}>
                      <td>{c.kind ? KIND_LABEL[c.kind] : "—"}{c.enabled === false ? <span className="ui-micro"> (paused)</span> : null}</td>
                      <td className="ui-mono">{c.target ?? "—"}</td>
                      <td>{c.digest ? DIGEST_LABEL[c.digest] : "—"}</td>
                      <td>{c.immediate_critical ? <StatusBadge status="ok">At once</StatusBadge> : "Digest only"}</td>
                      <td>{c.kind === "email" ? "—" : c.has_secret ? "Set" : "None"}</td>
                      <td>{write ? <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>Remove</Button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !adding ? <EmptyState action={write ? <button type="button" className="ui-link-button" onClick={() => setAdding(true)}>Add a channel</button> : undefined}>
                No alert channel yet. Critical findings reach nobody until one is added.
              </EmptyState> : null}

            {adding ? (
              <form className="ui-form" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
                <div className="ui-form__grid">
                  <Field label="Channel">
                    {({ controlId }) => <Select id={controlId} options={KINDS} value={kind} onValueChange={setKind} />}
                  </Field>
                  <Field label="Digest">
                    {({ controlId }) => <Select id={controlId} options={DIGESTS} value={digest} onValueChange={setDigest} />}
                  </Field>
                </div>
                <Field label={kind === "email" ? "Email address" : "Webhook URL"} required error={tErr}>
                  {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} required minLength={3} maxLength={2048}
                    type={kind === "email" ? "email" : "url"} invalid={!!tErr} value={target} onChange={(e) => setTarget(e.target.value)} />}
                </Field>
                {kind !== "email" ? (
                  <Field label="Signing secret" error={sErr} helper="Optional. Stored encrypted and never shown again, here or anywhere else.">
                    {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="password" autoComplete="new-password"
                      invalid={!!sErr} value={secret} onChange={(e) => setSecret(e.target.value)} />}
                  </Field>
                ) : null}
                <label className="ui-check">
                  <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
                  Send critical findings at once, not only in the digest
                </label>
                {silent ? <p className="ui-micro" role="alert">{silent}</p> : null}
                <div className="ui-form__actions">
                  <Button type="submit" disabled={!target.trim() || !!tErr || !!sErr || !!silent || add.isPending}>Add channel</Button>
                  <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </form>
            ) : null}
          </div>
        )}
    </SectionCard>
  );
}
