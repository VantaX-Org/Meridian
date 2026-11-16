"use client";

import "./tabs-g.css";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptMinedRule, getProfile, type Dependency, type FieldStats, type Severity, type TableProfile } from "@/lib/api/v2/profile";
import { useFixture } from "@/lib/api/v2/fixture";
import { v2Download } from "@/lib/api/v2/download";
import { errorSentence } from "@/lib/api/v2/client";
import { useV2Session } from "@/lib/v2/hooks";
import { useReceipt } from "@/lib/v2/queries";
import { describeTable } from "@/lib/v2/sap-fields";
import { f1, int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { useSubmitGuard } from "@/design/next/more/states";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton, useToast, type Column } from "../../kit";
import type { ObjectRun } from "../useObjectRun";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, ScoreBar } from "./tabs-g-parts";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_WORD: Record<Severity, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

/** What the values of a field look like: the commonest codes, the range of a number or date, or why they are withheld. */
function Values({ s }: { s: FieldStats }) {
  if (s.dates)
    return (
      <>
        {s.dates.min && s.dates.max ? t("{min} to {max}", { min: s.dates.min, max: s.dates.max }) : <Dash />}
        {s.dates.invalid ? ` ${t("({count} not a date)", { count: int(s.dates.invalid) })}` : ""}
      </>
    );
  if (s.numeric) return <>{s.numeric.min != null && s.numeric.max != null ? t("{min} to {max}, mean {mean}", { min: f1(s.numeric.min), max: f1(s.numeric.max), mean: f1(s.numeric.mean) }) : <Dash />}</>;
  if (s.top_values?.length) {
    return (
      <span className="nx-tg-sub">
        {s.top_values.slice(0, 3).map((v, i) => (
          <span key={v.value}>
            {i ? ", " : ""}
            <span className="nx-mono">{v.value}</span> {int(v.count)}
          </span>
        ))}
      </span>
    );
  }
  if (s.masked) return <Dash why={s.mask_reason === "privacy" ? t("Withheld: the field holds personal data") : t("Free text or a key: a list of values says nothing")} />;
  return <Dash />;
}

type FieldRow = { field: string; s: FieldStats };

function TableBlock({ tp }: { tp: TableProfile }) {
  const columns: Column<FieldRow>[] = [
    { id: "field", label: t("Field"), cell: (r) => <Code code={r.field} text={r.s.description ?? <Dash why={t("The data dictionary has no text for this field")} />} />, compare: (a, b) => a.field.localeCompare(b.field) },
    { id: "type", label: t("Type"), cell: (r) => (r.s.ddic_type ? <span className="nx-mono">{r.s.ddic_length ? `${r.s.ddic_type} ${r.s.ddic_length}` : r.s.ddic_type}</span> : <Dash />) },
    // Blank share as a bar: the fuller the field, the longer the bar.
    { id: "blank", label: t("Blank"), align: "end", cell: (r) => <ScoreBar value={100 - r.s.blank_pct} label={`${r.field} ${t("Blank")} ${f1(r.s.blank_pct)}%`} />, compare: (a, b) => a.s.blank_pct - b.s.blank_pct },
    { id: "distinct", label: t("Distinct"), align: "end", cell: (r) => int(r.s.distinct), compare: (a, b) => a.s.distinct - b.s.distinct },
    {
      id: "length",
      label: t("Length"),
      align: "end",
      cell: (r) => (r.s.min_length == null || r.s.max_length == null ? <Dash /> : r.s.min_length === r.s.max_length ? int(r.s.min_length) : t("{min} to {max}", { min: int(r.s.min_length), max: int(r.s.max_length) })),
    },
    { id: "values", label: t("Values"), cell: (r) => <Values s={r.s} /> },
  ];
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Fields of {table}", { table: tp.table })}>
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">
          <Code code={tp.table} text={describeTable(tp.table) ?? undefined} />
        </h2>
        <span className="nx-tg-sub">
          {tp.sampled ? t("{rows} of {total} rows profiled, a sample", { rows: int(tp.rows), total: int(tp.table_rows) }) : t("{rows} rows profiled", { rows: int(tp.rows) })}
        </span>
      </div>
      <ExportTable><DataTable
        rows={tp.fields.map(({ field, stats }) => ({ field, s: stats }))}
        columns={columns}
        rowKey={(r) => r.field}
        rowLabel={(r) => r.field}
        caption={t("Field profile of {table}", { table: tp.table })}
        density="compact"
      /></ExportTable>
    </section>
  );
}

/** A qualified field with its dictionary text beside it: MARA.MTART Material type. */
function FieldName({ q, texts }: { q: string; texts: Map<string, string> }) {
  return <Code code={q} text={texts.get(q)} />;
}

function DependencyRule({ d, module, versionId }: { d: Dependency; module: string; versionId: string }) {
  const qc = useQueryClient();
  const f = useFixture();
  const toast = useToast();
  const canAccept = useV2Session().can("manage_rules");
  const { busy, run } = useSubmitGuard();
  const [severity, setSeverity] = useState<Severity>("medium");
  if (d.accepted) return <>{t("Checked every run")}</>;
  if (!canAccept) return <Dash why={t("Needs the right to manage rules")} />;
  const accept = () =>
    run(async () => {
      try {
        const r = await acceptMinedRule({ module, determinant: d.determinant, dependent: d.dependent, severity });
        await qc.invalidateQueries({ queryKey: ["v2", "profile", f, versionId] });
        toast({ text: t("Rule {id} added. It runs from the next analysis.", { id: r.name.split(":")[0] }), tone: "good" });
      } catch (err) {
        toast({ text: errorSentence(err, t("The export failed.")), tone: "bad" });
      }
    });
  return (
    <span className="nx-tg-row">
      <select className="nx-input" aria-label={t("Severity for {field}", { field: d.dependent })} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {SEVERITY_WORD[s]()}
          </option>
        ))}
      </select>
      <Button size={32} onClick={() => void accept()} loading={busy} loadingLabel={t("Adding…")}>
        {t("Make it a rule")}
      </Button>
    </span>
  );
}

function Dependencies({ deps, module, texts, versionId }: { deps: Dependency[]; module: string; texts: Map<string, string>; versionId: string }) {
  const key = (d: Dependency) => `${d.determinant}>${d.dependent}`;
  const columns: Column<Dependency>[] = [
    { id: "when", label: t("When this field is set"), cell: (d) => <FieldName q={d.determinant} texts={texts} /> },
    { id: "decides", label: t("It decides"), cell: (d) => <FieldName q={d.dependent} texts={texts} /> },
    { id: "holds", label: t("Holds in"), align: "end", cell: (d) => <ScoreBar value={d.support * 100} label={`${d.dependent} ${t("Holds in")}`} />, compare: (a, b) => a.support - b.support },
    { id: "rows", label: t("Rows"), align: "end", cell: (d) => int(d.rows), compare: (a, b) => a.rows - b.rows },
    { id: "breaking", label: t("Breaking it"), align: "end", cell: (d) => int(d.violations), compare: (a, b) => a.violations - b.violations },
    { id: "examples", label: t("Example records"), cell: (d) => (d.sample_keys.length ? <span className="nx-mono">{d.sample_keys.slice(0, 2).join(", ")}</span> : <Dash />) },
    { id: "rule", label: t("Rule"), cell: (d) => <DependencyRule d={d} module={module} versionId={versionId} /> },
  ];
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Mined dependencies")}>
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Mined dependencies")}</h2>
        <span className="nx-tg-sub">{t("Where one field's value decides another's in almost every record. Each one can become a rule.")}</span>
      </div>
      {deps.length === 0 ? (
        <p className="nx-tg-prov">{t("No dependency between the fields of this object held in enough records to propose a rule.")}</p>
      ) : (
        <div data-testid="dependencies">
          <ExportTable><DataTable rows={deps} columns={columns} rowKey={key} rowLabel={key} caption={t("Mined dependencies")} density="compact" /></ExportTable>
        </div>
      )}
    </section>
  );
}

/** Saves the field profile of the object as an Excel file (GET /systems/{id}/versions/{v}/profile/export). */
function ProfileExport({ systemId, versionId, module }: { systemId: string | undefined; versionId: string; module: string }) {
  const session = useV2Session();
  const toast = useToast();
  const { busy, run } = useSubmitGuard();
  const canExport = session.can("export");
  const go = () =>
    run(async () => {
      if (session.fixture) return toast({ text: t("Fixture mode: no file is produced") });
      try {
        await v2Download(`/systems/${encodeURIComponent(systemId ?? "")}/versions/${encodeURIComponent(versionId)}/profile/export`, { object: module, format: "xlsx" }, "profile.xlsx");
        toast({ text: t("Profile downloading"), tone: "good" });
      } catch (err) {
        toast({ text: errorSentence(err, t("The export failed.")), tone: "bad" });
      }
    });
  return (
    <p className="nx-tg-prov">
      <Button icon="download" onClick={() => void go()} loading={busy} disabled={!systemId || !canExport} reason={!canExport ? t("Only users with the export right can download the workbook.") : undefined}>
        {t("Export the field profile")}
      </Button>
    </p>
  );
}

/** The Profile tab: what the run found in each field the object reads, and the dependencies mined between them. */
export function ProfileTab({ o }: { o: ObjectRun }) {
  const f = useFixture();
  const receiptQ = useReceipt(o.module, o.runId);
  const versionId = receiptQ.data?.run_id ?? "";
  const q = useQuery({ queryKey: ["v2", "profile", f, versionId, o.module], queryFn: () => getProfile(versionId, o.module), enabled: Boolean(versionId), retry: false });
  const label = o.label;

  if (receiptQ.isError || q.isError) {
    return (
      <ErrorState
        sentence={t("The field profile of {label} could not be read.", { label })}
        error={receiptQ.error ?? q.error}
        onRetry={() => {
          void receiptQ.refetch();
          void q.refetch();
        }}
      />
    );
  }
  if (receiptQ.isPending || q.isPending) {
    return (
      <div aria-busy="true" data-testid="profile-loading">
        <Skeleton lines={6} />
      </div>
    );
  }
  const p = q.data;
  if (p.tables.length === 0) {
    return (
      <EmptyState icon="info" heading={t("Profile")}>
        {t("This run did not profile {label}. A profile is taken when an analysis reads the object from SAP.", { label })}
      </EmptyState>
    );
  }
  const texts = new Map(p.tables.flatMap((tp) => tp.fields.filter((x) => x.stats.description).map((x) => [`${tp.table}.${x.field}`, x.stats.description as string] as const)));
  const fields = p.tables.reduce((n, tp) => n + tp.fields.length, 0);
  const open = p.dependencies.filter((d) => !d.accepted).length;
  const systemId = o.landscape.data?.cells.find((c) => c.module === o.module && c.run_id === versionId)?.system_id ?? o.systemId ?? undefined;
  return (
    <div className="nx-tg" data-testid="tab-profile">
      <p className="nx-tg-finding" data-testid="profile-sentence">
        {t("{fields} fields across {tables} tables profiled. {open} mined {open, plural, one {dependency is} other {dependencies are}} not yet a rule.", { fields, tables: p.tables.length, open })}
      </p>
      {p.tables.map((tp) => (
        <TableBlock key={tp.table} tp={tp} />
      ))}
      <ProfileExport systemId={systemId} versionId={versionId} module={o.module} />
      <Dependencies deps={p.dependencies} module={o.module} texts={texts} versionId={versionId} />
      <p className="nx-tg-prov">{t("Counts are of the rows read in this run. Values are withheld for personal data and for free text, where a list of values says nothing.")}</p>
    </div>
  );
}
