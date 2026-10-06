"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Input, Mono, SectionCard } from "@/components/ui-core";
import { ClusterGraph } from "@/components/mdm/cluster-graph";
import { useRole } from "@/hooks/use-role";
import {
  decidePair,
  getClusterGraph,
  getMergeEvents,
  getMergeExplanation,
  revertMergeEvent,
  setStewardOverrides,
  undoLastMerge,
  unmergeRecords,
  type PairExplanation,
} from "@/lib/api/merge-explain";
import { formatDate } from "@/lib/format";

const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const NONE = "None";
const scroll = { overflowX: "auto" } as const;

function PairDetail({ pair }: { pair: PairExplanation }) {
  const ex = pair.explanation;
  if (!ex) return <p className="ui-note">No per-attribute breakdown is stored for this pair.</p>;
  return (
    <div className="ui-stack">
      <p className="ui-note">
        <Mono>{pair.a}</Mono> against <Mono>{pair.b}</Mono>: total <strong className="aurora-number">{ex.total.toFixed(3)}</strong>,
        band <strong>{ex.band}</strong> ({ex.fired}).
      </p>
      <div style={scroll}>
        <table className="ui-mini-table">
          <thead>
            <tr><th>Field</th><th>Comparator</th><th>A</th><th>B</th><th>Similarity</th><th>Weight</th><th>Contribution</th><th>Threshold</th></tr>
          </thead>
          <tbody>
            {ex.attributes.map((a) => (
              <tr key={a.field}>
                <td><Mono>{a.field}</Mono></td>
                <td>{a.comparator}</td>
                <td><Mono>{a.value_a || NONE}</Mono></td>
                <td><Mono>{a.value_b || NONE}</Mono></td>
                <td className="aurora-number">{a.skipped ? a.reason : pct(a.similarity)}</td>
                <td className="aurora-number">{a.weight}</td>
                <td className="aurora-number">{a.contribution.toFixed(3)}</td>
                <td>{a.threshold == null ? NONE : `${pct(a.threshold)} ${a.threshold_met ? "met" : "not met"}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ex.attributes.some((a) => a.masked) ? <p className="ui-micro">Sensitive values are masked.</p> : null}
    </div>
  );
}

type Ask =
  | { kind: "unmerge" }
  | { kind: "undo" }
  | { kind: "remerge"; id: string }
  | { kind: "pair"; id: string; decision: "accept" | "reject" };

/** "Why merged": match evidence, survivorship winners and losers, cluster graph and unmerge controls. */
export function WhyMergedPanel({ recordId }: { recordId: string }) {
  const qc = useQueryClient();
  const canChange = useRole().can("approve");
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [split, setSplit] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState<{ field: string; value: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  const explain = useQuery({ queryKey: ["merge-explain", recordId], queryFn: () => getMergeExplanation(recordId) });
  const graph = useQuery({ queryKey: ["cluster-graph", recordId], queryFn: () => getClusterGraph(recordId) });
  const events = useQuery({ queryKey: ["merge-events", recordId], queryFn: () => getMergeEvents(recordId) });

  const refresh = () => {
    setAsk(null);
    for (const k of ["merge-explain", "cluster-graph", "merge-events", "master-record"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  const onError = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    toast.error(typeof detail === "string" ? detail : "Action failed");
  };
  const unmerge = useMutation({
    mutationFn: () => unmergeRecords(recordId, split, reason),
    onSuccess: (r) => {
      toast.success(`Split ${r.split_keys.length} record(s); ${r.do_not_match_pairs} do-not-match pairs added`);
      setSplit([]); setReason(""); refresh();
    },
    onError,
  });
  const undo = useMutation({
    mutationFn: () => undoLastMerge(recordId, reason || undefined),
    onSuccess: () => { toast.success("Last merge undone"); refresh(); },
    onError,
  });
  const revert = useMutation({
    mutationFn: (eventId: string) => revertMergeEvent(eventId, reason || undefined),
    onSuccess: (r) => { toast.success(`Re-merged ${r.remerged_keys.join(", ")}`); refresh(); },
    onError,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "accept" | "reject" }) => decidePair(v.id, v.decision, reason),
    onSuccess: (r) => { toast.success(`Pair recorded as ${r.kind.replace(/_/g, " ")}`); setReason(""); refresh(); },
    onError,
  });

  // Merges into the existing overrides; null clears one field. Survivorship is recomputed server side.
  const override = useMutation({
    mutationFn: (v: { field: string; value: string | null }) =>
      setStewardOverrides(recordId, { [v.field]: v.value }, reason || undefined),
    onSuccess: (_r, v) => { toast.success(v.value == null ? `Override on ${v.field} cleared` : `${v.field} overridden`); setEdit(null); refresh(); },
    onError,
  });

  if (explain.isLoading) return <p className="ui-note">Loading the merge explanation.</p>;
  if (!explain.data) return null;
  const d = explain.data;
  const pair = d.pairs.find((p) => p.id === edgeId) ?? d.pairs[0];
  const busy = unmerge.isPending || undo.isPending || revert.isPending || decide.isPending || override.isPending;
  const survivorship = Object.entries(d.survivorship).sort(([a], [b]) => a.localeCompare(b));
  const events_ = events.data ?? [];

  const run = () => {
    if (!ask) return;
    if (ask.kind === "unmerge") unmerge.mutate();
    else if (ask.kind === "undo") undo.mutate();
    else if (ask.kind === "remerge") revert.mutate(ask.id);
    else decide.mutate({ id: ask.id, decision: ask.decision });
  };
  const text = (a: Ask): { title: string; body: string; go: string } => {
    if (a.kind === "unmerge") return { title: `Split ${split.length} record${split.length === 1 ? "" : "s"} out of this cluster?`, body: "They become separate records again and each pair is marked do not match. This changes Meridian's data only, nothing is written to SAP.", go: "Unmerge records" };
    if (a.kind === "undo") return { title: "Undo the last merge?", body: "The most recent merge on this cluster is reversed. Nothing is written to SAP.", go: "Undo merge" };
    if (a.kind === "remerge") return { title: "Re-merge these records?", body: "The reversal is itself reversed and the records join the cluster again.", go: "Re-merge" };
    return { title: a.decision === "accept" ? "Always match this pair?" : "Never match this pair?", body: "Future runs follow this decision for the pair.", go: "Record decision" };
  };
  const t = ask ? text(ask) : null;
  const gentle = ask?.kind === "remerge" || ask?.kind === "pair";

  return (
    <div className="ui-stack">
      <SectionCard title="Why merged" meta={d.key}>
        <p className="ui-note">
          {d.members.length ? `Survivor ${d.key} with ${d.members.length} merged record${d.members.length === 1 ? "" : "s"}.` : `Survivor ${d.key}, not merged with any record.`}{" "}
          Auto-merge at {pct(d.thresholds.auto_merge)}, steward review from {pct(d.thresholds.review_floor)}.
        </p>
      </SectionCard>

      {ask && t ? (
        <Banner tone={gentle ? "warning" : "danger"} title={t.title}
          action={
            <div className="ui-page-header__actions">
              <Button size="sm" variant={gentle ? "primary" : "danger"} disabled={busy} onClick={run}>{t.go}</Button>
              <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>Keep as it is</Button>
            </div>}>
          {t.body}
        </Banner>
      ) : null}

      {graph.data && graph.data.nodes.length > 1 ? (
        <SectionCard title="Cluster" meta={`${graph.data.nodes.length} records`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--aurora-space-4)" }}>
            <ClusterGraph graph={graph.data} selectedEdgeId={pair?.id ?? null} onSelectEdge={(e) => setEdgeId(e.id)} />
            <div className="ui-stack">
              {graph.data.weak_chains.length > 0 ? (
                <>
                  <p className="ui-note"><strong>{graph.data.weak_chains.length} weak chain{graph.data.weak_chains.length === 1 ? "" : "s"}</strong> link records only through a third record.</p>
                  <ul className="ui-stack">
                    {graph.data.weak_chains.map((w) => (
                      <li key={`${w.a}-${w.via}-${w.b}`} className="ui-micro">
                        <Mono>{w.a}</Mono> to <Mono>{w.via}</Mono> to <Mono>{w.b}</Mono>: {w.reason.replace(/_/g, " ")}
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="ui-note">Every member links directly above the threshold.</p>}
              <p className="ui-micro">Select an edge to see its attribute breakdown.</p>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {pair ? (
        <SectionCard title="Match evidence"
          action={canChange ? (
            <div className="ui-page-header__actions">
              <Button size="sm" variant="secondary" disabled={busy || !reason} onClick={() => setAsk({ kind: "pair", id: pair.id, decision: "accept" })}>Always match</Button>
              <Button size="sm" variant="secondary" disabled={busy || !reason} onClick={() => setAsk({ kind: "pair", id: pair.id, decision: "reject" })}>Do not match</Button>
            </div>) : undefined}>
          <div className="ui-stack">
            <PairDetail pair={pair} />
            <p className="ui-micro">
              {pair.steward_decision ? `Steward ${pair.steward_decision}ed: ${pair.steward_reason ?? "no reason recorded"}.` : "No steward decision."}
              {pair.constraint ? ` Constraint: ${pair.constraint.replace(/_/g, " ")}.` : ""}
            </p>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Survivorship" meta={`${survivorship.length} fields`} flush>
        <div style={scroll}>
          <table className="ui-mini-table">
            <thead>
              <tr><th>Field</th><th>Value</th><th>From</th><th>Rule</th><th>Losing values</th>{canChange ? <th>Override</th> : null}</tr>
            </thead>
            <tbody>
              {survivorship.map(([field, s]) => (
                <tr key={field}>
                  <td><Mono>{field}</Mono></td>
                  <td>
                    {edit?.field === field ? (
                      <Input aria-label={`Override value for ${field}`} value={edit.value} autoFocus
                        onChange={(e) => setEdit({ field, value: e.target.value })} />
                    ) : <Mono>{s.value || NONE}</Mono>}
                  </td>
                  <td><Mono>{s.winner_key ?? NONE}</Mono></td>
                  <td>{s.rule}</td>
                  <td>
                    {s.losers.length === 0 ? NONE : s.losers.map((l) => (
                      <div key={l.key}>
                        <Mono>{l.key}</Mono> {l.value ? <Mono>{`"${l.value}"`}</Mono> : null} <span className="ui-micro">{l.reason}</span>
                      </div>
                    ))}
                  </td>
                  {canChange ? (
                    <td>
                      {edit?.field === field ? (
                        <>
                          <Button size="sm" variant="secondary" disabled={busy || !edit.value} onClick={() => override.mutate({ field, value: edit.value })}>Save</Button>{" "}
                          <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Discard edit</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit({ field, value: s.value ?? "" })}>Override</Button>
                          {field in d.steward_overrides ? (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => override.mutate({ field, value: null })}>Clear</Button>
                          ) : null}
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {canChange ? (
        <SectionCard title="Steward actions">
          <div className="ui-stack">
            <label className="ui-note">
              Reason, required for unmerge and pair decisions and recorded with overrides
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
            </label>
            {d.members.length > 0 ? (
              <fieldset className="ui-stack">
                <legend className="ui-micro">Split out of this cluster</legend>
                {d.members.map((k) => (
                  <label key={k} className="ui-note">
                    <input type="checkbox" checked={split.includes(k)}
                      onChange={(e) => setSplit(e.target.checked ? [...split, k] : split.filter((x) => x !== k))} />{" "}
                    <Mono>{k}</Mono>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="ui-page-header__actions">
              <Button size="sm" disabled={busy || !split.length || !reason} onClick={() => setAsk({ kind: "unmerge" })}>Unmerge selected</Button>
              <Button size="sm" variant="secondary" disabled={busy || !d.members.length} onClick={() => setAsk({ kind: "undo" })}>Undo last merge</Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Merge history" meta={String(events_.length)} flush={events_.length > 0}>
        {events_.length === 0 ? <p className="ui-note">No merge events.</p> : (
          <div style={scroll}>
            <table className="ui-mini-table">
              <thead><tr><th>When</th><th>Event</th><th>Records</th><th>Reason</th>{canChange ? <th>Action</th> : null}</tr></thead>
              <tbody>
                {events_.map((e) => (
                  <tr key={e.id}>
                    <td className="aurora-number">{formatDate(e.created_at, "datetime")}</td>
                    <td>{e.event_type}{e.reversed ? " (reversed)" : ""}</td>
                    <td><Mono>{e.member_keys.join(", ")}</Mono></td>
                    <td>{e.reason || NONE}</td>
                    {canChange ? (
                      <td>
                        {!e.reversed && (e.event_type === "unmerge" || e.event_type === "undo") ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk({ kind: "remerge", id: e.id })}>Re-merge</Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
