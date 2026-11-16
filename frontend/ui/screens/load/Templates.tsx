"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  checkTemplate, downloadBlankTemplate, downloadTemplateFile, exportTemplate, getTemplateFields, saveTemplateMapping, uploadTemplate,
  type TargetTemplate, type WorkbookReport,
} from "@/lib/api/v2/migration";
import { Button, Card, DataTable, EmptyState, FieldChip, PageHeader, Select, StatTile, useAletheiaScope, useToast } from "@/ui/kit";
import { AskButton, Gate, humanize, when } from "./common";
import { invalidateLoad, useLoadPlan, useTemplateList } from "./hooks";

type Unmapped = { sheet: string; header: string; id: string; label: string; mandatory: boolean };

/** Target templates: upload a kept workbook, map the columns the dictionary missed, check it, hand it over. */
export function Templates() {
  useInterfaceLang();
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<WorkbookReport | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const bad = () => toast(t("The action failed"), "bad");
  const fields = useQuery({ queryKey: ["ui", "load", fx, "tplfields", mod], queryFn: () => getTemplateFields(mod) });
  const upload = useMutation({ mutationFn: (f: File) => uploadTemplate(mod, f, f.name.replace(/\.[^.]+$/, "")), onSuccess: () => { toast(t("Template kept"), "good"); invalidateLoad(qc); }, onError: bad });
  const check = useMutation({ mutationFn: (x: TargetTemplate) => checkTemplate(mod, x.id), onSuccess: (r) => { setReport(r); toast(t("Template checked"), "good"); }, onError: bad });
  const save = useMutation({ mutationFn: (x: TargetTemplate) => saveTemplateMapping(mod, x.id, { ...x.column_map, ...draft }), onSuccess: () => { setDraft({}); toast(t("Mapping saved"), "good"); invalidateLoad(qc); }, onError: bad });

  const unmapped: Unmapped[] = (cur?.coverage?.sheets ?? []).flatMap((s) => s.unmapped.map((u) => ({ sheet: s.name, ...u })));

  useAletheiaScope({
    key: "load/templates",
    label: t("Asking about target templates"),
    suggestions: [t("Which columns are not mapped?")],
    answer: () => ({ text: t("{n} columns are not mapped in the selected template.", { n: unmapped.length }), evidence: unmapped.slice(0, 5).map((u) => `${u.sheet}: ${u.header}`) }),
  });

  return (
    <>
      <PageHeader
        title={t("Target templates")}
        context={t("Kept workbooks that the load reads and fills")}
        actions={<>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden aria-label={t("Choose a template file")} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>{t("Upload a template")}</Button>
          <Button onClick={() => downloadBlankTemplate(mod).catch(bad)}>{t("Download a blank template")}</Button>
          <AskButton />
        </>}
      />
      <div className="mx-links">
        <Select aria-label={t("Object")} value={mod} onChange={(e) => { setPick(e.target.value); setSel(null); setReport(null); }} options={(mods.length ? mods : [mod]).map((m) => ({ value: m, label: `${m} ${humanize(m)}` }))} />
      </div>
      <Gate loading={q.isLoading} error={q.isError} what={t("the templates")}>
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
        ) : <EmptyState heading={t("No template kept for this object yet")} />}
      </Gate>
      {cur ? (
        <Card title={cur.name} sub={cur.filename}>
          <div className="mx-links">
            <Button onClick={() => check.mutate(cur)} disabled={check.isPending}>{t("Check this template")}</Button>
            <Button onClick={() => downloadTemplateFile(mod, cur).catch(bad)}>{t("Download the kept file")}</Button>
            <Button onClick={() => exportTemplate(mod, cur, "xlsx").catch(bad)}>{t("Fill and download")}</Button>
          </div>
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
          ) : <EmptyState heading={t("Every column has a target field")} />}
          {Object.keys(draft).length ? <Button variant="primary" onClick={() => save.mutate(cur)} disabled={save.isPending}>{t("Save the mapping")}</Button> : null}
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
    </>
  );
}
