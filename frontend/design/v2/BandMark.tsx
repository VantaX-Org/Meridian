"use client";

import { useQualityThresholds } from "@/lib/v2/admin-queries";
import { BAND_VERDICT, bandOf, bandsFor, bandWord } from "@/lib/v2/thresholds";
import { t } from "@/lib/v2/i18n";
import { VerdictMark } from "./marks";

/** Where a score sits against the tenant's quality thresholds for that module and dimension. Nothing while they load. */
export function BandMark({ score, module, dimension }: { score: number | null | undefined; module: string; dimension: string }) {
  const q = useQualityThresholds();
  const b = bandsFor(q.data, module, dimension);
  const band = bandOf(score, b);
  if (!band || !b) return null;
  return (
    <span className="m2-v" data-band={band} data-testid={`band-${dimension}`} title={t("Target {target}, warning {warning}, critical {critical}", { target: b.target, warning: b.warning, critical: b.critical })}>
      <VerdictMark verdict={BAND_VERDICT[band]} />
      {bandWord(band)}
      <span className="m2-meta">{` ${t("Target")} ${b.target}`}</span>
    </span>
  );
}
