// frontend/app/(app)/mdm/match-rules/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ErrorState, Field, Pill, Select, Skeleton, Tabs } from "@/design";
import { useRole } from "@/hooks/use-role";
import {
  createMatchRule, deleteMatchRule, getMatchRules, simulateMatchRules, updateMatchRule,
} from "@/lib/api/match-rules";
import {
  clearPairConstraint, getPairConstraints, matchTuningDryRun,
  type DryRunResult, type PairConstraint, type PairConstraintKind,
} from "@/lib/api/merge-explain";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MatchRule, MatchType, SimulationResult } from "@/types/api";

// ponytail: folds the three legacy /match-rules, /match-rules/constraints and
// /match-rules/tuning pages (really one surface with a view param) into one
// page with design-system tabs.
// The brief's Tuning tab description (AI-proposed-rule review via
// getProposedRules/approveProposedRule/rejectProposedRule/submitAiFeedback) does not
// match the real legacy "tuning" view, which is a weight/threshold dry run
// (matchTuningDryRun). AI-proposed-rule review lives at a separate, unrelated legacy
// route (/ai/rules -> AiRulesSurface) that none of the three pages being folded here
// ever linked to, so it is left out of this page. See task-21-report.md.

const DOMAINS = [
  "business_partner", "material_master", "sd_customer_master",
  "accounts_payable", "accounts_receivable", "employee_central",
];
const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "exact", label: "Exact" },
  { value: "fuzzy", label: "Fuzzy" },
  { value: "phonetic", label: "Phonetic" },
  { value: "numeric_range", label: "Numeric range" },
  { value: "semantic", label: "Semantic" },
];
const KINDS: { value: PairConstraintKind; label: string }[] = [
  { value: "do_not_match", label: "Do not match" },
  { value: "always_match", label: "Always match" },
];

function domainOptions(extra: string[]) {
  return Array.from(new Set([...DOMAINS, ...extra])).sort().map((d) => ({ value: d, label: formatModuleName(d) }));
}

type Draft = { domain: string; field: string; match_type: MatchType; weight: number; threshold: number; active: boolean };
const emptyDraft = (domain: string): Draft => ({ domain, field: "", match_type: "fuzzy", weight: 1, threshold: 0.85, active: true });

export default function MatchRulesPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-[16px] font-semibold" style={{ color: "var(--m-ink)" }}>Match rules</h2>
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        How the matcher scores duplicate candidates, what a change would do, and the pairs stewards have pinned.
      </p>
      <Tabs
        items={[
          { value: "rules", label: "Rules", content: <RulesTab /> },
          { value: "tuning", label: "Tuning", content: <TuningTab /> },
          { value: "constraints", label: "Constraints", content: <ConstraintsTab /> },
        ]}
      />
    </div>
  );
}

/* ---------- Rules ---------- */

function RulesTab() {
  const qc = useQueryClient();
  const write = useRole().can("mdm.write");
  const [domain, setDomain] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<MatchRule | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const rulesQuery = useQuery({
    queryKey: queryKeys.matchRules(domain),
    queryFn: () => getMatchRules(domain || undefined),
  });
  const domains = useMemo(() => domainOptions(rulesQuery.data?.rules.map((r) => r.domain) ?? []), [rulesQuery.data]);
  const list = rulesQuery.data?.rules ?? [];
  const close = () => { setDraft(null); setEditing(null); };

  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.matchRulesAll() });
  const save = useMutation({
    mutationFn: (d: Draft) => (editing ? updateMatchRule(editing.id, d) : createMatchRule(d)),
    onSuccess: () => { refresh(); close(); },
  });
  const remove = useMutation({
    mutationFn: (r: MatchRule) => deleteMatchRule(r.id),
    onSuccess: () => { refresh(); close(); },
  });
  const simulate = useMutation({
    mutationFn: (d: string) => simulateMatchRules({ domain: d }),
    onSuccess: setSimulation,
  });

  const columns = useMemo<ColumnDef<MatchRule>[]>(() => [
    { id: "domain", header: "Domain", cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", cell: ({ row }) => row.original.field },
    { id: "type", header: "Match", cell: ({ row }) => MATCH_TYPES.find((t) => t.value === row.original.match_type)?.label ?? row.original.match_type },
    { id: "weight", header: "Weight", cell: ({ row }) => row.original.weight.toFixed(2) },
    { id: "threshold", header: "Threshold", cell: ({ row }) => `${Math.round(row.original.threshold * 100)}%` },
    { id: "active", header: "State", cell: ({ row }) => <Pill tone={row.original.active ? "go" : "neutral"}>{row.original.active ? "active" : "off"}</Pill> },
  ], []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select placeholder="All domains" value={domain} options={domains} onValueChange={(v) => { setDomain(v); setSimulation(null); }} />
        {write ? (
          <Button onClick={() => { setEditing(null); setDraft(emptyDraft(domain || DOMAINS[0])); }}>New rule</Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={!domain || simulate.isPending}
          onClick={() => simulate.mutate(domain)}
        >
          {simulate.isPending ? "Simulating…" : "Simulate"}
        </Button>
      </div>

      {simulation ? (
        <dl className="flex gap-6 text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          <div><dt>Candidate pairs</dt><dd className="font-semibold">{simulation.total_pairs.toLocaleString()}</dd></div>
          <div><dt>Would auto-merge</dt><dd className="font-semibold">{simulation.auto_merge_count.toLocaleString()}</dd></div>
          <div><dt>Would dismiss</dt><dd className="font-semibold">{simulation.auto_dismiss_count.toLocaleString()}</dd></div>
          <div><dt>To steward queue</dt><dd className="font-semibold">{simulation.queue_count.toLocaleString()}</dd></div>
        </dl>
      ) : null}

      {rulesQuery.isLoading ? (
        <Skeleton height={200} />
      ) : rulesQuery.error ? (
        <ErrorState
          message={rulesQuery.error instanceof Error ? rulesQuery.error.message : "Match rules could not be loaded."}
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : list.length ? (
        <DataTable<MatchRule>
          columns={columns}
          data={list}
          getRowId={(r) => r.id}
          onRowClick={(r) => { setEditing(r); setDraft({ ...r }); }}
        />
      ) : (
        <EmptyState title={domain ? `No rules for ${formatModuleName(domain)} yet.` : "No match rules yet. Add one per field the engine should compare."} />
      )}
      {!write ? <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Changing rules needs MDM write access.</p> : null}

      {draft ? (
        <div className="flex flex-col gap-3 rounded border p-4" style={{ borderColor: "var(--m-line)" }}>
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>
            {editing ? `Edit rule ${editing.field}` : "New match rule"}
          </h3>
          <Field label="Domain"><Select value={draft.domain} options={domains} onValueChange={(v) => setDraft({ ...draft, domain: v })} /></Field>
          <Field label="Field">
            <input
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)" }}
              value={draft.field}
              onChange={(e) => setDraft({ ...draft, field: e.target.value.toUpperCase().trim() })}
            />
          </Field>
          <Field label="Match type">
            <Select value={draft.match_type} options={MATCH_TYPES} onValueChange={(v) => setDraft({ ...draft, match_type: v as MatchType })} />
          </Field>
          <Field label="Weight">
            <input type="number" step="0.05" min="0" max="10" className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
              value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })} />
          </Field>
          <Field label="Threshold">
            <input type="number" step="0.01" min="0" max="1" className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
              value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} />
          </Field>
          <Field label="State">
            <Select value={draft.active ? "on" : "off"} options={[{ value: "on", label: "Active" }, { value: "off", label: "Off" }]}
              onValueChange={(v) => setDraft({ ...draft, active: v === "on" })} />
          </Field>
          {write ? (
            <div className="flex gap-2">
              <Button disabled={save.isPending || !draft.field.trim()} onClick={() => save.mutate(draft)}>{editing ? "Save" : "Create"}</Button>
              {editing ? <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate(editing)}>Delete rule</Button> : null}
              <Button variant="ghost" onClick={close}>Discard changes</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Tuning dry run ---------- */

function TuningTab() {
  const [domain, setDomain] = useState("");
  const rulesQuery = useQuery({ enabled: !!domain, queryKey: queryKeys.matchRules(domain), queryFn: () => getMatchRules(domain) });
  const domains = useMemo(() => domainOptions(rulesQuery.data?.rules.map((r) => r.domain) ?? []), [rulesQuery.data]);
  const current = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rulesQuery.data?.rules ?? []) if (r.active && !(r.field in m)) m[r.field] = r.weight;
    return m;
  }, [rulesQuery.data]);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [autoMerge, setAutoMerge] = useState("0.95");
  const [reviewFloor, setReviewFloor] = useState("0.30");
  const [result, setResult] = useState<DryRunResult | null>(null);
  const am = Number(autoMerge);
  const rf = Number(reviewFloor);
  const valid = !!domain && am > 0 && am <= 1 && rf >= 0 && rf < am;
  const run = useMutation({
    mutationFn: () => matchTuningDryRun({
      domain, auto_merge: am, review_floor: rf,
      weights: Object.fromEntries(Object.entries(weights).filter(([f, v]) => Number(v) !== current[f]).map(([f, v]) => [f, Number(v)])),
    }),
    onSuccess: setResult,
  });
  const fields = Object.keys(current).sort();
  const moves = Object.entries(result?.band_moves ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Re-scores the newest 50,000 stored pairs in a domain with the weights below. Nothing is saved.
      </p>
      <Select placeholder="Pick a domain" value={domain} options={domains} onValueChange={(v) => { setDomain(v); setResult(null); }} />
      {!domain ? (
        <EmptyState title="Pick a domain to tune." />
      ) : rulesQuery.isLoading ? (
        <Skeleton height={160} />
      ) : rulesQuery.error ? (
        <ErrorState
          message={rulesQuery.error instanceof Error ? rulesQuery.error.message : "Match rules could not be loaded."}
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {fields.length ? (
            <table className="text-[13px]">
              <thead><tr><th className="text-left pr-4">Field</th><th className="text-left pr-4">Current</th><th className="text-left">Proposed</th></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f}>
                    <td className="pr-4">{f}</td>
                    <td className="pr-4">{current[f]}</td>
                    <td>
                      <input type="number" min={0} step={0.1} className="rounded border px-2 py-1 text-[13px]" style={{ borderColor: "var(--m-line)" }}
                        value={weights[f] ?? String(current[f])}
                        onChange={(e) => { const v = e.target.value; setWeights((w) => ({ ...w, [f]: v })); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No active match rules for {formatModuleName(domain)}. Thresholds can still be tried.</p>
          )}
          <div className="flex gap-3">
            <Field label="Auto-merge at">
              <input type="number" min={0.01} max={1} step={0.01} className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
                value={autoMerge} onChange={(e) => setAutoMerge(e.target.value)} />
            </Field>
            <Field label="Review floor">
              <input type="number" min={0} max={1} step={0.01} className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
                value={reviewFloor} onChange={(e) => setReviewFloor(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button disabled={!valid || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Running…" : "Run dry run"}</Button>
          </div>
          {result ? (
            <>
              <dl className="flex flex-wrap gap-6 text-[13px]" style={{ color: "var(--m-ink-2)" }}>
                <div><dt>Pairs re-scored</dt><dd className="font-semibold">{result.pairs.toLocaleString()}</dd></div>
                <div><dt>Newly linked</dt><dd className="font-semibold">{result.pairs_newly_linked.toLocaleString()}</dd></div>
                <div><dt>Unlinked</dt><dd className="font-semibold">{result.pairs_unlinked.toLocaleString()}</dd></div>
                <div><dt>Clusters before / after</dt><dd className="font-semibold">{result.clusters_before.toLocaleString()} / {result.clusters_after.toLocaleString()}</dd></div>
                <div><dt>Would merge</dt><dd className="font-semibold">{result.clusters_that_would_merge.toLocaleString()}</dd></div>
                <div><dt>Would split</dt><dd className="font-semibold">{result.clusters_that_would_split.toLocaleString()}</dd></div>
              </dl>
              {moves.length ? (
                <table className="text-[13px]">
                  <thead><tr><th className="text-left pr-4">Band move</th><th className="text-left">Pairs</th></tr></thead>
                  <tbody>
                    {moves.map(([k, n]) => (
                      <tr key={k}><td className="pr-4">{k.split("->").map(formatModuleName).join(" to ")}</td><td>{n.toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No pair changes band.</p>}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------- Pair constraints ---------- */

function ConstraintsTab() {
  const qc = useQueryClient();
  const write = useRole().can("approve");
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<PairConstraintKind | "">("");
  const [key, setKey] = useState("");
  const params = { domain: domain || undefined, kind: kind || undefined, key: key.trim() || undefined };
  const list = useQuery({ queryKey: queryKeys.pairConstraints(params), queryFn: () => getPairConstraints(params) });
  const clear = useMutation({
    mutationFn: (c: PairConstraint) => clearPairConstraint(c.id, window.prompt("Why clear this constraint? (optional)") ?? undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pairConstraintsAll() }),
  });
  const rows = list.data ?? [];

  const columns = useMemo<ColumnDef<PairConstraint>[]>(() => [
    { id: "kind", header: "Kind", cell: ({ row }) => KINDS.find((k) => k.value === row.original.kind)?.label ?? row.original.kind },
    { id: "domain", header: "Domain", cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "a", header: "Record A", cell: ({ row }) => row.original.key_lo },
    { id: "b", header: "Record B", cell: ({ row }) => row.original.key_hi },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reason ?? "None given" },
    {
      id: "clear", header: "", cell: ({ row }) => write ? (
        <Button variant="secondary" disabled={clear.isPending} onClick={() => clear.mutate(row.original)}>Clear</Button>
      ) : null,
    },
  ], [write, clear]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Stewards create these by accepting or rejecting a pair, or by unmerging. They override the score until cleared.
      </p>
      <div className="flex items-center gap-2">
        <Select placeholder="All domains" value={domain} options={domainOptions([])} onValueChange={setDomain} />
        <Select placeholder="Both kinds" value={kind} options={KINDS} onValueChange={(v) => setKind((v as PairConstraintKind) || "")} />
        <input
          placeholder="Record key"
          className="rounded border px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--m-line)" }}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      {!write ? <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Clearing a constraint needs the approve permission.</p> : null}
      {list.isLoading ? (
        <Skeleton height={200} />
      ) : list.error ? (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : "Pair constraints could not be loaded."}
          onRetry={() => void list.refetch()}
        />
      ) : rows.length ? (
        <DataTable<PairConstraint> columns={columns} data={rows} getRowId={(c) => c.id} />
      ) : (
        <EmptyState title="No pair constraints yet." />
      )}
    </div>
  );
}
