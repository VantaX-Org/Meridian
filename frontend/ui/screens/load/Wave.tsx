"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { gapText } from "@/lib/v2/labels";
import { errorSentence } from "@/lib/api/v2/client";
import { deleteWave, downloadWaveReport, draftBlockerFixBatch, runWave, signOffWave, updateWave } from "@/lib/api/v2/reports";
import type { WaveBlocker, WaveObject } from "@/types/api";
import { Button, Card, Confirm, DataTable, EmptyState, Field, FieldChip, Input, PageHeader, StatTile, TrendArea, useAletheiaScope, useToast } from "@/ui/kit";
import { AskButton, Gate, humanize, pct, useHref, Verdict, when } from "./common";
import { invalidateLoad, useCockpit } from "./hooks";

const STATUS_FORECAST = (s: string): string => (s === "passing" ? t("Passing now") : s === "projected" ? t("On track") : s === "not_converging" ? t("Not converging") : t("Not enough runs"));

/** One wave: readiness verdict, per object source / projected / actual target DQS with reasons, trend, blockers and sign-off. */
export function Wave({ id }: { id: string }) {
  useInterfaceLang();
  const q = useCockpit(id);
  const href = useHref();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [min, setMin] = useState("");
  const c = q.data;
  const done = () => invalidateLoad(qc);
  const sign = useMutation({ mutationFn: () => signOffWave(id), onSuccess: () => { toast(t("Wave signed off"), "good"); done(); }, onError: () => toast(t("The wave is not a go yet, so it cannot be signed off"), "bad") });
  const [busy, setBusy] = useState<string | null>(null);
  const dl = (fmt: "xlsx" | "pdf") => { setBusy(fmt); downloadWaveReport(id, fmt).catch((e) => toast(errorSentence(e, t("That did not work. Try again.")), "bad")).finally(() => setBusy(null)); };
  const run = useMutation({ mutationFn: () => runWave(id), onSuccess: () => { toast(t("Wave analysis started"), "good"); done(); }, onError: () => toast(t("The wave analysis could not start"), "bad") });
  const patch = useMutation({ mutationFn: () => updateWave(id, { min_readiness: Number(min) }), onSuccess: () => { toast(t("Threshold saved"), "good"); done(); }, onError: () => toast(t("The threshold could not be saved"), "bad") });
  const del = useMutation({ mutationFn: () => deleteWave(id), onSuccess: () => { toast(t("Wave deleted"), "good"); window.location.assign(href("/load/waves")); }, onError: () => toast(t("The wave could not be deleted"), "bad") });
  const fix = useMutation({ mutationFn: (b: WaveBlocker) => draftBlockerFixBatch(id, { module: b.module, gap_type: b.gap_type, field: b.field }), onSuccess: (d) => toast(t("Fix batch drafted with {n} items", { n: d.items }), "good"), onError: () => toast(t("The fix batch could not be drafted"), "bad") });
  const objects = c?.objects ?? [];

  useAletheiaScope({
    key: `load/wave/${id}`,
    label: t("Asking about {wave}", { wave: c?.wave.name ?? id }),
    suggestions: [t("What blocks this wave?"), t("Why does target DQS differ from source DQS?")],
    answer: () => {
      const bl = c?.blockers ?? [];
      return bl.length
        ? { text: t("{n} blockers hold this wave back.", { n: bl.length }), evidence: bl.map((b) => `${b.module} ${b.field}: ${b.records}`) }
        : { text: t("No blocker holds this wave back."), evidence: [] };
    },
  });

  const dqs = (n: number | null | undefined) => (n === null || n === undefined ? t("Not analysed") : pct(n));

  return (
    <>
      <PageHeader
        title={c?.wave.name ?? t("Wave")}
        context={t("Readiness of every object in the wave against the target system.")}
        actions={<>
          <Button variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>{t("Run wave analysis")}</Button>
          <Button variant="secondary" disabled={sign.isPending || c?.verdict !== "go"} onClick={() => sign.mutate()}>{t("Sign off")}</Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => dl("xlsx")}>{t("Download Excel")}</Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => dl("pdf")}>{t("Download PDF")}</Button>
          <Button variant="ghost" onClick={() => setConfirm(true)}>{t("Delete wave")}</Button>
          <AskButton />
        </>}
      />
      <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the wave")}>
        {c ? (
          <div className="mx-col">
            <dl className="mx-tiles">
              <StatTile label={t("Verdict")} value={<Verdict v={c.verdict} />} />
              <StatTile label={t("Readiness score")} value={pct(c.score)} note={`${t("Threshold")}: ${pct(c.threshold)}`} />
              <StatTile label={t("Records")} value={c.records_total.toLocaleString()} note={`${t("Blocked")}: ${c.records_blocked.toLocaleString()}`} />
              <StatTile label={t("Signed off")} value={c.wave.signed_off_at ? when(c.wave.signed_off_at) : t("No")} note={c.wave.signed_off_at || c.verdict === "go" ? undefined : t("Sign-off opens when the verdict is Go")} />
            </dl>
            <Card title={t("Objects")} sub={t("Source DQS, projected and actual target DQS side by side")}>
              {objects.length ? (
                <DataTable
                  label={t("Objects")}
                  rows={objects}
                  rowKey={(o) => o.module}
                  columns={[
                    { key: "o", label: t("Object"), render: (o: WaveObject) => <FieldChip code={o.module} description={o.label ? humanize(o.label) : humanize(o.module)} /> },
                    { key: "v", label: t("Verdict"), render: (o) => <Verdict v={o.verdict} /> },
                    { key: "s", label: t("Source DQS"), align: "end", sort: (o) => o.dqs ?? -1, render: (o) => pct(o.dqs) },
                    { key: "p", label: t("Projected target DQS"), align: "end", sort: (o) => o.dest_dqs_projected ?? -1, render: (o) => dqs(o.dest_dqs_projected) },
                    { key: "a", label: t("Actual target DQS"), align: "end", sort: (o) => o.dest_dqs_actual ?? -1, render: (o) => dqs(o.dest_dqs_actual) },
                    { key: "r", label: t("Records blocked"), align: "end", sort: (o) => o.records_blocked, render: (o) => `${o.records_blocked.toLocaleString()} / ${o.records.toLocaleString()}` },
                    { key: "w", label: t("Why they differ"), render: (o) => (o.dest_contributors.length ? o.dest_contributors.map((x) => <span key={x.check_id}><FieldChip code={x.check_id} description={x.description ?? undefined} /></span>) : t("No difference")) },
                  ]}
                />
              ) : <EmptyState heading={t("This wave has not been analysed yet")} body={t("Run the analysis for this wave to see its blockers.")} />}
            </Card>
            <Card title={t("Readiness trend")} sub={c.forecast ? STATUS_FORECAST(c.forecast.status) : undefined}>
              <TrendArea label={t("Readiness score per run")} emptyLabel={t("No runs yet")} points={c.trend.map((p) => ({ axis: when(p.completed_at), title: when(p.completed_at), value: p.score }))} />
              {c.forecast?.projected_date ? <p>{t("Blocking findings reach zero about {date}.", { date: c.forecast.projected_date })}</p> : null}
            </Card>
            <Card title={t("Blockers")} sub={t("{n} open", { n: c.blockers.length })}>
              {c.blockers.length ? (
                <DataTable
                  label={t("Blockers")}
                  rows={c.blockers}
                  rowKey={(b) => `${b.module}:${b.gap_type}:${b.field}`}
                  columns={[
                    { key: "m", label: t("Object"), render: (b) => <FieldChip code={b.module} description={b.label ? humanize(b.label) : humanize(b.module)} /> },
                    { key: "f", label: t("Field"), render: (b) => <FieldChip code={b.field ?? "-"} description={humanize(gapText(b.gap_type))} /> },
                    { key: "sv", label: t("Severity"), render: (b) => humanize(b.severity) },
                    { key: "r", label: t("Records"), align: "end", sort: (b) => b.records, render: (b) => b.records.toLocaleString() },
                    { key: "x", label: t("Fix"), render: (b) => <Button variant="ghost" disabled={fix.isPending} onClick={() => fix.mutate(b)}>{t("Draft fix batch")}</Button> },
                  ]}
                />
              ) : <EmptyState heading={t("No blockers")} body={t("Nothing blocks this wave. Continue to the next step.")} />}
            </Card>
            <Card title={t("Wave settings")}>
              <Field label={t("Minimum readiness")}><Input inputMode="decimal" value={min} placeholder={String(c.threshold)} onChange={(e) => setMin(e.target.value)} /></Field>
              <div className="mx-actions"><Button variant="secondary" disabled={patch.isPending || !(Number(min) >= 0 && Number(min) <= 100 && min !== "")} onClick={() => patch.mutate()}>{t("Save threshold")}</Button></div>
            </Card>
          </div>
        ) : null}
      </Gate>
      <Confirm open={confirm} title={t("Delete this wave?")} confirmLabel={t("Delete wave")} cancelLabel={t("Cancel")} danger onConfirm={() => { setConfirm(false); del.mutate(); }} onCancel={() => setConfirm(false)} />
    </>
  );
}
