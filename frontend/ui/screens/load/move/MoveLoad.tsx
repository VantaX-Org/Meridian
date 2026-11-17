"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadCleansingLog, downloadErrors, moveKeys, RUN_DONE, runAction, startRun, usePlan, useRun, type MovePlan } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, FieldChip, StatTile, type Column } from "@/ui/kit";
import { WaveProgress } from "./charts";

interface Row { key: string; wave: number; entity: string; sent: number; ok: number; failed: number; error_rate: number }

const targetName = (p?: MovePlan) => (!p ? "" : typeof p.target === "string" ? p.target : p.target.name ?? p.target.id);
const num = (n: number) => n.toLocaleString("en");

const cols = (): Column<Row>[] => [
  { key: "wave", label: t("Wave"), sort: (r) => r.wave },
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} />, sort: (r) => r.entity },
  { key: "sent", label: t("Sent"), align: "end", render: (r) => <span className="mx-num">{num(r.sent)}</span>, sort: (r) => r.sent },
  { key: "ok", label: t("Loaded"), align: "end", render: (r) => <span className="mx-num">{num(r.ok)}</span>, sort: (r) => r.ok },
  { key: "failed", label: t("Failed"), align: "end", render: (r) => <span className="mx-num">{num(r.failed)}</span>, sort: (r) => r.failed },
  { key: "error_rate", label: t("Error rate"), align: "end", render: (r) => <span className="mx-num">{`${Math.round(r.error_rate * 1000) / 10}%`}</span>, sort: (r) => r.error_rate },
];

/** Step 5: a dry run first, then the real load behind a confirm sheet. Progress is read from the run every 2 seconds. */
export function MoveLoad({ planId, runId, onRun, onBack, onNext }: { planId: string; runId: string | null; onRun: (id: string) => void; onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient();
  const plan = usePlan(planId).data;
  const run = useRun(runId);
  const r = run.data;
  const [ask, setAsk] = useState(false);
  const start = useMutation({ mutationFn: (dry: boolean) => startRun(planId, dry), onSuccess: (x) => onRun(x.id) });
  const act = useMutation({ mutationFn: (a: "stop" | "resume" | "retry-failed") => runAction(runId as string, a), onSuccess: () => qc.invalidateQueries({ queryKey: moveKeys.run(runId) }) });

  const planned: Record<string, number> = {};
  plan?.waves.forEach((w) => w.steps.forEach((s) => { planned[s.entity] = s.rows + s.history_rows; }));
  const rows: Row[] = (r?.waves ?? []).flatMap((w) => w.steps.map((s) => ({ key: `${w.wave}:${s.entity}`, wave: w.wave, ...s })));
  const failed = rows.reduce((a, x) => a + x.failed, 0);
  const done = !!r && RUN_DONE.includes(r.status);
  const live = !!r && !done;
  const dryOk = !!r && r.dry_run && r.status === "completed";
  const realOk = !!r && !r.dry_run && done;
  const name = targetName(plan);

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
            {live ? <Button onClick={() => act.mutate("stop")}>{t("Stop")}</Button> : null}
            {done && r?.status !== "completed" ? <Button onClick={() => act.mutate("resume")}>{t("Resume")}</Button> : null}
            {done && failed > 0 ? <Button onClick={() => act.mutate("retry-failed")}>{t("Retry failed")}</Button> : null}
            {runId && plan?.mode === "cleansed" ? <Button onClick={() => downloadCleansingLog(runId)}>{t("Download cleansing log (CSV)")}</Button> : null}
            {failed > 0 && runId ? <Button onClick={() => downloadErrors(runId)}>{t("Download errors (CSV)")}</Button> : null}
            {realOk ? <Button variant="primary" onClick={onNext}>{t("Reconcile")}</Button> : null}
          </div>
          {start.isError || act.isError ? <p className="mx-field-e" role="alert">{t("That did not work. Nothing was changed.")}</p> : null}
        </div>
      </Card>
      {rows.length ? <Card title={t("By entity")}><DataTable columns={cols()} rows={rows} rowKey={(x) => x.key} label={t("By entity")} /></Card> : null}
      {dryOk ? (
        <Card title={t("Dry run passed")} sub={t("Nothing has been written yet. The next button writes real data.")}>
          <div className="mx-actions"><Button variant="primary" onClick={() => setAsk(true)}>{t("Load into {name}", { name })}</Button></div>
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
