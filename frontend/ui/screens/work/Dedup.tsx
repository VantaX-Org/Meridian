"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDedupCandidates, mergeDedup, previewDedup, type DedupCandidate } from "@/lib/api/v2/cleaning";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, Field, FieldChip, Select, Skeleton, Stepper, ErrorState, Textarea, useToast } from "@/ui/kit";
import { Gate, refreshV2, useQ } from "@/ui/screens/people/common";
import { useCan } from "@/ui/screens/orphans/useCan";
import { ObjChip } from "./ObjChip";
import { fieldText } from "./shared";

const STEPS = ["candidates", "preview", "merge", "done"] as const;

/** Duplicate pairs: pick a pair, preview the merged record, name the survivor, confirm, merge. */
export function Dedup() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const canMerge = can("approve");
  const [cand, setCand] = useState<DedupCandidate | null>(null);
  const [survivor, setSurvivor] = useState("");
  const [reason, setReason] = useState("");
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const list = useQ(["dedup"], getDedupCandidates);
  const prev = useQ(["dedup-preview", cand?.id], () => previewDedup(cand as DedupCandidate), !!cand);
  const merge = useMutation({
    mutationFn: () => mergeDedup((cand as DedupCandidate).id, survivor, reason.trim()),
    onSuccess: () => { setAsk(false); setDone(survivor); void refreshV2(qc); },
    onError: (e) => { setAsk(false); toast(errorSentence(e, t("The merge did not work. Try again.")), "bad"); },
  });
  const reset = () => { setCand(null); setSurvivor(""); setReason(""); setDone(null); };
  const step = done ? 3 : !cand ? 0 : ask ? 2 : 1;
  const other = cand ? (survivor === cand.record_key_a ? cand.record_key_b : cand.record_key_a) : "";
  const rows = Object.entries(prev.data?.merge_preview ?? {});
  const changed = rows.filter(([, v]) => v.survivor !== (survivor === cand?.record_key_b ? v.b : v.a)).length;
  const reasonGiven = reason.trim().length > 0;
  const why = !canMerge ? t("You need the approve permission to merge records.") : !survivor ? t("Choose which record survives.") : !reasonGiven ? t("Give a reason for the merge.") : "";

  return (
    <Card title={t("Duplicates")} sub={t("Pairs the cleaning engine found to be the same record. A merge keeps one record and folds the other into it.")}>
      <div className="mx-col">
        <Stepper label={t("Merge steps")} current={step} steps={STEPS.map((id) => ({ id, label: id === "candidates" ? t("Candidates") : id === "preview" ? t("Preview") : id === "merge" ? t("Merge") : t("Done") }))} />
        {done ? (
          <>
            <p role="status">{t("Merged. Record {key} is kept and {other} is folded into it.", { key: done, other })}</p>
            <Button onClick={reset}>{t("Back to candidates")}</Button>
          </>
        ) : !cand ? (
          <Gate q={list} label={t("Loading the pairs")}>
            {(d) => d.items.length === 0 ? <EmptyState heading={t("No duplicate is waiting")} body={t("New pairs appear after the next run.")} /> : (
              <DataTable<DedupCandidate> label={t("Duplicate pairs")} rows={d.items} rowKey={(c) => c.id} onSelect={(c) => { setCand(c); setSurvivor(c.record_key_a); }}
                columns={[
                  { key: "o", label: t("Object"), render: (c) => <ObjChip code={c.object_type} /> },
                  { key: "a", label: t("Record A"), render: (c) => c.record_key_a },
                  { key: "b", label: t("Record B"), render: (c) => c.record_key_b },
                  { key: "s", label: t("Match"), render: (c) => `${c.match_score}%`, sort: (c) => c.match_score, align: "end" },
                  { key: "m", label: t("Method"), render: (c) => c.match_method ?? "" },
                ]} />
            )}
          </Gate>
        ) : prev.isPending ? <Skeleton lines={5} label={t("Loading the preview")} /> : prev.isError ? (
          <ErrorState heading={t("The preview could not be loaded")} retryLabel={t("Try again")} onRetry={() => void prev.refetch()} />
        ) : (
          <>
            <DataTable label={t("Merged record")} rows={rows} rowKey={([f]) => f}
              columns={[
                { key: "f", label: t("Field"), render: ([f]) => <FieldChip code={f} description={fieldText(f)} /> },
                { key: "a", label: t("Record A"), render: ([, v]) => v.a },
                { key: "b", label: t("Record B"), render: ([, v]) => v.b },
                { key: "s", label: t("After the merge"), render: ([, v]) => v.survivor },
              ]} />
            <Field label={t("Record that survives")}>
              <Select value={survivor} onChange={(e) => setSurvivor(e.target.value)} options={[{ value: cand.record_key_a, label: t("A {key}", { key: cand.record_key_a }) }, { value: cand.record_key_b, label: t("B {key}", { key: cand.record_key_b }) }]} />
            </Field>
            <Field label={t("Reason for the merge")}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {why ? <p className="mx-muted" role="status">{why}</p> : null}
            <div className="mx-head-actions">
              <Button variant="primary" disabled={!!why} onClick={() => setAsk(true)}>{t("Merge these records")}</Button>
              <Button variant="ghost" onClick={reset}>{t("Choose another pair")}</Button>
            </div>
          </>
        )}
      </div>
      <Confirm open={ask} danger title={t("Merge the records")} confirmLabel={t("Merge")} cancelLabel={t("Cancel")} onCancel={() => setAsk(false)} onConfirm={() => merge.mutate()}>
        <p>{t("Record {other} is folded into {key}. 1 record is merged away and {n} fields of the survivor change.", { other, key: survivor, n: changed })}</p>
      </Confirm>
    </Card>
  );
}
