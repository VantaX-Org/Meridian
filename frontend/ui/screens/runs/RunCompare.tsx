"use client";

import { useState } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useCompareSets, useCompareSummary, useRun, type Change, type CompareRecord } from "@/lib/api/next/runs";
import { Button, Card, Chip, DataTable, EmptyState, ErrorState, FieldChip, PageHeader, Skeleton, StatTile, useAletheiaScope, type Column } from "@/ui/kit";
import { answer } from "./answers";
import { CompareObject } from "./CompareObject";
import { JobHairline } from "./JobHairline";
import { runPath, runTitle } from "./util";
import "./runs.css";

const CHANGES: Change[] = ["new", "resolved", "regressed", "persisting"];
const changeText = (c: Change) => ({ new: t("Newly failing"), resolved: t("Fixed"), regressed: t("Got worse"), persisting: t("Still failing") })[c];
const cell = (v: Record<string, unknown> | null) => (v ? Object.entries(v).map(([k, x]) => `${k}=${String(x)}`).join(", ") : "");

export function RunCompare({ a, b, runs, objects }: { a: string; b: string; runs?: readonly string[]; objects?: readonly string[] }) {
  useInterfaceLang();
  const fx = useFixture();
  const href = (p: string) => withFixture(p, fx);
  const [change, setChange] = useState<Change | "">("");
  const [check, setCheck] = useState("");
  const ra = useRun(a);
  const rb = useRun(b);
  const sum = useCompareSummary(a, b);
  const sets = useCompareSets({ v1: a, v2: b, change: change || undefined, check_id: check || undefined, limit: 200 });
  const s = sum.data;
  useAletheiaScope({
    key: `compare:${a}:${b}`,
    label: t("Asking about this comparison"),
    suggestions: [t("What changed most?")],
    answer: () => {
      if (!s) return answer(t("The comparison has not loaded yet."), []);
      const top = [...s.checks].sort((x, y) => y.new + y.regressed - (x.new + x.regressed))[0];
      return answer(t("{fixed} records are fixed and {added} are newly failing.", { fixed: s.totals.resolved, added: s.totals.new }), top ? [`${top.check_id}: ${top.new + top.regressed}`] : []);
    },
  });
  if (sum.isLoading) return <div className="mx-col"><JobHairline /><Skeleton lines={8} label={t("Loading the comparison")} /></div>;
  if (sum.isError || !s) return <ErrorState heading={t("The comparison could not be loaded")} retryLabel={t("Try again")} onRetry={() => sum.refetch()} />;
  const cols: Column<CompareRecord>[] = [
    { key: "change", label: t("Change"), render: (r) => changeText(r.change) },
    { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={moduleText(r.module)} /> },
    { key: "key", label: t("Record"), render: (r) => <code className="mx-code">{r.record_key}</code> },
    { key: "before", label: t("Before"), render: (r) => cell(r.values_before) },
    { key: "after", label: t("After"), render: (r) => cell(r.values_after) },
    { key: "why", label: t("Why"), render: (r) => r.reason ?? "" },
  ];
  const rows = sets.data?.records ?? [];
  return (
    <div className="mx-col">
      <JobHairline />
      <PageHeader title={t("Compare runs")} context={`${ra.data ? runTitle(ra.data) : a} ${t("with")} ${rb.data ? runTitle(rb.data) : b}`}
        actions={<span className="rn-row-actions"><Button variant="secondary" href={href(runPath(a))}>{t("Open first run")}</Button><Button variant="secondary" href={href(runPath(b))}>{t("Open second run")}</Button></span>} />
      <dl className="mx-tiles">{CHANGES.map((c) => <StatTile key={c} label={changeText(c)} value={String(s.totals[c] ?? 0)} />)}</dl>
      <Card title={t("Rules that changed")} sub={t("Pick a rule to see its records.")}>
        <div className="rn-filters">
          <Chip selected={!change} onClick={() => setChange("")}>{t("All changes")}</Chip>
          {CHANGES.map((c) => <Chip key={c} selected={change === c} onClick={() => setChange(c)} count={s.totals[c] ?? 0}>{changeText(c)}</Chip>)}
        </div>
        <div className="rn-filters">
          <Chip selected={!check} onClick={() => setCheck("")}>{t("All rules")}</Chip>
          {s.checks.slice(0, 12).map((c) => <Chip key={c.check_id} selected={check === c.check_id} onClick={() => setCheck(c.check_id)}>{c.check_id}</Chip>)}
        </div>
      </Card>
      <Card title={t("Records")} sub={t("{n, plural, one {# record} other {# records}}", { n: sets.data?.total ?? 0 })}>
        {sets.isLoading ? <Skeleton lines={5} label={t("Loading the records")} /> : rows.length === 0 ? <EmptyState heading={t("No records here")} body={t("Nothing changed for this choice.")} /> : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => `${r.check_id}/${r.record_key}/${r.change}`} label={t("Changed records")} height={420} />
        )}
      </Card>
      <CompareObject ids={runs?.length ? runs : [a, b]} objects={objects} />
    </div>
  );
}
