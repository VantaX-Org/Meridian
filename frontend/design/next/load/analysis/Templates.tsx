"use client";

/** The template library: target templates kept per object, checked and filled from the latest finished run, with a column map for what they do not resolve. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { checkTemplate, downloadBlankTemplate, downloadTemplateFile, exportTemplate, getTemplateFields, getTemplates, saveTemplateMapping, uploadTemplate, type TargetTemplate } from "@/lib/api/v2/migration";
import { formatDate } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { Button, Code, EmptyState, ErrorState, Skeleton, useToast } from "../../kit";
import { Panel } from "../parts";
import { Labelled, Table, status, useMig } from "./shared";
import { WORKBOOK_TYPES } from "./Workbook";

export function TemplateLibraryPanel() {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const objects = useLandscape(null).data?.objects ?? [];
  const [module, setModule] = useUrlParam<string>("tpl_module", "material_master");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState<string | null>(null);
  const list = useMig(["templates", module], () => getTemplates(module));
  const write = can("analyse") && !shared && !viewAs;
  const take = can("export") && !shared && !viewAs;
  const fail = (msg: string) => (e: unknown) => toast({ text: errorSentence(e, msg), tone: "bad" });
  const saved = (n: string) => toast({ text: t("Saved as {name}", { name: n }), tone: "good" });
  const upload = useMutation({
    mutationFn: () => uploadTemplate(module, file as File, name),
    onSuccess: (r) => { toast({ text: t("{name} is kept as version {v}.", { name: r.name, v: int(r.version) }), tone: "good" }); setFile(null); setName(""); void qc.invalidateQueries({ queryKey: ["migration", "templates"] }); },
    onError: fail(t("The template could not be kept.")),
  });
  const blank = useMutation({ mutationFn: () => downloadBlankTemplate(module), onSuccess: saved, onError: fail(t("The blank template could not be prepared.")) });
  const original = useMutation({ mutationFn: (tp: TargetTemplate) => downloadTemplateFile(module, tp), onSuccess: saved, onError: fail(t("The template could not be read.")) });
  const fill = useMutation({
    mutationFn: (tp: TargetTemplate) => exportTemplate(module, tp, "xlsx"),
    onSuccess: (n) => { saved(n); void qc.invalidateQueries({ queryKey: ["migration", "templates"] }); },
    onError: fail(t("The template could not be filled.")),
  });
  const check = useMutation({ mutationFn: (tp: TargetTemplate) => checkTemplate(module, tp.id), onError: fail(t("The template could not be checked.")) });
  const rows = list.data?.templates ?? [];
  const report = check.data;
  const editing = rows.find((r) => r.id === mapping) ?? null;
  return (
    <Panel title={t("Template library")} meta={t("Target templates kept per object, filled from the latest finished run")} testId="mig-templates">
      <form className="nx-ld-filters" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}>
        <Labelled label={t("Object")}>
          <select className="nx-input" value={module} onChange={(e) => { setModule(e.target.value); setMapping(null); check.reset(); }}>
            {[...new Set([module, ...objects.map((o) => o.module)])].map((m) => <option key={m} value={m}>{moduleText(m)}</option>)}
          </select>
        </Labelled>
        {write ? (
          <>
            <Labelled label={t("Template name")}><input className="nx-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Labelled>
            <Labelled label={t("Template file")}><input type="file" className="nx-input" accept={WORKBOOK_TYPES} data-testid="mig-template-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Labelled>
            <Button type="submit" variant="primary" disabled={!file} loading={upload.isPending} loadingLabel={t("Keeping the template")}>{t("Keep the template")}</Button>
          </>
        ) : null}
        {take ? <Button variant="secondary" data-testid="mig-template-blank" loading={blank.isPending} onClick={() => blank.mutate()}>{t("Download a blank template")}</Button> : null}
      </form>
      <p className="nx-ld-meta">{t("A blank template lists every field the object's rules read, with its description, whether it is required and its allowed values. The same name again is kept as a new version, with the column corrections carried over.")}</p>
      {list.isPending ? <Skeleton /> : list.isError ? (
        status(list.error) === 403 ? <EmptyState heading={t("Your role cannot read the template library.")} /> : <ErrorState sentence={t("The template library could not be read.")} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? <EmptyState heading={t("No template is kept for this object yet.")} /> : (
        <Table<TargetTemplate>
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.name}
          caption={t("Template library")}
          columns={[
            { id: "tpl", label: t("Template"), cell: (r) => <>{t("{name}, version {v}", { name: r.name, v: int(r.version) })}<div className="nx-ld-meta">{r.filename}</div></> },
            { id: "cov", label: t("Columns resolved"), cell: (r) => (r.coverage ? t("{a} of {b}", { a: int(r.coverage.matched), b: int(r.coverage.columns) }) : "-") },
            { id: "fill", label: t("Last filled"), cell: (r) => (r.last_fill_at ? formatDate(r.last_fill_at, "datetime") : t("Never")) },
            {
              id: "act", label: t("Actions"), cell: (r) => (
                <div className="nx-ld-actions">
                  {take ? <>
                    <Button variant="secondary" size={32} onClick={() => original.mutate(r)}>{t("Original")}</Button>
                    <Button variant="secondary" size={32} data-testid={`mig-template-check-${r.id}`} disabled={check.isPending} onClick={() => check.mutate(r)}>{t("Check")}</Button>
                    <Button variant="primary" size={32} disabled={fill.isPending} onClick={() => fill.mutate(r)}>{t("Fill from the latest run")}</Button>
                  </> : null}
                  {write && (r.coverage?.matched ?? 0) < (r.coverage?.columns ?? 0) ? (
                    <Button variant="secondary" size={32} aria-expanded={mapping === r.id} data-testid={`mig-template-map-${r.id}`} onClick={() => setMapping((m) => (m === r.id ? null : r.id))}>{t("Map columns")}</Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}
      {report ? (
        <div role="status" data-testid="mig-template-report">
          <p>{t("{ready} rows are ready and {held} are held back. {filled} of {sheets} sheets can be filled, with {matched} of {columns} columns.", { ready: int(report.summary.ready), held: int(report.summary.held), filled: int(report.summary.filled_sheets), sheets: int(report.summary.sheets), matched: int(report.summary.matched_columns), columns: int(report.summary.columns) })}</p>
          {report.cleansed ? <p className="nx-ld-meta">{t("{n} approved cleansing values were applied, changing {c} cells.", { n: int(report.cleansed.approved), c: int(report.cleansed.cells_changed) })}</p> : null}
        </div>
      ) : null}
      {editing ? <TemplateMappingForm module={module} template={editing} onDone={() => setMapping(null)} /> : null}
    </Panel>
  );
}

function TemplateMappingForm({ module, template, onDone }: { module: string; template: TargetTemplate; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fields = useMig(["template-fields", module], () => getTemplateFields(module));
  const open = template.coverage?.sheets.flatMap((s) => s.unmapped.map((u) => ({ key: `${s.name}::${u.header}`, sheet: s.name, ...u }))) ?? [];
  const [picks, setPicks] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => saveTemplateMapping(module, template.id, picks),
    onSuccess: (r) => { toast({ text: t("The column map is saved. {a} of {b} columns resolve.", { a: int(r.coverage.matched), b: int(r.coverage.columns) }), tone: "good" }); void qc.invalidateQueries({ queryKey: ["migration", "templates"] }); onDone(); },
    onError: (e) => toast({ text: errorSentence(e, t("The column map could not be saved.")), tone: "bad" }),
  });
  return (
    <form data-testid="mig-template-mapping" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="nx-ld-meta">{t("Choose the field each unresolved column holds. Only fields of this object's tables are offered. A column left open is reported as absent.")}</p>
      {fields.isPending ? <Skeleton /> : fields.isError ? <ErrorState sentence={t("The fields could not be read.")} onRetry={() => void fields.refetch()} /> : (
        <Table
          rows={open}
          rowKey={(u) => u.key}
          rowLabel={(u) => u.header}
          caption={t("Unresolved columns")}
          columns={[
            { id: "sheet", label: t("Sheet"), cell: (u) => u.sheet },
            { id: "col", label: t("Column"), cell: (u) => <Code code={u.id} text={u.label} /> },
            {
              id: "field", label: t("Field"), cell: (u) => (
                <select className="nx-input" aria-label={t("Field for {column}", { column: u.header })} value={picks[u.key] ?? ""} onChange={(e) => setPicks((p) => ({ ...p, [u.key]: e.target.value }))}>
                  <option value="">{t("Leave open")}</option>
                  {fields.data.fields.map((f) => <option key={f.field} value={f.field}>{`${f.field} ${f.description}`}</option>)}
                </select>
              ),
            },
          ]}
        />
      )}
      <div className="nx-ld-actions">
        <Button type="submit" variant="primary" disabled={Object.values(picks).every((v) => !v)} loading={save.isPending}>{t("Save the column map")}</Button>
      </div>
    </form>
  );
}
