"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { createWave, type MigrationWave } from "@/lib/api/v2/reports";
import { sortWaves } from "@/lib/v2/waves";
import { Button, Card, Chip, DataTable, EmptyState, Field, FieldChip, Input, PageHeader, Select, Sheet, TrendArea, useAletheiaScope, useToast } from "@/ui/kit";
import { AskButton, Gate, humanize, pct, useHref, Verdict, when } from "./common";
import { invalidateLoad, usePairs, useLoadPlan, useWaves } from "./hooks";

const STAGES = ["plan", "mock1", "mock2", "dress", "cutover"] as const;
const stageLabel = (s: string): string => (s === "plan" ? t("Plan") : s === "mock1" ? t("Mock load 1") : s === "mock2" ? t("Mock load 2") : s === "dress" ? t("Dress rehearsal") : t("Cutover"));

/** Every migration wave: its objects, stage, target date, verdict and score trend, plus a Sheet to plan a new one. */
export function Waves() {
  useInterfaceLang();
  const q = useWaves();
  const plan = useLoadPlan();
  const pairs = usePairs();
  const href = useHref();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", date: "", stage: "plan", min: "80", source: "", target: "", modules: [] as string[] });
  const waves = sortWaves(q.data ?? []);
  const mods = (plan.data?.objects ?? []).map((o) => o.module);
  const sys = pairs.data?.systems ?? [];
  const add = useMutation({
    mutationFn: () => createWave({ name: f.name.trim(), modules: f.modules, target_date: f.date || null, stage: f.stage as MigrationWave["stage"], min_readiness: Number(f.min), source_system_id: f.source || null, target_system_id: f.target || null }),
    onSuccess: () => { setOpen(false); toast(t("Wave created"), "good"); invalidateLoad(qc); },
    onError: () => toast(t("The wave could not be created"), "bad"),
  });
  const ok = f.name.trim() && f.modules.length > 0 && Number(f.min) >= 0 && Number(f.min) <= 100;

  useAletheiaScope({
    key: "load/waves",
    label: t("Asking about migration waves"),
    suggestions: [t("Which wave is next and is it ready?")],
    answer: () => {
      const w = waves.find((x) => !x.signed_off_at);
      return w ? { text: t("{wave} is the next wave to sign off.", { wave: w.name }), evidence: [w.target_date ? `${t("Target date")}: ${when(w.target_date)}` : t("No target date")] } : { text: t("Every wave is signed off."), evidence: [] };
    },
  });

  return (
    <>
      <PageHeader title={t("Migration waves")} context={t("Group objects into waves and track each wave to sign-off.")} actions={<><Button variant="primary" onClick={() => setOpen(true)}>{t("New wave")}</Button><AskButton /></>} />
      <Card title={t("Waves")} sub={t("{n} waves", { n: waves.length })}>
        <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the waves")}>
          {waves.length ? (
            <DataTable
              label={t("Waves")}
              rows={waves}
              rowKey={(w) => w.id}
              columns={[
                { key: "n", label: t("Wave"), sort: (w) => w.name, render: (w) => <Link href={href(`/load/waves/${w.id}`)}>{w.name}</Link> },
                { key: "st", label: t("Stage"), sort: (w) => STAGES.indexOf(w.stage), render: (w) => stageLabel(w.stage) },
                { key: "d", label: t("Target date"), sort: (w) => w.target_date ?? "", render: (w) => (w.target_date ? when(w.target_date) : t("Not set")) },
                { key: "v", label: t("Verdict"), render: (w) => <Verdict v={w.last_verdict ?? null} /> },
                { key: "sc", label: t("Score"), align: "end", sort: (w) => w.last_score ?? -1, render: (w) => pct(w.last_score) },
                { key: "tr", label: t("Trend"), render: (w) => (w.trend?.length ? <TrendArea label={t("Score trend of {wave}", { wave: w.name })} emptyLabel={t("No trend")} height={32} points={w.trend.map((v, i) => ({ axis: String(i + 1), title: String(i + 1), value: v }))} /> : t("No runs yet")) },
                { key: "so", label: t("Signed off"), render: (w) => (w.signed_off_at ? when(w.signed_off_at) : t("No")) },
                { key: "m", label: t("Objects"), render: (w) => w.modules.map((m) => <FieldChip key={m} code={m} description={humanize(m)} />) },
              ]}
            />
          ) : <EmptyState heading={t("No wave yet")} body={t("Group the objects that load together. Start with New wave.")} />}
        </Gate>
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} label={t("New wave")} closeLabel={t("Close")}>
        <h2 className="mx-card-t">{t("New wave")}</h2>
        <Field label={t("Wave name")}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t("Objects")}>
          <span className="mx-links">{mods.map((m) => <Chip key={m} selected={f.modules.includes(m)} onClick={() => setF({ ...f, modules: f.modules.includes(m) ? f.modules.filter((x) => x !== m) : [...f.modules, m] })}>{`${m} ${humanize(m)}`}</Chip>)}</span>
        </Field>
        <Field label={t("Target date")}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t("Stage")}><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} options={STAGES.map((s) => ({ value: s, label: stageLabel(s) }))} /></Field>
        <Field label={t("Minimum readiness")}><Input inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label={t("Source system")}><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={[{ value: "", label: t("Choose a system") }, ...sys.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label={t("Target system")}><Select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} options={[{ value: "", label: t("Choose a system") }, ...sys.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <div className="mx-actions"><Button variant="primary" disabled={!ok || add.isPending} onClick={() => add.mutate()}>{t("Create wave")}</Button></div>
      </Sheet>
    </>
  );
}
