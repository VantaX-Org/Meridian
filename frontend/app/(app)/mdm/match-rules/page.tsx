// frontend/app/(app)/mdm/match-rules/page.tsx
"use client";
import { useUrlState } from "@/hooks/use-url-state";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Mono, Notice, PageHeader, Pill, Select, Skeleton, Tabs, Input, PageFrame, Textarea, toast } from "@/design";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { usePermissionsContext } from "@/lib/permissions";
import { primaryRole } from "@/components/gated-primary";
import {
  createMatchRule, deleteMatchRule, getMatchRules, simulateMatchRules, updateMatchRule,
} from "@/lib/api/match-rules";
import {
  clearPairConstraint, getPairConstraints, matchTuningDryRun,
  type DryRunResult, type PairConstraint, type PairConstraintKind,
} from "@/lib/api/merge-explain";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
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
  { value: "do_not_match", label: "Not a match" },
  { value: "always_match", label: "Same record" },
];

function domainOptions(extra: string[]) {
  return Array.from(new Set([...DOMAINS, ...extra])).sort().map((d) => ({ value: d, label: formatModuleName(d) }));
}

type Draft = { domain: string; field: string; match_type: MatchType; weight: number; threshold: number; active: boolean };
// The API takes weight as a whole number from 0 to 100 (api/routes/match_rules.py MatchRuleCreate) and threshold as 0-1.
const emptyDraft = (domain: string): Draft => ({ domain, field: "", match_type: "fuzzy", weight: 50, threshold: 0.85, active: true });
const validWeight = (w: number) => Number.isInteger(w) && w >= 0 && w <= 100;

export default function MatchRulesPage() {
  const [tabRaw, setTab] = useUrlState("tab", "rules");
  const tab = (["rules", "tuning", "constraints"] as string[]).includes(tabRaw) ? tabRaw : "rules";
  return (
    <PageFrame>
      <PageHeader
        title="Match rules"
        meta="How the matcher decides two records are the same: the fields it compares, what a change would do, and the pairs stewards have settled"
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "rules", label: "Rules", content: <RulesTab /> },
          { value: "tuning", label: "Tuning", content: <TuningTab /> },
          { value: "constraints", label: "Settled pairs", content: <ConstraintsTab /> },
        ]}
      />
    </PageFrame>
  );
}

/* ---------- Rules ---------- */

// The /match-rules API requires manage_rules for every call, reading included.
function NeedsManageRules() {
  return (
    <EmptyState
      title="You need permission to manage rules"
      detail="Ask an administrator for a role that manages rules, such as steward. You can still review match pairs."
      ghost="list"
      action={<Button variant="secondary" render={<Link href="/mdm/golden/merge">Review match pairs</Link>} />}
    />
  );
}

function RulesTab() {
  const { can, loading } = useRole();
  // Grants fail closed while loading; a refusal must not flash before they arrive.
  if (loading) return <Skeleton height={200} />;
  return can("manage_rules") ? <RulesEditor /> : <NeedsManageRules />;
}

function RulesEditor() {
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<MatchRule | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (r: MatchRule) => deleteMatchRule(r.id),
    onSuccess: () => { refresh(); close(); setConfirmDelete(false); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const simulate = useMutation({
    mutationFn: (d: string) => simulateMatchRules({ domain: d }),
    onSuccess: setSimulation,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns = useMemo<ColumnDef<MatchRule>[]>(() => [
    { id: "domain", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", cell: ({ row }) => row.original.field },
    { id: "type", header: "Match", cell: ({ row }) => MATCH_TYPES.find((t) => t.value === row.original.match_type)?.label ?? row.original.match_type },
    { id: "weight", header: "Weight", cell: ({ row }) => row.original.weight.toLocaleString() },
    { id: "threshold", header: "Threshold", cell: ({ row }) => `${Math.round(row.original.threshold * 100)}%` },
    { id: "active", header: "State", cell: ({ row }) => <Pill tone={row.original.active ? "go" : "neutral"}>{row.original.active ? "Active" : "Off"}</Pill> },
    actionColumn((r) => <RowButton label={`Edit ${r.field}`} onClick={() => { setEditing(r); setDraft({ ...r }); }}>Edit</RowButton>),
  ], []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select label="Object" placeholder="All objects" value={domain} options={domains} onValueChange={(v) => { setDomain(v); setSimulation(null); }} />
        <Button onClick={() => { setEditing(null); setDraft(emptyDraft(domain || DOMAINS[0])); }}>New rule</Button>
        <Button
          variant="secondary"
          disabled={!domain || simulate.isPending}
          onClick={() => simulate.mutate(domain)}
        >
          {simulate.isPending ? "Simulating…" : "Simulate"}
        </Button>
      </div>

      {simulation ? (
        <dl className="flex gap-6 m-text-body m-ink-2">
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
          {...apiErrorState(rulesQuery.error)}
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
        <EmptyState
          title={domain ? `No rules for ${formatModuleName(domain)} yet` : "No match rules yet"}
          detail={domain ? undefined : "Add one per field the engine should compare."}
          action={<Button onClick={() => { setEditing(null); setDraft(emptyDraft(domain || DOMAINS[0])); }}>Add rule</Button>}
        />
      )}

      {draft ? (
        <Card title={editing ? `Edit rule ${editing.field}` : "New match rule"}>
        <div className="flex flex-col gap-3">
          <Field label="Object"><Select value={draft.domain} options={domains} onValueChange={(v) => setDraft({ ...draft, domain: v })} /></Field>
          <Field label="Field">
            <Input
              value={draft.field}
              onChange={(e) => setDraft({ ...draft, field: e.target.value.toUpperCase().trim() })}
            />
          </Field>
          <Field label="Match type">
            <Select value={draft.match_type} options={MATCH_TYPES} onValueChange={(v) => setDraft({ ...draft, match_type: v as MatchType })} />
          </Field>
          <Field label="Weight, 0 to 100" error={validWeight(draft.weight) ? undefined : "Enter a whole number from 0 to 100"}>
            <Input type="number" step="1" min="0" max="100"
              value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })} />
          </Field>
          <Field label="Threshold %">
            <Input type="number" step="1" min="0" max="100"
              value={Math.round(draft.threshold * 100)} onChange={(e) => setDraft({ ...draft, threshold: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })} />
          </Field>
          <Field label="State">
            <Select value={draft.active ? "on" : "off"} options={[{ value: "on", label: "Active" }, { value: "off", label: "Off" }]}
              onValueChange={(v) => setDraft({ ...draft, active: v === "on" })} />
          </Field>
          <div className="flex gap-2">
            <Button disabled={save.isPending || !draft.field.trim() || !validWeight(draft.weight)} onClick={() => save.mutate(draft)}>{editing ? "Save" : "Create"}</Button>
            {editing ? <Button variant="secondary" disabled={remove.isPending} onClick={() => setConfirmDelete(true)}>Delete rule</Button> : null}
            <Button variant="ghost" onClick={close}>Discard changes</Button>
          </div>
        </div>
        </Card>
      ) : null}
      {editing ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete the ${editing.field} rule?`}
          body={<p className="m-text-body m-ink-2">The matcher stops comparing {editing.field} for {formatModuleName(editing.domain)} from the next match run. Pairs already scored keep their score.</p>}
          confirmLabel="Delete rule"
          cancelLabel="Keep rule"
          tone="danger"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(editing)}
        />
      ) : null}
    </div>
  );
}

/* ---------- Tuning dry run ---------- */

function TuningTab() {
  const qc = useQueryClient();
  const tuneRef = useRef<HTMLDivElement>(null);
  const [domain, setDomain] = useState("");
  // Current weights come from /match-rules (manage_rules); the dry run itself needs only view.
  const canReadRules = useRole().can("manage_rules");
  const rulesQuery = useQuery({ enabled: !!domain && canReadRules, queryKey: queryKeys.matchRules(domain), queryFn: () => getMatchRules(domain) });
  const domains = useMemo(() => domainOptions(rulesQuery.data?.rules.map((r) => r.domain) ?? []), [rulesQuery.data]);
  const current = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rulesQuery.data?.rules ?? []) if (r.active && !(r.field in m)) m[r.field] = r.weight;
    return m;
  }, [rulesQuery.data]);
  const [weights, setWeights] = useState<Record<string, string>>({});
  // Thresholds read as percentages here, as everywhere else; the dry-run API takes 0-1.
  const [autoMerge, setAutoMerge] = useState("95");
  const [reviewFloor, setReviewFloor] = useState("30");
  const [result, setResult] = useState<DryRunResult | null>(null);
  // The weights the shown result was run with, so Apply saves exactly what was tried.
  const [tried, setTried] = useState<Record<string, number>>({});
  const [confirmApply, setConfirmApply] = useState(false);
  const am = Number(autoMerge) / 100;
  const rf = Number(reviewFloor) / 100;
  const changedWeights = Object.fromEntries(Object.entries(weights).filter(([f, v]) => v.trim() !== "" && Number(v) !== current[f]).map(([f, v]) => [f, Number(v)]));
  const weightsValid = Object.values(changedWeights).every(validWeight);
  const valid = !!domain && am > 0 && am <= 1 && rf >= 0 && rf < am && weightsValid;
  const run = useMutation({
    mutationFn: (w: Record<string, number>) => matchTuningDryRun({ domain, auto_merge: am, review_floor: rf, weights: w }),
    onSuccess: (r, w) => { setResult(r); setTried(w); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // Every active rule on a tried field takes the tried weight (the dry run scores a field by one weight).
  const toApply = (rulesQuery.data?.rules ?? []).filter((r) => r.active && r.field in tried && r.weight !== tried[r.field]);
  const stale = JSON.stringify(tried) !== JSON.stringify(changedWeights);
  const apply = useMutation({
    mutationFn: () => Promise.all(toApply.map((r) => updateMatchRule(r.id, { weight: tried[r.field] }))),
    onSuccess: (rows) => {
      setConfirmApply(false);
      setWeights({});
      setTried({});
      setResult(null);
      toast.success(`${rows.length === 1 ? "1 rule" : `${rows.length.toLocaleString()} rules`} updated. The next match run scores pairs with the new weights`);
      void qc.invalidateQueries({ queryKey: queryKeys.matchRulesAll() });
    },
    onError: (e) => { setConfirmApply(false); toast.error(apiErrorMessage(e)); void qc.invalidateQueries({ queryKey: queryKeys.matchRulesAll() }); },
  });
  const fields = Object.keys(current).sort();
  const moves = Object.entries(result?.band_moves ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-3">
      <p className="m-text-body m-ink-3">
        Re-scores the newest 50,000 stored pairs of an object with the weights below. Nothing is saved until you apply the weights.
      </p>
      <div ref={tuneRef}><Select label="Object" placeholder="Pick an object" value={domain} options={domains} onValueChange={(v) => { setDomain(v); setResult(null); }} /></div>
      {!domain ? (
        <EmptyState title="Pick an object to tune" detail="Choose one above to re-score its stored pairs" action={<Button variant="secondary" onClick={() => tuneRef.current?.querySelector("button")?.focus()}>Choose an object</Button>} />
      ) : rulesQuery.isLoading ? (
        <Skeleton height={160} />
      ) : rulesQuery.error ? (
        <ErrorState
          {...apiErrorState(rulesQuery.error)}
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {fields.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <Field key={f} label={`${f} (current ${current[f]})`} error={weights[f] !== undefined && f in changedWeights && !validWeight(changedWeights[f]!) ? "Enter a whole number from 0 to 100" : undefined}>
                  <Input type="number" min={0} max={100} step={1}
                    value={weights[f] ?? String(current[f])}
                    onChange={(e) => { const v = e.target.value; setWeights((w) => ({ ...w, [f]: v })); }} />
                </Field>
              ))}
            </div>
          ) : canReadRules ? (
            <EmptyState variant="inline" title={`No active match rules for ${formatModuleName(domain)}`} detail="Thresholds can still be tried" />
          ) : (
            <Notice tone="info">Only rule managers can see and change rule weights. Thresholds can still be tried.</Notice>
          )}
          <div className="flex gap-3">
            <Field label="Auto-merge at %">
              <Input type="number" min={1} max={100} step={1}
                value={autoMerge} onChange={(e) => setAutoMerge(e.target.value)} />
            </Field>
            <Field label="Review floor %">
              <Input type="number" min={0} max={99} step={1}
                value={reviewFloor} onChange={(e) => setReviewFloor(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!valid || run.isPending} onClick={() => run.mutate(changedWeights)}>{run.isPending ? "Running…" : "Run dry run"}</Button>
            {result && canReadRules ? (
              <Button variant="secondary" disabled={!toApply.length || stale || apply.isPending} onClick={() => setConfirmApply(true)}>Apply these weights</Button>
            ) : null}
            {result && canReadRules && !toApply.length ? <span className="m-text-meta m-ink-3">This run tried the current weights, so there is nothing to apply</span> : null}
            {result && canReadRules && toApply.length && stale ? <span className="m-text-meta m-ink-3">The weights changed since this run. Run it again to apply them</span> : null}
          </div>
          <p className="m-text-meta m-ink-3">The thresholds are fixed by the matcher; only the weights can be applied.</p>
          {result ? (
            <>
              <dl className="flex flex-wrap gap-6 m-text-body m-ink-2">
                <div><dt>Pairs re-scored</dt><dd className="font-semibold">{result.pairs.toLocaleString()}</dd></div>
                <div><dt>Newly linked</dt><dd className="font-semibold">{result.pairs_newly_linked.toLocaleString()}</dd></div>
                <div><dt>Unlinked</dt><dd className="font-semibold">{result.pairs_unlinked.toLocaleString()}</dd></div>
                <div><dt>Clusters before / after</dt><dd className="font-semibold">{result.clusters_before.toLocaleString()} / {result.clusters_after.toLocaleString()}</dd></div>
                <div><dt>Would merge</dt><dd className="font-semibold">{result.clusters_that_would_merge.toLocaleString()}</dd></div>
                <div><dt>Would split</dt><dd className="font-semibold">{result.clusters_that_would_split.toLocaleString()}</dd></div>
              </dl>
              {moves.length ? (
                <DataTable<[string, number]>
                  columns={moveCols}
                  data={moves}
                  getRowId={([k]) => k}
                  height="auto"
                />
              ) : <EmptyState variant="inline" title="No pair changes band" />}
            </>
          ) : null}
          <ConfirmDialog
            open={confirmApply}
            onOpenChange={setConfirmApply}
            title={`Change the weight of ${toApply.length === 1 ? "1 rule" : `${toApply.length.toLocaleString()} rules`}?`}
            body={
              <div className="flex flex-col gap-2 m-text-body">
                <p className="m-ink-2">{formatModuleName(domain)} pairs are scored with these weights from the next match run. Pairs already scored keep their score.</p>
                <ul className="flex flex-col gap-1">
                  {toApply.map((r) => <li key={r.id}><Mono>{r.field}</Mono> {r.weight.toLocaleString()} to {tried[r.field]?.toLocaleString()}</li>)}
                </ul>
              </div>
            }
            confirmLabel="Apply weights"
            cancelLabel="Keep current weights"
            pending={apply.isPending}
            onConfirm={() => apply.mutate()}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- Pair constraints ---------- */

const moveCols: ColumnDef<[string, number]>[] = [
  { id: "move", header: "Band move", accessorFn: ([k]) => k.split("->").map(formatModuleName).join(" to ") },
  { id: "pairs", header: "Pairs", accessorFn: ([, n]) => n.toLocaleString() },
];

function ConstraintsTab() {
  const qc = useQueryClient();
  const write = useRole().can("approve");
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<PairConstraintKind | "">("");
  const [key, setKey] = useState("");
  const params = { domain: domain || undefined, kind: kind || undefined, key: key.trim() || undefined };
  const list = useQuery({ queryKey: queryKeys.pairConstraints(params), queryFn: () => getPairConstraints(params) });
  const [clearing, setClearing] = useState<PairConstraint | null>(null);
  const [reason, setReason] = useState("");
  const clear = useMutation({
    mutationFn: (c: PairConstraint) => clearPairConstraint(c.id, reason.trim() || undefined),
    onSuccess: () => { setClearing(null); setReason(""); toast("Decision cleared"); void qc.invalidateQueries({ queryKey: queryKeys.pairConstraintsAll() }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const rows = list.data ?? [];

  const columns = useMemo<ColumnDef<PairConstraint>[]>(() => [
    { id: "kind", header: "Kind", cell: ({ row }) => KINDS.find((k) => k.value === row.original.kind)?.label ?? row.original.kind },
    { id: "domain", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "a", header: "Record A", cell: ({ row }) => row.original.key_lo },
    { id: "b", header: "Record B", cell: ({ row }) => row.original.key_hi },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reason ?? "None given" },
    actionColumn((c) => (write ? <RowButton disabled={clear.isPending} onClick={() => setClearing(c)}>Clear</RowButton> : null)),
  ], [write, clear.isPending]);

  return (
    <div className="flex flex-col gap-3">
      <p className="m-text-body m-ink-3">
        A steward settles a pair by merging it, marking it not a match, or splitting a record out. The decision beats the score until it is cleared.
      </p>
      <div className="flex items-center gap-2">
        <Select label="Object" placeholder="All objects" value={domain} options={domainOptions([])} onValueChange={setDomain} />
        <Select label="Constraint kind" placeholder="Both kinds" value={kind} options={KINDS} onValueChange={(v) => setKind((v as PairConstraintKind) || "")} />
        <Input
          placeholder="Record key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      {!write ? <NeedsApprove action="Clearing a decision" /> : null}
      {list.isLoading ? (
        <Skeleton height={200} />
      ) : list.error ? (
        <ErrorState
          {...apiErrorState(list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : rows.length ? (
        <DataTable<PairConstraint> columns={columns} data={rows} getRowId={(c) => c.id} />
      ) : (
        <EmptyState
          title="No settled pairs yet"
          detail="Merge a pair or mark it not a match in match review to settle it."
          action={<Button render={<Link href="/mdm/golden/merge">Review match pairs</Link>} />}
        />
      )}
      <ConfirmDialog
        open={!!clearing}
        onOpenChange={(o) => { if (!o) { setClearing(null); setReason(""); } }}
        title="Clear this decision?"
        body={clearing ? (
          <div className="flex flex-col gap-3 m-text-body">
            <p className="m-ink-2">{clearing.key_lo} and {clearing.key_hi} go back to being judged by their score on the next match run.</p>
            <Field label="Reason (optional)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        ) : null}
        confirmLabel="Clear decision"
        cancelLabel="Keep it"
        pending={clear.isPending}
        onConfirm={() => { if (clearing) clear.mutate(clearing); }}
      />
    </div>
  );
}

/** The approve gate in the GatedPrimary wording, with its Request access link, for an action that sits in a row. */
function NeedsApprove({ action }: { action: string }) {
  const perms = usePermissionsContext();
  if (perms?.loading) return null;
  return (
    <Notice tone="info">
      {action} needs {primaryRole("approve")} on all systems.{" "}
      {perms ? (
        <button type="button" className="m-ink-accent-ink underline underline-offset-2" onClick={() => perms.requestAccess({ resource: "fixes", action: "approve", system_id: null })}>Request access</button>
      ) : null}
    </Notice>
  );
}
