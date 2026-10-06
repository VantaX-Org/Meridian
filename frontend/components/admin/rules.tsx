"use client";

/**
 * Admin, Rules: the check library — shipped YAML rules, HQ rules, rules
 * mined from profiled data and rules a steward wrote — faceted by module,
 * check type, dimension, severity, authority and source, with each rule's
 * last-run pass rate. A tenant can enable or disable a rule here, and a
 * steward can author a new one from an existing check type: dry-run it on an
 * analysed version, then save (source 'custom').
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, Field, FilterBar, Input, KeyValue, Mono, PageHeader, Select,
  StatusBadge, TableSkeleton, Tally, Textarea, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { createCustomRule, dryRunRule, getRules, getRulesSummary, updateRule, type CheckClass, type CustomRuleDraft, type DryRunResult, type Rule } from "@/lib/api/rules";
import { getVersions } from "@/lib/api/versions";
import { checkClassLabel, formatModuleName, formatDate, labelOf } from "@/lib/format";

const HREF = "/admin?tab=rules";
const meta = (m: AuroraColumnMeta) => m;
const CATEGORY_LABEL: Record<string, string> = { ecc: "ECC", successfactors: "SuccessFactors", warehouse: "Warehouse" };
const SOURCE_LABEL: Record<string, string> = { yaml: "built-in", hq: "HQ", mined: "mined", custom: "custom" };
const AUTHORING: CheckClass[] = ["null_check", "domain_value_check", "regex_check", "cross_field_check", "dependency_check", "uniqueness_check"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
/** Shipped rule names start with their code ("AP001: Vendor number is mandatory"); the code gets its own column. */
const CODE_PREFIX = /^([A-Z][A-Z0-9]*\d):\s+/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const codeOf = (r: Rule) => r.name.match(CODE_PREFIX)?.[1] ?? (UUID.test(r.id) ? "" : r.id);
const nameOf = (r: Rule) => r.name.replace(CODE_PREFIX, "");
const sev = (s: string) => (s === "critical" || s === "high" || s === "low" ? s : "medium");
const authority = (r: Rule) => (r.source === "mined" || r.source === "custom" ? "customer" : "shipped");
/** Shipped rules carry a list of conditions; mined/custom rules one rule object. */
const conditionList = (r: Rule) => (Array.isArray(r.conditions) ? r.conditions : r.conditions ? [r.conditions] : []);
const valuesOf = (r: Rule, key: "check_class" | "dimension") =>
  [...new Set(conditionList(r).map((c) => c[key]).filter((v): v is string => typeof v === "string" && !!v))];
const pct = (v: number) => `${(v * (v <= 1 ? 100 : 1)).toFixed(1)} %`;
const matches = (r: Rule, q: string) => !q || [r.id, r.name, r.description ?? "", r.module, r.severity, ...(r.tags ?? [])].join(" ").toLowerCase().includes(q.toLowerCase());
const detail = (e: unknown) => (isAxiosError<{ detail?: unknown }>(e) && typeof e.response?.data?.detail === "string" ? e.response.data.detail : null) ?? "Request failed";
const splitList = (s: string) => s.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
const uniq = (xs: string[]) => [...new Set(xs)].sort();

async function getAllRules(category?: string): Promise<Rule[]> {
  const out: Rule[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await getRules({ category, limit: 1000, offset });
    out.push(...page.rules);
    if (out.length >= page.total || page.rules.length === 0) return out;
  }
}

export function RulesSurface() {
  const qc = useQueryClient();
  const canManage = useRole().can("manage_rules");
  const [category, setCategory] = useUrlState("category", "all");
  const [module, setModule] = useUrlState("module", "");
  const [check, setCheck] = useUrlState("check", "");
  const [dimension, setDimension] = useUrlState("dimension", "");
  const [severity, setSeverity] = useUrlState("severity", "");
  const [auth, setAuth] = useUrlState("authority", "");
  const [source, setSource] = useUrlState("source", "");
  const [sort, setSort] = useUrlState("sort");
  const [search, setSearch] = useState("");
  const [authoring, setAuthoring] = useState(false);
  const drawer = useDrawerParam("rule");
  const summary = useQuery({ queryKey: ["rules.summary"], queryFn: getRulesSummary });
  const rulesQ = useQuery({ queryKey: ["rules.list", { category }], queryFn: () => getAllRules(category === "all" ? undefined : category) });
  const rules = useMemo(() => rulesQ.data ?? [], [rulesQ.data]);
  const facets = useMemo(() => ({
    modules: uniq(rules.map((r) => r.module)),
    checks: uniq(rules.flatMap((r) => valuesOf(r, "check_class"))),
    dimensions: uniq(rules.flatMap((r) => valuesOf(r, "dimension"))),
    sources: uniq(rules.map((r) => r.source)),
  }), [rules]);
  const tests: Record<string, (r: Rule) => boolean> = {
    module: (r) => !module || r.module === module,
    check: (r) => !check || valuesOf(r, "check_class").includes(check),
    dimension: (r) => !dimension || valuesOf(r, "dimension").includes(dimension),
    severity: (r) => !severity || r.severity === severity,
    authority: (r) => !auth || authority(r) === auth,
    source: (r) => !source || r.source === source,
  };
  const passing = (r: Rule, skip?: string) => matches(r, search) && Object.entries(tests).every(([k, t]) => k === skip || t(r));
  const visible = rules.filter((r) => passing(r));
  const filtered = !!(search || module || check || dimension || severity || auth || source || category !== "all");
  const clearFilters = () => { setSearch(""); setModule(""); setCheck(""); setDimension(""); setSeverity(""); setAuth(""); setSource(""); setCategory("all"); };
  /** Options for one menu chip, each counted over the rules the other filters leave. */
  const group = (id: string, label: string, value: string, onChange: (v: string) => void, values: string[], format: (v: string) => string, allLabel: string) => ({
    id, label, value, onChange, allLabel,
    options: values.map((v) => ({ value: v, label: format(v), count: rules.filter((r) => passing(r, id) && (id === "module" ? r.module === v
      : id === "check" ? valuesOf(r, "check_class").includes(v) : id === "dimension" ? valuesOf(r, "dimension").includes(v)
      : id === "severity" ? r.severity === v : id === "authority" ? authority(r) === v : r.source === v)).length })),
  });
  const groups = [
    { id: "category", label: "System", value: category === "all" ? "" : category, allLabel: "All systems", onChange: (v: string) => setCategory(v || "all"),
      options: Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })) },
    ...(facets.checks.length > 1 ? [group("check", "Check type", check, setCheck, facets.checks, checkClassLabel, "All check types")] : []),
    ...(facets.dimensions.length > 1 ? [group("dimension", "Dimension", dimension, setDimension, facets.dimensions, labelOf, "All dimensions")] : []),
    group("severity", "Severity", severity, setSeverity, [...SEVERITIES], labelOf, "All severities"),
    group("authority", "Authority", auth, setAuth, ["shipped", "customer"], (a) => (a === "shipped" ? "SAP standard (shipped)" : "Customer configured"), "All authorities"),
    ...(facets.sources.length > 1 ? [group("source", "Source", source, setSource, facets.sources, (v) => labelOf(SOURCE_LABEL[v] ?? v), "All sources")] : []),
    ...(facets.modules.length > 1 ? [group("module", "Object", module, setModule, facets.modules, formatModuleName, "All objects")] : []),
  ];
  const selected = drawer.value ? rules.find((r) => r.id === drawer.value) ?? null : null;
  const totals = useMemo(() => {
    const t = { yaml: 0, other: 0, enabled: 0, disabled: 0 };
    for (const row of summary.data?.summary ?? []) { if (row.source === "yaml") t.yaml += row.count; else t.other += row.count; if (row.enabled) t.enabled += row.count; else t.disabled += row.count; }
    return t;
  }, [summary.data]);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRule(id, { enabled }),
    onSuccess: (_d, v) => { toast.success(v.enabled ? "Rule enabled" : "Rule disabled"); qc.invalidateQueries({ queryKey: ["rules.list"] }); qc.invalidateQueries({ queryKey: ["rules.summary"] }); },
    onError: (e) => toast.error((e as Error).message || "Rule not updated"),
  });

  const anyPassRate = rules.some((r) => r.last_pass_rate != null);
  const toggleRule = toggle.mutate;
  const columns = useMemo<ColumnDef<Rule, unknown>[]>(() => [
    { id: "state", header: "State", accessorFn: (r) => (r.enabled ? 1 : 0), meta: meta({ sticky: "start", width: 96 }), cell: ({ row }) => {
      const r = row.original;
      const text = labelOf(r.enabled ? "enabled" : "disabled");
      return canManage
        ? <button type="button" className="ui-state-toggle" data-off={r.enabled ? undefined : "true"} aria-label={`${r.enabled ? "Disable" : "Enable"} ${nameOf(r)}`}
            onClick={(e) => { e.stopPropagation(); toggleRule({ id: r.id, enabled: !r.enabled }); }}>{text}</button>
        : <span className="ui-state-toggle" data-off={r.enabled ? undefined : "true"}>{text}</span>;
    } },
    { id: "code", header: "Rule ID", accessorFn: (r) => codeOf(r), meta: meta({ width: 72 }), cell: ({ row }) => <Mono>{codeOf(row.original) || "—"}</Mono> },
    { id: "rule", header: "Rule", accessorFn: (r) => nameOf(r), meta: meta({ minWidth: 260, clamp: 2 }), cell: ({ row }) => <strong>{nameOf(row.original)}</strong> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module), meta: meta({ width: 170 }) },
    { id: "check", header: "Check", accessorFn: (r) => valuesOf(r, "check_class").map(checkClassLabel).join(", "), meta: meta({ width: 170 }), cell: ({ row }) => valuesOf(row.original, "check_class").map(checkClassLabel).join(", ") || "—" },
    { id: "severity", header: "Severity", accessorFn: (r) => SEV_RANK[r.severity] ?? 0, meta: meta({ width: 110 }), cell: ({ row }) => <StatusBadge status={sev(row.original.severity)}>{labelOf(row.original.severity)}</StatusBadge> },
    { id: "source", header: "Source", accessorFn: (r) => SOURCE_LABEL[r.source] ?? r.source, meta: meta({ width: 90 }) },
    ...(anyPassRate ? [{ id: "pass", header: "Last pass rate", accessorFn: (r: Rule) => r.last_pass_rate ?? -1, meta: meta({ width: 120, align: "end" }), cell: ({ row }) => (
      <span className="ui-num" title={row.original.last_run_at ? `Last run ${formatDate(row.original.last_run_at, "datetime")}` : "Not run yet"}>
        {row.original.last_pass_rate != null ? pct(row.original.last_pass_rate) : "—"}</span>) } as ColumnDef<Rule, unknown>] : []),
  ], [canManage, toggleRule, anyPassRate]);

  return (
    <div className="ui-page">
      <PageHeader title="Rules"
        summary={`${(totals.yaml + totals.other || rules.length).toLocaleString()} rules in the library; ${totals.enabled.toLocaleString()} enabled.`}
        actions={canManage ? <Button onClick={() => setAuthoring(true)}>New rule</Button> : null} />
      <Tally level={4} label="Rule library" figures={[
        { label: "Rules", value: summary.isLoading ? null : totals.yaml + totals.other || rules.length, loading: summary.isLoading, verdict: `${totals.yaml.toLocaleString()} built in, ${totals.other.toLocaleString()} HQ, mined or custom.`, href: HREF },
        { label: "Enabled", value: summary.isLoading ? null : totals.enabled, loading: summary.isLoading, verdict: "Run on every analysis.", href: HREF },
        { label: "Disabled", value: summary.isLoading ? null : totals.disabled, loading: summary.isLoading, tone: totals.disabled ? "warning" : undefined, verdict: totals.disabled ? "Skipped by analyses." : "Every rule is active.", href: HREF },
      ]} />
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Filter rules" }} groups={groups} onClear={filtered ? clearFilters : undefined} />
      {!canManage ? <p className="ui-note">Enabling, disabling or writing a rule needs the manage-rules permission; the library is read-only for you.</p> : null}
      {rulesQ.isLoading ? <TableSkeleton rows={8} label="Reading the rule library" />
        : rulesQ.error ? <Banner tone="danger" title="Rules could not be read">{(rulesQ.error as Error).message}</Banner>
        : visible.length ? <DataTable columns={columns} data={visible} getRowId={(r) => r.id} onRowActivate={(r) => drawer.open(r.id)} ariaLabel="Rules" maxHeight="60vh" sort={sort} onSortChange={setSort} />
        : <EmptyState action={filtered ? <Button variant="ghost" onClick={clearFilters}>Clear filters</Button> : undefined}>
            No rules match. Built-in rules ship with Meridian; HQ rules arrive through HQ sync; mined and custom rules are your stewards&apos; own.
          </EmptyState>}
      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Rule details"
        header={selected ? <div className="ui-drawer-head"><StatusBadge status={sev(selected.severity)}>{selected.severity}</StatusBadge><h2 className="ui-drawer-head__title">{nameOf(selected)}</h2></div> : null}>
        {selected ? (
          <div className="ui-detail">
            {selected.description ? <p className="ui-note">{selected.description}</p> : null}
            <KeyValue rows={[
              { k: "Rule ID", v: codeOf(selected) || "—", mono: true },
              { k: "Object", v: formatModuleName(selected.module) },
              { k: "System", v: CATEGORY_LABEL[selected.category] ?? selected.category },
              { k: "Source", v: selected.source === "yaml" ? `built-in${selected.source_yaml ? `, ${selected.source_yaml}` : ""}` : SOURCE_LABEL[selected.source] ?? selected.source },
              { k: "Authority", v: authority(selected) === "shipped" ? "SAP standard (shipped)" : "Customer configured" },
              { k: "State", v: selected.enabled ? "Enabled" : "Disabled" },
              { k: "Updated", v: formatDate(selected.updated_at, "datetime") },
              { k: "Last run", v: selected.last_pass_rate != null ? `${pct(selected.last_pass_rate)} pass${selected.last_run_at ? `, ${formatDate(selected.last_run_at, "datetime")}` : ""}` : "not run yet" },
              ...(valuesOf(selected, "check_class").length
                ? [{ k: "Check", v: valuesOf(selected, "check_class").map((c, i) => <span key={c} title={c}>{i ? ", " : ""}{checkClassLabel(c)}</span>) }]
                : []),
            ]} />
            {selected.tags?.length ? <div className="ui-filterbar__chips">{selected.tags.map((t) => <Chip key={t}>{t}</Chip>)}</div> : null}
            {conditionList(selected).length ? (
              <section className="ui-detail-part"><h3 className="ui-detail-part__title">Conditions</h3>
                <pre className="ui-code">{JSON.stringify(selected.conditions, null, 2)}</pre></section>
            ) : null}
            {selected.thresholds ? (
              <section className="ui-detail-part"><h3 className="ui-detail-part__title">Thresholds</h3>
                <pre className="ui-code">{JSON.stringify(selected.thresholds, null, 2)}</pre></section>
            ) : null}
            {canManage ? (
              <div className="ui-form__actions">
                <Button variant={selected.enabled ? "danger" : "primary"} onClick={() => toggle.mutate({ id: selected.id, enabled: !selected.enabled })} disabled={toggle.isPending}>
                  {selected.enabled ? "Disable rule" : "Enable rule"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DetailDrawer>
      {canManage ? <AuthorDrawer open={authoring} onClose={() => setAuthoring(false)} modules={facets.modules} /> : null}
    </div>
  );
}

const EMPTY: CustomRuleDraft = { module: "", check_class: "null_check", message: "", severity: "medium" };

/** Build a rule from an existing check type; Save is enabled only after a clean dry run of the current draft. */
function AuthorDrawer({ open, onClose, modules }: { open: boolean; onClose: () => void; modules: string[] }) {
  const qc = useQueryClient();
  const [draft, setDraftState] = useState(EMPTY);
  const [values, setValues] = useState(""); // allowed values / unique fields, comma or newline separated
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setDraft = (patch: Partial<CustomRuleDraft>) => { setDraftState((d) => ({ ...d, ...patch })); setResult(null); setError(null); };
  const versions = useQuery({
    queryKey: ["versions", draft.module],
    queryFn: () => getVersions({ module: draft.module, limit: 20 }),
    enabled: open && !!draft.module,
    select: (d) => d.versions,
  });
  const cls = draft.check_class;
  const body: CustomRuleDraft = {
    ...draft,
    dimension: draft.dimension || undefined,
    allowed_values: cls === "domain_value_check" ? splitList(values) : undefined,
    fields: cls === "uniqueness_check" ? splitList(values) : undefined,
  };
  const dry = useMutation({
    mutationFn: () => dryRunRule(body),
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setResult(null); setError(detail(e)); },
  });
  const save = useMutation({
    mutationFn: () => createCustomRule(body),
    onSuccess: (r) => {
      toast.success(`${r.name.split(":")[0]} saved; it runs on the next analysis`);
      qc.invalidateQueries({ queryKey: ["rules.list"] }); qc.invalidateQueries({ queryKey: ["rules.summary"] });
      setDraftState(EMPTY); setValues(""); setResult(null); onClose();
    },
    onError: (e) => setError(detail(e)),
  });
  const needsField = cls !== "cross_field_check" && cls !== "uniqueness_check";
  const text = (key: "field" | "pattern" | "determinant" | "message", label: string, helper?: string) => (
    <Field label={label} helper={helper}>
      {({ controlId }) => <Input id={controlId} value={draft[key] ?? ""} onChange={(e) => setDraft({ [key]: e.target.value })} className={key === "message" ? undefined : "ui-mono"} />}
    </Field>
  );

  return (
    <DetailDrawer open={open} onClose={onClose} ariaLabel="New rule" header={<div className="ui-drawer-head"><h2 className="ui-drawer-head__title">New rule</h2></div>}
      footer={
        <div className="ui-form__actions" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Discard draft</Button>
          <Button variant="secondary" disabled={!draft.version_id || dry.isPending} onClick={() => dry.mutate()}>{dry.isPending ? "Running…" : "Dry run"}</Button>
          <Button disabled={!result || !!result.error || save.isPending} onClick={() => save.mutate()}>Save rule</Button>
        </div>
      }>
      <div className="ui-form">
        <p className="ui-note">
          Build a check from an existing check type. Fields are SAP TABLE.FIELD names and are checked against the data
          dictionary. Dry-run it on an analysed version, then save; it runs on every later analysis of the object.
        </p>
        <Field label="Object">
          {({ controlId }) => <Select id={controlId} placeholder="Choose an object" value={draft.module}
            options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))} onValueChange={(m) => setDraft({ module: m, version_id: undefined })} />}
        </Field>
        <Field label="Check type">
          {({ controlId }) => <Select<CheckClass> id={controlId} value={cls}
            options={AUTHORING.map((c) => ({ value: c, label: checkClassLabel(c) }))} onValueChange={(c) => setDraft({ check_class: c })} />}
        </Field>
        {cls === "dependency_check" && text("determinant", "Determining field", "e.g. LFA1.KTOKK; its value decides the field below")}
        {needsField && text("field", "Field", "e.g. LFA1.STCD1")}
        {cls === "regex_check" && text("pattern", "Pattern (regular expression)", "Values that do not match fail, e.g. ^[0-9]{10}$")}
        {(cls === "domain_value_check" || cls === "uniqueness_check") && (
          <Field label={cls === "domain_value_check" ? "Allowed values" : "Fields that must be unique together"} helper="Comma or newline separated">
            {({ controlId }) => <Textarea id={controlId} rows={3} className="ui-mono" value={values} onChange={(e) => { setValues(e.target.value); setResult(null); }} />}
          </Field>
        )}
        {cls === "cross_field_check" && (
          <Field label="Fails when" helper="Backtick columns; use == != < > and, or, not, .isna() / .notna(), e.g. `LFA1.LAND1` == 'ZA' and `LFA1.STCD1`.isna()">
            {({ controlId }) => <Textarea id={controlId} rows={3} className="ui-mono" value={draft.fail_when ?? ""} onChange={(e) => setDraft({ fail_when: e.target.value })} />}
          </Field>
        )}
        {text("message", "Message", "What a failing record means, shown on each finding")}
        <div className="ui-form__grid">
          <Field label="Severity">
            {({ controlId }) => <Select id={controlId} value={draft.severity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} onValueChange={(s) => setDraft({ severity: s })} />}
          </Field>
          <Field label="Dimension">
            {({ controlId }) => <Select id={controlId} value={draft.dimension ?? ""}
              options={[{ value: "", label: "Default for the check type" }, ...DIMENSIONS.map((d) => ({ value: d, label: d }))]} onValueChange={(d) => setDraft({ dimension: d })} />}
          </Field>
        </div>
        <Field label="Dry run against" helper={draft.module && versions.data?.length === 0 ? "No analysed version holds this object yet" : undefined}>
          {({ controlId }) => <Select id={controlId} placeholder={draft.module ? "Choose a version" : "Choose an object first"}
            value={draft.version_id ?? ""} disabled={!versions.data?.length}
            options={(versions.data ?? []).map((v) => ({ value: v.id, label: `${formatDate(v.run_at, "datetime")}${v.label ? `, ${v.label}` : ""}` }))}
            onValueChange={(v) => setDraft({ version_id: v })} />}
        </Field>
        {error ? <Banner tone="danger" title="Not valid yet">{error}</Banner> : null}
        {result ? (result.error ? <Banner tone="danger" title="The rule errored on this data">{result.error}</Banner> : (
          <section className="ui-detail-part" aria-label="Dry run">
            <h3 className="ui-detail-part__title">Dry run{result.grain ? <span className="ui-chip-count">per {result.grain} record</span> : null}</h3>
            <KeyValue rows={[
              { k: "Checked", v: result.population.toLocaleString() },
              { k: "Failing", v: result.failing.toLocaleString() },
              { k: "Pass rate", v: pct(result.pass_rate) },
            ]} />
            {result.sample_keys.length ? (
              <pre className="ui-code">{result.sample_keys.join("\n")}{result.failing > result.sample_keys.length ? `\n+${(result.failing - result.sample_keys.length).toLocaleString()} more` : ""}</pre>
            ) : null}
          </section>
        )) : null}
      </div>
    </DetailDrawer>
  );
}
