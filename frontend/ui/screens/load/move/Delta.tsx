"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiDetail, startDelta, useRun } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Field, Input, StatTile } from "@/ui/kit";
import { WaveProgress } from "./charts";

const num = (n: number) => n.toLocaleString("en");

/** Step 7: at cut-over, send only what changed in the source since a date. */
export function Delta({ planId, onBack }: { planId: string; onBack: () => void }) {
  const [since, setSince] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const go = useMutation({ mutationFn: (dry: boolean) => startDelta(planId, since, dry), onSuccess: (x) => setRunId(x.id) });
  const r = useRun(runId).data;
  const dryOk = !!r && r.dry_run && r.status === "completed";
  const all = (r?.waves ?? []).flatMap((w) => w.steps);

  return (
    <Card title={t("Send the cut-over delta")} sub={t("Sends only the rows that changed in the source after the date you choose. Use the date of your first full load.")}>
      <div className="mx-col">
        <Field label={t("Changed since")} hint={t("Rows changed on or after this date are sent again.")}>
          <Input type="date" value={since} onChange={(e) => { setSince(e.target.value); setRunId(null); }} />
        </Field>
        {r ? (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Status")} value={r.status} note={r.dry_run ? t("Dry run, nothing written") : undefined} />
              <StatTile label={t("Loaded")} value={num(all.reduce((a, s) => a + s.ok, 0))} />
              <StatTile label={t("Failed")} value={num(all.reduce((a, s) => a + s.failed, 0))} />
            </dl>
            <WaveProgress waves={r.waves} planned={{}} label={t("Progress by wave")} />
          </>
        ) : null}
        {go.isError ? <p className="mx-field-e" role="alert">{apiDetail(go.error) ?? t("The delta could not start.")}</p> : null}
        <div className="mx-actions">
          <Button onClick={onBack}>{t("Back")}</Button>
          <Button variant={dryOk ? undefined : "primary"} disabled={!since || go.isPending} onClick={() => go.mutate(true)}>{t("Dry run the delta")}</Button>
          <Button variant="primary" disabled={!dryOk || go.isPending} onClick={() => go.mutate(false)}>{t("Send the delta")}</Button>
        </div>
      </div>
    </Card>
  );
}
