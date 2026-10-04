"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const muted = { color: "var(--aurora-fg-muted)" };
const mono = { fontFamily: "var(--aurora-font-mono)" };
const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);

function PairDetail({ pair }: { pair: PairExplanation }) {
  const ex = pair.explanation;
  if (!ex) return <p className="text-sm" style={muted}>No per-attribute breakdown stored for this pair.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span style={mono}>{pair.a}</span> vs <span style={mono}>{pair.b}</span>: total{" "}
        <strong className="aurora-number">{ex.total.toFixed(3)}</strong>, band <strong>{ex.band}</strong>{" "}
        <span style={muted}>({ex.fired})</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={muted} className="text-left">
              <th className="py-1 pr-3">Field</th><th className="pr-3">Comparator</th><th className="pr-3">A</th>
              <th className="pr-3">B</th><th className="pr-3 text-right">Similarity</th>
              <th className="pr-3 text-right">Weight</th><th className="pr-3 text-right">Contribution</th>
              <th>Threshold</th>
            </tr>
          </thead>
          <tbody>
            {ex.attributes.map((a) => (
              <tr key={a.field} style={{ borderTop: "1px solid var(--aurora-canvas-line)" }}>
                <td className="py-1 pr-3" style={mono}>{a.field}</td>
                <td className="pr-3">{a.comparator}</td>
                <td className="pr-3" style={mono}>{a.value_a || "-"}</td>
                <td className="pr-3" style={mono}>{a.value_b || "-"}</td>
                <td className="pr-3 text-right aurora-number">{a.skipped ? a.reason : pct(a.similarity)}</td>
                <td className="pr-3 text-right aurora-number">{a.weight}</td>
                <td className="pr-3 text-right aurora-number">{a.contribution.toFixed(3)}</td>
                <td style={{ color: a.threshold_met === false ? "var(--aurora-status-warning-500)" : undefined }}>
                  {a.threshold == null ? "-" : `${pct(a.threshold)} ${a.threshold_met ? "met" : "not met"}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ex.attributes.some((a) => a.masked) && (
        <p className="text-xs" style={muted}>Sensitive values are masked.</p>
      )}
    </div>
  );
}

/** "Why merged": match evidence, survivorship winners and losers, cluster graph and unmerge controls. */
export function WhyMergedPanel({ recordId }: { recordId: string }) {
  const qc = useQueryClient();
  const canChange = useRole().can("approve");
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [split, setSplit] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState<{ field: string; value: string } | null>(null);

  const explain = useQuery({ queryKey: ["merge-explain", recordId], queryFn: () => getMergeExplanation(recordId) });
  const graph = useQuery({ queryKey: ["cluster-graph", recordId], queryFn: () => getClusterGraph(recordId) });
  const events = useQuery({ queryKey: ["merge-events", recordId], queryFn: () => getMergeEvents(recordId) });

  const refresh = () => {
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

  if (explain.isLoading) return <p className="text-sm" style={muted}>Loading merge explanation...</p>;
  if (!explain.data) return null;
  const d = explain.data;
  const pair = d.pairs.find((p) => p.id === edgeId) ?? d.pairs[0];
  const busy = unmerge.isPending || undo.isPending || revert.isPending || decide.isPending || override.isPending;
  const survivorship = Object.entries(d.survivorship).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card>
      <CardContent className="space-y-6 p-4">
        <div>
          <h2 className="text-base font-semibold">Why merged</h2>
          <p className="text-sm" style={muted}>
            Survivor <span style={mono}>{d.key}</span>
            {d.members.length ? <> with {d.members.length} merged record(s)</> : <>, not merged with any record</>}.
            Auto-merge at {pct(d.thresholds.auto_merge)}, steward review from {pct(d.thresholds.review_floor)}.
          </p>
        </div>

        {graph.data && graph.data.nodes.length > 1 && (
          <div className="grid gap-4 md:grid-cols-[320px_1fr]">
            <ClusterGraph graph={graph.data} selectedEdgeId={pair?.id ?? null} onSelectEdge={(e) => setEdgeId(e.id)} />
            <div className="space-y-2 text-sm">
              {graph.data.weak_chains.length > 0 ? (
                <>
                  <p style={{ color: "var(--aurora-status-warning-500)" }}>
                    {graph.data.weak_chains.length} weak transitive chain(s):
                  </p>
                  <ul className="space-y-1">
                    {graph.data.weak_chains.map((w) => (
                      <li key={`${w.a}-${w.via}-${w.b}`} style={mono}>
                        {w.a} - {w.via} - {w.b}: {w.reason.replace(/_/g, " ")}
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p style={muted}>Every member links directly above the threshold.</p>}
              <p className="text-xs" style={muted}>Select an edge to see its attribute breakdown.</p>
            </div>
          </div>
        )}

        {pair && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Match evidence</h3>
            <PairDetail pair={pair} />
            <p className="text-xs" style={muted}>
              {pair.steward_decision ? `Steward ${pair.steward_decision}ed: ${pair.steward_reason ?? ""}` : "No steward decision"}
              {pair.constraint ? ` | ${pair.constraint.replace(/_/g, " ")}` : ""}
            </p>
            {canChange && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy || !reason}
                  onClick={() => decide.mutate({ id: pair.id, decision: "accept" })}>Always match</Button>
                <Button size="sm" variant="outline" disabled={busy || !reason}
                  onClick={() => decide.mutate({ id: pair.id, decision: "reject" })}>Do not match</Button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Survivorship</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={muted} className="text-left">
                  <th className="py-1 pr-3">Field</th><th className="pr-3">Value</th><th className="pr-3">From</th>
                  <th className="pr-3">Rule</th><th className="pr-3">Losing values</th>{canChange && <th>Override</th>}
                </tr>
              </thead>
              <tbody>
                {survivorship.map(([field, s]) => (
                  <tr key={field} style={{ borderTop: "1px solid var(--aurora-canvas-line)" }}>
                    <td className="py-1 pr-3" style={mono}>{field}</td>
                    <td className="pr-3" style={mono}>
                      {edit?.field === field ? (
                        <input
                          aria-label={`Override value for ${field}`} value={edit.value} autoFocus
                          onChange={(e) => setEdit({ field, value: e.target.value })}
                          className="w-full rounded border px-2 py-1 text-sm"
                          style={{ borderColor: "var(--aurora-canvas-line)", background: "var(--aurora-elev-1-bg)" }}
                        />
                      ) : s.value || "-"}
                    </td>
                    <td className="pr-3" style={mono}>{s.winner_key ?? "-"}</td>
                    <td className="pr-3">{s.rule}</td>
                    <td>
                      {s.losers.length === 0 ? <span style={muted}>-</span> : s.losers.map((l) => (
                        <div key={l.key}>
                          <span style={mono}>{l.key}</span> {l.value ? <span style={mono}>&quot;{l.value}&quot;</span> : null}{" "}
                          <span style={muted}>{l.reason}</span>
                        </div>
                      ))}
                    </td>
                    {canChange && (
                      <td className="whitespace-nowrap">
                        {edit?.field === field ? (
                          <>
                            <Button size="sm" variant="outline" disabled={busy || !edit.value}
                              onClick={() => override.mutate({ field, value: edit.value })}>Save</Button>{" "}
                            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Discard edit</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" disabled={busy}
                              onClick={() => setEdit({ field, value: s.value ?? "" })}>Override</Button>
                            {field in d.steward_overrides && (
                              <Button size="sm" variant="ghost" disabled={busy}
                                onClick={() => override.mutate({ field, value: null })}>Clear</Button>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {canChange && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Steward actions</h3>
            <label className="block text-sm">
              Reason (required for unmerge and pair decisions, recorded with overrides)
              <input
                value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000}
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                style={{ borderColor: "var(--aurora-canvas-line)", background: "var(--aurora-elev-1-bg)" }}
              />
            </label>
            {d.members.length > 0 && (
              <fieldset className="flex flex-wrap gap-3 text-sm">
                <legend className="mb-1" style={muted}>Split out of this cluster</legend>
                {d.members.map((k) => (
                  <label key={k} className="flex items-center gap-1" style={mono}>
                    <input type="checkbox" checked={split.includes(k)}
                      onChange={(e) => setSplit(e.target.checked ? [...split, k] : split.filter((x) => x !== k))} />
                    {k}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !split.length || !reason} onClick={() => unmerge.mutate()}>
                Unmerge selected
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !d.members.length} onClick={() => undo.mutate()}>
                Undo last merge
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Merge history</h3>
          {(events.data ?? []).length === 0 ? <p className="text-sm" style={muted}>No merge events.</p> : (
            <ul className="space-y-1 text-sm">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <span style={mono}>{new Date(e.created_at).toLocaleString()}</span>
                  <strong>{e.event_type}</strong>
                  <span style={mono}>{e.member_keys.join(", ")}</span>
                  {e.reason && <span style={muted}>{e.reason}</span>}
                  {e.reversed && <span style={muted}>(reversed)</span>}
                  {canChange && !e.reversed && (e.event_type === "unmerge" || e.event_type === "undo") && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => revert.mutate(e.id)}>Re-merge</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
