"use client";

import { useState } from "react";
import { formatInt } from "@/lib/format";
import { MODULE_LABELS } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import type { SimGroup, SimObject } from "@/lib/api/v2/load-simulation";
import { useFieldCoverage, useLoadSimulation } from "@/lib/api/next/load";
import { SegBar } from "../kit/viz";
import { loadSegs } from "./segs";
import { Button, Chip, Confirm, DataTable, ErrorState, Skeleton, type Column, type ChipTone } from "../kit";

type Verdict = "ready" | "conditions" | "not_ready";
export const verdictOf = (o: Pick<SimObject, "would_fail" | "provisional">): Verdict => (o.would_fail > 0 ? "not_ready" : o.provisional > 0 ? "conditions" : "ready");
const VERDICT_TONE: Record<Verdict, ChipTone> = { ready: "good", conditions: "warn", not_ready: "bad" };
const verdictText = (v: Verdict) => (v === "ready" ? t("Ready to load") : v === "conditions" ? t("Ready with conditions") : t("Not ready to load"));

/** What a gap does to its rows: a provisional gap warns, a structural gap with no rows drops a field, the rest reject. */
export type Effect = "warns" | "dropped" | "rejects";
export const effectOf = (g: Pick<SimGroup, "provisional" | "structural" | "records">): Effect => (g.provisional ? "warns" : g.structural && g.records === 0 ? "dropped" : "rejects");
const effectText = (e: Effect) => (e === "warns" ? t("Warns") : e === "dropped" ? t("Field not loaded") : t("Rejects"));
const VALUE_GAPS = new Set(["value_unmapped", "check_table_value"]);

/** Step 2: every row of the chosen run checked against the target's rules, by object and by kind of issue. */
export function Validate({ runId, objects, release, onBack, onBuild }: { runId: string; objects: string[]; release: string; onBack: () => void; onBuild: () => void }) {
  const sim = useLoadSimulation(runId);
  const cover = useFieldCoverage(objects, release);
  const [asking, setAsking] = useState(false);

  if (sim.isLoading) return <Skeleton lines={6} label={t("Checking the rows against the target")} />;
  if (sim.isError || !sim.data) return <ErrorState sentence={t("The check could not be read.")} error={sim.error} onRetry={() => void sim.refetch()} />;

  const data = sim.data;
  const objs = data.objects.filter((o) => objects.includes(o.module));
  const groups = data.groups.filter((g) => objects.includes(g.module));
  const sum = objs.reduce((a, o) => ({ records: a.records + o.records, load: a.load + o.would_load, fail: a.fail + o.would_fail, warn: a.warn + o.provisional }), { records: 0, load: 0, fail: 0, warn: 0 });
  const label = (m: string) => objs.find((o) => o.module === m)?.label ?? MODULE_LABELS[m] ?? m;

  const columns: Column<SimGroup>[] = [
    { id: "issue", label: t("Issue"), cell: (g) => <span><strong>{label(g.module)}</strong><br />{g.message}</span> },
    { id: "rows", label: t("Rows"), align: "end", cell: (g) => formatInt(g.records), compare: (a, b) => a.records - b.records },
    { id: "effect", label: t("Effect"), cell: (g) => { const e = effectOf(g); return <Chip tone={e === "rejects" ? "bad" : "warn"}>{effectText(e)}</Chip>; } },
    { id: "fields", label: t("Fields"), cell: (g) => <span><code>{g.dest_table}-{g.field}</code>{g.field_text ? <><br />{g.field_text}</> : null}</span> },
    { id: "action", label: t("Action"), cell: (g) => <V2Link href="/load/analysis">{VALUE_GAPS.has(g.gap_type) ? t("Map the value") : t("Review in Analysis")}</V2Link> },
  ];

  return (
    <section className="nx-ld-step" data-testid="validate" aria-labelledby="nx-ld-h-validate">
      <h2 id="nx-ld-h-validate">{t("What fits and what would not load")}</h2>
      <p className="nx-ld-lede">{t("Every row of the chosen runs is checked against the target's rules. Fix the red ones first, or build the files without them and keep the list.")}</p>

      <SegBar segs={loadSegs({ would_load: sum.load, provisional: sum.warn, would_fail: sum.fail })} format={formatInt} testid="validate-bar" />

      <ul className="nx-ld-verdicts">
        {objs.map((o) => (
          <li key={o.module} className="nx-ld-verdict" data-testid={`verdict-${o.module}`}>
            <Chip tone={VERDICT_TONE[verdictOf(o)]}>{verdictText(verdictOf(o))}</Chip>
            <strong>{o.label}</strong>
            <span>{t("{rows} rows, {load} would load, {fail} rejected, {warn} with a warning", { rows: formatInt(o.records), load: formatInt(o.would_load), fail: formatInt(o.would_fail), warn: formatInt(o.provisional) })}</span>
          </li>
        ))}
      </ul>

      <DataTable
        rows={groups}
        columns={columns}
        rowKey={(g) => `${g.module}-${g.dest_table}-${g.field}-${g.gap_type}`}
        rowLabel={(g) => `${label(g.module)} ${g.dest_table}-${g.field}`}
        caption={t("Issues by kind")}
        empty={{ heading: t("Nothing to fix"), text: t("Every row of the chosen objects fits the target.") }}
      />

      {cover.data ? (
        <p className="nx-ld-meta" data-testid="field-coverage">
          {t("{done} of {all} fields mapped", { done: formatInt(cover.data.confirmed), all: formatInt(cover.data.total) })}{" "}
          <V2Link href="/load/analysis">{t("Map fields")}</V2Link>
        </p>
      ) : null}

      {data.target_connected ? (
        <div className="nx-ld-sim" data-testid="simulated-load">
          <h3>{t("Simulated load against the connected target")}</h3>
          {data.transports.filter((x) => objects.includes(x.module)).length === 0 ? (
            <p>{t("The target's check tables hold every value in these rows.")}</p>
          ) : (
            <ul>
              {data.transports.filter((x) => objects.includes(x.module)).map((x) => (
                <li key={`${x.module}-${x.check_table}-${x.field}`}>
                  {t("{table} {text}: {n} rows use values the target does not hold yet", { table: x.check_table, text: x.check_table_text ?? "", n: formatInt(x.records) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="nx-ld-actions">
        <Button variant="quiet" onClick={onBack}>{t("Back")}</Button>
        <Button variant="primary" onClick={() => (sum.fail > 0 ? setAsking(true) : onBuild())}>{t("Build the load files")}</Button>
      </div>
      <Confirm
        open={asking}
        title={t("{n} rows would be rejected", { n: formatInt(sum.fail) })}
        consequence={t("{n} rows would be rejected. Build the files without them?", { n: formatInt(sum.fail) })}
        confirmLabel={t("Build without them")}
        onConfirm={() => { setAsking(false); onBuild(); }}
        onCancel={() => setAsking(false)}
      />
    </section>
  );
}
