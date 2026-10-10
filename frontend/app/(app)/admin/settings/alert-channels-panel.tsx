"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, EmptyState, ErrorState, Field, Pill, Select, Skeleton } from "@/design";
import {
  createAlertChannel, deleteAlertChannel, getAlertChannels, testAlertChannel,
  type AlertChannelKind, type AlertDigest,
} from "@/lib/api/notifications";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const th = "px-3 py-2 text-left font-medium";
const thStyle = { color: "var(--m-ink-3)" };
const td = "px-3 py-1.5 border-t";
const tdStyle = { borderColor: "var(--m-line)" };

const KIND_LABEL: Record<AlertChannelKind, string> = {
  slack: "Slack", teams: "Microsoft Teams", webhook: "Webhook (signed)", email: "Email",
};
const DIGEST_LABEL: Record<AlertDigest, string> = { daily: "Daily digest", weekly: "Weekly digest", off: "No digest" };
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const DIGEST_OPTIONS = Object.entries(DIGEST_LABEL).map(([value, label]) => ({ value, label }));
const isKind = (v: string): v is AlertChannelKind => v in KIND_LABEL;
const isDigest = (v: string): v is AlertDigest => v in DIGEST_LABEL;

/** Where data-quality alerts go: per-system score drops, new critical rules, SLA breaches. */
export function AlertChannelsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.alertChannels(), queryFn: getAlertChannels });
  const [kind, setKind] = useState<AlertChannelKind>("slack");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const [immediate, setImmediate] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.alertChannels() });
  const fail = (fallback: string) => (e: unknown) => toast.error(apiErrorMessage(e) || fallback);

  const create = useMutation({
    mutationFn: () => createAlertChannel({
      kind, target: target.trim(), secret: kind === "webhook" && secret ? secret : undefined,
      digest, immediate_critical: immediate,
    }),
    onSuccess: () => { setTarget(""); setSecret(""); toast("Channel added"); refresh(); },
    onError: fail("The channel could not be added."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAlertChannel(id),
    onSuccess: () => { setConfirmId(null); refresh(); },
    onError: (e: unknown) => { setConfirmId(null); fail("The channel could not be removed.")(e); },
  });
  const test = useMutation({
    mutationFn: (id: string) => testAlertChannel(id),
    onSuccess: (r) => (r.delivered
      ? toast("Test alert delivered")
      : toast.error("The test alert was not delivered. Check the target and secret.")),
    onError: fail("The test alert could not be sent."),
  });

  const secretTooShort = kind === "webhook" && secret.length > 0 && secret.length < 16;
  const neverFires = digest === "off" && !immediate;
  const canAdd = target.trim().length >= 3 && !secretTooShort && !neverFires && !create.isPending;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold">Alert channels</h2>
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Each system is compared with its own previous run. Alerts carry counts, rule ids and links, never record values.
      </p>
      {q.isLoading ? <Skeleton height={64} /> : isListFailure(q) ? (
        <ErrorState message={apiErrorMessage(q.error) || "Alert channels could not be read."} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No alert channel yet." />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={th} style={thStyle}>Kind</th><th className={th} style={thStyle}>Target</th>
              <th className={th} style={thStyle}>Digest</th><th className={th} style={thStyle}>Critical findings</th>
              <th className={th} style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {q.data.map((c) => (
              <tr key={c.id}>
                <td className={td} style={tdStyle}>{KIND_LABEL[c.kind]}</td>
                <td className={td} style={tdStyle}>{c.target}</td>
                <td className={td} style={tdStyle}>{DIGEST_LABEL[c.digest]}</td>
                <td className={td} style={tdStyle}>
                  {c.immediate_critical ? <Pill tone="go">Immediate</Pill> : <Pill tone="neutral">In digest</Pill>}
                </td>
                <td className={td} style={tdStyle}>
                  <span className="flex gap-2 justify-end">
                    <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(c.id)}>Send test</Button>
                    {confirmId === c.id ? (
                      <>
                        <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>
                          Confirm remove
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmId(null)}>Keep channel</Button>
                      </>
                    ) : (
                      <Button variant="ghost" disabled={remove.isPending} onClick={() => setConfirmId(c.id)}>Remove</Button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="rounded border p-3 flex flex-wrap items-end gap-3" style={{ borderColor: "var(--m-line)" }}>
        <Field label="Kind">
          <Select options={KIND_OPTIONS} value={kind} onValueChange={(v) => { if (isKind(v)) setKind(v); }} />
        </Field>
        <Field label="Target" error={undefined}>
          <input className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
            placeholder={kind === "email" ? "team@example.com" : "https://"} value={target}
            onChange={(e) => setTarget(e.target.value)} />
        </Field>
        {kind === "webhook" ? (
          <Field label="Signing secret" error={secretTooShort ? "At least 16 characters" : undefined}>
            <input type="password" className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
              value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Digest">
          <Select options={DIGEST_OPTIONS} value={digest} onValueChange={(v) => { if (isDigest(v)) setDigest(v); }} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
          Send new critical findings immediately
        </label>
        <Button disabled={!canAdd} onClick={() => create.mutate()}>Add channel</Button>
        {neverFires ? (
          <span className="text-[12px]" style={{ color: "var(--m-critical)" }}>Choose a digest or immediate delivery.</span>
        ) : null}
      </div>
    </section>
  );
}
