"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { checkClassLabel, formatDate, labelOf } from "@/lib/format";
import { CHECK_CLASSES, DIMENSIONS, EMPTY_FORM, SEVERITIES, formToBody, ruleToForm, validateForm, type DraftForm } from "@/lib/v2/draft-model";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  createDraft, deleteDraft, dryRunDraftBody, endSuppression, generateDraft, getModuleRules, publishDraftById, setRuleEnabled, updateDraft,
  type RuleDraft, type RuleDraftDryRun,
} from "@/lib/api/v2/rulelib";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { filterRows, NO_FILTERS, rankRows, toRows, activeFilterCount, type LibFilters, type LibRow, type StateFilter } from "@/lib/v2/rules-library";
import { int } from "@/lib/v2/score";
import { sysKeys, useAllDrafts, useRefreshV2, useRuleList, useSuppressions } from "@/lib/v2/sys-queries";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { ConfirmBar, Field, Gate } from "../forms";
import { Sev } from "../inspector/rule";
import { ResultFrame, useOutcome } from "../inspector/shared";
import "../object.css";
import { ScrollFrame } from "./object/ScrollFrame";
import { Dash, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton } from "../parts";
import { t, tx } from "@/lib/v2/i18n";

type View = "rules" | "drafts" | "suppressions";

const columns: GridColumn<LibRow>[] = [
  { id: "rule", get header() { return t("Rule"); }, width: 300, pin: true, locked: true, cell: (r) => (<><span className="m2-mono">{r.checkId}</span> {r.message}</>) },
  { id: "object", get header() { return t("Object"); }, width: 170, cell: (r) => labelOf(r.module) },
  { id: "severity", get header() { return t("Severity"); }, width: 110, cell: (r) => <Sev severity={r.severity} /> },
  { id: "dimension", get header() { return t("Dimension"); }, width: 120, cell: (r) => (r.dimension ? labelOf(r.dimension) : <Dash why={t("Read from the object's rules when you filter by dimension")} />) },
  { id: "class", get header() { return t("Class"); }, width: 150, cell: (r) => (r.checkClass ? labelOf(r.checkClass) : <Dash why={t("Read from the object's rules when you filter by class")} />) },
  { id: "failing", get header() { return t("Failing"); }, width: 90, numeric: true, cell: (r) => (r.failing == null ? <Dash why={t("Not run yet")} /> : int(r.failing)) },
  { id: "pass", get header() { return t("Pass rate"); }, width: 90, numeric: true, cell: (r) => (r.passRate == null ? <Dash why={t("Not run yet")} /> : `${r.passRate.toFixed(1)}%`) },
  { id: "state", get header() { return t("State"); }, width: 110, cell: (r) => (r.suppressed ? t("Suppressed") : r.enabled ? t("Enabled") : t("Disabled")) },
  { id: "source", get header() { return t("Source"); }, width: 90, cell: (r) => (r.source === "yaml" ? t("Shipped") : t("Custom")) },
];

function FilterBar({ f, set, modules }: { f: LibFilters; set: (f: LibFilters) => void; modules: string[] }) {
  const sel = (label: string, key: keyof LibFilters, options: { value: string; label: string }[]) => (
    <Field label={label}>
      {(p) => (
        <select {...p} value={f[key]} onChange={(e) => set({ ...f, [key]: e.target.value })}>
          <option value="">{t("All")}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
  const opts = (list: readonly string[]) => list.map((value) => ({ value, label: labelOf(value) }));
  return (
    <div className="m2-filters" role="search" aria-label={t("Filter the rules")}>
      <Field label={t("Search")}>{(p) => <input {...p} type="search" value={f.search} placeholder={t("Code, name or object")} onChange={(e) => set({ ...f, search: e.target.value })} />}</Field>
      {sel(t("Object"), "module", modules.map((m) => ({ value: m, label: labelOf(m) })))}
      {sel(t("Dimension"), "dimension", opts(DIMENSIONS))}
      {sel(t("Severity"), "severity", opts(SEVERITIES))}
      {sel(t("Class"), "checkClass", opts(CHECK_CLASSES))}
      {sel(t("State"), "state", [{ value: "enabled", label: t("Enabled") }, { value: "disabled", label: t("Disabled") }, { value: "suppressed", label: t("Suppressed") }, { value: "custom", label: t("Custom rules") }] as { value: StateFilter; label: string }[])}
    </div>
  );
}

/* ---- drafts ---- */

function DraftEditor({ draft, modules, onClose }: { draft: RuleDraft | null; modules: string[]; onClose: () => void }) {
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const initialModule = draft ? draft.domain.replace("dq_rule:", "") : "";
  const [form, setForm] = useState<DraftForm>(() => (draft ? ruleToForm(draft.proposed_rule, initialModule) : EMPTY_FORM));
  const [prompt, setPrompt] = useState("");
  const [dry, setDry] = useState<RuleDraftDryRun | null>(null);
  const [shown, setShown] = useState(false);
  const [removing, setRemoving] = useState(false);
  const errors = validateForm(form);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof DraftForm>(k: K, v: DraftForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDry(null);
  };
  const err = (k: keyof DraftForm) => (shown ? errors[k] : undefined);
  const guard = (fn: () => void) => () => {
    setShown(true);
    if (valid) fn();
  };
  const options = [...new Set([...modules, ...(form.module ? [form.module] : [])])].sort();

  const generate = () =>
    void run("generate", async () => {
      const g = await generateDraft({ module: form.module.trim(), description: prompt.trim() });
      setForm(ruleToForm(g.rule, form.module));
      setDry(null);
      return { tone: g.valid ? "ok" : "fail", title: g.valid ? t("Draft generated") : t("Draft generated with problems to fix"), detail: g.valid ? t("Review it, dry run it, then save.") : g.errors.join(" ") };
    });
  const dryRun = guard(() =>
    void run("dry", async () => {
      const r = await dryRunDraftBody(formToBody(form));
      setDry(r);
      return { tone: "info", title: t("Dry run finished") };
    }),
  );
  const save = guard(() =>
    void run("save", async () => {
      if (draft) await updateDraft(draft.id, formToBody(form));
      else await createDraft(formToBody(form));
      refresh();
      onClose();
      return { tone: "ok", title: draft ? t("Draft saved") : t("Draft created") };
    }),
  );
  const publish = () =>
    void run("publish", async () => {
      if (!draft) throw new Error(t("Save the draft first."));
      await updateDraft(draft.id, formToBody(form));
      const r = await publishDraftById(draft.id);
      refresh();
      onClose();
      return { tone: "ok", title: t("{split} is published", { split: r.name.split(":")[0] }), detail: t("It runs from the next analysis.") };
    });
  const remove = () =>
    void run("remove", async () => {
      if (draft) await deleteDraft(draft.id);
      refresh();
      onClose();
      return { tone: "ok", title: t("Draft deleted") };
    });

  return (
    <form className="m2-form6" noValidate aria-label={draft ? t("Edit draft") : t("New draft")} onSubmit={(e) => e.preventDefault()} data-testid="draft-editor">
      <h3>{draft ? t("Edit draft") : t("New draft")}</h3>
      {!draft ? (
        <>
          <Field label={t("Describe the rule in plain English")} hint={t("Needs an object chosen. The result is a draft for the form below, never published.")}>
            {(p) => <textarea {...p} value={prompt} placeholder={t("Vendors in Germany must have a VAT registration number")} onChange={(e) => setPrompt(e.target.value)} />}
          </Field>
          <div className="m2-acts">
            <button type="button" className="m2-btn" disabled={prompt.trim().length < 5 || !form.module || pending !== null} onClick={generate}>{t("Generate a draft")}</button>
          </div>
        </>
      ) : null}
      <div className="m2-grid2">
        <Field label={t("Rule id")} error={err("id")}>{(p) => <input {...p} className="m2-mono" value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="ZR000500" />}</Field>
        <Field label={t("Object")} error={err("module")}>
          {(p) => (
            <select {...p} value={form.module} onChange={(e) => set("module", e.target.value)}>
              <option value="">{t("Choose an object")}</option>
              {options.map((m) => (
                <option key={m} value={m}>{labelOf(m)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("Check class")}>
          {(p) => (
            <select {...p} value={form.check_class} onChange={(e) => set("check_class", e.target.value)}>
              {CHECK_CLASSES.map((c) => (
                <option key={c} value={c}>{tx(checkClassLabel(c))}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("Field")} hint={t("The table and field, such as MARA.MATNR")}>{(p) => <input {...p} className="m2-mono" value={form.field} onChange={(e) => set("field", e.target.value)} />}</Field>
        <Field label={t("Severity")}>
          {(p) => (
            <select {...p} value={form.severity} onChange={(e) => set("severity", e.target.value)}>
              {SEVERITIES.map((c) => (
                <option key={c} value={c}>{labelOf(c)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("Dimension")}>
          {(p) => (
            <select {...p} value={form.dimension} onChange={(e) => set("dimension", e.target.value)}>
              {DIMENSIONS.map((c) => (
                <option key={c} value={c}>{labelOf(c)}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label={t("Message stewards see")} error={err("message")}>{(p) => <input {...p} value={form.message} onChange={(e) => set("message", e.target.value)} />}</Field>
      <Field label={t("Conditions (JSON)")} error={err("conditions")} hint={t("Every other key of the rule: pattern, allowed_values, fail_when and so on.")}>
        {(p) => <textarea {...p} className="m2-mono" value={form.conditions} onChange={(e) => set("conditions", e.target.value)} />}
      </Field>
      {dry ? (
        <p className="m2-result" role="status" data-testid="dry-run-result">
          {dry.evaluated ? t("{hits} of {population} records would fail (pass rate {value}%).", { hits: int(dry.hits), population: int(dry.population), value: dry.pass_rate.toFixed(1) }) : dry.reason}
        </p>
      ) : null}
      <div className="m2-acts">
        <button type="button" className="m2-btn" disabled={pending !== null} onClick={dryRun}>{t("Dry run")}</button>
        <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={save}>{draft ? t("Save draft") : t("Create draft")}</button>
        {draft ? <button type="button" className="m2-btn" disabled={pending !== null || !valid} onClick={publish}>{t("Publish rule")}</button> : null}
        {draft ? <button type="button" className="m2-btn m2-ghost" aria-expanded={removing} onClick={() => setRemoving((x) => !x)}>{t("Delete draft")}</button> : null}
        <button type="button" className="m2-btn m2-ghost" onClick={onClose}>{t("Close")}</button>
      </div>
      {removing ? <ConfirmBar message={t("The draft is deleted. A published rule is not affected.")} confirmLabel={t("Delete draft")} pending={pending === "remove"} onConfirm={remove} onCancel={() => setRemoving(false)} /> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </form>
  );
}

function Drafts({ modules, editing, setEditing }: { modules: string[]; editing: RuleDraft | "new" | null; setEditing: (d: RuleDraft | "new" | null) => void }) {
  const q = useAllDrafts(true);
  if (q.isLoading) return <Skeleton width="100%" height={120} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The drafts could not be read.")}</ErrorFrame>;
  const items = q.data ?? [];
  return (
    <>
      {editing ? (
        <DraftEditor key={editing === "new" ? "new" : editing.id} draft={editing === "new" ? null : editing} modules={modules} onClose={() => setEditing(null)} />
      ) : null}
      {items.length === 0 ? (
        <EmptyFrame>{t("No drafts. Write a rule, or describe it in plain English; a dry run shows what it would find before it is published.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Table 1, scrollable")}  style={{ marginTop: "var(--m2-s3)" }}>
          <table className="m2-tbl" data-testid="drafts-table">
            <thead>
              <tr>
                <th scope="col">{t("Draft")}</th>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Severity")}</th>
                <th scope="col">{t("Saved")}</th>
                <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <th scope="row"><Mono>{String(d.proposed_rule.id ?? "")}</Mono> {d.proposed_rule.message ?? t("Untitled draft")}</th>
                  <td>{labelOf(d.domain.replace("dq_rule:", ""))}</td>
                  <td>{d.proposed_rule.severity ? <Sev severity={d.proposed_rule.severity} /> : <Dash />}</td>
                  <td>{d.created_at ? formatDate(d.created_at, "date") : <Dash />}</td>
                  <td>
                    <button type="button" className="m2-btn m2-sm" aria-label={t("Edit draft {id}", { id: d.proposed_rule.id ?? d.id })} onClick={() => setEditing(d)}>{t("Edit")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </>
  );
}

function Suppressions({ canEnd }: { canEnd: boolean }) {
  const q = useSuppressions();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  if (q.isLoading) return <Skeleton width="100%" height={100} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The suppressions could not be read.")}</ErrorFrame>;
  const items = (q.data?.suppressions ?? []).filter((s) => s.active);
  return (
    <>
      {items.length === 0 ? (
        <EmptyFrame>{t("No rule is suppressed. A suppression keeps a rule out of the score until a date; start one from the rule.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Table 2, scrollable")}>
          <table className="m2-tbl" data-testid="suppressions-table">
            <thead>
              <tr><th scope="col">{t("Rule")}</th><th scope="col">{t("Reason")}</th><th scope="col">{t("Until")}</th><th scope="col"><span className="m2-sr">{t("Actions")}</span></th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <th scope="row"><Mono>{s.check_id}</Mono></th>
                  <td>{s.reason}</td>
                  <td>{formatDate(s.expires_at, "date")}</td>
                  <td>
                    {canEnd ? (
                      <button
                        type="button"
                        className="m2-btn m2-sm"
                        disabled={pending !== null}
                        aria-label={t("End the suppression of {check_id}", { check_id: s.check_id })}
                        onClick={() =>
                          void run(`end:${s.id}`, async () => {
                            await endSuppression(s.id);
                            refresh();
                            return { tone: "ok", title: t("{check_id} counts in the score again", { check_id: s.check_id }), detail: t("It takes effect on the next run.") };
                          })
                        }
                      >
                        {t("End suppression")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      {!canEnd ? <Gate>{t("Ending a suppression needs the approve permission.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/**
 * `/rules`: every rule of the tenant across objects. Search and filter by object, dimension, severity, class and
 * state; a grid ranked worst severity first; a row opens the rule inspector. Dimension and class are not in the rules
 * list of the API, so they are read from each object's rules the first time you filter by them. With manage_rules
 * there are drafts (create, edit, dry run, publish, delete) and enabling or disabling selected rules.
 */
export function RulesLibrary() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const { open, openItem } = useOpenItem();
  const refresh = useRefreshV2();
  const canManage = can("manage_rules");
  const list = useRuleList();
  const sup = useSuppressions();
  const landscape = useLandscape(null).data;
  const params = useSearchParams();
  // `/rules?object={module}` (an object's "and N more rules") or `?module=` opens the library on one object.
  const [filters, setFilters] = useState<LibFilters>(() => ({ ...NO_FILTERS, module: params.get("object") ?? params.get("module") ?? "" }));
  const [view, setView] = useUrlParam<View>("view", "rules", ["rules", "drafts", "suppressions"]);
  const [editing, setEditing] = useState<RuleDraft | "new" | null>(null);
  const { outcome, pending, run } = useOutcome();

  const rules = useMemo(() => list.data?.rules ?? [], [list.data]);
  const modules = useMemo(() => [...new Set([...rules.map((r) => r.module), ...(landscape?.objects.map((o) => o.module) ?? [])])].sort(), [rules, landscape]);
  const needMeta = Boolean(filters.dimension || filters.checkClass);
  const wanted = useMemo(() => (needMeta ? [...new Set(rules.map((r) => r.module))].filter((m) => !filters.module || m === filters.module) : []), [needMeta, rules, filters.module]);
  const coverage = useQueries({ queries: wanted.map((m) => ({ queryKey: sysKeys.coverage(fixture, m), queryFn: () => getModuleRules(m), retry: false, staleTime: 60_000 })) });
  const loadingMeta = coverage.some((c) => c.isLoading);
  const covMap = useMemo(() => new Map(coverage.flatMap((c) => (c.data ? [[c.data.module, c.data] as const] : []))), [coverage]);
  const suppressed = useMemo(() => new Set((sup.data?.suppressions ?? []).filter((s) => s.active).map((s) => s.check_id)), [sup.data]);
  const rows = useMemo(() => rankRows(toRows(rules, suppressed, covMap)), [rules, suppressed, covMap]);
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const openId = open?.kind === "rule" ? open.id : null;

  const toggle = (selected: LibRow[], enabled: boolean, clear: () => void) =>
    void run("toggle", async () => {
      await Promise.all(selected.map((r) => setRuleEnabled(r.id, enabled)));
      clear();
      refresh();
      return { tone: "ok", title: t("{selectedCount} {selectedCount, plural, one {rule} other {rules}} {state, select, enabled {enabled} other {disabled}}", { selectedCount: selected.length, state: enabled ? "enabled" : "disabled" }), detail: t("It takes effect on the next analysis.") };
    });

  const segs: { key: View; label: string; show: boolean }[] = [
    { key: "rules", label: t("All rules"), show: true },
    { key: "drafts", label: t("Drafts"), show: canManage },
    { key: "suppressions", label: suppressed.size ? t("Suppressed {count}", { count: suppressed.size }) : t("Suppressed"), show: true },
  ];

  return (
    <>
      <PageTitle>{t("Rules")}</PageTitle>
      <p className="m2-statusline" data-testid="rules-status-line">
        <span>{list.isLoading ? t("Reading the rules") : t("{total} rules across {modulesCount} objects", { total: int(list.data?.total ?? 0), modulesCount: modules.length })}</span>
        {rows.length ? <span>{t("{filterCount} enabled", { filterCount: rows.filter((r) => r.enabled).length })}</span> : null}
        {suppressed.size ? <span>{t("{size} suppressed", { size: suppressed.size })}</span> : null}
      </p>
      <div className="m2-rbar" style={{ marginTop: "var(--m2-s4)" }}>
        <div className="m2-segs" role="group" aria-label={t("Show")}>
          {segs.filter((s) => s.show).map((s) => (
            <button key={s.key} type="button" className="m2-seg" aria-pressed={view === s.key} onClick={() => setView(s.key)}>{s.label}</button>
          ))}
        </div>
        {canManage ? (
          <button
            type="button"
            className="m2-btn m2-strong"
            onClick={() => {
              setView("drafts");
              setEditing("new");
            }}
          >
            {t("New rule draft")}
          </button>
        ) : null}
      </div>
      {!canManage ? <Gate>{t("Writing a rule draft and enabling or disabling rules needs the manage rules permission.")}</Gate> : null}

      {view === "drafts" && canManage ? (
        <Drafts modules={modules} editing={editing} setEditing={setEditing} />
      ) : view === "suppressions" ? (
        <Suppressions canEnd={can("approve")} />
      ) : (
        <>
          <FilterBar f={filters} set={setFilters} modules={modules} />
          {needMeta && loadingMeta ? <p className="m2-prov" role="status">{t("Reading the dimension and class of each object's rules.")}</p> : null}
          {list.isError ? (
            <ErrorFrame onRetry={() => void list.refetch()}>{t("The rules could not be read.")}</ErrorFrame>
          ) : list.isLoading ? (
            <Skeleton width="100%" height={240} />
          ) : (
            <ToolGrid<LibRow>
              id="rules-library"
              toolsTitle={t("Rules library")}
              toolsRoute="rules"
              toolsFilters={Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>}
              ariaLabel={t("Rules library")}
              columns={columns}
              rows={shown}
              rowId={(r) => r.id}
              count={shown.length}
              openRowId={rows.find((r) => r.checkId === openId)?.id ?? null}
              onOpen={(r) => openItem({ kind: "rule", id: r.checkId })}
              selectable={canManage}
              initialViewport={2000}
              bulkBar={({ selected, clear }) => (
                <>
                  <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => toggle(selected, true, clear)}>{t("Enable")}</button>
                  <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => toggle(selected, false, clear)}>{t("Disable")}</button>
                </>
              )}
              emptyFrame={<EmptyFrame>{activeFilterCount(filters) ? t("No rule matches these filters.") : t("No rules yet.")}</EmptyFrame>}
            />
          )}
          {activeFilterCount(filters) ? (
            <p className="m2-prov">
              {t("{shownCount} of {rowsCount} rules. ", { shownCount: int(shown.length), rowsCount: int(rows.length) })}
              <button type="button" className="m2-linkbtn" onClick={() => setFilters(NO_FILTERS)}>{t("Clear the filters")}</button>
            </p>
          ) : null}
          {outcome ? <ResultFrame outcome={outcome} /> : null}
        </>
      )}
    </>
  );
}
