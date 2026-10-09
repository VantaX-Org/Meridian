"use client";

/**
 * Rules: the check library -- shipped YAML rules, HQ rules, rules mined from
 * profiled data and rules a steward wrote -- faceted by module, check type,
 * dimension, severity, authority and source, with each rule's last-run pass
 * rate. A tenant can enable or disable a rule here, and a steward can author
 * a new one from an existing check type: dry-run it on an analysed version,
 * then save (source 'custom').
 *
 * ponytail: no "Thresholds" (readiness threshold / value-per-record) section
 * here -- grep of frontend/lib/api/*.ts and api/routes/*.py found no such
 * settings endpoint (only an unrelated per-feature `value_per_record` field
 * on the insights API). Per the brief, the section is omitted rather than
 * stubbed; see task-11-report.md.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { Button, DataTable, Drawer, EmptyState, ErrorState, Field, Mono, Pill, Select, Skeleton, Stat, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { createCustomRule, dryRunRule, getRules, getRulesSummary, updateRule, type CheckClass, type CustomRuleDraft, type DryRunResult, type Rule } from "@/lib/api/rules";
import { getVersions } from "@/lib/api/versions";
import { getSystems } from "@/lib/api/connectivity";
import { getConfigAwareScore, type ConfigAwareModule } from "@/lib/api/config-load";
import { apiErrorMessage } from "@/lib/error";
import { checkClassLabel, DIMENSIONS, formatModuleName, formatDate, labelOf } from "@/lib/format";
import { MM_VIEWS } from "@/lib/material-views";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";

const CATEGORY_LABEL: Record<string, string> = { ecc: "ECC", successfactors: "SuccessFactors", warehouse: "Warehouse" };
const SOURCE_LABEL: Record<string, string> = { yaml: "built-in", hq: "HQ", mined: "mined", custom: "custom" };
const AUTHORING: CheckClass[] = ["null_check", "domain_value_check", "regex_check", "cross_field_check", "dependency_check", "uniqueness_check"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEV_TONE: Record<string, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral" };
/** Shipped rule names start with their code ("AP001: Vendor number is mandatory"); the code gets its own column. */
const CODE_PREFIX = /^([A-Z][A-Z0-9]*\d):\s+/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const codeOf = (r: Rule) => r.name.match(CODE_PREFIX)?.[1] ?? (UUID.test(r.id) ? "" : r.id);
const nameOf = (r: Rule) => r.name.replace(CODE_PREFIX, "");
const authority = (r: Rule) => (r.source === "mined" || r.source === "custom" ? "customer" : "shipped");
/** The SAP table a rule is anchored on: the prefix of its first condition's field. */
const tableOf = (r: Rule) => {
  const f = conditionList(r)[0]?.field;
  return typeof f === "string" && f.includes(".") ? f.slice(0, f.indexOf(".")) : "";
};
/** Material master only: a rule is in a view when the view lists its table. A heuristic; the coverage page has the authoritative map. */
const inView = (r: Rule, module: string, view: string) =>
  (!module || module === "material_master") && (MM_VIEWS.find((v) => v.id === view)?.tables as readonly string[] | undefined)?.includes(tableOf(r)) === true;
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

export default function RulesPage() {
  const qc = useQueryClient();
  const canManage = useRole().can("manage_rules");
  const dayOne = useDayOne();
  const hasFinishedRun = dayOne.status !== "loading" && dayOne.step === null;
  const [category, setCategory] = useUrlState("category", "all");
  const [module, setModule] = useUrlState("module", "");
  const [check, setCheck] = useUrlState("check", "");
  const [dimension, setDimension] = useUrlState("dimension", "");
  const [severity, setSeverity] = useUrlState("severity", "");
  const [auth, setAuth] = useUrlState("authority", "");
  const [source, setSource] = useUrlState("source", "");
  const [table, setTable] = useUrlState("table", "");
  const [view, setView] = useUrlState("view", "");
  const [search, setSearch] = useState("");
  const [authoring, setAuthoring] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [cfgSystem, setCfgSystem] = useUrlState("config_system", "");
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, meta: { ignoreError: true } });
  const awareQ = useQuery({
    queryKey: queryKeys.configAwareScore(undefined, cfgSystem),
    queryFn: () => getConfigAwareScore({ system_id: cfgSystem || undefined }),
    retry: false,
    meta: { ignoreError: true },
  });
  const awareByModule = useMemo(
    () => new Map<string, ConfigAwareModule>((awareQ.data?.modules ?? []).map((m) => [m.module, m])),
    [awareQ.data],
  );

  const summary = useQuery({ queryKey: queryKeys.rulesSummary(), queryFn: getRulesSummary });
  const rulesQ = useQuery({ queryKey: queryKeys.rules({ category }), queryFn: () => getAllRules(category === "all" ? undefined : category) });
  const rules = useMemo(() => rulesQ.data ?? [], [rulesQ.data]);
  const facets = useMemo(() => ({
    modules: uniq(rules.map((r) => r.module)),
    checks: uniq(rules.flatMap((r) => valuesOf(r, "check_class"))),
    dimensions: uniq(rules.flatMap((r) => valuesOf(r, "dimension"))),
    sources: uniq(rules.map((r) => r.source)),
    tables: uniq(rules.map(tableOf).filter(Boolean)),
    views: module === "material_master" ? MM_VIEWS.map((v) => v.id) : [],
  }), [rules, module]);
  const tests: Record<string, (r: Rule) => boolean> = {
    module: (r) => !module || r.module === module,
    check: (r) => !check || valuesOf(r, "check_class").includes(check),
    dimension: (r) => !dimension || valuesOf(r, "dimension").includes(dimension),
    severity: (r) => !severity || r.severity === severity,
    authority: (r) => !auth || authority(r) === auth,
    source: (r) => !source || r.source === source,
    table: (r) => !table || tableOf(r) === table,
    view: (r) => !view || inView(r, module, view),
  };
  const passing = (r: Rule) => matches(r, search) && Object.values(tests).every((t) => t(r));
  const visible = rules.filter(passing);
  const filtered = !!(search || module || check || dimension || severity || auth || source || table || view || category !== "all");
  const clearFilters = () => { setSearch(""); setModule(""); setCheck(""); setDimension(""); setSeverity(""); setAuth(""); setSource(""); setTable(""); setView(""); setCategory("all"); };

  const selected = selectedId ? rules.find((r) => r.id === selectedId) ?? null : null;
  const totals = useMemo(() => {
    const t = { yaml: 0, other: 0, enabled: 0, disabled: 0 };
    for (const row of summary.data?.summary ?? []) { if (row.source === "yaml") t.yaml += row.count; else t.other += row.count; if (row.enabled) t.enabled += row.count; else t.disabled += row.count; }
    return t;
  }, [summary.data]);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRule(id, { enabled }),
    onSuccess: (_d, v) => { toast.success(v.enabled ? "Rule enabled" : "Rule disabled"); qc.invalidateQueries({ queryKey: ["rules"] }); },
    onError: (e) => toast.error((e as Error).message || "Rule not updated"),
  });

  const anyPassRate = rules.some((r) => r.last_pass_rate != null);
  const toggleRule = toggle.mutate;
  const columns = useMemo<ColumnDef<Rule>[]>(() => [
    {
      id: "state", header: "State",
      cell: ({ row }) => {
        const r = row.original;
        return canManage ? (
          <button
            type="button"
            aria-label={`${r.enabled ? "Disable" : "Enable"} ${nameOf(r)}`}
            onClick={(e) => { e.stopPropagation(); toggleRule({ id: r.id, enabled: !r.enabled }); }}
          >
            <Pill tone={r.enabled ? "go" : "neutral"}>{labelOf(r.enabled ? "enabled" : "disabled")}</Pill>
          </button>
        ) : (
          <Pill tone={r.enabled ? "go" : "neutral"}>{labelOf(r.enabled ? "enabled" : "disabled")}</Pill>
        );
      },
    },
    { id: "code", header: "Rule ID", cell: ({ row }) => <Mono>{codeOf(row.original) || "—"}</Mono> },
    { id: "rule", header: "Rule", cell: ({ row }) => <strong>{nameOf(row.original)}</strong> },
    { id: "module", header: "Object", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "check", header: "Check", cell: ({ row }) => valuesOf(row.original, "check_class").map(checkClassLabel).join(", ") || "—" },
    { id: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEV_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "source", header: "Source", cell: ({ row }) => labelOf(SOURCE_LABEL[row.original.source] ?? row.original.source) },
    ...(anyPassRate ? [{
      id: "pass", header: "Last pass rate",
      cell: ({ row }: { row: { original: Rule } }) => (
        <span title={row.original.last_run_at ? `Last run ${formatDate(row.original.last_run_at, "datetime")}` : "Not run yet"}>
          {row.original.last_pass_rate != null ? pct(row.original.last_pass_rate) : "—"}
        </span>
      ),
    } as ColumnDef<Rule>] : []),
  ], [canManage, toggleRule, anyPassRate]);

  const coverageRows = useMemo(
    () => facets.modules.map((m) => ({ module: m, total: rules.filter((r) => r.module === m).length, aware: awareByModule.get(m) })),
    [facets.modules, rules, awareByModule],
  );
  const coverageColumns = useMemo<ColumnDef<(typeof coverageRows)[number]>[]>(() => [
    { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "total", header: "Total", cell: ({ row }) => row.original.total.toLocaleString() },
    { id: "configured", header: "Configured", cell: ({ row }) => row.original.aware ? (row.original.aware.applicable - row.original.aware.by_default).toLocaleString() : "—" },
    { id: "default", header: "Applies by default", cell: ({ row }) => row.original.aware ? row.original.aware.by_default.toLocaleString() : "—" },
    {
      id: "na", header: "Does not apply",
      cell: ({ row }) => {
        const a = row.original.aware;
        if (!a) return "—";
        if (a.not_applicable === 0) return "–";
        const reason = a.not_applicable_reasons[0]?.reason;
        return reason ? <span title={reason}>{a.not_applicable.toLocaleString()}</span> : a.not_applicable.toLocaleString();
      },
    },
    {
      id: "pass", header: "Passing applicable",
      cell: ({ row }) => {
        const a = row.original.aware;
        return !a || a.applicable === 0 ? "—" : `${a.passes.toLocaleString()} of ${a.applicable.toLocaleString()}`;
      },
    },
  ], []);

  const facetSelect = (label: string, value: string, onChange: (v: string) => void, values: string[], format: (v: string) => string, allLabel: string) =>
    values.length > 1 ? (
      <Field label={label}>
        <Select value={value} onValueChange={onChange} placeholder={allLabel} options={[{ value: "", label: allLabel }, ...values.map((v) => ({ value: v, label: format(v) }))]} />
      </Field>
    ) : null;

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Search">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter rules"
          className="rounded border px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
        />
      </Field>
      <Field label="System">
        <Select value={category === "all" ? "" : category} onValueChange={(v) => setCategory(v || "all")} placeholder="All systems"
          options={[{ value: "", label: "All systems" }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))]} />
      </Field>
      {facetSelect("Check type", check, setCheck, facets.checks, checkClassLabel, "All check types")}
      {facetSelect("Dimension", dimension, setDimension, facets.dimensions, labelOf, "All dimensions")}
      {facetSelect("Severity", severity, setSeverity, [...SEVERITIES], labelOf, "All severities")}
      <Field label="Authority">
        <Select value={auth} onValueChange={setAuth} placeholder="All authorities"
          options={[{ value: "", label: "All authorities" }, { value: "shipped", label: "SAP standard (shipped)" }, { value: "customer", label: "Customer configured" }]} />
      </Field>
      {facetSelect("Source", source, setSource, facets.sources, (v) => labelOf(SOURCE_LABEL[v] ?? v), "All sources")}
      {facetSelect("Object", module, setModule, facets.modules, formatModuleName, "All objects")}
      {facetSelect("Table", table, setTable, facets.tables, (v) => v, "All tables")}
      {facetSelect("View", view, setView, facets.views, (v) => MM_VIEWS.find((x) => x.id === v)?.label ?? v, "All views")}
      {(systemsQ.data?.length ?? 0) > 1
        ? facetSelect("Configuration", cfgSystem, setCfgSystem, (systemsQ.data ?? []).map((s) => s.id), (id) => systemsQ.data?.find((s) => s.id === id)?.name ?? id, "All systems")
        : null}
      {filtered ? <Button variant="ghost" onClick={clearFilters}>Clear filters</Button> : null}
      {canManage ? <Button onClick={() => setAuthoring(true)}>New rule</Button> : null}
    </div>
  );

  const summaryRow = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-6">
        <Stat label="Rules" value={(summary.isLoading ? rules.length : totals.yaml + totals.other || rules.length).toLocaleString()} />
        <Stat label="Enabled" value={totals.enabled.toLocaleString()} />
        <Stat label="Disabled" value={totals.disabled.toLocaleString()} delta={totals.disabled ? "Skipped by analyses" : "Every rule is active"} />
      </div>
      {!canManage ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Enabling, disabling or writing a rule needs the manage-rules permission; the library is read-only for you.</p> : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      {filterBar}
      {summaryRow}
      {coverageRows.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Coverage by object</p>
          {hasFinishedRun ? (
            <DataTable columns={coverageColumns} data={coverageRows} getRowId={(r) => r.module} />
          ) : (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--m-ink-3)" }}>
              <span>Coverage is measured on a finished run.</span>
              <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />
            </div>
          )}
        </div>
      ) : null}
      {rulesQ.isLoading ? (
        <Skeleton height={320} />
      ) : rulesQ.error ? (
        <ErrorState message={apiErrorMessage(rulesQ.error)} onRetry={() => rulesQ.refetch()} />
      ) : visible.length ? (
        <DataTable columns={columns} data={visible} getRowId={(r) => r.id} onRowClick={(r) => setSelectedId(r.id)} />
      ) : filtered ? (
        <EmptyState
          title="No rules match. Built-in rules ship with Meridian; HQ rules arrive through HQ sync; mined and custom rules are your stewards' own."
          action={<Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : (
        <EmptyState
          title="No rules loaded."
          action={<Button render={<Link href="/admin/settings">Open settings</Link>} />}
        />
      )}

      <Drawer open={!!selected} onOpenChange={(o) => { if (!o) setSelectedId(null); }} title={selected ? nameOf(selected) : "Rule"}>
        {selected ? (
          <div className="flex flex-col gap-3">
            {selected.description ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{selected.description}</p> : null}
            <dl className="flex flex-col gap-1 text-[13px]">
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Rule ID</dt><dd><Mono>{codeOf(selected) || "—"}</Mono></dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Object</dt><dd>{formatModuleName(selected.module)}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>System</dt><dd>{CATEGORY_LABEL[selected.category] ?? selected.category}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Source</dt><dd>{selected.source === "yaml" ? `built-in${selected.source_yaml ? `, ${selected.source_yaml}` : ""}` : labelOf(SOURCE_LABEL[selected.source] ?? selected.source)}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Authority</dt><dd>{authority(selected) === "shipped" ? "SAP standard (shipped)" : "Customer configured"}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>State</dt><dd><Pill tone={selected.enabled ? "go" : "neutral"}>{labelOf(selected.enabled ? "enabled" : "disabled")}</Pill></dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Updated</dt><dd>{formatDate(selected.updated_at, "datetime")}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Last run</dt><dd>{selected.last_pass_rate != null ? `${pct(selected.last_pass_rate)} pass${selected.last_run_at ? `, ${formatDate(selected.last_run_at, "datetime")}` : ""}` : "not run yet"}</dd></div>
            </dl>
            {selected.tags?.length ? <div className="flex flex-wrap gap-1">{selected.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}</div> : null}
            {conditionList(selected).length ? (
              <section>
                <h3 className="text-[13px] font-semibold">Conditions</h3>
                <pre className="text-[12px] overflow-auto">{JSON.stringify(selected.conditions, null, 2)}</pre>
              </section>
            ) : null}
            {selected.thresholds ? (
              <section>
                <h3 className="text-[13px] font-semibold">Thresholds</h3>
                <pre className="text-[12px] overflow-auto">{JSON.stringify(selected.thresholds, null, 2)}</pre>
              </section>
            ) : null}
            {codeOf(selected) ? <p className="text-[13px]"><Link className="underline" href={`/rules/${selected.id}`}>Open rule page</Link></p> : null}
            {canManage ? (
              <Button variant={selected.enabled ? "secondary" : "primary"} onClick={() => toggle.mutate({ id: selected.id, enabled: !selected.enabled })} disabled={toggle.isPending}>
                {selected.enabled ? "Disable rule" : "Enable rule"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Drawer>

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
    queryKey: queryKeys.versionsList({ module: draft.module, limit: 20 }),
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
      qc.invalidateQueries({ queryKey: ["rules"] });
      setDraftState(EMPTY); setValues(""); setResult(null); onClose();
    },
    onError: (e) => setError(detail(e)),
  });
  const needsField = cls !== "cross_field_check" && cls !== "uniqueness_check";
  const textInput = (key: "field" | "pattern" | "determinant" | "message", label: string) => (
    <Field label={label}>
      <input
        value={draft[key] ?? ""}
        onChange={(e) => setDraft({ [key]: e.target.value })}
        className="rounded border px-3 py-1.5 text-[13px] w-full"
        style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
      />
    </Field>
  );

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="New rule">
      <div className="flex flex-col gap-3">
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          Build a check from an existing check type. Fields are SAP TABLE.FIELD names and are checked against the data
          dictionary. Dry-run it on an analysed version, then save; it runs on every later analysis of the object.
        </p>
        <Field label="Object">
          <Select value={draft.module} onValueChange={(m) => setDraft({ module: m, version_id: undefined })} placeholder="Choose an object"
            options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))} />
        </Field>
        <Field label="Check type">
          <Select value={cls} onValueChange={(c) => setDraft({ check_class: c as CheckClass })}
            options={AUTHORING.map((c) => ({ value: c, label: checkClassLabel(c) }))} />
        </Field>
        {cls === "dependency_check" && textInput("determinant", "Determining field (e.g. LFA1.KTOKK; its value decides the field below)")}
        {needsField && textInput("field", "Field (e.g. LFA1.STCD1)")}
        {cls === "regex_check" && textInput("pattern", "Pattern (regular expression -- values that do not match fail, e.g. ^[0-9]{10}$)")}
        {(cls === "domain_value_check" || cls === "uniqueness_check") && (
          <Field label={cls === "domain_value_check" ? "Allowed values (comma or newline separated)" : "Fields that must be unique together (comma or newline separated)"}>
            <textarea
              rows={3}
              value={values}
              onChange={(e) => { setValues(e.target.value); setResult(null); }}
              className="rounded border px-3 py-1.5 text-[13px] w-full"
              style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
            />
          </Field>
        )}
        {cls === "cross_field_check" && (
          <Field label="Fails when (backtick columns; use == != < > and, or, not, .isna() / .notna(), e.g. `LFA1.LAND1` == 'ZA' and `LFA1.STCD1`.isna())">
            <textarea
              rows={3}
              value={draft.fail_when ?? ""}
              onChange={(e) => setDraft({ fail_when: e.target.value })}
              className="rounded border px-3 py-1.5 text-[13px] w-full"
              style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
            />
          </Field>
        )}
        {textInput("message", "Message (what a failing record means, shown on each finding)")}
        <Field label="Severity">
          <Select value={draft.severity} onValueChange={(s) => setDraft({ severity: s as CustomRuleDraft["severity"] })}
            options={SEVERITIES.map((s) => ({ value: s, label: labelOf(s) }))} />
        </Field>
        <Field label="Dimension">
          <Select value={draft.dimension ?? ""} onValueChange={(d) => setDraft({ dimension: d })}
            options={[{ value: "", label: "Default for the check type" }, ...DIMENSIONS.map((d) => ({ value: d.id, label: d.label }))]} />
        </Field>
        <Field label="Dry run against">
          <Select value={draft.version_id ?? ""} onValueChange={(v) => setDraft({ version_id: v })}
            placeholder={draft.module ? "Choose a version" : "Choose an object first"}
            options={(versions.data ?? []).map((v) => ({ value: v.id, label: `${formatDate(v.run_at, "datetime")}${v.label ? `, ${v.label}` : ""}` }))} />
        </Field>
        {draft.module && versions.data?.length === 0 ? <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>No analysed version holds this object yet</p> : null}
        {error ? (
          <div role="alert" className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}>
            Not valid yet: {error}
          </div>
        ) : null}
        {result ? (result.error ? (
          <div role="alert" className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}>
            The rule errored on this data: {result.error}
          </div>
        ) : (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">Dry run{result.grain ? ` -- per ${result.grain} record` : ""}</h3>
            <dl className="flex flex-col gap-1 text-[13px]">
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Checked</dt><dd>{result.population.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Failing</dt><dd>{result.failing.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Pass rate</dt><dd>{pct(result.pass_rate)}</dd></div>
            </dl>
            {result.sample_keys.length ? (
              <pre className="text-[12px] overflow-auto">{result.sample_keys.join("\n")}{result.failing > result.sample_keys.length ? `\n+${(result.failing - result.sample_keys.length).toLocaleString()} more` : ""}</pre>
            ) : null}
          </section>
        )) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Discard draft</Button>
          <Button variant="secondary" disabled={!draft.version_id || dry.isPending} onClick={() => dry.mutate()}>{dry.isPending ? "Running…" : "Dry run"}</Button>
          <Button disabled={!result || !!result.error || save.isPending} onClick={() => save.mutate()}>Save rule</Button>
        </div>
      </div>
    </Drawer>
  );
}
