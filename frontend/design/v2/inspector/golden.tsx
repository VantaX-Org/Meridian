"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { markNotDuplicate, mergePair, splitGolden, type ReviewPairDetail } from "@/lib/api/v2/mdm";
import { useV2Session } from "@/lib/v2/hooks";
import { useGoldenEvents, useGoldenExplain, useGoldenRecord, useMatchPair } from "@/lib/v2/mdm-queries";
import { refreshV2 } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { Fact, InspectorFrame } from "../Inspector";
import { FactList, Sec } from "./mdm-parts";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { RULE_LABEL, confidencePct, shortKey } from "../screens/object/GoldenTab";
import { ResultFrame, useOutcome } from "./shared";

const EVENT_WORD: Record<string, string> = {
  merge: "Merged",
  unmerge: "Split",
  undo: "Undone",
  remerge: "Merged again",
  override: "Value chosen",
  pair_accept: "Pair accepted",
  pair_reject: "Marked not a duplicate",
  pair_clear: "Decision cleared",
};

function fieldLabel(field: string): ReactNode {
  const d = describeField(field);
  return (
    <>
      <Mono>{field}</Mono>
      {d ? <span className="m2-meta">{d}</span> : null}
    </>
  );
}

/* ---- one golden record ---- */

function GoldenBody({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const rec = useGoldenRecord(id);
  const explain = useGoldenExplain(id);
  const events = useGoldenEvents(id);
  const { outcome, pending, run } = useOutcome();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const canSplit = session.can("approve");
  const r = rec.data;
  const ex = explain.data;
  const members = ex?.members ?? [];
  const survivor = r?.sap_object_key;

  const fields = useMemo(() => Object.entries(r?.golden_fields ?? {}), [r]);
  const conflicts = useMemo(() => (ex ? Object.entries(ex.survivorship).filter(([, a]) => a.losers.some((l) => l.value !== a.value)).length : 0), [ex]);

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const split = () =>
    void run("split", async () => {
      const res = await splitGolden(id, [...picked], reason.trim());
      void refreshV2(qc);
      setPicked(new Set());
      setReason("");
      return { tone: "ok", title: `${res.split_keys.length === 1 ? "1 record" : `${res.split_keys.length} records`} split out`, detail: `${res.remaining_keys.length} stay in this golden record. The split records are marked as not duplicates of it.` };
    });

  return (
    <InspectorFrame title={r ? <Mono>{r.sap_object_key}</Mono> : "Golden record"} status={r ? `Golden record, ${r.status === "golden" ? "approved" : "waiting for review"}` : "Golden record"} onClose={onClose}>
      {rec.isError && !r ? (
        <ErrorFrame onRetry={() => void rec.refetch()}>This golden record could not be read.</ErrorFrame>
      ) : !r ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={140} />
        </div>
      ) : (
        <>
          <Sec title="Facts">
            <FactList>
              <Fact label="Golden key">
                <Mono>{r.sap_object_key}</Mono>
              </Fact>
              <Fact label="Status">{r.status === "golden" ? "Approved" : r.status === "pending_review" ? "Waiting for review" : r.status}</Fact>
              <Fact label="Confidence">{confidencePct(r.overall_confidence)}</Fact>
              <Fact label="Sources">{ex ? int(members.length) : <Dash />}</Fact>
              <Fact label="Open conflicts">{ex ? int(conflicts) : <Dash />}</Fact>
              <Fact label="Last merged">{formatDate(r.updated_at, "date")}</Fact>
            </FactList>
          </Sec>
          <Sec title="Fields">
            {explain.isError ? (
              <ErrorFrame onRetry={() => void explain.refetch()}>How each value was chosen could not be read.</ErrorFrame>
            ) : (
              <table className="m2-tbl m2-ftbl" aria-label="Golden fields and how each value was chosen">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Value</th>
                    <th scope="col">Chosen by</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(([f, v]) => {
                    const s = ex?.survivorship[f];
                    const differs = s?.losers.filter((l) => l.value !== s.value) ?? [];
                    return (
                      <tr key={f}>
                        <th scope="row" className="m2-fcell">{fieldLabel(f)}</th>
                        <td>
                          {String(v)}
                          {differs.length > 0 ? <span className="m2-meta m2-fdiff">{`Differs: ${differs.map((l) => `${l.value}${l.system ? ` (${l.system})` : ""}`).join(", ")}`}</span> : null}
                        </td>
                        <td>{s ? (RULE_LABEL[s.rule] ?? s.rule) : explain.isPending ? <Skeleton width={70} height={12} /> : <Dash why="No rule decided this field" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Sec>
          <Sec title="Source records">
            {explain.isPending ? (
              <Skeleton width="100%" height={60} />
            ) : members.length === 0 ? (
              <p className="m2-rp m2-meta">No source record is listed for this golden record.</p>
            ) : (
              <ul className="m2-lk" aria-label="Source records">
                {members.map((k) => (
                  <li key={k}>
                    <label className="m2-mrow">
                      {canSplit && members.length > 1 && k !== survivor ? <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} aria-label={`Split out ${k}`} /> : null}
                      <Mono>{shortKey(k)}</Mono>
                    </label>
                    <span className="m2-meta">{k === survivor ? "Survivor" : "Merged in"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title="Actions">
            {canSplit ? (
              <div className="m2-aform">
                <label>
                  Reason for the split
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why these are different materials" />
                </label>
                <div className="m2-acts">
                  <button type="button" className="m2-btn m2-strong" disabled={picked.size === 0 || reason.trim() === "" || pending !== null} onClick={split}>
                    {pending === "split" ? "Splitting…" : picked.size ? `Split out ${picked.size} ${picked.size === 1 ? "record" : "records"}` : "Choose records to split out"}
                  </button>
                  <V2Link href={`/mdm/golden/${encodeURIComponent(id)}`} className="m2-btn">
                    Open in the current interface
                  </V2Link>
                </div>
                {outcome ? <ResultFrame outcome={outcome} /> : null}
              </div>
            ) : (
              <>
                <p className="m2-rp m2-meta">Splitting a golden record needs the approve permission. A data owner can do it.</p>
                <div className="m2-acts">
                  <V2Link href={`/mdm/golden/${encodeURIComponent(id)}`} className="m2-btn">
                    Open in the current interface
                  </V2Link>
                </div>
              </>
            )}
          </Sec>
          <Sec title="History">
            {events.isPending ? (
              <Skeleton width="100%" height={50} />
            ) : events.isError ? (
              <ErrorFrame onRetry={() => void events.refetch()}>The merge history could not be read.</ErrorFrame>
            ) : (events.data ?? []).length === 0 ? (
              <p className="m2-rp m2-meta">No merge has changed this record yet.</p>
            ) : (
              <ul className="m2-hist">
                {(events.data ?? []).map((e) => (
                  <li key={e.id}>
                    <span className="m2-d">{formatDate(e.created_at, "date")}</span>
                    <span>
                      {EVENT_WORD[e.event_type] ?? e.event_type}
                      {e.actor ? `, ${e.actor}` : ""}
                      {e.reason ? `: ${e.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}

/* ---- one pair waiting for a steward ---- */

type Side = "a" | "b";

/** The fields where the picked side differs from the survivor's side, with the picked value: the merge's overrides. */
export function overridesOf(detail: ReviewPairDetail, survivor: Side, picks: Record<string, Side>): Record<string, string> {
  const out: Record<string, string> = {};
  const names = new Set([...Object.keys(detail.record_a.fields), ...Object.keys(detail.record_b.fields)]);
  for (const f of names) {
    const a = detail.record_a.fields[f];
    const b = detail.record_b.fields[f];
    if (String(a ?? "") === String(b ?? "")) continue;
    const pick = picks[f] ?? survivor;
    if (pick !== survivor) {
      const v = pick === "a" ? a : b;
      if (v != null) out[f] = String(v);
    }
  }
  return out;
}

function PairBody({ pairId, onClose }: { pairId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useMatchPair(pairId);
  const { outcome, pending, run } = useOutcome();
  const [survivorPick, setSurvivorPick] = useState<Side | null>(null);
  const [picks, setPicks] = useState<Record<string, Side>>({});
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const can = session.can("approve");
  const d = q.data;
  const survivor: Side = survivorPick ?? (d && d.default_survivor === d.b ? "b" : "a");
  const names = useMemo(() => (d ? [...new Set([...Object.keys(d.record_a.fields), ...Object.keys(d.record_b.fields)])] : []), [d]);
  const same = (f: string): boolean => d != null && String(d.record_a.fields[f] ?? "") === String(d.record_b.fields[f] ?? "");
  const differing = names.filter((f) => !same(f));

  const finish = () => {
    void refreshV2(qc);
    setDone(true);
  };
  const merge = () =>
    void run("merge", async () => {
      if (!d) throw new Error("The pair is not loaded.");
      const key = survivor === "a" ? d.record_a.key : d.record_b.key;
      const res = await mergePair(pairId, { survivor: key, overrides: overridesOf(d, survivor, picks), reason: reason.trim() });
      finish();
      return { tone: "ok", title: "Merged", detail: `${shortKey(res.survivor_key)} survives${res.filled_fields.length ? `; ${res.filled_fields.length} empty ${res.filled_fields.length === 1 ? "field was" : "fields were"} filled from the other record` : ""}. Undo it from the golden record.` };
    });
  const reject = () =>
    void run("reject", async () => {
      await markNotDuplicate(pairId, reason.trim());
      finish();
      return { tone: "ok", title: "Marked as not a duplicate", detail: "This pair will not be offered again." };
    });

  return (
    <InspectorFrame title="Possible duplicate" status={d ? `Match score ${d.total.toFixed(2)}, waiting for a steward` : "Possible duplicate"} onClose={onClose}>
      {q.isError && !d ? (
        <ErrorFrame onRetry={() => void q.refetch()}>This pair could not be read. It may already be decided.</ErrorFrame>
      ) : !d ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={160} />
        </div>
      ) : (
        <>
          <Sec title="Facts">
            <FactList>
              <Fact label="Match score">{d.total.toFixed(2)}</Fact>
              <Fact label="Record A">
                <Mono>{shortKey(d.record_a.key)}</Mono>
              </Fact>
              <Fact label="Record B">
                <Mono>{shortKey(d.record_b.key)}</Mono>
              </Fact>
              <Fact label="Fields that differ">{`${differing.length} of ${names.length}`}</Fact>
            </FactList>
          </Sec>
          <Sec title="Side by side">
            <table className="m2-tbl m2-pick" aria-label="The two records side by side, pick a value per field">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Record A</th>
                  <th scope="col">Record B</th>
                </tr>
              </thead>
              <tbody>
                {names.map((f) => {
                  const eq = same(f);
                  const pick = picks[f] ?? survivor;
                  const cell = (side: Side, v: unknown) => (
                    <td>
                      {eq || done || !can ? (
                        String(v ?? "")
                      ) : (
                        <label className="m2-pickl">
                          <input type="radio" name={`pick-${f}`} checked={pick === side} onChange={() => setPicks((p) => ({ ...p, [f]: side }))} aria-label={`${f}: keep the value of record ${side === "a" ? "A" : "B"}`} />
                          {String(v ?? "")}
                        </label>
                      )}
                    </td>
                  );
                  return (
                    <tr key={f} data-same={eq ? "true" : undefined}>
                      <th scope="row" className="m2-fcell">{fieldLabel(f)}</th>
                      {eq ? <td colSpan={2}>{`${String(d.record_a.fields[f] ?? "")} (same)`}</td> : <>{cell("a", d.record_a.fields[f])}{cell("b", d.record_b.fields[f])}</>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="m2-prov">Each value you pick on a field that differs is kept in the merged record; the others follow the survivor.</p>
          </Sec>
          <Sec title="Actions">
            {!can ? (
              <p className="m2-rp m2-meta">Merging, or marking a pair as not a duplicate, needs the approve permission. A data owner can decide this pair.</p>
            ) : done ? null : (
              <div className="m2-aform">
                <fieldset className="m2-surv">
                  <legend>Keep the key of</legend>
                  <label>
                    <input type="radio" name="survivor" checked={survivor === "a"} onChange={() => setSurvivorPick("a")} />
                    <Mono>{shortKey(d.record_a.key)}</Mono>
                  </label>
                  <label>
                    <input type="radio" name="survivor" checked={survivor === "b"} onChange={() => setSurvivorPick("b")} />
                    <Mono>{shortKey(d.record_b.key)}</Mono>
                  </label>
                </fieldset>
                <label>
                  Reason
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why these are one thing, or two" />
                </label>
                <div className="m2-acts">
                  <button type="button" className="m2-btn m2-strong" disabled={reason.trim() === "" || pending !== null} onClick={merge}>
                    {pending === "merge" ? "Merging…" : "Merge"}
                  </button>
                  <button type="button" className="m2-btn" disabled={reason.trim() === "" || pending !== null} onClick={reject}>
                    {pending === "reject" ? "Saving…" : "Not a duplicate"}
                  </button>
                </div>
              </div>
            )}
            {outcome ? <ResultFrame outcome={outcome} /> : null}
            <div className="m2-acts">
              <V2Link href={`/mdm/golden/merge?pair=${encodeURIComponent(pairId)}`} className="m2-btn m2-ghost">
                Open in the current interface
              </V2Link>
            </div>
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}

/** `?open=golden:<id>` is a golden record; `?open=golden:pair:<id>` is a pair waiting for a steward. */
export function GoldenInspector({ id, onClose }: { id: string; onClose: () => void }) {
  if (id.startsWith("pair:")) return <PairBody pairId={id.slice(5)} onClose={onClose} />;
  return id ? <GoldenBody id={id} onClose={onClose} /> : <InspectorFrame title="Golden record" onClose={onClose}><EmptyFrame>No golden record is named.</EmptyFrame></InspectorFrame>;
}
