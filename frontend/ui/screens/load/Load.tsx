"use client";

import Link from "next/link";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useLoadHistory, useLoadRuns } from "@/lib/api/next/load";
import { Card, DataTable, EmptyState, FieldChip, PageHeader, StatTile, useAletheiaScope } from "@/ui/kit";
import { AskButton, Gate, Verdict, humanize, useHref, when } from "./common";
import { useLoadPlan } from "./hooks";
import { LoadBoard } from "./LoadBoard";

/** The Load area home: the order to load in, the files handed over, and a way into every part of the area. */
export function Load() {
  useInterfaceLang();
  const href = useHref();
  const plan = useLoadPlan();
  const runs = useLoadRuns();
  const hist = useLoadHistory(10, 0);
  const objects = plan.data?.objects ?? [];
  const go = objects.filter((o) => o.status === "go").length;
  const noGo = objects.filter((o) => o.status === "no_go").length;

  useAletheiaScope({
    key: "load/home",
    label: t("Asking about the load"),
    suggestions: [t("What blocks the load?")],
    answer: () => {
      const b = objects.filter((o) => o.status === "no_go");
      return b.length
        ? { text: t("{n} objects are no-go. Load them after the objects they wait for.", { n: b.length }), evidence: b.slice(0, 5).map((o) => `${o.module} ${o.label}`) }
        : { text: t("No object blocks the load."), evidence: [] };
    },
  });

  const areas: { to: string; title: string; note: string }[] = [
    { to: "/load/plan", title: t("Load order"), note: t("Which object loads first, and why.") },
    { to: "/load/move", title: t("Move to new instance"), note: t("Move every object and its history to a new system, then check it arrived.") },
    { to: "/load/s4", title: t("S/4 readiness"), note: t("Rules that must pass before the move.") },
    { to: "/load/go-live", title: t("Go-live gates"), note: t("Gates, certificates and sign-off per wave.") },
    { to: "/load/waves", title: t("Waves"), note: t("Groups of objects that move together.") },
    { to: "/load/runs", title: t("Migration runs"), note: t("Every dry run and its findings.") },
    { to: "/load/templates", title: t("Load templates"), note: t("The workbooks the new system gave.") },
    { to: "/load/maps", title: t("Field and value maps"), note: t("How each source value becomes a target value.") },
    { to: "/load/compare", title: t("Paired systems"), note: t("Source against target, object by object.") },
  ];

  return (
    <>
      <PageHeader title={t("Load")} context={t("Move clean data into the new system, in the right order.")} actions={<AskButton />} />
      <LoadBoard />
      <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Objects in the plan")} value={String(objects.length)} />
        <StatTile label={t("Go")} value={String(go)} />
        <StatTile label={t("No-go")} value={String(noGo)} />
        <StatTile label={t("Migration runs")} value={String(runs.data?.length ?? 0)} />
        <StatTile label={t("Files handed over")} value={String(hist.data?.total ?? 0)} />
      </dl>
          <Card title={t("Load order")} sub={plan.data ? t("{n} steps for release {r}", { n: plan.data.steps, r: plan.data.release }) : undefined}>
            <Gate loading={plan.isLoading} error={plan.isError} what={t("the load order")}>
              {objects.length ? (
                <DataTable
                  label={t("Load order")}
                  rows={[...objects].sort((a, b) => a.step - b.step)}
                  rowKey={(o) => o.module}
                  columns={[
                    { key: "step", label: t("Step"), align: "end", sort: (o) => o.step, render: (o) => o.step },
                    { key: "m", label: t("Object"), sort: (o) => o.module, render: (o) => <FieldChip code={o.module} description={o.label || humanize(o.module)} /> },
                    { key: "a", label: t("Anchor table"), render: (o) => <FieldChip code={o.anchor} description={o.anchor_text} /> },
                    { key: "s", label: t("Status"), render: (o) => <Verdict v={o.status} /> },
                    { key: "b", label: t("Blocking findings"), align: "end", sort: (o) => o.blocking, render: (o) => o.blocking },
                  ]}
                />
              ) : <EmptyState heading={t("No load order yet")} body={t("Analyse an object first.")} />}
            </Gate>
          </Card>
          <Card title={t("Files handed over")} sub={t("{n} in total", { n: hist.data?.total ?? 0 })}>
            <Gate loading={hist.isLoading} error={hist.isError} what={t("the load history")}>
              {hist.data?.items.length ? (
                <DataTable
                  label={t("Files handed over")}
                  rows={hist.data.items}
                  rowKey={(e) => e.id}
                  columns={[
                    { key: "f", label: t("File"), render: (e) => e.filename },
                    { key: "r", label: t("Run"), render: (e) => <Link href={href(`/load/runs/${e.run_id}`)}>{e.run_id}</Link> },
                    { key: "n", label: t("Records"), align: "end", sort: (e) => e.record_count, render: (e) => e.record_count },
                    { key: "w", label: t("Wave"), render: (e) => (e.wave_id ? <Link href={href(`/load/waves/${e.wave_id}`)}>{e.wave_name}</Link> : t("None")) },
                    { key: "by", label: t("Handed over by"), render: (e) => e.exported_by_label ?? "" },
                    { key: "at", label: t("Date"), sort: (e) => e.exported_at ?? "", render: (e) => when(e.exported_at) },
                  ]}
                />
              ) : <EmptyState heading={t("No file handed over yet")} />}
            </Gate>
          </Card>
        <Card title={t("Everything in Load")}>
          <DataTable
            label={t("Everything in Load")}
            rows={areas}
            rowKey={(a) => a.to}
            columns={[
              { key: "t", label: t("Area"), render: (a) => <Link href={href(a.to)}>{a.title}</Link> },
              { key: "n", label: t("What it holds"), render: (a) => a.note },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
