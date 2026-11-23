"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  checkTemplate, downloadBlankTemplate, downloadTemplateFile, exportTemplate, getTemplateFields, saveTemplateMapping, uploadTemplate,
  type TargetTemplate, type WorkbookReport,
} from "@/lib/api/v2/migration";
import { Button, Card, DataTable, EmptyState, Field, FieldChip, PageHeader, Select, StatTile, useAletheiaScope, useToast, ExportMenu, ImportDialog } from "@/ui/kit";
import { AskButton, Gate, humanize, when, useBack } from "./common";
import { invalidateLoad, useLoadPlan, useTemplateList } from "./hooks";
import { useCrumbs, Flow } from "@/ui/screens/flow";

type Unmapped = { sheet: string; header: string; id: string; label: string; mandatory: boolean };

/** Target templates: upload a kept workbook, map the columns the dictionary missed, check it, hand it over. */
export function Templates() {
  useInterfaceLang();
  const back = useBack();
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const plan = useLoadPlan();
  const mods = (plan.data?.objects ?? []).map((o) => o.module);
  const [pick, setPick] = useState("");
  const mod = pick || (mods.includes("material_master") ? "material_master" : mods[0]) || "material_master";
  const q = useTemplateList(mod);
  const rows = q.data?.templates ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const cur = rows.find((r) => r.id === sel) ?? rows[0];
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<WorkbookReport | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const bad = () => toast(t("The action failed"), "bad");
  const fields = useQuery({ queryKey: ["ui", "load", fx, "tplfields", mod], queryFn: () => getTemplateFields(mod) });
  const check = useMutation({ mutationFn: (x: TargetTemplate) => checkTemplate(mod, x.id), onSuccess: (r) => { setReport(r); toast(t("Template checked"), "good"); }, onError: bad });
  const save = useMutation({ mutationFn: (x: TargetTemplate) => saveTemplateMapping(mod, x.id, { ...x.column_map, ...draft }), onSuccess: () => { setDraft({}); toast(t("Mapping saved"), "good"); invalidateLoad(qc); }, onError: bad });

  const unmapped: Unmapped[] = (cur?.coverage?.sheets ?? []).flatMap((s) => s.unmapped.map((u) => ({ sheet: s.name, ...u })));

  useAletheiaScope({
    key: "load/templates",
    label: t("Asking about target templates"),
    suggestions: [t("Which columns are not mapped?")],
    answer: () => ({ text: t("{n} columns are not mapped in the selected template.", { n: unmapped.length }), evidence: unmapped.slice(0, 5).map((u) => `${u.sheet}: ${u.header}`) }),
  });

  const crumbs = useCrumbs();
  return (
    <>
      <PageHeader crumbs={crumbs("load", t("Load templates"))} stepper={<Flow label={t("Workbook fill")} at={1} steps={[t("Get the template"), t("Fill it"), t("Upload it"), t("Check the load")]} />} back={back}
        title={t("Target templates")}
        context={t("Kept workbooks that the load reads and fills")}
        actions={<>
          <Button variant="primary" onClick={() => setImporting(true)}>{t("Upload a template")}</Button>
          <ImportDialog open={importing} onClose={() => setImporting(false)} label={t("Upload a template")} closeLabel={t("Close")}
            accept=".xlsx,.xlsm,.csv" fileLabel={t("Choose a template file")} hint={t("Drop the target workbook.")} target={t("PROD")}
            apply={async (f) => { await uploadTemplate(mod, f, f.name.replace(/\.[^.]+$/, "")); invalidateLoad(qc); return t("Template kept"); }} />
          <ExportMenu label={t("Download a blank template")} formats={[{ id: "xlsx", label: t("Excel workbook") }]} onExport={() => downloadBlankTemplate(mod)} />
          <AskButton />
        </>}
      />
      <div className="mx-col">
      <div className="mx-links">
        <Field label={t("Object")}><Select value={mod} onChange={(e) => { setPick(e.target.value); setSel(null); setReport(null); }} options={(mods.length ? mods : [mod]).map((m) => ({ value: m, label: `${m} ${humanize(m)}` }))} /></Field>
      </div>
      <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the templates")}>
        {rows.length ? (
          <Card title={t("Kept templates")}>
            <DataTable<TargetTemplate>
              label={t("Kept templates")}
              rows={rows}
              rowKey={(r) => r.id}
              selected={cur?.id}
              onSelect={(r) => { setSel(r.id); setReport(null); setDraft({}); }}
              columns={[
                { key: "n", label: t("Template"), sort: (r) => r.name, render: (r) => r.name },
                { key: "v", label: t("Version"), align: "end", sort: (r) => r.version, render: (r) => r.version },
                { key: "f", label: t("File"), render: (r) => r.filename },
                { key: "c", label: t("Columns matched"), align: "end", sort: (r) => r.coverage?.matched ?? -1, render: (r) => (r.coverage ? `${r.coverage.matched} / ${r.coverage.columns}` : "") },
                { key: "l", label: t("Last filled"), sort: (r) => r.last_fill_at ?? "", render: (r) => when(r.last_fill_at) },
              ]}
            />
          </Card>
        ) : <EmptyState heading={t("No template kept for this object yet")} body={t("Upload the target workbook, or download a blank template to start from.")} />}
      </Gate>
      {cur ? (
        <Card title={cur.name} sub={cur.filename}>
          <div className="mx-links">
            <Button variant="secondary" onClick={() => check.mutate(cur)} disabled={check.isPending}>{t("Check this template")}</Button>
            <ExportMenu label={t("Download")} formats={[{ id: "kept", label: t("The kept file"), hint: t("As it was uploaded") }, { id: "filled", label: t("Filled template"), hint: t("With the current fields") }]}
              onExport={(f) => (f === "kept" ? downloadTemplateFile(mod, cur) : exportTemplate(mod, cur, "xlsx"))} />
          </div>
          {fields.isError ? <p role="alert" className="mx-muted">{t("The target fields could not be loaded")} <Button variant="ghost" onClick={() => void fields.refetch()}>{t("Retry")}</Button></p> : null}
          {unmapped.length ? (
            <DataTable<Unmapped>
              label={t("Columns without a target field")}
              rows={unmapped}
              rowKey={(u) => `${u.sheet}::${u.header}`}
              columns={[
                { key: "s", label: t("Sheet"), render: (u) => u.sheet },
                { key: "h", label: t("Column"), render: (u) => <FieldChip code={u.header} description={u.mandatory ? t("Mandatory") : undefined} /> },
                { key: "m", label: t("Target field"), render: (u) => (
                  <Select aria-label={t("Target field for {col}", { col: u.header })} value={draft[`${u.sheet}::${u.header}`] ?? cur.column_map[`${u.sheet}::${u.header}`] ?? ""} onChange={(e) => setDraft({ ...draft, [`${u.sheet}::${u.header}`]: e.target.value })}
                    options={[{ value: "", label: t("Not mapped") }, ...(fields.data?.fields ?? []).map((f) => ({ value: f.field, label: `${f.field} ${f.description}` }))]} />
                ) },
              ]}
            />
          ) : <EmptyState heading={t("Every column has a target field")} body={t("Nothing to map. Download the template to load.")} />}
          {Object.keys(draft).length ? <div className="mx-actions"><Button variant="primary" onClick={() => save.mutate(cur)} disabled={save.isPending}>{t("Save the mapping")}</Button></div> : null}
        </Card>
      ) : null}
      {report ? (
        <Card title={t("Check result")}>
          <dl className="mx-tiles">
            <StatTile label={t("Rows")} value={report.summary.rows.toLocaleString()} note={`${t("Ready")}: ${report.summary.ready.toLocaleString()}`} />
            <StatTile label={t("Held")} value={report.summary.held.toLocaleString()} note={`${t("Columns matched")}: ${report.summary.matched_columns} / ${report.summary.columns}`} />
            <StatTile label={t("Mandatory columns unmapped")} value={String(report.summary.mandatory_unmapped)} />
          </dl>
          <DataTable
            label={t("Held rows")}
            rows={report.held}
            rowKey={(h) => `${h.sheet}|${h.record}|${h.field}`}
            columns={[
              { key: "s", label: t("Sheet"), render: (h) => h.sheet },
              { key: "r", label: t("Record"), render: (h) => <code className="mx-code">{h.record}</code> },
              { key: "f", label: t("Field"), render: (h) => <FieldChip code={h.field} /> },
              { key: "w", label: t("Reason"), render: (h) => humanize(h.reason) },
            ]}
          />
        </Card>
      ) : null}
      </div>
    </>
  );
}
