"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { splitScope, type SplitScope } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, FieldChip, Sheet, Skeleton, Stepper, useToast } from "@/ui/kit";
import { useCan } from "@/ui/screens/orphans/useCan";

type Capped = { table: string; rows: number | null; source_rows: number | null };
const n0 = (n: number | null) => (n === null ? "-" : n.toLocaleString());
const scopeText = (s: SplitScope["scopes"][number]) =>
  Object.entries(s).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ");

function Body({ systemId, versionId, capped, onClose }: { systemId: string; versionId: string; capped: Capped[]; onClose: () => void }) {
  const fx = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan()("trigger_sync");
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<SplitScope | null>(null);
  const q = useQuery({ queryKey: ["next", "run", fx, "split-scope", systemId, versionId], queryFn: () => splitScope(systemId, versionId, false), retry: false, staleTime: 0 });
  const steps = [{ id: "find", label: t("Find the capped tables") }, { id: "check", label: t("Check the split") }, { id: "queue", label: t("Queue the downloads") }];

  if (q.isLoading) return <Skeleton lines={5} label={t("Working out the split")} />;
  if (q.isError || !q.data) return <ErrorState heading={t("The scope cannot be split")} body={errorSentence(q.error, t("This run has no scope that can be split."))} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const p = q.data;
  if (queued?.downloads) {
    return (
      <div className="mx-col">
        <Stepper steps={steps} current={2} label={t("Split the scope")} />
        <p>{t("{n} downloads are queued. Each one reads its own scope and is analysed when it finishes.", { n: String(queued.downloads.length) })}</p>
        <DataTable label={t("Queued downloads")} rows={queued.downloads} rowKey={(d) => d.job_id} columns={[
          { key: "job", label: t("Job"), render: (d) => d.job_id },
          { key: "ver", label: t("Run"), render: (d) => d.version_id },
        ]} />
        <Button onClick={onClose}>{t("Done")}</Button>
      </div>
    );
  }
  if (p.scopes.length === 0) return <EmptyState heading={t("Nothing to split")} body={t("No smaller scope was found for this run.")} />;
  const go = async () => {
    setBusy(true);
    try { setQueued(await splitScope(systemId, versionId, true)); setAsk(false); toast(t("Downloads queued"), "good"); void qc.invalidateQueries({ queryKey: ["next"] }); }
    catch (e) { setAsk(false); toast(errorSentence(e, t("The downloads could not be queued. Nothing was read.")), "bad"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-col">
      <Stepper steps={steps} current={1} label={t("Split the scope")} />
      <p className="mx-muted">{t("The read hit the row cap, so part of these tables was not scored. The scope is split by {by}.", { by: p.split_by })}</p>
      <DataTable label={t("Capped tables")} rows={capped.filter((c) => p.tables.includes(c.table))} rowKey={(c) => c.table} columns={[
        { key: "table", label: t("Table"), render: (c) => <FieldChip code={c.table} /> },
        { key: "rows", label: t("Rows read"), align: "end", render: (c) => n0(c.rows) },
        { key: "src", label: t("Rows in scope"), align: "end", render: (c) => n0(c.source_rows) },
      ]} />
      <DataTable label={t("New scopes")} rows={p.scopes.map((s, i) => ({ i, text: scopeText(s) }))} rowKey={(r) => String(r.i)} columns={[
        { key: "n", label: t("Download"), render: (r) => t("{i} of {n}", { i: String(r.i + 1), n: String(p.scopes.length) }) },
        { key: "s", label: t("Scope"), render: (r) => r.text },
      ]} />
      {can ? null : <p className="mx-muted">{t("You need the sync permission to queue downloads.")}</p>}
      <Button disabled={!can || busy} title={can ? undefined : t("You need the sync permission to queue downloads.")} onClick={() => setAsk(true)}>{t("Queue the downloads")}</Button>
      <Confirm open={ask} title={t("Read {n} scopes from SAP?", { n: String(p.scopes.length) })} confirmLabel={t("Queue {n} downloads", { n: String(p.scopes.length) })} cancelLabel={t("Cancel")} onConfirm={() => void go()} onCancel={() => setAsk(false)}>
        {t("This reads {tables} from SAP once for each of the {n} scopes, and analyses each result as its own run. It does not change this run or any SAP data.", { tables: p.tables.join(", "), n: String(p.scopes.length) })}
      </Confirm>
    </div>
  );
}

/** A run whose read hit the row cap: split its scope into smaller ones, check them, then queue one download each. */
export function SplitCapped({ systemId, versionId, capped }: { systemId: string; versionId: string; capped: Capped[] }) {
  const [open, setOpen] = useState(false);
  if (!capped.length || !systemId) return null;
  return (
    <Card title={t("Part of this run was not read")} sub={t("{n} tables hit the row cap: {tables}.", { n: String(capped.length), tables: capped.map((c) => c.table).join(", ") })}>
      <Button variant="secondary" onClick={() => setOpen(true)}>{t("Split the scope")}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} label={t("Split the scope")} closeLabel={t("Close")}>
        {open ? <Body systemId={systemId} versionId={versionId} capped={capped} onClose={() => setOpen(false)} /> : null}
      </Sheet>
    </Card>
  );
}
