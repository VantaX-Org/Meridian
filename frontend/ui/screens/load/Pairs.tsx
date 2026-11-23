"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { createPair, deletePair, runPair, type ComparePair } from "@/lib/api/v2/compare";
import { Button, Card, Confirm, DataTable, EmptyState, Field, FieldChip, PageHeader, Select, Sheet, useAletheiaScope, useToast } from "@/ui/kit";
import { AskButton, Gate, humanize, pct, useHref, when, useBack } from "./common";
import { invalidateLoad, usePairs } from "./hooks";
import { useCrumbs } from "@/ui/screens/flow";

/** Every source and target pair, with its last scores. A row opens the Pair card. */
export function Pairs() {
  useInterfaceLang();
  const back = useBack();
  const q = usePairs();
  const href = useHref();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState<ComparePair | null>(null);
  const [form, setForm] = useState({ module: "", source: "", target: "" });
  const pairs = q.data?.pairs ?? [];

  useAletheiaScope({
    key: "load/pairs",
    label: t("Asking about paired systems"),
    suggestions: [t("Which pair has the biggest gap?")],
    answer: () => {
      const w = [...pairs].filter((p) => p.last?.scores).sort((a, b) => ((b.last?.scores?.projected ?? 0) - (b.last?.scores?.actual ?? 0)) - ((a.last?.scores?.projected ?? 0) - (a.last?.scores?.actual ?? 0)))[0];
      return w ? { text: t("{pair} has the widest gap between projected and actual target DQS.", { pair: `${w.source.name} / ${w.target.name}` }), evidence: [] } : { text: t("No pair has been compared yet."), evidence: [] };
    },
  });

  const run = useMutation({ mutationFn: (id: string) => runPair(id), onSuccess: () => { toast(t("Comparison started"), "info"); invalidateLoad(qc); }, onError: () => toast(t("The comparison could not be started"), "bad") });
  const add = useMutation({
    mutationFn: () => createPair({ module: form.module, source_system_id: form.source, target_system_id: form.target }),
    onSuccess: () => { setOpen(false); toast(t("Pair created"), "good"); invalidateLoad(qc); },
    onError: () => toast(t("The pair could not be created"), "bad"),
  });
  const del = useMutation({ mutationFn: (id: string) => deletePair(id), onSuccess: () => { setDrop(null); toast(t("Pair deleted"), "good"); invalidateLoad(qc); }, onError: () => { setDrop(null); toast(t("The pair could not be deleted"), "bad"); } });

  const sys = q.data?.systems ?? [];
  const mods = q.data?.modules ?? [];
  const ok = form.module && form.source && form.target && form.source !== form.target;

  const crumbs = useCrumbs();
  return (
    <>
      <PageHeader crumbs={crumbs("load", t("Paired systems"))} back={back}
        title={t("Paired systems")}
        context={t("Compare a source system with its target, object by object.")}
        actions={<><Button variant="primary" onClick={() => setOpen(true)}>{t("New pair")}</Button><AskButton /></>}
      />
      <Card title={t("Pairs")} sub={t("{n} pairs", { n: pairs.length })}>
        <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the pairs")}>
          {pairs.length ? (
            <DataTable id="pairs-1" viewMenu
              label={t("Pairs")}
              rows={pairs}
              rowKey={(p) => p.id}
              columns={[
                { key: "module", label: t("Object"), sort: (p) => p.module, render: (p) => <Link href={href(`/load/compare/${p.id}`)}><FieldChip code={p.module} description={humanize(p.module)} /></Link> },
                { key: "source", label: t("Source system"), sort: (p) => p.source.name, render: (p) => p.source.name },
                { key: "target", label: t("Target system"), sort: (p) => p.target.name, render: (p) => p.target.name },
                { key: "s", label: t("Source DQS"), align: "end", sort: (p) => p.last?.scores?.source ?? -1, render: (p) => pct(p.last?.scores?.source) },
                { key: "p", label: t("Projected target DQS"), align: "end", sort: (p) => p.last?.scores?.projected ?? -1, render: (p) => pct(p.last?.scores?.projected) },
                { key: "a", label: t("Actual target DQS"), align: "end", sort: (p) => p.last?.scores?.actual ?? -1, render: (p) => pct(p.last?.scores?.actual) },
                { key: "at", label: t("Last compared"), sort: (p) => p.last?.at ?? "", render: (p) => (
                  <span className="mx-row-end"><span>{p.last ? when(p.last.at) : t("Never")}</span>
                    <span className="mx-row-acts">
                      <Button variant="secondary" disabled={run.isPending} onClick={(e) => { e.stopPropagation(); run.mutate(p.id); }}>{t("Run comparison")}</Button>
                      <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setDrop(p); }}>{t("Remove")}</Button>
                    </span>
                  </span>
                ) },
              ]}
            />
          ) : <EmptyState heading={t("No pair yet")} body={t("A pair links a source system to its target. Choose New pair.")} />}
        </Gate>
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} label={t("New pair")} closeLabel={t("Close")}>
        <h2 className="mx-card-t">{t("New pair")}</h2>
        <Field label={t("Object")}><Select value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} options={[{ value: "", label: t("Choose an object") }, ...mods.map((m) => ({ value: m, label: `${m} ${humanize(m)}` }))]} /></Field>
        <Field label={t("Source system")}><Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} options={[{ value: "", label: t("Choose a system") }, ...sys.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label={t("Target system")} error={form.source && form.source === form.target ? t("Source and target must differ") : undefined}><Select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} options={[{ value: "", label: t("Choose a system") }, ...sys.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Button variant="primary" disabled={!ok || add.isPending} onClick={() => add.mutate()}>{t("Create pair")}</Button>
      </Sheet>
      <Confirm open={drop !== null} title={t("Remove this pair?")} confirmLabel={t("Remove")} cancelLabel={t("Cancel")} danger onConfirm={() => drop && del.mutate(drop.id)} onCancel={() => setDrop(null)}>
        {t("The pair and its comparison history are removed. The systems stay.")}
      </Confirm>
    </>
  );
}
