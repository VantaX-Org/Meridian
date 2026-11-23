"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getRuleTuning, getScorecard, uploadKnownIssues } from "@/lib/api/v2/pilot";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, DataTable, FieldChip, SeverityPill, StatTile, useToast, EmptyState } from "@/ui/kit";
import { errMsg, Gate } from "./shared";

const pct = (n: number | null | undefined): string => (n === null || n === undefined ? "-" : `${Math.round(n * 100)}%`);

export function PilotTab({ id }: { id: string }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const sc = useQuery({ queryKey: ["v2", "scorecard", fx, id] as const, queryFn: () => getScorecard(id), retry: false });
  const tune = useQuery({ queryKey: ["v2", "rule-tuning", fx] as const, queryFn: getRuleTuning, retry: false });
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await uploadKnownIssues(id, await f.text());
      toast(t("{n} known issues loaded, {m} rejected.", { n: r.records, m: r.rejected }), "good");
      await qc.invalidateQueries({ queryKey: ["v2"] });
    } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  return (
    <div className="mx-col">
      <Card title={t("Pilot scorecard")} sub={t("How often the checks are right, and what they miss.")}>
        <Gate q={sc} empty={{ heading: t("No scorecard yet"), body: t("Review findings or load known issues to build it.") }}>
          {(d) => (
            <>
              <dl className="mx-tiles">
                <StatTile label={t("Precision")} value={pct(d.precision.precision)} note={t("Target {n}", { n: pct(d.precision.target) })} />
                <StatTile label={t("Reviewed")} value={whole(d.precision.reviewed)} note={t("{n} false positives", { n: d.precision.false_positives })} />
                <StatTile label={t("Recall")} value={pct(d.recall.recall)} note={t("{a} of {b} known issues caught", { a: d.recall.caught, b: d.recall.known })} />
              </dl>
              <DataTable columns={[
                { key: "check_id", label: t("Check"), render: (r) => <FieldChip code={r.check_id} description={r.message} /> },
                { key: "module", label: t("Module"), render: (r) => r.module },
                { key: "flagged", label: t("Flagged"), align: "end" as const, render: (r) => whole(r.flagged) },
                { key: "false_positive", label: t("False positives"), align: "end" as const, render: (r) => whole(r.false_positive) },
                { key: "precision", label: t("Precision"), align: "end" as const, render: (r) => pct(r.precision) },
                { key: "needs_tuning", label: "", render: (r) => (r.needs_tuning ? <SeverityPill sev="medium" label={t("Needs tuning")} /> : null) },
              ]} rows={d.rules} rowKey={(r) => r.check_id} label={t("Rule precision")} height={300} />
              <h3>{t("Known issues the checks missed")}</h3>
              {d.recall.missed.length === 0 ? <EmptyState heading={t("No missed issues.")} body={t("The pilot found nothing the rules missed.")} /> : (
                <DataTable columns={[
                  { key: "module", label: t("Module"), render: (r) => r.module },
                  { key: "record_ref", label: t("Record"), render: (r) => <FieldChip code={r.record_ref} description={r.note ?? undefined} /> },
                ]} rows={d.recall.missed} rowKey={(r) => `${r.module}-${r.record_ref}`} label={t("Missed records")} height={200} />
              )}
            </>
          )}
        </Gate>
      </Card>
      <Card title={t("Known issues")} sub={t("Upload a CSV of problems you already know, to measure recall.")}>
        <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label={t("Known issues file")} onChange={(e) => void upload(e.target.files?.[0])} />
        <Button variant="secondary" disabled={busy || !me.can("manage_systems")} onClick={() => file.current?.click()}>{t("Upload known issues")}</Button>
      </Card>
      <Card title={t("Tuning proposals")}>
        <Gate q={tune} empty={{ heading: t("No tuning proposals") }}>
          {(d) => d.proposals.length === 0 ? <EmptyState heading={t("No checks need tuning.")} body={t("Every check scored well in the pilot.")} /> : <p>{t("{n} checks need tuning.", { n: d.proposals.length })}</p>}
        </Gate>
      </Card>
    </div>
  );
}
