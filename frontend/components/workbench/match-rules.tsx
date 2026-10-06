"use client";

/**
 * Match rules: the rules the match and merge engine scores duplicate
 * candidates with, per domain. Three views share the page:
 *  - rules: edit a rule, switch it off, simulate the whole set before it goes live.
 *  - tuning: re-score stored pairs with proposed weights. Nothing is saved.
 *  - constraints: the do-not-match and always-match pairs that win over the score.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, Field, FilterBar, Input, KeyValue, PageHeader, ReasonButton,
  SegmentedControl, Select, TableSkeleton, Tally, type AuroraColumnMeta,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { createMatchRule, deleteMatchRule, getMatchRules, simulateMatchRules, updateMatchRule } from "@/lib/api/match-rules";
import {
  clearPairConstraint, getPairConstraints, matchTuningDryRun, type DryRunResult, type PairConstraint, type PairConstraintKind,
} from "@/lib/api/merge-explain";
import { formatModuleName, formatDate } from "@/lib/format";
import type { MatchRule, MatchType, SimulationResult } from "@/types/api";

const MATCH_TYPES: { value: MatchType; label: string; hint: string }[] = [
  { value: "exact", label: "Exact", hint: "Values identical after normalisation" },
  { value: "fuzzy", label: "Fuzzy", hint: "Edit-distance similarity on text" },
  { value: "phonetic", label: "Phonetic", hint: "Sounds-alike names (Soundex or Metaphone)" },
  { value: "numeric_range", label: "Numeric range", hint: "Numbers within a tolerance" },
  { value: "semantic", label: "Semantic", hint: "Meaning-level similarity for descriptions" },
];
const DOMAINS = ["business_partner", "material_master", "sd_customer_master", "accounts_payable", "accounts_receivable", "employee_central"];
const KINDS: { value: PairConstraintKind; label: string }[] = [
  { value: "do_not_match", label: "Do not match" }, { value: "always_match", label: "Always match" },
];
const VIEWS = [{ id: "rules", label: "Rules" }, { id: "tuning", label: "Tuning" }, { id: "constraints", label: "Constraints" }];
const HREF = "/admin?tab=match-rules";
const meta = (m: AuroraColumnMeta) => m;
const errText = (e: unknown, fallback: string) => (e as Error).message || fallback;
const domainOptions = (extra: string[]) =>
  Array.from(new Set([...DOMAINS, ...extra])).sort().map((d) => ({ value: d, label: formatModuleName(d) }));

type Draft = { domain: string; field: string; match_type: MatchType; weight: number; threshold: number; active: boolean };
const empty = (domain: string): Draft => ({ domain, field: "", match_type: "fuzzy", weight: 1, threshold: 0.85, active: true });

export function MatchRulesSurface() {
  const [view, setView] = useUrlState("view", "rules");
  const current = VIEWS.some((v) => v.id === view) ? view : "rules";
  const [tuned, setTuned] = useState<number | null>(null);
  const all = useQuery({ queryKey: ["match-rules", ""], queryFn: () => getMatchRules() });
  const cons = useQuery({ queryKey: ["pair-constraints", {}], queryFn: () => getPairConstraints({}) });
  const nRules = all.data?.rules.length;
  const nOff = all.data?.rules.filter((r) => !r.active).length ?? 0;
  return (
    <div className="ui-page">
      <PageHeader title="Match rules" summary="How the matcher scores duplicate candidates, what a change would do, and the pairs stewards have pinned."
        actions={<SegmentedControl ariaLabel="Match rules view" value={current} options={VIEWS} onChange={setView} />} />
      <Tally level={4} label="Matching" figures={[
        { label: "Rules", value: all.isLoading ? null : nRules ?? 0, loading: all.isLoading, tone: nOff ? "warning" : undefined, verdict: nOff ? `${nOff} switched off.` : nRules ? "Every rule is active." : "No rule to score with yet.", href: HREF },
        { label: "Tuned pairs", value: tuned ?? null, verdict: tuned === null ? "Run a tuning dry run." : "Re-scored in the last dry run.", href: `${HREF}&view=tuning` },
        { label: "Constraints", value: cons.isLoading ? null : cons.data?.length ?? 0, loading: cons.isLoading, verdict: cons.data?.length ? "Pinned by stewards." : "No pair is pinned.", href: `${HREF}&view=constraints` },
      ]} />
      {current === "tuning" ? <TuningView domains={domainOptions(all.data?.rules.map((r) => r.domain) ?? [])} onTuned={setTuned} />
        : current === "constraints" ? <ConstraintsView domains={domainOptions(all.data?.rules.map((r) => r.domain) ?? [])} />
        : <RulesView />}
    </div>
  );
}

/* ---------- Rules ---------- */

function RulesView() {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("mdm.write");
  const [domain, setDomain] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<MatchRule | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const rules = useQuery({ queryKey: ["match-rules", domain], queryFn: () => getMatchRules(domain || undefined) });
  const domains = useMemo(() => domainOptions(rules.data?.rules.map((r) => r.domain) ?? []), [rules.data]);
  const list = rules.data?.rules ?? [];
  const close = () => { setDraft(null); setEditing(null); };

  const refresh = () => qc.invalidateQueries({ queryKey: ["match-rules"] });
  const save = useMutation({
    mutationFn: (d: Draft) => (editing ? updateMatchRule(editing.id, d) : createMatchRule(d)),
    onSuccess: () => { refresh(); close(); toast.success("Rule saved"); },
    onError: (e) => toast.error(errText(e, "Rule not saved")),
  });
  const toggle = useMutation({
    mutationFn: (r: MatchRule) => updateMatchRule(r.id, { active: !r.active }), onSuccess: refresh,
    onError: (e) => toast.error(errText(e, "Not saved")),
  });
  const remove = useMutation({
    mutationFn: (r: MatchRule) => deleteMatchRule(r.id), onSuccess: () => { refresh(); close(); toast.success("Rule deleted"); },
    onError: (e) => toast.error(errText(e, "Not deleted")),
  });
  const simulate = useMutation({
    mutationFn: (d: string) => simulateMatchRules({ domain: d }), onSuccess: setSimulation,
    onError: (e) => toast.error(errText(e, "Simulation failed")),
  });

  const columns = useMemo<ColumnDef<MatchRule, unknown>[]>(() => [
    { id: "domain", header: "Domain", meta: meta({ width: 170 }), cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", accessorKey: "field", meta: meta({ width: 180 }), cell: ({ row }) => <span className="aurora-number">{row.original.field}</span> },
    { id: "type", header: "Match", meta: meta({ width: 130 }), cell: ({ row }) => MATCH_TYPES.find((t) => t.value === row.original.match_type)?.label ?? row.original.match_type },
    { id: "weight", header: "Weight", meta: meta({ width: 90, numeric: true, align: "end" }), cell: ({ row }) => row.original.weight.toFixed(2) },
    { id: "threshold", header: "Threshold", meta: meta({ width: 100, numeric: true, align: "end" }), cell: ({ row }) => `${Math.round(row.original.threshold * 100)}%` },
    { id: "active", header: "State", meta: meta({ width: 90 }), cell: ({ row }) => <Chip tone={row.original.active ? "success" : "neutral"}>{row.original.active ? "active" : "off"}</Chip> },
  ], []);

  return (
    <>
      <FilterBar onClear={domain ? () => { setDomain(""); setSimulation(null); } : undefined}
        actions={<>
          {write ? <Button onClick={() => { setEditing(null); setDraft(empty(domain || DOMAINS[0])); }}>New rule</Button> : null}
          <Button variant="secondary" disabled={!domain || simulate.isPending} onClick={() => simulate.mutate(domain)}
            title={domain ? "Score every candidate pair in this domain with the active rules" : "Pick a domain to simulate"}>
            {simulate.isPending ? "Simulating" : "Simulate"}
          </Button>
        </>}>
        <Select placeholder="All domains" value={domain} aria-label="Domain" options={domains} onValueChange={(v) => { setDomain(v); setSimulation(null); }} />
      </FilterBar>

      {simulation ? (
        <KeyValue rows={[
          { k: "Candidate pairs", v: simulation.total_pairs.toLocaleString() },
          { k: "Would auto-merge", v: simulation.auto_merge_count.toLocaleString() },
          { k: "Would dismiss", v: simulation.auto_dismiss_count.toLocaleString() },
          { k: "To steward queue", v: simulation.queue_count.toLocaleString() },
        ]} />
      ) : null}

      {rules.isLoading ? <TableSkeleton rows={6} label="Loading match rules" />
        : rules.error ? <Banner tone="danger" title="Match rules could not be read">{errText(rules.error, "")}</Banner>
        : list.length ? <DataTable<MatchRule> ariaLabel="Match rules. Press Enter to open a rule." columns={columns} data={list} getRowId={(r) => r.id} maxHeight="62vh"
            onRowActivate={(r) => { setEditing(r); setDraft({ ...r }); }} />
        : <EmptyState>{domain ? `No rules for ${formatModuleName(domain)} yet.` : "No match rules yet. Add one per field the engine should compare."}</EmptyState>}
      {!write ? <p className="ui-micro">You can view the rules. Stewards with MDM write access change them.</p> : null}

      <DetailDrawer open={!!draft} onClose={close} ariaLabel="Match rule"
        header={<h2 className="ui-drawer-head__title">{editing ? `Edit rule ${editing.field}` : "New match rule"}</h2>}>
        {draft ? (
          <div className="ui-form">
            <Field label="Domain" required>
              {({ controlId }) => <Select id={controlId} value={draft.domain} options={domains} onValueChange={(v) => setDraft({ ...draft, domain: v })} />}
            </Field>
            <Field label="Field" helper="SAP field the rule compares, such as NAME1, STCD1 or STRAS" required>
              {({ controlId }) => <Input id={controlId} value={draft.field} className="aurora-number" onChange={(e) => setDraft({ ...draft, field: e.target.value.toUpperCase().trim() })} />}
            </Field>
            <Field label="Match type" helper={MATCH_TYPES.find((t) => t.value === draft.match_type)?.hint}>
              {({ controlId }) => <Select<MatchType> id={controlId} value={draft.match_type} options={MATCH_TYPES} onValueChange={(v) => setDraft({ ...draft, match_type: v })} />}
            </Field>
            <div className="ui-form__grid">
              <Field label="Weight" helper="Share of the pair score this field carries">
                {({ controlId }) => <Input id={controlId} type="number" step="0.05" min="0" max="10" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })} />}
              </Field>
              <Field label="Threshold" helper="Similarity needed to count as a match, 0 to 1">
                {({ controlId }) => <Input id={controlId} type="number" step="0.01" min="0" max="1" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} />}
              </Field>
            </div>
            <Field label="State">
              {({ controlId }) => <Select<"on" | "off"> id={controlId} value={draft.active ? "on" : "off"} options={[{ value: "on", label: "Active" }, { value: "off", label: "Off" }]}
                onValueChange={(v) => setDraft({ ...draft, active: v === "on" })} />}
            </Field>
            {write ? (
              <div className="ui-form__actions">
                <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !draft.field.trim()}>{editing ? "Save" : "Create"}</Button>
                {editing ? <Button variant="secondary" disabled={toggle.isPending} onClick={() => { toggle.mutate(editing); close(); }}>{editing.active ? "Switch off" : "Switch on"}</Button> : null}
                {editing ? <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(editing)}>Delete rule</Button> : null}
                <Button variant="ghost" onClick={close}>Discard changes</Button>
              </div>
            ) : <p className="ui-micro">Changing rules needs MDM write access.</p>}
          </div>
        ) : null}
      </DetailDrawer>
    </>
  );
}

/* ---------- Tuning dry run ---------- */

function TuningView({ domains, onTuned }: { domains: { value: string; label: string }[]; onTuned: (pairs: number) => void }) {
  const [domain, setDomain] = useState("");
  return (
    <>
      <p className="ui-note">Re-scores the newest 50,000 stored pairs in a domain with the weights below. Steward decisions and pair constraints still win. Nothing is saved.</p>
      <FilterBar><Select placeholder="Pick a domain" value={domain} aria-label="Domain" options={domains} onValueChange={setDomain} /></FilterBar>
      {domain ? <TuningForm key={domain} domain={domain} onTuned={onTuned} /> : <EmptyState>Pick a domain to tune.</EmptyState>}
    </>
  );
}

function TuningForm({ domain, onTuned }: { domain: string; onTuned: (pairs: number) => void }) {
  const rules = useQuery({ queryKey: ["match-rules", domain], queryFn: () => getMatchRules(domain) });
  // One weight per field: the dry-run keys weights by field, not by rule.
  const current = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rules.data?.rules ?? []) if (r.active && !(r.field in m)) m[r.field] = r.weight;
    return m;
  }, [rules.data]);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [autoMerge, setAutoMerge] = useState("0.95");
  const [reviewFloor, setReviewFloor] = useState("0.30");
  const [result, setResult] = useState<DryRunResult | null>(null);
  const am = Number(autoMerge);
  const rf = Number(reviewFloor);
  const badWeight = Object.values(weights).some((v) => v === "" || !(Number(v) >= 0));
  const valid = am > 0 && am <= 1 && rf >= 0 && rf < am && !badWeight;
  const run = useMutation({
    // Only changed weights go up: fields left out keep the weight each pair was scored with.
    mutationFn: () => matchTuningDryRun({
      domain, auto_merge: am, review_floor: rf,
      weights: Object.fromEntries(Object.entries(weights).filter(([f, v]) => Number(v) !== current[f]).map(([f, v]) => [f, Number(v)])),
    }),
    onSuccess: (r) => { setResult(r); onTuned(r.pairs); },
    onError: (e) => toast.error(errText(e, "Dry run failed")),
  });
  const fields = Object.keys(current).sort();
  const moves = Object.entries(result?.band_moves ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="ui-stack">
      {rules.isLoading ? <TableSkeleton rows={4} label="Reading match rules" />
        : rules.error ? <Banner tone="danger" title="Match rules could not be read">{errText(rules.error, "")}</Banner>
        : fields.length ? (
          <table className="ui-mini-table">
            <thead><tr><th>Field</th><th className="ui-num">Current weight</th><th>Proposed weight</th></tr></thead>
            <tbody>{fields.map((f) => (
              <tr key={f}>
                <td>{f}</td>
                <td className="ui-num">{current[f]}</td>
                <td><Input type="number" min={0} step={0.1} aria-label={`Proposed weight for ${f}`} value={weights[f] ?? String(current[f])}
                  onChange={(e) => { const v = e.target.value; setWeights((w) => ({ ...w, [f]: v })); }} /></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="ui-note">No active match rules for {formatModuleName(domain)}. Thresholds can still be tried.</p>}
      <div className="ui-form__grid">
        <Field label="Auto-merge at" helper="Score at or above merges without review.">
          {({ controlId }) => <Input id={controlId} type="number" min={0.01} max={1} step={0.01} value={autoMerge} onChange={(e) => setAutoMerge(e.target.value)} />}
        </Field>
        <Field label="Review floor" helper={rf >= am ? "Must be below auto-merge." : "Below this a pair is dismissed."}>
          {({ controlId }) => <Input id={controlId} type="number" min={0} max={1} step={0.01} value={reviewFloor} onChange={(e) => setReviewFloor(e.target.value)} />}
        </Field>
      </div>
      <div className="ui-form__actions">
        <Button disabled={!valid || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Running" : "Run dry run"}</Button>
        <Button variant="ghost" disabled={run.isPending} onClick={() => { setWeights({}); setAutoMerge("0.95"); setReviewFloor("0.30"); setResult(null); }}>Reset</Button>
      </div>
      {result ? (
        <>
          <KeyValue rows={[
            { k: "Pairs re-scored", v: result.pairs.toLocaleString() },
            { k: "Newly linked", v: result.pairs_newly_linked.toLocaleString() },
            { k: "Unlinked", v: result.pairs_unlinked.toLocaleString() },
            { k: "Clusters before and after", v: `${result.clusters_before.toLocaleString()} and ${result.clusters_after.toLocaleString()}` },
            { k: "Would merge", v: result.clusters_that_would_merge.toLocaleString() },
            { k: "Would split", v: result.clusters_that_would_split.toLocaleString() },
          ]} />
          {moves.length ? (
            <table className="ui-mini-table">
              <thead><tr><th>Band move</th><th className="ui-num">Pairs</th></tr></thead>
              <tbody>{moves.map(([k, n]) => (
                <tr key={k}><td>{k.split("->").map(formatModuleName).join(" to ")}</td><td className="ui-num">{n.toLocaleString()}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="ui-note">No pair changes band.</p>}
        </>
      ) : null}
    </div>
  );
}

/* ---------- Pair constraints ---------- */

function ConstraintsView({ domains }: { domains: { value: string; label: string }[] }) {
  const qc = useQueryClient();
  const write = useRole().can("approve");
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<PairConstraintKind | "">("");
  const [key, setKey] = useState("");
  const params = { domain: domain || undefined, kind: kind || undefined, key: key.trim() || undefined };
  const list = useQuery({ queryKey: ["pair-constraints", params], queryFn: () => getPairConstraints(params) });
  const clear = useMutation({
    mutationFn: ({ c, reason }: { c: PairConstraint; reason: string }) => clearPairConstraint(c.id, reason || undefined),
    onSuccess: () => {
      for (const k of ["pair-constraints", "merge-explain", "cluster-graph", "merge-events"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success("Constraint cleared");
    },
    onError: (e) => toast.error(errText(e, "Constraint not cleared")),
  });
  const rows = list.data ?? [];
  const filtered = !!(domain || kind || key.trim());
  const columns = useMemo<ColumnDef<PairConstraint, unknown>[]>(() => [
    { id: "kind", header: "Kind", meta: meta({ width: 140 }), cell: ({ row }) => KINDS.find((k) => k.value === row.original.kind)?.label ?? row.original.kind },
    { id: "domain", header: "Domain", meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "a", header: "Record A", meta: meta({ width: 140 }), cell: ({ row }) => <span className="aurora-number">{row.original.key_lo}</span> },
    { id: "b", header: "Record B", meta: meta({ width: 140 }), cell: ({ row }) => <span className="aurora-number">{row.original.key_hi}</span> },
    { id: "reason", header: "Reason", meta: meta({ minWidth: 200 }), cell: ({ row }) => row.original.reason ?? "None given" },
    { id: "created", header: "Created", meta: meta({ width: 170 }), cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
    { id: "clear", header: "", meta: meta({ width: 260 }), cell: ({ row }) => write ? (
      <ReasonButton size="sm" label="Clear" prompt="Why clear this constraint? (optional note)" disabled={clear.isPending}
        onConfirm={(reason) => clear.mutate({ c: row.original, reason })} />
    ) : null },
  ], [write, clear]);
  return (
    <>
      <p className="ui-note">Stewards create these by accepting or rejecting a pair, or by unmerging. They override the score until cleared. Clearing does not re-merge or split anything by itself.</p>
      <FilterBar onClear={filtered ? () => { setDomain(""); setKind(""); setKey(""); } : undefined}>
        <Select placeholder="All domains" value={domain} aria-label="Domain" options={domains} onValueChange={setDomain} />
        <Select placeholder="Both kinds" value={kind} aria-label="Kind" options={KINDS} onValueChange={(v) => setKind(KINDS.find((k) => k.value === v)?.value ?? "")} />
        <Input aria-label="Record key" placeholder="Record key" value={key} onChange={(e) => setKey(e.target.value)} />
      </FilterBar>
      {!write ? <Banner tone="info" title="Read only">Clearing a constraint needs the approve permission.</Banner> : null}
      {list.isLoading ? <TableSkeleton rows={6} label="Reading constraints" />
        : list.error ? <Banner tone="danger" title="Constraints could not be read">{errText(list.error, "")}</Banner>
        : rows.length ? <DataTable<PairConstraint> ariaLabel="Pair constraints" columns={columns} data={rows} getRowId={(c) => c.id} maxHeight="62vh" />
        : <EmptyState>{filtered ? "No pair constraints match these filters." : "No pair constraints yet."}</EmptyState>}
      {rows.length === 500 ? <p className="ui-micro">Showing the newest 500. Narrow the filters to see others.</p> : null}
    </>
  );
}
