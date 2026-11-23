"use client";

import { t } from "@/lib/v2/i18n";
import { useGoldenRecord } from "@/lib/v2/mdm-queries";
import { Button, ErrorState, FieldChip, Skeleton } from "@/ui/kit";
import { describeField } from "@/lib/v2/sap-fields";
import { day, pct, show, statusLabel, useHref } from "./shared";

/** The summary sheet for one golden record; the full record lives at /mdm/golden/[id]. */
export function GoldenSheet({ id }: { id: string }) {
  const href = useHref();
  const q = useGoldenRecord(id);
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading the golden record")} />;
  if (q.isError || !q.data) return <ErrorState heading={t("The golden record could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const fields = Object.entries(r.golden_fields).slice(0, 8);
  return (
    <div className="mx-col">
      <h2 className="mx-card-t">{r.sap_object_key}</h2>
      <p className="mx-muted">{statusLabel(r.status)} {t("with confidence {c}", { c: pct(r.overall_confidence) })}, {t("promoted {d}", { d: day(r.promoted_at) })}</p>
      <dl className="mx-tiles">
        {fields.map(([f, v]) => (
          <div key={f} className="mx-stat">
            <dt><FieldChip code={f} description={describeField(f) ?? undefined} /></dt>
            <dd className="mx-num">{show(v)}</dd>
          </div>
        ))}
      </dl>
      <Button variant="primary" href={href(`/mdm/golden/${r.id}`)}>{t("Open the record")}</Button>
    </div>
  );
}
