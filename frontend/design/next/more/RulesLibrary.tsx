"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { checkClassLabel, formatDate, labelOf } from "@/lib/format";
import { CHECK_CLASSES, DIMENSIONS, EMPTY_FORM, SEVERITIES, formToBody, ruleToForm, validateForm, type DraftForm } from "@/lib/v2/draft-model";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import {
  createDraft, deleteDraft, dryRunDraftBody, endSuppression, generateDraft, getModuleRules, publishDraftById, setRuleEnabled, updateDraft,
  type MigrationRelevance, type MigrationScenario, type MigrationScenarioId, type MigrationScenarioRule, type RuleDraft, type RuleDraftDryRun,
} from "@/lib/api/v2/rulelib";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useRuleTrend } from "@/lib/v2/runs-queries";
import { useScopeSystem } from "@/lib/v2/scope";
import { activeFilterCount, filterRows, NO_FILTERS, rankRows, toRows, type LibFilters, type LibRow, type StateFilter } from "@/lib/v2/rules-library";
import { int } from "@/lib/v2/score";
import { sysKeys, useAllDrafts, useMigrationScenarios, useRefreshV2, useRuleList, useSuppressions } from "@/lib/v2/sys-queries";
import { t, tx } from "@/lib/v2/i18n";
import { Button, Code, Confirm, DataTable, SegmentedControl, SidePanel, Sparkline, StatCard, useToast, type Column } from "../kit";
import { SegBar } from "../kit/viz";

type View = "rules" | "drafts" | "suppressions";

/** The name of each migration scenario. The id is the API's; the words are the interface's. */
export function scenarioName(id: MigrationScenarioId): string {
  switch (id) {
    case "new_implementation": return t("New implementation");
    case "system_conversion": return t("System conversion");
    case "selective_transition": return t("Selective data transition");
    case "carve_out": return t("Carve-out");
  }
}

function scenarioText(s: Pick<MigrationScenario, "id" | "description">): string {
  switch (s.id) {
    case "new_implementation": return t("A fresh S/4HANA system loaded through the migration cockpit, with no history carried over.");
    case "system_conversion": return t("The existing ECC system is converted in place and must pass the conversion pre-checks.");
    case "selective_transition": return t("Chosen objects and organisational units are copied into S/4HANA while the rest stays behind.");
    case "carve_out": return t("One company code or business unit is extracted into its own S/4HANA system.");
    default: return tx(s.description);
  }
}

function relevanceLabel(r: MigrationRelevance): string {
  switch (r) {
    case "required": return t("Required");
    case "recommended": return t("Recommended");
    case "not_applicable": return t("Not applicable");
  }
}

const notRun = () => <span className="nx-sub">{t("Not run yet")}</span>;

function ruleColumns(trend: Map<string, readonly (number | null)[]>): Column<LibRow>[] {
  return [
    { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.checkId} text={r.message} />, compare: (a, b) => a.checkId.localeCompare(b.checkId) },
    { id: "object", label: t("Object"), cell: (r) => labelOf(r.module) },
    { id: "severity", label: t("Severity"), cell: (r) => labelOf(r.severity) },
    { id: "failing", label: t("Failing"), align: "end", cell: (r) => (r.failing == null ? notRun() : int(r.failing)), compare: (a, b) => (a.failing ?? -1) - (b.failing ?? -1) },
    { id: "pass", label: t("Pass rate"), align: "end", cell: (r) => (r.passRate == null ? notRun() : `${r.passRate.toFixed(1)}%`), compare: (a, b) => (a.passRate ?? -1) - (b.passRate ?? -1) },
    {
      id: "ribbon",
      label: t("Across runs"),
      cell: (r) => {
        const pts = (trend.get(`${r.module}|${r.checkId}`) ?? []).filter((v): v is number => v != null);
        return <Sparkline points={pts} label={t("Across runs")} />;
      },
    },
    { id: "state", label: t("State"), cell: (r) => (r.suppressed ? t("Suppressed") : r.enabled ? t("Enabled") : t("Disabled")) },
    { id: "source", label: t("Source"), cell: (r) => (r.source === "yaml" ? t("Shipped") : t("Custom")) },
    { id: "dimension", label: t("Dimension"), cell: (r) => (r.dimension ? labelOf(r.dimension) : <span className="nx-sub">{t("Read from the object's rules when you filter by dimension")}</span>) },
    { id: "class", label: t("Class"), cell: (r) => (r.checkClass ? labelOf(r.checkClass) : <span className="nx-sub">{t("Read from the object's rules when you filter by class")}</span>) },
  ];
}

/** The columns a migration scenario adds: how much the rule matters for that path, and why. */
function scenarioColumns(byId: Map<string, MigrationScenarioRule>): Column<LibRow>[] {
  return [
    { id: "relevance", label: t("Migration relevance"), cell: (r) => { const m = byId.get(r.checkId); return m ? relevanceLabel(m.relevance) : null; } },
    { id: "s4area", label: t("S/4 area"), cell: (r) => { const a = byId.get(r.checkId)?.s4_area; return a ? labelOf(a) : <span className="nx-sub">{t("This rule records no S/4HANA area")}</span>; } },
    { id: "why", label: t("Why"), cell: (r) => { const m = byId.get(r.checkId); return m ? <>{tx(m.rationale)}{m.impact_note ? ` ${m.impact_note}` : ""}</> : null; } },
  ];
}

function Select({ label, value, onChange, options, first, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; first: string; hint?: string }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      <select className="nx-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{first}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint ? <small className="nx-sub">{hint}</small> : null}
    </label>
  );
}

function FilterBar({ f, set, modules }: { f: LibFilters; set: (f: LibFilters) => void; modules: string[] }) {
  const opts = (list: readonly string[]) => list.map((value) => ({ value, label: labelOf(value) }));
  const sel = (label: string, key: keyof LibFilters, options: { value: string; label: string }[]) => (
    <Select label={label} value={f[key]} onChange={(v) => set({ ...f, [key]: v })} options={options} first={t("All")} />
  );
  const states: { value: StateFilter; label: string }[] = [
    { value: "enabled", label: t("Enabled") },
    { value: "disabled", label: t("Disabled") },
    { value: "suppressed", label: t("Suppressed") },
    { value: "custom", label: t("Custom rules") },
  ];
  return (
    <div className="nx-row nx-wrap" role="search" aria-label={t("Filter the rules")}>
      <label className="nx-field">
        <span>{t("Search")}</span>
        <input className="nx-input" type="search" value={f.search} placeholder={t("Code, name or object")} onChange={(e) => set({ ...f, search: e.target.value })} />
      </label>
      {sel(t("Object"), "module", modules.map((m) => ({ value: m, label: labelOf(m) })))}
      {sel(t("Dimension"), "dimension", opts(DIMENSIONS))}
      {sel(t("Severity"), "severity", opts(SEVERITIES))}
      {sel(t("Class"), "checkClass", opts(CHECK_CLASSES))}
      {sel(t("State"), "state", states)}
    </div>
  );
}

function ScenarioPanel({ scenarios, chosen, onChoose }: { scenarios: MigrationScenario[]; chosen: MigrationScenarioId | ""; onChoose: (id: MigrationScenarioId | "") => void }) {
  const columns: Column<MigrationScenario>[] = [
    { id: "name", label: t("Scenario"), cell: (s) => scenarioName(s.id) },
    { id: "what", label: t("What it is"), cell: (s) => scenarioText(s) },
    { id: "required", label: t("Required"), align: "end", cell: (s) => int(s.counts.required) },
    { id: "recommended", label: t("Recommended"), align: "end", cell: (s) => int(s.counts.recommended) },
    { id: "na", label: t("Not applicable"), align: "end", cell: (s) => int(s.counts.not_applicable) },
    { id: "blocking", label: t("Blocking"), align: "end", cell: (s) => int(s.blocking) },
    {
      id: "act",
      label: t("Actions"),
      cell: (s) => (
        <Button size={32} variant={chosen === s.id ? "primary" : "secondary"} aria-pressed={chosen === s.id} aria-label={t("Show the rules for {name}", { name: scenarioName(s.id) })} onClick={() => onChoose(chosen === s.id ? "" : s.id)}>
          {chosen === s.id ? t("Showing") : t("Show rules")}
        </Button>
      ),
    },
  ];
  return (
    <section className="nx-card" aria-label={t("Migration scenarios")} data-testid="migration-scenarios">
      <h2>{t("Which rules matter for your S/4HANA path")}</h2>
      <DataTable rows={scenarios} columns={columns} rowKey={(s) => s.id} rowLabel={(s) => scenarioName(s.id)} caption={t("Migration scenarios")} density="compact" />
      <p className="nx-sub">{t("Counts are the enabled shipped rules. A rule flagged as a migration blocker is required for a system conversion and a selective data transition.")}</p>
    </section>
  );
}

function ScenarioFilter({ scenarios, scenario, relevance, onScenario, onRelevance }: { scenarios: MigrationScenario[]; scenario: MigrationScenarioId | ""; relevance: MigrationRelevance | ""; onScenario: (id: MigrationScenarioId | "") => void; onRelevance: (r: MigrationRelevance | "") => void }) {
  const chosen = scenarios.find((s) => s.id === scenario);
  return (
    <div className="nx-row nx-wrap" role="search" aria-label={t("Filter by migration scenario")}>
      <Select
        label={t("Migration scenario")}
        hint={chosen ? scenarioText(chosen) : t("Show only the rules that matter for one path to S/4HANA.")}
        value={scenario}
        onChange={(v) => { onScenario(v as MigrationScenarioId | ""); onRelevance(""); }}
        first={t("Any scenario")}
        options={scenarios.map((s) => ({ value: s.id, label: scenarioName(s.id) }))}
      />
      {scenario ? (
        <Select
          label={t("Relevance")}
          value={relevance}
          onChange={(v) => onRelevance(v as MigrationRelevance | "")}
          first={t("All")}
          options={(["required", "recommended", "not_applicable"] as const).map((r) => ({ value: r, label: relevanceLabel(r) }))}
        />
      ) : null}
    </div>
  );
}

/* ---- drafts ---- */

type Outcome = { tone: "good" | "bad" | "neutral"; text: string };

function useRun() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<Outcome>) => {
    setPending(key);
    try {
      const o = await fn();
      toast(o);
    } catch (e) {
      toast({ tone: "bad", text: errorSentence(e, t("It did not go through")) });
    } finally {
      setPending(null);
    }
  };
  return { pending, run };
}

function DraftEditor({ draft, modules, onClose }: { draft: RuleDraft | null; modules: string[]; onClose: () => void }) {
  const refresh = useRefreshV2();
  const { pending, run } = useRun();
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
  const busy = pending !== null;

  const generate = () =>
    void run("generate", async () => {
      const g = await generateDraft({ module: form.module.trim(), description: prompt.trim() });
      setForm(ruleToForm(g.rule, form.module));
      setDry(null);
      return g.valid
        ? { tone: "good", text: `${t("Draft generated")}. ${t("Review it, dry run it, then save.")}` }
        : { tone: "bad", text: `${t("Draft generated with problems to fix")}. ${g.errors.join(" ")}` };
    });
  const dryRun = guard(() =>
    void run("dry", async () => {
      setDry(await dryRunDraftBody(formToBody(form)));
      return { tone: "neutral", text: t("Dry run finished") };
    }),
  );
  const save = guard(() =>
    void run("save", async () => {
      if (draft) await updateDraft(draft.id, formToBody(form));
      else await createDraft(formToBody(form));
      refresh();
      onClose();
      return { tone: "good", text: draft ? t("Draft saved") : t("Draft created") };
    }),
  );
  const publish = () =>
    void run("publish", async () => {
      if (!draft) throw new Error(t("Save the draft first."));
      await updateDraft(draft.id, formToBody(form));
      const r = await publishDraftById(draft.id);
      refresh();
      onClose();
      return { tone: "good", text: `${t("{split} is published", { split: r.name.split(":")[0] })}. ${t("It runs from the next analysis.")}` };
    });
  const remove = () =>
    void run("remove", async () => {
      if (draft) await deleteDraft(draft.id);
      refresh();
      onClose();
      return { tone: "good", text: t("Draft deleted") };
    });

  const field = (label: string, k: keyof DraftForm, input: React.ReactNode, hint?: string) => (
    <label className="nx-field">
      <span>{label}</span>
      {input}
      {hint ? <small className="nx-sub">{hint}</small> : null}
      {err(k) ? <small className="nx-banner" data-tone="bad" role="alert">{err(k)}</small> : null}
    </label>
  );
  const pick = (k: keyof DraftForm, list: readonly string[], text: (v: string) => string, first?: string) => (
    <select className="nx-input" value={form[k]} onChange={(e) => set(k, e.target.value)}>
      {first ? <option value="">{first}</option> : null}
      {list.map((c) => <option key={c} value={c}>{text(c)}</option>)}
    </select>
  );

  return (
    <SidePanel
      open
      onClose={onClose}
      title={draft ? t("Edit draft") : t("New draft")}
      footer={
        <div className="nx-row nx-wrap">
          <Button disabled={busy} loading={pending === "dry"} onClick={dryRun}>{t("Dry run")}</Button>
          <Button variant="primary" disabled={busy} loading={pending === "save"} onClick={save}>{draft ? t("Save draft") : t("Create draft")}</Button>
          {draft ? <Button disabled={busy || !valid} loading={pending === "publish"} onClick={publish}>{t("Publish rule")}</Button> : null}
          {draft ? <Button variant="quiet" aria-expanded={removing} onClick={() => setRemoving(true)}>{t("Delete draft")}</Button> : null}
          <Button variant="quiet" onClick={onClose}>{t("Close")}</Button>
        </div>
      }
    >
      <form className="nx-form" noValidate aria-label={draft ? t("Edit draft") : t("New draft")} onSubmit={(e) => e.preventDefault()} data-testid="draft-editor">
        {!draft ? (
          <>
            <label className="nx-field">
              <span>{t("Describe the rule in plain English")}</span>
              <textarea className="nx-input" value={prompt} placeholder={t("Vendors in Germany must have a VAT registration number")} onChange={(e) => setPrompt(e.target.value)} />
              <small className="nx-sub">{t("Needs an object chosen. The result is a draft for the form below, never published.")}</small>
            </label>
            <div className="nx-row">
              <Button disabled={prompt.trim().length < 5 || !form.module || busy} loading={pending === "generate"} onClick={generate}>{t("Generate a draft")}</Button>
            </div>
          </>
        ) : null}
        {field(t("Rule id"), "id", <input className="nx-input nx-mono" value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="ZR000500" />)}
        {field(t("Object"), "module", pick("module", options, labelOf, t("Choose an object")))}
        {field(t("Check class"), "check_class", pick("check_class", CHECK_CLASSES, (c) => tx(checkClassLabel(c))))}
        {field(t("Field"), "field", <input className="nx-input nx-mono" value={form.field} onChange={(e) => set("field", e.target.value)} />, t("The table and field, such as MARA.MATNR"))}
        {field(t("Severity"), "severity", pick("severity", SEVERITIES, labelOf))}
        {field(t("Dimension"), "dimension", pick("dimension", DIMENSIONS, labelOf))}
        {field(t("Message stewards see"), "message", <input className="nx-input" value={form.message} onChange={(e) => set("message", e.target.value)} />)}
        {field(
          t("Conditions (JSON)"),
          "conditions",
          <textarea className="nx-input nx-mono" value={form.conditions} onChange={(e) => set("conditions", e.target.value)} />,
          t("Every other key of the rule: pattern, allowed_values, fail_when and so on."),
        )}
        {dry ? (
          <p className="nx-banner" data-tone={dry.evaluated ? "info" : "warn"} role="status" data-testid="dry-run-result">
            {dry.evaluated ? t("{hits} of {population} records would fail (pass rate {value}%).", { hits: int(dry.hits), population: int(dry.population), value: dry.pass_rate.toFixed(1) }) : dry.reason}
          </p>
        ) : null}
      </form>
      <Confirm
        open={removing}
        title={t("Delete draft")}
        consequence={t("The draft is deleted. A published rule is not affected.")}
        confirmLabel={t("Delete draft")}
        danger
        onConfirm={() => { setRemoving(false); remove(); }}
        onCancel={() => setRemoving(false)}
      />
    </SidePanel>
  );
}

function Drafts({ modules, editing, setEditing }: { modules: string[]; editing: RuleDraft | "new" | null; setEditing: (d: RuleDraft | "new" | null) => void }) {
  const q = useAllDrafts(true);
  const items = q.data ?? [];
  const columns: Column<RuleDraft>[] = [
    { id: "draft", label: t("Draft"), cell: (d) => <Code code={String(d.proposed_rule.id ?? "")} text={d.proposed_rule.message ?? t("Untitled draft")} /> },
    { id: "object", label: t("Object"), cell: (d) => labelOf(d.domain.replace("dq_rule:", "")) },
    { id: "severity", label: t("Severity"), cell: (d) => (d.proposed_rule.severity ? labelOf(d.proposed_rule.severity) : null) },
    { id: "saved", label: t("Saved"), cell: (d) => (d.created_at ? formatDate(d.created_at, "date") : null) },
    {
      id: "act",
      label: t("Actions"),
      cell: (d) => <Button size={32} aria-label={t("Edit draft {id}", { id: d.proposed_rule.id ?? d.id })} onClick={() => setEditing(d)}>{t("Edit")}</Button>,
    },
  ];
  return (
    <>
      {editing ? <DraftEditor key={editing === "new" ? "new" : editing.id} draft={editing === "new" ? null : editing} modules={modules} onClose={() => setEditing(null)} /> : null}
      <div data-testid="drafts-table">
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(d) => d.id}
          rowLabel={(d) => String(d.proposed_rule.id ?? d.id)}
          caption={t("Drafts")}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The drafts could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No drafts. Write a rule, or describe it in plain English; a dry run shows what it would find before it is published.") }}
          onOpenRow={(d) => setEditing(d)}
        />
      </div>
    </>
  );
}

type Suppression = { id: string; check_id: string; message: string; reason: string; expires_at: string; active: boolean };

function Suppressions({ canEnd }: { canEnd: boolean }) {
  const q = useSuppressions();
  const refresh = useRefreshV2();
  const { pending, run } = useRun();
  const items = ((q.data?.suppressions ?? []) as Suppression[]).filter((s) => s.active);
  const columns: Column<Suppression>[] = [
    { id: "rule", label: t("Rule"), cell: (s) => <Code code={s.check_id} text={s.message} /> },
    { id: "reason", label: t("Reason"), cell: (s) => s.reason },
    { id: "until", label: t("Until"), cell: (s) => formatDate(s.expires_at, "date") },
    {
      id: "act",
      label: t("Actions"),
      hidden: !canEnd,
      cell: (s) => (
        <Button
          size={32}
          disabled={pending !== null}
          loading={pending === `end:${s.id}`}
          aria-label={t("End the suppression of {check_id}", { check_id: s.check_id })}
          onClick={() =>
            void run(`end:${s.id}`, async () => {
              await endSuppression(s.id);
              refresh();
              return { tone: "good", text: `${t("{check_id} counts in the score again", { check_id: s.check_id })}. ${t("It takes effect on the next run.")}` };
            })
          }
        >
          {t("End suppression")}
        </Button>
      ),
    },
  ];
  return (
    <>
      <div data-testid="suppressions-table">
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(s) => s.id}
          rowLabel={(s) => s.check_id}
          caption={t("Suppressed")}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The suppressions could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No rule is suppressed. A suppression keeps a rule out of the score until a date; start one from the rule.") }}
        />
      </div>
      {!canEnd ? <p className="nx-sub" data-testid="suppressions-gate">{t("Ending a suppression needs the approve permission.")}</p> : null}
    </>
  );
}

/**
 * Every rule of the tenant across objects. Search and filter by object, dimension, severity, class, state and migration
 * scenario; a table ranked worst severity first; a row opens the rule page. With manage_rules there are drafts (create,
 * edit, dry run, publish, delete) and enabling or disabling selected rules. Dimension and class are read from each
 * object's rules the first time you filter by them.
 */
export function RulesLibrary() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const router = useRouter();
  const refresh = useRefreshV2();
  const canManage = can("manage_rules");
  const list = useRuleList();
  const sup = useSuppressions();
  const landscape = useLandscape(null).data;
  const params = useSearchParams();
  // `?object={module}` or `?module=` opens the library on one object.
  const [filters, setFilters] = useState<LibFilters>(() => ({ ...NO_FILTERS, module: params.get("object") ?? params.get("module") ?? "" }));
  const [view, setView] = useUrlParam<View>("view", "rules", ["rules", "drafts", "suppressions"]);
  const [editing, setEditing] = useState<RuleDraft | "new" | null>(null);
  const { pending, run } = useRun();

  const rules = useMemo(() => list.data?.rules ?? [], [list.data]);
  const modules = useMemo(() => [...new Set([...rules.map((r) => r.module), ...(landscape?.objects.map((o) => o.module) ?? [])])].sort(), [rules, landscape]);
  const needMeta = Boolean(filters.dimension || filters.checkClass);
  const wanted = useMemo(() => (needMeta ? [...new Set(rules.map((r) => r.module))].filter((m) => !filters.module || m === filters.module) : []), [needMeta, rules, filters.module]);
  const coverage = useQueries({ queries: wanted.map((m) => ({ queryKey: sysKeys.coverage(fixture, m), queryFn: () => getModuleRules(m), retry: false, staleTime: 60 * 1000 })) });
  const loadingMeta = coverage.some((c) => c.isLoading);
  const covMap = useMemo(() => new Map(coverage.flatMap((c) => (c.data ? [[c.data.module, c.data] as const] : []))), [coverage]);
  const suppressed = useMemo(() => new Set((sup.data?.suppressions ?? []).filter((s) => s.active).map((s) => s.check_id)), [sup.data]);
  const rows = useMemo(() => rankRows(toRows(rules, suppressed, covMap)), [rules, suppressed, covMap]);
  const [scenario, setScenario] = useState<MigrationScenarioId | "">("");
  const [relevance, setRelevance] = useState<MigrationRelevance | "">("");
  const summary = useMigrationScenarios(null);
  const scen = useMigrationScenarios(scenario || null);
  const scenarios = (summary.data ?? scen.data)?.scenarios ?? [];
  const byId = useMemo(() => new Map((scen.data?.rules ?? []).map((m) => [m.id, m] as const)), [scen.data]);
  const scopeSystem = useScopeSystem();
  const ruleTrend = useRuleTrend((scopeSystem ?? landscape?.systems[0])?.id ?? null).data;
  const columns = useMemo(() => {
    const base = ruleColumns(new Map((ruleTrend?.rules ?? []).map((x) => [`${x.module}|${x.check_id}`, x.failing] as const)));
    return scenario ? [...base, ...scenarioColumns(byId)] : base;
  }, [scenario, byId, ruleTrend]);
  const shown = useMemo(() => {
    const base = filterRows(rows, filters);
    return scenario ? base.filter((r) => { const m = byId.get(r.checkId); return m && (!relevance || m.relevance === relevance); }) : base;
  }, [rows, filters, scenario, relevance, byId]);
  const filtered = activeFilterCount(filters) + (scenario ? 1 : 0);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const openRule = (checkId: string) => router.push(`/more/rules/${encodeURIComponent(checkId)}`);
  const newDraft = () => { setView("drafts"); setEditing("new"); };

  const toggle = (keys: string[], enabled: boolean) =>
    void run("toggle", async () => {
      const selected = keys.flatMap((k) => byKey.get(k) ?? []);
      await Promise.all(selected.map((r) => setRuleEnabled(r.id, enabled)));
      refresh();
      return {
        tone: "good",
        text: `${t("{selectedCount} {selectedCount, plural, one {rule} other {rules}} {state, select, enabled {enabled} other {disabled}}", { selectedCount: selected.length, state: enabled ? "enabled" : "disabled" })}. ${t("It takes effect on the next analysis.")}`,
      };
    });

  const segs = [
    { value: "rules" as const, label: t("All rules"), show: true },
    { value: "drafts" as const, label: t("Drafts"), show: canManage },
    { value: "suppressions" as const, label: suppressed.size ? t("Suppressed {count}", { count: suppressed.size }) : t("Suppressed"), show: true },
  ].filter((s) => s.show);

  const failingRows = rows.filter((r) => (r.failing ?? 0) > 0 && r.enabled && !r.suppressed);
  const worst = [...failingRows].sort((a, b) => (b.failing ?? 0) - (a.failing ?? 0))[0];
  const byModule = new Map<string, number>();
  for (const r of failingRows) byModule.set(r.module, (byModule.get(r.module) ?? 0) + 1);
  const moduleBars = [...byModule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const enabledCount = rows.filter((r) => r.enabled).length;

  return (
    <div className="nx-body" data-testid="rules-library">
      <p className="nx-sub">{t("Every check Meridian runs on your data. Counts come from each object's newest finished run. Open a rule to see its failing records and where it is used.")}</p>
      {!list.isLoading && !list.isError ? (
        <>
          <section className="nx-card" aria-label={t("Rules summary")} data-testid="rules-banner">
            <p className="nx-sub">{t("Rules library")}</p>
            <h2>{failingRows.length > 0 ? t("{n} {count, plural, one {rule fails} other {rules fail}} on live data", { n: int(failingRows.length), count: failingRows.length }) : t("No enabled rule fails")}</h2>
            {worst ? (
              <p className="nx-row nx-wrap">
                <span>{t("The worst is")}</span> <Code code={worst.checkId} text={worst.message} /> <span>{t("{n} failing records", { n: int(worst.failing ?? 0) })}</span>
              </p>
            ) : null}
            <div className="nx-statgrid">
              <StatCard label={t("Rules")} value={rows.length} format={int} />
              <StatCard label={t("Enabled")} value={enabledCount} format={int} />
              <StatCard label={t("Suppressed")} value={suppressed.size} format={int} />
            </div>
            <ul className="nx-sub">
              <li>{t("across {n} objects", { n: modules.length })}. {t("Every rule in the library, enabled or not.")}</li>
              <li>{t("run on every analysis")}. {t("Enabled rules are measured in each run and move the score.")}</li>
              <li>{t("kept out of the score")}. {t("Suppressed rules are still measured but do not count against the score.")}</li>
            </ul>
            {worst ? (
              <p className="nx-row nx-wrap">
                <Link className="nx-btn nx-btn-primary" href={`/more/rules/${encodeURIComponent(worst.checkId)}`}>{t("Open the rule with most findings")}</Link>
                <span className="nx-sub">{t("It has the most failing records, so fixing it moves the score most.")}</span>
              </p>
            ) : canManage ? (
              <div className="nx-row"><Button variant="primary" onClick={newDraft}>{t("New rule draft")}</Button></div>
            ) : null}
          </section>
          {moduleBars.length > 0 ? (
            <section className="nx-card" aria-label={t("Failing rules by object")} data-testid="rules-by-object">
              <h2>{t("Failing rules by object")}</h2>
              <SegBar format={int} segs={moduleBars.map(([m, n], i) => ({ key: m, label: labelOf(m), value: n, tone: i === 0 ? "bad" : "data" }))} />
            </section>
          ) : null}
        </>
      ) : null}

      <p className="nx-row nx-wrap nx-sub" data-testid="rules-status-line">
        <span>{list.isLoading ? t("Reading the rules") : t("{total} rules across {modulesCount} objects", { total: int(list.data?.total ?? 0), modulesCount: modules.length })}</span>
        {rows.length ? <span>{t("{filterCount} enabled", { filterCount: enabledCount })}</span> : null}
        {suppressed.size ? <span>{t("{size} suppressed", { size: suppressed.size })}</span> : null}
      </p>

      <div className="nx-row nx-wrap">
        <SegmentedControl label={t("Show")} value={view} onChange={setView} items={segs} />
        {canManage ? <Button onClick={newDraft}>{t("New rule draft")}</Button> : null}
      </div>
      <p className="nx-sub">
        {view === "drafts"
          ? t("A draft is not live. It runs on every analysis only after you publish it.")
          : view === "suppressions"
            ? t("A suppressed rule is still measured but stays out of the score until the suppression ends.")
            : t("Enabled rules run on every analysis and move the score. Select rules to switch them on or off.")}
      </p>
      {!canManage ? <p className="nx-sub" data-testid="rules-gate">{t("Writing a rule draft and enabling or disabling rules needs the manage rules permission.")}</p> : null}

      {view === "drafts" && canManage ? (
        <Drafts modules={modules} editing={editing} setEditing={setEditing} />
      ) : view === "suppressions" ? (
        <Suppressions canEnd={can("approve")} />
      ) : (
        <>
          {scenarios.length ? <ScenarioPanel scenarios={scenarios} chosen={scenario} onChoose={(id) => { setScenario(id); setRelevance(""); }} /> : null}
          <FilterBar f={filters} set={setFilters} modules={modules} />
          {scenarios.length ? <ScenarioFilter scenarios={scenarios} scenario={scenario} relevance={relevance} onScenario={setScenario} onRelevance={setRelevance} /> : null}
          {scenario && scen.isLoading ? <p className="nx-sub" role="status">{t("Reading the migration scenario.")}</p> : null}
          {scenario && scen.isError ? <p className="nx-banner" data-tone="bad" role="alert">{t("The migration scenario could not be read.")}</p> : null}
          {needMeta && loadingMeta ? <p className="nx-sub" role="status">{t("Reading the dimension and class of each object's rules.")}</p> : null}
          <DataTable
            rows={shown}
            columns={columns}
            rowKey={(r) => r.id}
            rowLabel={(r) => r.checkId}
            caption={t("Rules library")}
            total={shown.length}
            selectable={canManage}
            loading={list.isLoading}
            error={list.isError ? { sentence: t("The rules could not be read."), onRetry: () => void list.refetch() } : undefined}
            empty={{ heading: filtered ? t("No rule matches these filters.") : t("No rules yet.") }}
            onOpenRow={(r) => openRule(r.checkId)}
            bulkActions={(keys) => (
              <>
                <span className="nx-sub" data-testid="bulk-consequence">
                  {t("{n, plural, one {Enable switches the selected rule on and Disable switches it off} other {Enable switches the # selected rules on and Disable switches them off}}, both from the next analysis. Disabled rules leave the score.", { n: keys.length })}
                </span>
                <Button size={32} disabled={pending !== null} onClick={() => toggle(keys, true)}>{t("Enable")}</Button>
                <Button size={32} disabled={pending !== null} onClick={() => toggle(keys, false)}>{t("Disable")}</Button>
              </>
            )}
          />
          {filtered ? (
            <p className="nx-row nx-wrap nx-sub">
              <span>{t("{shownCount} of {rowsCount} rules. ", { shownCount: int(shown.length), rowsCount: int(rows.length) })}</span>
              <Button size={32} variant="quiet" onClick={() => { setFilters(NO_FILTERS); setScenario(""); setRelevance(""); }}>{t("Clear the filters")}</Button>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
