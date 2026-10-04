"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import {
  Banner, Button, Chip, Drawer, Field, Input, KpiRail, Panel, Select, Stack, Stat, Text, Textarea,
} from "@/components/aurora";
import { PageHead } from "@/components/meridian/atoms";
import {
  createCustomRule, dryRunRule, getRuleHistory, getRules, updateRule,
  type CheckClass, type CustomRuleDraft, type DryRunResult, type Rule,
} from "@/lib/api/rules";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";

const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)] align-top";

const CHECK_LABEL: Record<CheckClass, string> = {
  null_check: "Required",
  domain_value_check: "Allowed values",
  regex_check: "Format",
  cross_field_check: "Cross-field",
  dependency_check: "Dependency",
  uniqueness_check: "Unique",
};
const SOURCE_LABEL: Record<Rule["source"], string> = {
  yaml: "Shipped", hq: "HQ", mined: "Mined", custom: "Custom",
};
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const SEVERITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  critical: "danger", high: "warning", medium: "info",
};

const authority = (r: Rule) => (r.source === "mined" || r.source === "custom" ? "customer" : "shipped");
const conditionList = (r: Rule) => (Array.isArray(r.conditions) ? r.conditions : r.conditions ? [r.conditions] : []);
const valuesOf = (r: Rule, key: "check_class" | "dimension") =>
  Array.from(new Set(conditionList(r).map((c) => c[key]).filter((v): v is string => typeof v === "string")));
const pct = (v: number) => `${(v * (v <= 1 ? 100 : 1)).toFixed(1)} %`;
const detail = (e: unknown) =>
  (isAxiosError<{ detail?: unknown }>(e) && typeof e.response?.data?.detail === "string"
    ? e.response.data.detail : null) ?? "Request failed";
const splitList = (s: string) => s.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);

async function getAllRules(): Promise<Rule[]> {
  const out: Rule[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await getRules({ limit: 1000, offset });
    out.push(...page.rules);
    if (out.length >= page.total || page.rules.length === 0) return out;
  }
}

function FacetRow<T extends string>({ label, options, value, onChange, format = (v) => v }: {
  label: string; options: T[]; value: string; onChange: (v: string) => void; format?: (v: T) => string;
}) {
  if (options.length < 2) return null;
  return (
    <Stack direction="row" gap={2} align="center" wrap>
      <Text variant="text-small" tone="tertiary" className="w-24">{label}</Text>
      <Chip selected={!value} onClick={() => onChange("")}>All</Chip>
      {options.map((o) => (
        <Chip key={o} selected={value === o} onClick={() => onChange(value === o ? "" : o)}>{format(o)}</Chip>
      ))}
    </Stack>
  );
}

function RuleDrawer({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const history = useQuery({
    queryKey: ["rules.history", rule?.id],
    queryFn: () => getRuleHistory(rule!.id),
    enabled: !!rule,
  });
  return (
    <Drawer open={!!rule} onClose={onClose} ariaLabel="Rule detail"
      header={rule && (
        <Stack gap={1}>
          <Text variant="text-small" tone="tertiary">{formatModuleName(rule.module)} · {SOURCE_LABEL[rule.source]}</Text>
          <span className="font-medium">{rule.name}</span>
        </Stack>
      )}>
      {rule && (
        <Stack gap={4}>
          {rule.description && <Text tone="secondary">{rule.description}</Text>}
          <Stack direction="row" gap={2} wrap>
            <Chip tone={SEVERITY_TONE[rule.severity] ?? "neutral"}>{rule.severity}</Chip>
            <Chip tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "Enabled" : "Disabled"}</Chip>
            {rule.last_pass_rate != null && <Chip>Last run {pct(rule.last_pass_rate)} pass</Chip>}
          </Stack>
          <Panel title="Conditions">
            <pre className="overflow-x-auto font-mono text-[12px] text-[var(--aurora-fg-secondary)]">
              {JSON.stringify(rule.conditions, null, 2)}
            </pre>
          </Panel>
          <Panel title="History">
            {history.isLoading ? <Text tone="muted">Reading the change log…</Text> : !history.data?.events.length ? (
              <Text tone="muted">No recorded changes since this rule was loaded.</Text>
            ) : (
              <table className="w-full text-[13px]">
                <thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Change</th></tr></thead>
                <tbody>
                  {history.data.events.map((e) => (
                    <tr key={`${e.at}-${e.action}`}>
                      <td className={`${td} aurora-number whitespace-nowrap`}>{new Date(e.at).toLocaleString()}</td>
                      <td className={td}>{e.actor ?? "—"}</td>
                      <td className={td}>
                        <div>{e.action}</div>
                        <div className="font-mono text-[12px] text-[var(--aurora-fg-tertiary)]">
                          {Object.entries(e.changes).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(" · ")}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </Stack>
      )}
    </Drawer>
  );
}

const EMPTY: Omit<CustomRuleDraft, "module"> & { module: string } = {
  module: "", check_class: "null_check", message: "", severity: "medium",
};

function AuthorDrawer({ open, onClose, modules }: { open: boolean; onClose: () => void; modules: string[] }) {
  const qc = useQueryClient();
  const [draft, setDraftState] = useState(EMPTY);
  const [values, setValues] = useState(""); // allowed values / unique fields, comma or newline separated
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setDraft = (patch: Partial<CustomRuleDraft>) => {
    setDraftState((d) => ({ ...d, ...patch }));
    setResult(null);
    setError(null);
  };
  const versions = useQuery({
    queryKey: ["versions", draft.module],
    queryFn: () => getVersions({ module: draft.module, limit: 20 }),
    enabled: open && !!draft.module,
    select: (d) => d.versions,
  });
  const body: CustomRuleDraft = {
    ...draft,
    dimension: draft.dimension || undefined,
    allowed_values: draft.check_class === "domain_value_check" ? splitList(values) : undefined,
    fields: draft.check_class === "uniqueness_check" ? splitList(values) : undefined,
  };
  const dry = useMutation({
    mutationFn: () => dryRunRule(body),
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setResult(null); setError(detail(e)); },
  });
  const save = useMutation({
    mutationFn: () => createCustomRule(body),
    onSuccess: (r) => {
      toast.success(`${r.name.split(":")[0]} saved — it runs on the next analysis`);
      void qc.invalidateQueries({ queryKey: ["rules.list"] });
      setDraftState(EMPTY); setValues(""); setResult(null);
      onClose();
    },
    onError: (e) => setError(detail(e)),
  });
  const cls = draft.check_class;
  const needsField = cls !== "cross_field_check" && cls !== "uniqueness_check";
  const text = (key: "field" | "pattern" | "determinant" | "message", label: string, helper?: string) => (
    <Field label={label} helper={helper}>
      {({ controlId }) => (
        <Input id={controlId} value={draft[key] ?? ""} onChange={(e) => setDraft({ [key]: e.target.value })}
          className={key === "message" ? undefined : "font-mono"} />
      )}
    </Field>
  );

  return (
    <Drawer open={open} onClose={onClose} ariaLabel="New rule"
      header={<span className="font-medium">New rule</span>}
      footer={
        <Stack direction="row" gap={2} justify="end">
          <Button variant="ghost" onClick={onClose}>Discard draft</Button>
          <Button variant="secondary" disabled={!draft.version_id || dry.isPending} onClick={() => dry.mutate()}>
            {dry.isPending ? "Running…" : "Dry run"}
          </Button>
          <Button disabled={!result || !!result.error || save.isPending} onClick={() => save.mutate()}>Save rule</Button>
        </Stack>
      }>
      <Stack gap={4}>
        <Text variant="text-small" tone="secondary">
          Build a check from an existing check type. Fields are SAP <span className="font-mono">TABLE.FIELD</span> names
          and are checked against the data dictionary. Dry-run it on an analysed version, then save — it runs on every
          later analysis of the module.
        </Text>
        <Field label="Module">
          {({ controlId }) => (
            <Select id={controlId} placeholder="Choose a module" value={draft.module}
              options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))}
              onValueChange={(m) => setDraft({ module: m, version_id: undefined })} />
          )}
        </Field>
        <Field label="Check type">
          {({ controlId }) => (
            <Select<CheckClass> id={controlId} value={cls}
              options={(Object.keys(CHECK_LABEL) as CheckClass[]).map((c) => ({ value: c, label: CHECK_LABEL[c] }))}
              onValueChange={(c) => setDraft({ check_class: c })} />
          )}
        </Field>
        {cls === "dependency_check" && text("determinant", "Determining field", "e.g. LFA1.KTOKK — its value decides the field below")}
        {needsField && text("field", "Field", "e.g. LFA1.STCD1")}
        {cls === "regex_check" && text("pattern", "Pattern (regular expression)", "Values that do not match fail, e.g. ^[0-9]{10}$")}
        {(cls === "domain_value_check" || cls === "uniqueness_check") && (
          <Field label={cls === "domain_value_check" ? "Allowed values" : "Fields that must be unique together"}
            helper="Comma or newline separated">
            {({ controlId }) => (
              <Textarea id={controlId} rows={3} className="font-mono" value={values}
                onChange={(e) => { setValues(e.target.value); setResult(null); }} />
            )}
          </Field>
        )}
        {cls === "cross_field_check" && (
          <Field label="Fails when" helper="Backtick columns; use == != < > & | ~ and .isna() / .notna(), e.g. `LFA1.LAND1` == 'ZA' & `LFA1.STCD1`.isna()">
            {({ controlId }) => (
              <Textarea id={controlId} rows={3} className="font-mono" value={draft.fail_when ?? ""}
                onChange={(e) => setDraft({ fail_when: e.target.value })} />
            )}
          </Field>
        )}
        {text("message", "Message", "What a failing record means, shown on each finding")}
        <Stack direction="row" gap={3}>
          <Field label="Severity" className="flex-1">
            {({ controlId }) => (
              <Select id={controlId} value={draft.severity} options={SEVERITIES.map((s) => ({ value: s, label: s }))}
                onValueChange={(s) => setDraft({ severity: s })} />
            )}
          </Field>
          <Field label="Dimension" className="flex-1">
            {({ controlId }) => (
              <Select id={controlId} value={draft.dimension ?? ""}
                options={[{ value: "", label: "Default for the check type" }, ...DIMENSIONS.map((d) => ({ value: d, label: d }))]}
                onValueChange={(d) => setDraft({ dimension: d })} />
            )}
          </Field>
        </Stack>
        <Field label="Dry run against" helper={draft.module && versions.data?.length === 0 ? "No analysed version holds this module yet" : undefined}>
          {({ controlId }) => (
            <Select id={controlId} placeholder={draft.module ? "Choose a version" : "Choose a module first"}
              value={draft.version_id ?? ""} disabled={!versions.data?.length}
              options={(versions.data ?? []).map((v) => ({
                value: v.id, label: `${new Date(v.run_at).toLocaleString()}${v.label ? ` · ${v.label}` : ""}`,
              }))}
              onValueChange={(v) => setDraft({ version_id: v })} />
          )}
        </Field>
        {error && <Banner tone="danger" title="Not valid yet">{error}</Banner>}
        {result && (result.error ? (
          <Banner tone="danger" title="The rule errored on this data">{result.error}</Banner>
        ) : (
          <Panel title="Dry run" action={<Text variant="text-small" tone="tertiary">{result.grain ? `per ${result.grain} record` : ""}</Text>}>
            <Stack gap={3}>
              <KpiRail>
                <Stat label="Checked" value={result.population.toLocaleString()} />
                <Stat label="Failing" value={result.failing.toLocaleString()} tone={result.failing ? "warning" : "neutral"} />
                <Stat label="Pass rate" value={pct(result.pass_rate)} />
              </KpiRail>
              {result.sample_keys.length > 0 && (
                <div className="font-mono text-[12px]">
                  {result.sample_keys.map((k) => <div key={k}>{k}</div>)}
                  {result.failing > result.sample_keys.length && (
                    <div className="text-[var(--aurora-fg-muted)]">+{(result.failing - result.sample_keys.length).toLocaleString()} more</div>
                  )}
                </div>
              )}
            </Stack>
          </Panel>
        ))}
      </Stack>
    </Drawer>
  );
}

export default function SettingsRulesPage() {
  const qc = useQueryClient();
  const canManage = useRole().can("manage_rules");
  const [search, setSearch] = useUrlState("q", "");
  const [module, setModule] = useUrlState("module", "");
  const [check, setCheck] = useUrlState("check", "");
  const [dimension, setDimension] = useUrlState("dimension", "");
  const [severity, setSeverity] = useUrlState("severity", "");
  const [auth, setAuth] = useUrlState("authority", "");
  const [source, setSource] = useUrlState("source", "");
  const [selected, setSelected] = useState<Rule | null>(null);
  const [authoring, setAuthoring] = useState(false);

  const { data: rules = [], isLoading, error } = useQuery({ queryKey: ["rules.list"], queryFn: getAllRules });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRule(id, { enabled }),
    onSuccess: (_d, v) => {
      toast.success(v.enabled ? "Rule enabled" : "Rule disabled");
      void qc.invalidateQueries({ queryKey: ["rules.list"] });
      void qc.invalidateQueries({ queryKey: ["rules.history", v.id] });
    },
    onError: () => toast.error("Could not update the rule"),
  });

  const facets = useMemo(() => {
    const uniq = (xs: string[]) => Array.from(new Set(xs)).sort();
    return {
      modules: uniq(rules.map((r) => r.module)),
      checks: uniq(rules.flatMap((r) => valuesOf(r, "check_class"))),
      dimensions: uniq(rules.flatMap((r) => valuesOf(r, "dimension"))),
      sources: uniq(rules.map((r) => r.source)) as Rule["source"][],
    };
  }, [rules]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) =>
      (!q || `${r.name} ${r.description ?? ""} ${JSON.stringify(r.conditions)}`.toLowerCase().includes(q))
      && (!module || r.module === module)
      && (!check || valuesOf(r, "check_class").includes(check))
      && (!dimension || valuesOf(r, "dimension").includes(dimension))
      && (!severity || r.severity === severity)
      && (!auth || authority(r) === auth)
      && (!source || r.source === source));
  }, [rules, search, module, check, dimension, severity, auth, source]);

  const enabled = rules.filter((r) => r.enabled).length;
  const ran = rules.filter((r) => r.last_pass_rate != null);
  const customer = rules.filter((r) => authority(r) === "customer").length;

  return (
    <div className="space-y-6">
      <PageHead
        title="Rule library"
        sub="Every check Meridian runs: shipped SAP-standard rules, rules mined from your data and rules your stewards wrote."
        actions={canManage ? <Button onClick={() => setAuthoring(true)}>New rule</Button> : undefined}
      />
      {error ? <Banner tone="danger" title="Could not load rules">{(error as Error).message}</Banner> : null}
      {isLoading ? <Text tone="muted">Loading rules…</Text> : (
        <>
          <KpiRail>
            <Stat label="Rules" value={rules.length.toLocaleString()} />
            <Stat label="Enabled" value={enabled.toLocaleString()} />
            <Stat label="Disabled" value={(rules.length - enabled).toLocaleString()}
              tone={rules.length > enabled ? "warning" : "neutral"} />
            <Stat label="Customer rules" value={customer.toLocaleString()} />
            <Stat label="Ran at least once" value={ran.length.toLocaleString()} />
          </KpiRail>

          <Panel>
            <Stack gap={2}>
              <Stack direction="row" gap={3} align="center" wrap>
                <Input aria-label="Search rules" placeholder="Search name, message or field…" value={search}
                  onChange={(e) => setSearch(e.target.value)} className="min-w-[280px] flex-1" />
                <Select aria-label="Module" value={module}
                  options={[{ value: "", label: "All modules" }, ...facets.modules.map((m) => ({ value: m, label: formatModuleName(m) }))]}
                  onValueChange={setModule} />
              </Stack>
              <FacetRow label="Check type" options={facets.checks} value={check} onChange={setCheck}
                format={(c) => CHECK_LABEL[c as CheckClass] ?? c.replace(/_check$/, "").replace(/_/g, " ")} />
              <FacetRow label="Dimension" options={facets.dimensions} value={dimension} onChange={setDimension} />
              <FacetRow label="Severity" options={[...SEVERITIES]} value={severity} onChange={setSeverity} />
              <FacetRow label="Authority" options={["shipped", "customer"]} value={auth} onChange={setAuth}
                format={(a) => (a === "shipped" ? "SAP standard (shipped)" : "Customer configured")} />
              <FacetRow label="Source" options={facets.sources} value={source} onChange={setSource}
                format={(s) => SOURCE_LABEL[s]} />
            </Stack>
          </Panel>

          <Panel title="Rules" action={
            <Text variant="text-small" tone="tertiary" numeric>{shown.length.toLocaleString()} of {rules.length.toLocaleString()}</Text>
          }>
            {shown.length === 0 ? <Text tone="muted">No rules match these filters.</Text> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr>
                    <th className={th}>Rule</th><th className={th}>Module</th><th className={th}>Check</th>
                    <th className={th}>Severity</th><th className={th}>Source</th>
                    <th className={`${th} text-right`}>Last pass rate</th><th className={th}>Enabled</th>
                  </tr></thead>
                  <tbody>
                    {shown.slice(0, 500).map((r) => (
                      <tr key={r.id} className="cursor-pointer hover:bg-[var(--aurora-elev-1-bg)]" onClick={() => setSelected(r)}>
                        <td className={td}>
                          <div className="font-medium">{r.name}</div>
                          {r.description && r.description !== r.name.split(": ").slice(1).join(": ") && (
                            <div className="text-[12px] text-[var(--aurora-fg-tertiary)]">{r.description}</div>
                          )}
                        </td>
                        <td className={td}>{formatModuleName(r.module)}</td>
                        <td className={td}>{valuesOf(r, "check_class").map((c) => CHECK_LABEL[c as CheckClass] ?? c).join(", ") || "—"}</td>
                        <td className={td}><Chip tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{r.severity}</Chip></td>
                        <td className={td}>{SOURCE_LABEL[r.source] ?? r.source}</td>
                        <td className={`${td} text-right aurora-number`}
                          title={r.last_run_at ? `Last run ${new Date(r.last_run_at).toLocaleString()}` : "Not run yet"}>
                          {r.last_pass_rate != null ? pct(r.last_pass_rate) : "—"}
                        </td>
                        <td className={td} onClick={(e) => e.stopPropagation()}>
                          {canManage ? (
                            <Button size="sm" variant={r.enabled ? "secondary" : "ghost"} aria-pressed={r.enabled}
                              disabled={toggle.isPending} onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}>
                              {r.enabled ? "On" : "Off"}
                            </Button>
                          ) : <Chip tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "On" : "Off"}</Chip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 500 && (
                  <Text variant="text-small" tone="muted" className="px-3 py-2">
                    Showing the first 500 — narrow the filters to see the rest.
                  </Text>
                )}
              </div>
            )}
          </Panel>
        </>
      )}
      <RuleDrawer rule={selected && (rules.find((r) => r.id === selected.id) ?? selected)} onClose={() => setSelected(null)} />
      {canManage && <AuthorDrawer open={authoring} onClose={() => setAuthoring(false)} modules={facets.modules} />}
    </div>
  );
}
