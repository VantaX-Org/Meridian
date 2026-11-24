"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMigrationRuns, releaseFor, startMigration, type MigrationMode, type MigrationRun } from "@/lib/api/v2/migration";
import { Button, Card, Chip, DataTable, EmptyState, Field, FieldChip, PageHeader, Select, Sheet, useAletheiaScope, useToast } from "@/ui/kit";
import { AskButton, Gate, humanize, pct, useHref, Verdict, when, useBack } from "./common";
import { invalidateLoad, useLoadPlan, usePairs } from "./hooks";
import { useCrumbs } from "@/ui/screens/flow";

export const modeLabel = (m: MigrationMode): string => (m === "s4_dry_run" ? t("S/4HANA dry run") : m === "source_to_destination" ? t("Source to target") : t("Source to source"));

/** Every migration analysis: how ready the source data is to load, with a Sheet to start a new one. */
export function MigrationRuns() {
  useInterfaceLang();
  const back = useBack();
  const fx = useFixture();
  const q = useQuery({ queryKey: ["ui", "load", fx, "runs"], queryFn: getMigrationRuns });
  const plan = useLoadPlan();
  const pairs = usePairs();
  const href = useHref();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ mode: "source_to_destination" as MigrationMode, source: "", dest: "", modules: [] as string[] });
  const runs = q.data?.runs ?? [];
  const sys = pairs.data?.systems ?? [];
  const mods = (plan.data?.objects ?? []).map((o) => o.module);
  const destType = sys.find((s) => s.id === f.dest)?.type;
  const start = useMutation({
    mutationFn: () => startMigration({ mode: f.mode, source_system_id: f.source || undefined, dest_system_id: f.mode === "source_to_destination" ? f.dest || undefined : undefined, target_release: f.mode === "s4_dry_run" ? "s4hana" : f.mode === "source_to_destination" ? releaseFor(destType) : undefined, modules: f.modules }),
    onSuccess: () => { setOpen(false); toast(t("Analysis queued"), "good"); invalidateLoad(qc); qc.invalidateQueries({ queryKey: ["ui", "load", fx, "runs"] }); },
    onError: () => toast(t("The analysis could not be started"), "bad"),
  });
  const ok = f.modules.length > 0 && !!f.source && (f.mode !== "source_to_destination" || !!f.dest);

  useAletheiaScope({
    key: "load/runs",
    label: t("Asking about migration runs"),
    suggestions: [t("Which run has the most blocked records?")],
    answer: () => {
      const w = [...runs].sort((a, b) => (b.records_blocked ?? 0) - (a.records_blocked ?? 0))[0];
      return w ? { text: t("{run} has the most blocked records.", { run: w.id }), evidence: [`${t("Records blocked")}: ${w.records_blocked ?? 0}`] } : { text: t("No run yet."), evidence: [] };
    },
  });

  const sysName = (id: string | null) => (id ? sys.find((s) => s.id === id)?.name ?? id : t("Not set"));
  const crumbs = useCrumbs();
  return (
    <>
      <PageHeader crumbs={crumbs("load", t("Migration runs"))} back={back} title={t("Migration runs")} context={t("Each run measures how much of the source data can load into the target.")} actions={<><Button variant="primary" onClick={() => setOpen(true)}>{t("Start a run")}</Button><AskButton /></>} />
      <Card title={t("Runs")} sub={t("{n} runs", { n: runs.length })}>
        <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the runs")}>
          {runs.length ? (
            <DataTable id="migrationruns-1" viewMenu
              label={t("Runs")}
              rows={runs}
              rowKey={(r: MigrationRun) => r.id}
              columns={[
                { key: "id", label: t("Run"), sort: (r) => r.id, render: (r) => <Link href={href(`/load/runs/${r.id}`)}>{r.id}</Link> },
                { key: "mode", label: t("Mode"), sort: (r) => r.mode, render: (r) => modeLabel(r.mode) },
                { key: "m", label: t("Objects"), render: (r) => r.modules.map((m) => <FieldChip key={m} code={m} description={humanize(m)} />) },
                { key: "src", label: t("Source system"), render: (r) => sysName(r.source_system_id) },
                { key: "dst", label: t("Target system"), render: (r) => sysName(r.dest_system_id) },
                { key: "v", label: t("Verdict"), render: (r) => <Verdict v={r.readiness_verdict} /> },
                { key: "sc", label: t("Score"), align: "end", sort: (r) => r.readiness_score ?? -1, render: (r) => pct(r.readiness_score) },
                { key: "rt", label: t("Records"), align: "end", sort: (r) => r.records_total ?? -1, render: (r) => (r.records_total ?? 0).toLocaleString() },
                { key: "rb", label: t("Records blocked"), align: "end", sort: (r) => r.records_blocked ?? -1, render: (r) => (r.records_blocked ?? 0).toLocaleString() },
                { key: "at", label: t("Started"), sort: (r) => r.created_at ?? "", render: (r) => when(r.created_at) },
              ]}
            />
          ) : <EmptyState heading={t("No run yet")} body={t("A run checks whether your objects are ready to load. Choose Start a run.")} />}
        </Gate>
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} label={t("Start a run")} closeLabel={t("Close")}>
        <h2 className="mx-card-t">{t("Start a run")}</h2>
        <Field label={t("Mode")}><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as MigrationMode })} options={(["source_to_destination", "s4_dry_run", "source_to_source"] as MigrationMode[]).map((m) => ({ value: m, label: modeLabel(m) }))} /></Field>
        <Field label={t("Source system")}><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={[{ value: "", label: t("Choose a system") }, ...sys.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        {f.mode === "source_to_destination" ? <Field label={t("Target system")}><Select value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })} options={[{ value: "", label: t("Choose a system") }, ...sys.map((s) => ({ value: s.id, label: s.name }))]} /></Field> : null}
        <Field label={t("Objects")}>
          <span className="mx-links">{mods.map((m) => <Chip key={m} selected={f.modules.includes(m)} onClick={() => setF({ ...f, modules: f.modules.includes(m) ? f.modules.filter((x) => x !== m) : [...f.modules, m] })}>{`${m} ${humanize(m)}`}</Chip>)}</span>
        </Field>
        <Button variant="primary" disabled={!ok || start.isPending} onClick={() => start.mutate()}>{t("Start analysis")}</Button>
      </Sheet>
    </>
  );
}
