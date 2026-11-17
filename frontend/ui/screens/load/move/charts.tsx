"use client";

import { t } from "@/lib/v2/i18n";
import type { MoveWaveRun, ReconEntity } from "@/lib/api/next/move";
import { FieldChip } from "@/ui/kit";

const n = (x: number) => x.toLocaleString("en");

/** One stacked bar per wave: rows loaded, rows failed, rows still to go. `planned` maps an entity to the rows the plan holds. */
export function WaveProgress({ waves, planned, label }: { waves: MoveWaveRun[]; planned: Record<string, number>; label: string }) {
  return (
    <ul className="mx-wavebar" aria-label={label}>
      {waves.map((w) => {
        const ok = w.steps.reduce((a, s) => a + s.ok, 0);
        const failed = w.steps.reduce((a, s) => a + s.failed, 0);
        const total = Math.max(1, w.steps.reduce((a, s) => a + Math.max(planned[s.entity] ?? 0, s.sent), 0));
        return (
          <li key={w.wave}>
            <span>{t("Wave {n}", { n: w.wave })} <span className="mx-muted">{w.status}</span></span>
            <span className="mx-seg" role="img" aria-label={t("{ok} loaded, {failed} failed of {total}", { ok: n(ok), failed: n(failed), total: n(total) })}>
              <span data-k="ok" style={{ inlineSize: `${(ok / total) * 100}%` }} />
              <span data-k="failed" style={{ inlineSize: `${(failed / total) * 100}%` }} />
            </span>
            <span className="mx-num">{n(ok)} / {n(total)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Source rows against target rows, one pair of bars per entity, on one scale. */
export function CountsChart({ rows, label }: { rows: ReconEntity[]; label: string }) {
  const top = Math.max(1, ...rows.flatMap((r) => [r.source_rows, r.target_rows]));
  return (
    <ul className="mx-barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.entity}>
          <span className="mx-barlist-l"><FieldChip code={r.entity} /></span>
          <span className="mx-barlist-v mx-num">{n(r.source_rows)} / {n(r.target_rows)}</span>
          <span className="mx-bar" aria-hidden="true"><span style={{ inlineSize: `${(r.source_rows / top) * 100}%` }} /></span>
          <span className="mx-bar" aria-hidden="true"><span data-k="actual" style={{ inlineSize: `${(r.target_rows / top) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}
