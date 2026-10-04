"use client";

/**
 * Workbench → Match tuning: re-score a domain's stored candidate pairs with
 * proposed field weights and thresholds and see which clusters would merge
 * or split. Nothing is saved; change the match rules to apply a result.
 *
 * Workbench → Pair constraints: the do-not-match / always-match pairs that
 * stewards created by rejecting or accepting a pair, or by unmerging. They
 * win over the score. Clearing one needs the approve permission.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Field, Input, KpiRail, Select, Stack, Stat, Text } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { getMatchRules } from "@/lib/api/match-rules";
import {
  clearPairConstraint, getPairConstraints, matchTuningDryRun, type DryRunResult, type PairConstraint, type PairConstraintKind,
} from "@/lib/api/merge-explain";
import { formatModuleName } from "@/lib/format";

// Same list the Match rules tab offers; domains with rules are added to it.
const DOMAINS = ["business_partner", "material_master", "sd_customer_master", "accounts_payable", "accounts_receivable", "employee_central"];
const KINDS: { value: PairConstraintKind; label: string }[] = [
  { value: "do_not_match", label: "Do not match" }, { value: "always_match", label: "Always match" },
];
const errText = (e: unknown, fallback: string) => (e as Error).message || fallback;
const domainOptions = (extra: string[]) =>
  Array.from(new Set([...DOMAINS, ...extra])).sort().map((d) => ({ value: d, label: formatModuleName(d) }));

/* ---------- Match tuning dry-run ---------- */

export function MatchTuningSurface() {
  const [domain, setDomain] = useState("");
  const all = useQuery({ queryKey: ["match-rules", ""], queryFn: () => getMatchRules() });
  const domains = domainOptions(all.data?.rules.map((r) => r.domain) ?? []);
  return (
    <Stack gap={6} className="aurora-page">
      <Text variant="text-small" tone="secondary">
        Re-scores the newest 50,000 stored pairs in a domain with the weights below. Steward decisions and pair constraints still win. Nothing is saved.
      </Text>
      <Stack direction="row" gap={3} align="center" wrap>
        <Select placeholder="Pick a domain" value={domain} aria-label="Domain" options={domains} onValueChange={setDomain} />
      </Stack>
      {domain ? <TuningForm key={domain} domain={domain} /> : <Text tone="muted">Pick a domain to tune.</Text>}
    </Stack>
  );
}

function TuningForm({ domain }: { domain: string }) {
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
    onSuccess: setResult,
    onError: (e) => toast.error(errText(e, "Dry run failed")),
  });
  const fields = Object.keys(current).sort();
  const moves = Object.entries(result?.band_moves ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Stack gap={4}>
      {rules.isLoading ? <Text tone="muted">Reading match rules.</Text>
        : rules.error ? <Banner tone="danger" title="Match rules could not be read">{errText(rules.error, "")}</Banner>
        : fields.length ? (
          <table className="aurora-exec__table">
            <thead><tr><th>Field</th><th>Current weight</th><th>Proposed weight</th></tr></thead>
            <tbody>{fields.map((f) => (
              <tr key={f}>
                <td>{f}</td>
                <td className="aurora-number">{current[f]}</td>
                <td>
                  <Input type="number" min={0} step={0.1} aria-label={`Proposed weight for ${f}`} value={weights[f] ?? String(current[f])}
                    onChange={(e) => { const v = e.target.value; setWeights((w) => ({ ...w, [f]: v })); }} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Text tone="muted">No active match rules for {formatModuleName(domain)}. Thresholds can still be tried.</Text>}
      <Stack direction="row" gap={3} wrap className="aurora-filters">
        <Field label="Auto-merge at" helper="Score at or above merges without review.">
          {({ controlId }) => <Input id={controlId} type="number" min={0.01} max={1} step={0.01} value={autoMerge} onChange={(e) => setAutoMerge(e.target.value)} />}
        </Field>
        <Field label="Review floor" helper={rf >= am ? "Must be below auto-merge." : "Below this a pair is dismissed."}>
          {({ controlId }) => <Input id={controlId} type="number" min={0} max={1} step={0.01} value={reviewFloor} onChange={(e) => setReviewFloor(e.target.value)} />}
        </Field>
      </Stack>
      <Stack direction="row" gap={2}>
        <Button disabled={!valid || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Running…" : "Run dry run"}</Button>
        <Button variant="ghost" disabled={run.isPending} onClick={() => { setWeights({}); setAutoMerge("0.95"); setReviewFloor("0.30"); setResult(null); }}>Reset</Button>
      </Stack>
      {result ? (
        <Stack gap={3}>
          <KpiRail>
            <Stat label="Pairs re-scored" value={result.pairs.toLocaleString()} />
            <Stat label="Newly linked" value={result.pairs_newly_linked.toLocaleString()} tone={result.pairs_newly_linked ? "warning" : "neutral"} />
            <Stat label="Unlinked" value={result.pairs_unlinked.toLocaleString()} tone={result.pairs_unlinked ? "warning" : "neutral"} />
            <Stat label="Clusters before → after" value={`${result.clusters_before.toLocaleString()} → ${result.clusters_after.toLocaleString()}`} />
            <Stat label="Would merge" value={result.clusters_that_would_merge.toLocaleString()} />
            <Stat label="Would split" value={result.clusters_that_would_split.toLocaleString()} />
          </KpiRail>
          {moves.length ? (
            <table className="aurora-exec__table">
              <thead><tr><th>Band move</th><th>Pairs</th></tr></thead>
              <tbody>{moves.map(([k, n]) => (
                <tr key={k}><td>{k.split("->").map(formatModuleName).join(" → ")}</td><td className="aurora-number">{n.toLocaleString()}</td></tr>
              ))}</tbody>
            </table>
          ) : <Text tone="muted">No pair changes band.</Text>}
        </Stack>
      ) : null}
    </Stack>
  );
}

/* ---------- Pair constraints ---------- */

export function PairConstraintsSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("approve");
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<PairConstraintKind | "">("");
  const [key, setKey] = useState("");
  const params = { domain: domain || undefined, kind: kind || undefined, key: key.trim() || undefined };
  const list = useQuery({ queryKey: ["pair-constraints", params], queryFn: () => getPairConstraints(params) });
  const rules = useQuery({ queryKey: ["match-rules", ""], queryFn: () => getMatchRules() });
  const clear = useMutation({
    mutationFn: ({ c, reason }: { c: PairConstraint; reason: string }) => clearPairConstraint(c.id, reason || undefined),
    onSuccess: () => {
      for (const k of ["pair-constraints", "merge-explain", "cluster-graph", "merge-events"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success("Constraint cleared");
    },
    onError: (e) => toast.error(errText(e, "Constraint not cleared")),
  });
  const onClear = (c: PairConstraint) => {
    const reason = window.prompt(`Clear ${c.kind === "do_not_match" ? "do-not-match" : "always-match"} for ${c.key_lo} and ${c.key_hi}? Reason (optional):`);
    if (reason !== null) clear.mutate({ c, reason: reason.trim() });
  };
  const rows = list.data ?? [];
  return (
    <Stack gap={6} className="aurora-page">
      <Text variant="text-small" tone="secondary">
        Stewards create these by accepting or rejecting a pair, or by unmerging. They override the score until cleared. Clearing does not re-merge or split anything by itself.
      </Text>
      <Stack direction="row" gap={3} align="center" wrap>
        <Select value={domain} aria-label="Domain" options={[{ value: "", label: "All domains" }, ...domainOptions(rules.data?.rules.map((r) => r.domain) ?? [])]} onValueChange={setDomain} />
        <Select value={kind} aria-label="Kind" options={[{ value: "", label: "Both kinds" }, ...KINDS]}
          onValueChange={(v) => setKind(KINDS.find((k) => k.value === v)?.value ?? "")} />
        <Input aria-label="Record key" placeholder="Record key" value={key} onChange={(e) => setKey(e.target.value)} />
      </Stack>
      {!write ? <Banner tone="info" title="Read only">Clearing a constraint needs the approve permission.</Banner> : null}
      {list.isLoading ? <Text tone="muted">Reading constraints.</Text>
        : list.error ? <Banner tone="danger" title="Constraints could not be read">{errText(list.error, "")}</Banner>
        : rows.length ? (
          <table className="aurora-exec__table">
            <thead><tr><th>Kind</th><th>Domain</th><th>Record A</th><th>Record B</th><th>Reason</th><th>Created</th>{write ? <th /> : null}</tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td>{KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</td>
                <td>{formatModuleName(c.domain)}</td>
                <td>{c.key_lo}</td>
                <td>{c.key_hi}</td>
                <td><Text variant="text-small">{c.reason ?? "—"}</Text></td>
                <td>{new Date(c.created_at).toLocaleString()}</td>
                {write ? <td><Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => onClear(c)}>Clear</Button></td> : null}
              </tr>
            ))}</tbody>
          </table>
        ) : <Text tone="muted">No pair constraints{domain || kind || key.trim() ? " match these filters" : " yet"}.</Text>}
      {rows.length === 500 ? <Text variant="text-small" tone="muted">Showing the newest 500. Narrow the filters to see others.</Text> : null}
    </Stack>
  );
}
