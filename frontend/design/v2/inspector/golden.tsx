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
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { RULE_LABEL, confidencePct, shortKey } from "../screens/object/GoldenTab";
import { ResultFrame, useOutcome } from "./shared";
import { t } from "@/lib/v2/i18n";

const EVENT_WORD: Record<string, string> = {
  get merge() { return t("Merged"); },
  get unmerge() { return t("Split"); },
  get undo() { return t("Undone"); },
  get remerge() { return t("Merged again"); },
  get override() { return t("Value chosen"); },
  get pair_accept() { return t("Pair accepted"); },
  get pair_reject() { return t("Marked not a duplicate"); },
  get pair_clear() { return t("Decision cleared"); },
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
      return { tone: "ok", title: t("{value} split out", { value: res.split_keys.length === 1 ? t("1 record") : t("{split_keysCount} records", { split_keysCount: res.split_keys.length }) }), detail: t("{remaining_keysCount} stay in this golden record. The split records are marked as not duplicates of it.", { remaining_keysCount: res.remaining_keys.length }) };
    });

  return (
    <InspectorFrame title={r ? <Mono>{r.sap_object_key}</Mono> : t("Golden record")} status={r ? t("Golden record, {value}", { value: r.status === "golden" ? t("approved") : t("waiting for review") }) : t("Golden record")} onClose={onClose}>
      {rec.isError && !r ? (
        <ErrorFrame onRetry={() => void rec.refetch()}>{t("This golden record could not be read.")}</ErrorFrame>
      ) : !r ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={140} />
        </div>
      ) : (
        <>
          <Sec title={t("Facts")}>
            <FactList>
              <Fact label={t("Golden key")}>
                <Mono>{r.sap_object_key}</Mono>
              </Fact>
              <Fact label={t("Status")}>{r.status === "golden" ? t("Approved") : r.status === "pending_review" ? t("Waiting for review") : r.status}</Fact>
              <Fact label={t("Confidence")}>{confidencePct(r.overall_confidence)}</Fact>
              <Fact label={t("Sources")}>{ex ? int(members.length) : <Dash />}</Fact>
              <Fact label={t("Open conflicts")}>{ex ? int(conflicts) : <Dash />}</Fact>
              <Fact label={t("Last merged")}>{formatDate(r.updated_at, "date")}</Fact>
            </FactList>
          </Sec>
          <Sec title={t("Fields")}>
            {explain.isError ? (
              <ErrorFrame onRetry={() => void explain.refetch()}>{t("How each value was chosen could not be read.")}</ErrorFrame>
            ) : (
              <table className="m2-tbl m2-ftbl" aria-label={t("Golden fields and how each value was chosen")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Value")}</th>
                    <th scope="col">{t("Chosen by")}</th>
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
                        <td>{s ? (RULE_LABEL[s.rule] ?? s.rule) : explain.isPending ? <Skeleton width={70} height={12} /> : <Dash why={t("No rule decided this field")} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Sec>
          <Sec title={t("Source records")}>
            {explain.isPending ? (
              <Skeleton width="100%" height={60} />
            ) : members.length === 0 ? (
              <p className="m2-rp m2-meta">{t("No source record is listed for this golden record.")}</p>
            ) : (
              <ul className="m2-lk" aria-label={t("Source records")}>
                {members.map((k) => (
                  <li key={k}>
                    <label className="m2-mrow">
                      {canSplit && members.length > 1 && k !== survivor ? <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} aria-label={t("Split out {k}", { k })} /> : null}
                      <Mono>{shortKey(k)}</Mono>
                    </label>
                    <span className="m2-meta">{k === survivor ? t("Survivor") : t("Merged in")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title={t("Actions")}>
            {canSplit ? (
              <div className="m2-aform">
                <label>
                  {t("Reason for the split")}
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why these are different materials")} />
                </label>
                <div className="m2-acts">
                  <button type="button" className="m2-btn m2-strong" disabled={picked.size === 0 || reason.trim() === "" || pending !== null} onClick={split}>
                    {pending === "split" ? t("Splitting…") : picked.size ? t("Split out {size} {size, plural, one {record} other {records}}", { size: picked.size }) : t("Choose records to split out")}
                  </button>
                </div>
                {outcome ? <ResultFrame outcome={outcome} /> : null}
              </div>
            ) : (
              <>
                <p className="m2-rp m2-meta">{t("Splitting a golden record needs the approve permission. A data owner can do it.")}</p>
              </>
            )}
          </Sec>
          <Sec title={t("History")}>
            {events.isPending ? (
              <Skeleton width="100%" height={50} />
            ) : events.isError ? (
              <ErrorFrame onRetry={() => void events.refetch()}>{t("The merge history could not be read.")}</ErrorFrame>
            ) : (events.data ?? []).length === 0 ? (
              <p className="m2-rp m2-meta">{t("No merge has changed this record yet.")}</p>
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
      if (!d) throw new Error(t("The pair is not loaded."));
      const key = survivor === "a" ? d.record_a.key : d.record_b.key;
      const res = await mergePair(pairId, { survivor: key, overrides: overridesOf(d, survivor, picks), reason: reason.trim() });
      finish();
      return { tone: "ok", title: t("Merged"), detail: t("{shortKey} survives{value}. Undo it from the golden record.", { shortKey: shortKey(res.survivor_key), value: res.filled_fields.length ? t("; {filled_fieldsCount} empty {filled_fieldsCount, plural, one {field was} other {fields were}} filled from the other record", { filled_fieldsCount: res.filled_fields.length }) : "" }) };
    });
  const reject = () =>
    void run("reject", async () => {
      await markNotDuplicate(pairId, reason.trim());
      finish();
      return { tone: "ok", title: t("Marked as not a duplicate"), detail: t("This pair will not be offered again.") };
    });

  return (
    <InspectorFrame title={t("Possible duplicate")} status={d ? t("Match score {value}, waiting for a steward", { value: d.total.toFixed(2) }) : t("Possible duplicate")} onClose={onClose}>
      {q.isError && !d ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("This pair could not be read. It may already be decided.")}</ErrorFrame>
      ) : !d ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={160} />
        </div>
      ) : (
        <>
          <Sec title={t("Facts")}>
            <FactList>
              <Fact label={t("Match score")}>{d.total.toFixed(2)}</Fact>
              <Fact label={t("Record A")}>
                <Mono>{shortKey(d.record_a.key)}</Mono>
              </Fact>
              <Fact label={t("Record B")}>
                <Mono>{shortKey(d.record_b.key)}</Mono>
              </Fact>
              <Fact label={t("Fields that differ")}>{t("{differingCount} of {namesCount}", { differingCount: differing.length, namesCount: names.length })}</Fact>
            </FactList>
          </Sec>
          <Sec title={t("Side by side")}>
            <table className="m2-tbl m2-pickt" aria-label={t("The two records side by side, pick a value per field")}>
              <thead>
                <tr>
                  <th scope="col">{t("Field")}</th>
                  <th scope="col">{t("Record A")}</th>
                  <th scope="col">{t("Record B")}</th>
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
                          <input type="radio" name={`pick-${f}`} checked={pick === side} onChange={() => setPicks((p) => ({ ...p, [f]: side }))} aria-label={t("{f}: keep the value of record {value}", { f, value: side === "a" ? "A" : "B" })} />
                          {String(v ?? "")}
                        </label>
                      )}
                    </td>
                  );
                  return (
                    <tr key={f} data-same={eq ? "true" : undefined}>
                      <th scope="row" className="m2-fcell">{fieldLabel(f)}</th>
                      {eq ? <td colSpan={2}>{t("{fields} (same)", { fields: String(d.record_a.fields[f] ?? "") })}</td> : <>{cell("a", d.record_a.fields[f])}{cell("b", d.record_b.fields[f])}</>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="m2-prov">{t("Each value you pick on a field that differs is kept in the merged record; the others follow the survivor.")}</p>
          </Sec>
          <Sec title={t("Actions")}>
            {!can ? (
              <p className="m2-rp m2-meta">{t("Merging, or marking a pair as not a duplicate, needs the approve permission. A data owner can decide this pair.")}</p>
            ) : done ? null : (
              <div className="m2-aform">
                <fieldset className="m2-surv">
                  <legend>{t("Keep the key of")}</legend>
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
                  {t("Reason")}
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why these are one thing, or two")} />
                </label>
                <div className="m2-acts">
                  <button type="button" className="m2-btn m2-strong" disabled={reason.trim() === "" || pending !== null} onClick={merge}>
                    {pending === "merge" ? t("Merging…") : t("Merge")}
                  </button>
                  <button type="button" className="m2-btn" disabled={reason.trim() === "" || pending !== null} onClick={reject}>
                    {pending === "reject" ? t("Saving…") : t("Not a duplicate")}
                  </button>
                </div>
              </div>
            )}
            {outcome ? <ResultFrame outcome={outcome} /> : null}
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}

/** `?open=golden:<id>` is a golden record; `?open=golden:pair:<id>` is a pair waiting for a steward. */
export function GoldenInspector({ id, onClose }: { id: string; onClose: () => void }) {
  if (id.startsWith("pair:")) return <PairBody pairId={id.slice(5)} onClose={onClose} />;
  return id ? <GoldenBody id={id} onClose={onClose} /> : <InspectorFrame title={t("Golden record")} onClose={onClose}><EmptyFrame>{t("No golden record is named.")}</EmptyFrame></InspectorFrame>;
}
