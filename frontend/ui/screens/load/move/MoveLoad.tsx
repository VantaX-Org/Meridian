"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { apiDetail, downloadCleansingLog, downloadErrors, moveKeys, RUN_DONE, runAction, startRun, usePlan, useRun, type RunCleansing, type Unfixable } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, FieldChip, StatTile, type Column } from "@/ui/kit";
import { WaveProgress } from "./charts";
import { displayKey } from "@/lib/v2/work";

interface Row { key: string; wave: number; entity: string; sent: number; ok: number; failed: number; error_rate: number }

const num = (n: number) => n.toLocaleString("en");

const cols = (): Column<Row>[] => [
  { key: "wave", label: t("Wave"), sort: (r) => r.wave },
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} />, sort: (r) => r.entity },
  { key: "sent", label: t("Sent"), align: "end", render: (r) => <span className="mx-num">{num(r.sent)}</span>, sort: (r) => r.sent },
  { key: "ok", label: t("Loaded"), align: "end", render: (r) => <span className="mx-num">{num(r.ok)}</span>, sort: (r) => r.ok },
  { key: "failed", label: t("Failed"), align: "end", render: (r) => <span className="mx-num">{num(r.failed)}</span>, sort: (r) => r.failed },
  { key: "error_rate", label: t("Error rate"), align: "end", render: (r) => <span className="mx-num">{`${Math.round(r.error_rate * 1000) / 10}%`}</span>, sort: (r) => r.error_rate },
];

const unfixCols = (): Column<Unfixable & { k: string }>[] => [
  { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.rule} description={r.reason} />, sort: (r) => r.rule },
  { key: "field", label: t("Field"), render: (r) => <FieldChip code={r.field} /> },
  { key: "record_key", label: t("Record"), render: (r) => <span className="mx-num">{displayKey(r.record_key)}</span> },
  { key: "current_value", label: t("Value loaded"), render: (r) => r.current_value ?? t("empty") },
];

function RunCleansingCard({ c }: { c: RunCleansing }) {
  const fixed = Object.values(c.summary?.cells_fixed_per_rule ?? {}).reduce((a, n) => a + n, 0);
  const left = (c.unfixable ?? []).map((u, i) => ({ ...u, k: `${i}` }));
  return (
    <Card title={t("Cleaned in this run")} sub={t("Every rule fix was applied. Records that could not be fixed loaded with their current value.")}>
      <div className="mx-col">
        <dl className="mx-tiles">
          <StatTile label={t("Cells fixed")} value={num(fixed)} />
          <StatTile label={t("Could not be fixed")} value={num(left.length)} />
        </dl>
        {left.length ? <DataTable columns={unfixCols()} rows={left.slice(0, 50)} rowKey={(r) => r.k} label={t("Could not be fixed")} /> : null}
      </div>
    </Card>
  );
}

/** Step 5: a dry run first, then the real load behind a confirm sheet. Progress is read from the run every 2 seconds. */
export function MoveLoad({ planId, runId, onRun, onBack, onNext }: { planId: string; runId: string | null; onRun: (id: string) => void; onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient();
  const plan = usePlan(planId).data;
  const systems = useQuery({ queryKey: moveKeys.systems, queryFn: getSystemsExtended }).data ?? [];
  const run = useRun(runId);
  const r = run.data;
  const [ask, setAsk] = useState(false);
  const start = useMutation({ mutationFn: (dry: boolean) => startRun(planId, dry), onSuccess: (x) => onRun(x.id) });
  const act = useMutation({ mutationFn: (a: "stop" | "resume" | "retry-failed") => runAction(runId as string, a), onSuccess: () => qc.invalidateQueries({ queryKey: moveKeys.run(runId) }) });

  const planned: Record<string, number> = {};
  plan?.waves.forEach((w) => w.steps.forEach((s) => { planned[s.entity] = s.rows + s.history_rows; }));
  const live0 = !!r && !RUN_DONE.includes(r.status);
  const rows: Row[] = live0 && r?.progress?.length ? r.progress.map((s) => ({ key: s.entity, wave: 0, ...s })) : (r?.waves ?? []).flatMap((w) => w.steps.map((s) => ({ key: `${w.wave}:${s.entity}`, wave: w.wave, ...s })));
  const failed = rows.reduce((a, x) => a + x.failed, 0);
  const done = !!r && RUN_DONE.includes(r.status);
  const live = !!r && !done;
  const dryOk = !!r && r.dry_run && r.status === "completed";
  const realOk = !!r && !r.dry_run && done;
  const stopping = r?.status === "stopping";
  const name = systems.find((x) => x.id === plan?.target)?.name ?? plan?.target ?? "";
  const [dlErr, setDlErr] = useState<unknown>(null);
  const [dlBusy, setDlBusy] = useState(false);
  const dl = (p: Promise<unknown>) => { setDlErr(null); setDlBusy(true); p.catch(setDlErr).finally(() => setDlBusy(false)); };
  const err = start.error ?? act.error ?? dlErr;

  return (
    <div className="mx-col">
      <Card title={r ? (r.dry_run ? t("Dry run") : t("Load into {name}", { name })) : t("Start with a dry run")} sub={r ? t("Status: {status}", { status: r.status }) : t("A dry run goes through every step and writes nothing to {name}.", { name })}>
        <div className="mx-col">
          {r ? (
            <>
              <dl className="mx-tiles">
                <StatTile label={t("Loaded")} value={num(rows.reduce((a, x) => a + x.ok, 0))} />
                <StatTile label={t("Failed")} value={num(failed)} />
                <StatTile label={t("Sent")} value={num(rows.reduce((a, x) => a + x.sent, 0))} />
              </dl>
              <WaveProgress waves={r.waves} planned={planned} label={t("Progress by wave")} />
            </>
          ) : null}
          <div className="mx-actions">
            <Button onClick={onBack} disabled={live}>{t("Back")}</Button>
            {!r || (done && !realOk && !dryOk) ? <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate(true)}>{t("Run a dry run")}</Button> : null}
            {live ? <Button disabled={stopping || act.isPending} onClick={() => act.mutate("stop")}>{stopping ? t("Stopping after this batch") : t("Stop")}</Button> : null}
            {done && r?.status !== "completed" ? <Button disabled={act.isPending} onClick={() => act.mutate("resume")}>{t("Resume")}</Button> : null}
            {done && failed > 0 ? <Button disabled={act.isPending} onClick={() => act.mutate("retry-failed")}>{t("Retry failed")}</Button> : null}
            {runId && plan?.mode === "cleansed" ? <Button disabled={dlBusy} onClick={() => dl(downloadCleansingLog(runId))}>{t("Download cleansing log (CSV)")}</Button> : null}
            {failed > 0 && runId ? <Button disabled={dlBusy} onClick={() => dl(downloadErrors(runId))}>{t("Download errors (CSV)")}</Button> : null}
            {realOk ? <Button variant="primary" onClick={onNext}>{t("Reconcile")}</Button> : null}
          </div>
          {err ? <p className="mx-field-e" role="alert">{apiDetail(err) ?? t("That did not work. Nothing was changed.")}</p> : null}
        </div>
      </Card>
      {rows.length ? <Card title={t("By entity")}><DataTable columns={cols()} rows={rows} rowKey={(x) => x.key} label={t("By entity")} /></Card> : null}
      {r?.cleansing ? <RunCleansingCard c={r.cleansing} /> : null}
      {dryOk ? (
        <Card title={t("Dry run passed")} sub={t("Nothing has been written yet. The next button writes real data.")}>
          <div className="mx-actions"><Button variant="primary" disabled={start.isPending} onClick={() => setAsk(true)}>{t("Load into {name}", { name })}</Button></div>
        </Card>
      ) : null}
      <Confirm
        open={ask}
        danger
        title={t("Load into {name}?", { name })}
        confirmLabel={t("Load into {name}", { name })}
        cancelLabel={t("Cancel")}
        onCancel={() => setAsk(false)}
        onConfirm={() => { setAsk(false); start.mutate(false); }}
      >
        <p>{t("This writes real data into {name}. You can stop the load, but rows already written stay there.", { name })}</p>
      </Confirm>
    </div>
  );
}
