"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { getAgreement, noLaterRun, type AgreementField, type AgreementRow } from "@/lib/api/v2/roundtrip";
import { Button, Card, DataTable, EmptyState, ErrorState, FieldChip, PageHeader, ScoreRing, Skeleton, StatTile, useAletheiaScope, useSheet, type Column } from "@/ui/kit";
import { answer } from "./answers";
import { JobHairline } from "./JobHairline";
import { runPath } from "./util";
import { useRun } from "@/lib/api/next/runs";
import { modulesOf } from "./util";
import "./runs.css";

const statusText = (s: AgreementRow["status"]) => ({ matched: t("Agrees"), different: t("Differs"), missing: t("Missing") })[s];

export function Agreement({ id }: { id: string }) {
  useInterfaceLang();
  const fx = useFixture();
  const href = (p: string) => withFixture(p, fx);
  const sheet = useSheet();
  const run = useRun(id);
  const q = useQuery({ queryKey: ["next", "run", id, "agreement", fx], queryFn: () => getAgreement(id), retry: false });
  const d = q.data;
  useAletheiaScope({
    key: `agreement:${id}`,
    label: t("Asking about this agreement"),
    suggestions: [t("Where does the later run disagree?")],
    answer: () => {
      if (!d) return answer(t("The agreement has not loaded yet."), []);
      const worst = [...d.fields].sort((x, y) => y.different + y.missing - (x.different + x.missing))[0];
      return answer(t("{n} of {total} cleaned values agree.", { n: d.matched, total: d.total }), worst ? [`${worst.table}.${worst.field}: ${worst.different + worst.missing}`] : []);
    },
  });
  const upload = () => sheet.open("upload", { run: id, module: run.data ? modulesOf(run.data)[0] ?? "" : "" });
  const header = <PageHeader title={t("Agreement with the cleaned file")} context={t("How far a later run holds what you uploaded.")}
    actions={<span className="rn-row-actions"><Button variant="secondary" href={href(runPath(id))}>{t("Back to the run")}</Button><Button onClick={upload}>{t("Upload cleaned file")}</Button></span>} />;
  if (q.isLoading) return <div className="mx-col"><JobHairline />{header}<Skeleton lines={6} label={t("Loading the agreement")} /></div>;
  if (q.isError || !d) {
    if (q.error && noLaterRun(q.error)) return <div className="mx-col"><JobHairline />{header}<EmptyState heading={t("No later run yet")} body={t("Pull the object again after the upload. The agreement shows then.")} /></div>;
    return <ErrorState heading={t("The agreement could not be loaded")} retryLabel={t("Try again")} onRetry={() => q.refetch()} />;
  }
  const fcols: Column<AgreementField>[] = [
    { key: "f", label: t("Field"), render: (f) => <FieldChip code={`${f.table}.${f.field}`} description={f.description} /> },
    { key: "m", label: t("Agree"), align: "end", render: (f) => <span className="rn-num">{f.matched}</span> },
    { key: "d", label: t("Differ"), align: "end", render: (f) => <span className="rn-num">{f.different}</span> },
    { key: "x", label: t("Missing"), align: "end", render: (f) => <span className="rn-num">{f.missing}</span> },
  ];
  const rcols: Column<AgreementRow>[] = [
    { key: "s", label: t("Result"), render: (r) => statusText(r.status) },
    { key: "f", label: t("Field"), render: (r) => <FieldChip code={`${r.table}.${r.field}`} description={r.description} /> },
    { key: "k", label: t("Record"), render: (r) => <code className="mx-code">{r.key}</code> },
    { key: "c", label: t("You uploaded"), render: (r) => r.cleaned ?? "" },
    { key: "u", label: t("Run holds"), render: (r) => r.current ?? t("Record gone") },
  ];
  return (
    <div className="mx-col">
      <JobHairline />
      {header}
      <div className="mx-split">
        <Card title={t("Agreement")}><ScoreRing value={d.score} label={t("Agreement score")} naLabel={t("n/a")} /></Card>
        <dl className="mx-tiles">
          <StatTile label={t("Agree")} value={String(d.matched)} />
          <StatTile label={t("Differ")} value={String(d.different)} />
          <StatTile label={t("Missing")} value={String(d.missing)} />
        </dl>
      </div>
      <Card title={t("By field")}><DataTable columns={fcols} rows={d.fields} rowKey={(f) => `${f.table}.${f.field}`} label={t("Agreement by field")} height={220} /></Card>
      <Card title={t("Values")} sub={t("{n, plural, one {# value} other {# values}}", { n: d.rows_total })}><DataTable columns={rcols} rows={d.rows} rowKey={(r) => `${r.table}.${r.field}.${r.key}.${r.status}`} label={t("Cleaned values")} height={360} /></Card>
    </div>
  );
}
