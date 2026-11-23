"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import { enterSandbox, exitSandbox, type SandboxEntered, type SandboxExited } from "@/lib/api/v2/step10";
import { refreshStep10, useSandbox } from "@/lib/v2/step10-queries";
import { relTime, whole } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, ErrorState, Skeleton, StatTile, Stepper, Toggle, useToast } from "@/ui/kit";
import { useCan } from "../common";

type Counts = Record<string, number>;
const rows = (c: Counts) => Object.entries(c).map(([table, n]) => ({ table, n }));

/** The tables a sandbox run is built from, as the backend names them. */
function CountTable({ label, counts }: { label: string; counts: Counts }) {
  const r = rows(counts);
  if (!r.length) return null;
  return (
    <DataTable label={label} rows={r} rowKey={(x) => x.table} height={200} columns={[
      { key: "table", label: t("Table"), render: (x) => x.table.replace(/_/g, " ") },
      { key: "n", label: t("Rows"), align: "end", render: (x) => whole(x.n) },
    ]} />
  );
}

/**
 * Sandbox mode: work on a copy of the latest run while every delivery (notifications, webhooks, digests, mailouts and
 * write-backs) is held back. Both ways in and out go through a confirm that says what changes. Needs manage_system.
 */
export function SandboxPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useSandbox();
  const [copy, setCopy] = useState(true);
  const [ask, setAsk] = useState<"enter" | "exit" | null>(null);
  const [result, setResult] = useState<{ kind: "enter"; r: SandboxEntered } | { kind: "exit"; r: SandboxExited } | null>(null);
  const done = () => { setAsk(null); void refreshStep10(qc, "sandbox"); };
  const enter = useMutation<SandboxEntered, Error>({
    mutationFn: () => enterSandbox(copy),
    onSuccess: (r) => { setResult({ kind: "enter", r }); toast(t("Sandbox mode is on."), "good"); done(); },
    onError: (e) => { setAsk(null); toast(errorSentence(e, t("Sandbox mode could not be switched on.")), "bad"); },
  });
  const leave = useMutation<SandboxExited, Error>({
    mutationFn: () => exitSandbox(),
    onSuccess: (r) => { setResult({ kind: "exit", r }); toast(t("Sandbox mode is off."), "good"); done(); },
    onError: (e) => { setAsk(null); toast(errorSentence(e, t("Sandbox mode could not be switched off.")), "bad"); },
  });
  const allowed = can("manage_system");
  const block = allowed ? null : t("Only a system administrator can switch sandbox mode.");
  const s = q.data;
  return (
    <div id="sandbox">
      <Card title={t("Sandbox mode")} sub={t("Try changes on a copy of the latest run. Nothing is delivered while it is on.")}>
        {q.isPending ? <Skeleton lines={3} label={t("Loading sandbox mode")} /> : q.isError || !s ? (
          <ErrorState heading={t("Sandbox mode could not be read")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />
        ) : (
          <div className="mx-col">
            <Stepper label={t("Sandbox steps")} current={s.sandbox ? 1 : 0} steps={[{ id: "enter", label: t("Switch it on") }, { id: "work", label: t("Work on the copy") }, { id: "exit", label: t("Switch it off") }]} />
            <dl className="mx-tiles">
              <StatTile label={t("Sandbox mode")} value={s.sandbox ? t("On") : t("Off")} note={s.sandbox && s.since ? t("Since {when} by {who}", { when: relTime(s.since), who: s.by ?? "" }) : undefined} />
              <StatTile label={t("Sandbox runs")} value={String(s.runs.length)} />
              <StatTile label={t("Deliveries held back")} value={whole(s.skipped_deliveries)} />
            </dl>
            {s.sandbox ? (
              <div className="mx-row">
                <Button variant="secondary" disabled={!!block} onClick={() => setAsk("exit")}>{t("Review switching it off")}</Button>
              </div>
            ) : (
              <div className="mx-row">
                <Toggle label={t("Copy the latest finished run into the sandbox")} checked={copy} onChange={setCopy} />
                <Button variant="secondary" disabled={!!block} onClick={() => setAsk("enter")}>{t("Review switching it on")}</Button>
              </div>
            )}
            {block ? <p className="mx-muted">{block}</p> : null}
            {result?.kind === "enter" ? (
              <div className="mx-col" role="status">
                <p>{result.r.sandbox_run_id ? t("Sandbox run {id} was made from run {src}.", { id: result.r.sandbox_run_id, src: result.r.source_run_id ?? "" }) : t("No run was copied. Mode is on and the next run is a sandbox run.")}</p>
                <CountTable label={t("Rows copied")} counts={result.r.copied} />
              </div>
            ) : null}
            {result?.kind === "exit" ? (
              <div className="mx-col" role="status">
                <p>{rows(result.r.discarded).length ? t("The sandbox runs were discarded.") : t("There were no sandbox runs to discard.")}</p>
                <CountTable label={t("Rows discarded")} counts={result.r.discarded} />
              </div>
            ) : null}
          </div>
        )}
      </Card>
      <Confirm open={ask === "enter"} title={t("Switch sandbox mode on?")} confirmLabel={t("Switch it on")} cancelLabel={t("Cancel")} onConfirm={() => enter.mutate()} onCancel={() => setAsk(null)}>
        {copy ? t("The latest finished run is copied into a new sandbox run. Notifications, webhooks, digests, mailouts and write-backs are held back until you switch it off.")
          : t("No run is copied. Notifications, webhooks, digests, mailouts and write-backs are held back until you switch it off.")}
      </Confirm>
      <Confirm open={ask === "exit"} danger title={t("Switch sandbox mode off?")} confirmLabel={t("Discard and switch off")} cancelLabel={t("Cancel")} onConfirm={() => leave.mutate()} onCancel={() => setAsk(null)}>
        {t("{n} sandbox runs are discarded with their findings and records. {m} held back deliveries are not sent. Real runs are not touched.", { n: s?.runs.length ?? 0, m: s?.skipped_deliveries ?? 0 })}
      </Confirm>
    </div>
  );
}
