"use client";

// The bodies of the Root causes, S/4 migration and Cleansing opportunity cards on the lead home (home/_analyses.tsx,
// which took them from the retired Insights overview). `run` pins the links to one run;
// without it they open the current state. A root cause of the current state carries the run it was computed in.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, Button, Card, Funnel, Mono } from "@/design";
import type { CleansingStep, RootCauseCluster } from "@/lib/api/insights";
import type { S4Area } from "@/lib/api/migration";
import { drillLabel, fixHref, type FixFilter } from "@/lib/drill";
import { formatModuleName, labelOf } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { withScope } from "./useInsightScope";

type Cluster = RootCauseCluster & { version_id?: string };

/** The five highest-impact clusters, each linking to its rules and its failing records. */
export function RootCauseList({ clusters, run, empty }: { clusters: Cluster[]; run?: string; empty: string }) {
  if (clusters.length === 0) {
    return (
      <p className="m-text-body m-ink-3">
        {empty}{" "}
        <Link href={withScope("/insights/rules", { run })} className="m-ink-accent underline underline-offset-2">Open failing rules</Link>
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {[...clusters].sort((a, b) => b.impact - a.impact).slice(0, 5).map((c) => {
        const where = c.table && c.field ? `${c.table}.${c.field}` : null;
        const at = run ?? c.version_id;
        return (
          <li key={c.key}>
            <Card padding="sm">
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  {where
                    ? <>{`${formatModuleName(c.module)}: one field fails on ${c.records.toLocaleString()}${c.records_estimated ? " (estimated)" : ""} records `}<Mono>{where}</Mono></>
                    : `${formatModuleName(c.module)}: ${c.records.toLocaleString()} records without a known field`}
                </span>
                <span className="m-text-meta m-ink-3">
                  {`${c.rules.length} ${c.rules.length === 1 ? "rule" : "rules"}, ${labelOf(c.dimension).toLowerCase()}, ${labelOf(c.severity).toLowerCase()}`}
                </span>
                <span className="m-text-meta m-ink-3">
                  {`${c.impact.toLocaleString()} weighted failures (failing records × severity weight: critical 8, high 4, medium 2, low 1)${c.auto_fix_pct != null ? `, ${Math.round(c.auto_fix_pct)}% auto-fixable` : ""}`}
                </span>
                <span className="flex gap-3 m-text-body">
                  <Link href={withScope("/insights/rules", { run: at, module: c.module, field: c.field ?? undefined })} className="underline-offset-2 hover:underline">Open rules</Link>
                  {/* One rule opens exactly its records; a field failing several rules opens the object's records. */}
                  <Link
                    href={fixHref({ run: at, module: c.module, check: c.rules.length === 1 ? c.rules[0] : undefined })}
                    aria-label={drillLabel({ what: "failing records", module: c.module, check: c.rules.length === 1 ? c.rules[0] : undefined })}
                    className="underline-offset-2 hover:underline"
                  >Open records</Link>
                </span>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Failing blocking and warning S/4 rules: totals of the areas. */
export function s4Totals(areas: readonly S4Area[]): { blocking: number; warning: number } {
  return {
    blocking: areas.reduce((n, a) => n + a.blocking_failing, 0),
    warning: areas.reduce((n, a) => n + Math.max(0, a.failing - a.blocking_failing), 0),
  };
}

/** Blocking failing rules per S/4 area, each bar opening that area on the readiness page. */
/** The longest category label that fits the bar chart's widest axis (180px at 12px) on one line. */
const AXIS_LABEL_CHARS = 24;
/** A category label cut to one axis line, with an ellipsis where it was cut. */
export function axisLabel(label: string, max = AXIS_LABEL_CHARS): string {
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

export function S4Chart({ areas, run }: { areas: S4Area[]; run?: string }) {
  const router = useRouter();
  if (areas.length === 0) {
    return <p className="m-text-body m-ink-3">No rule in this scope maps to an S/4 simplification area. <Link href={withScope("/insights/readiness", { run })} className="m-ink-accent underline underline-offset-2">Open waves</Link></p>;
  }
  const failing = areas.filter((a) => a.failing > 0);
  if (failing.length === 0) {
    return <p className="m-text-body m-ink-3">No S/4 rule fails, so nothing blocks an S/4 load. <Link href={withScope("/insights/readiness", { run })} className="m-ink-accent underline underline-offset-2">Open waves</Link></p>;
  }
  return (
    <>
      <Bar
        // A long area name ("Warehouse Management to EWM") wrapped onto its neighbours' rows: the tick shows it cut to
        // one line (`label`), the tooltip and the drill keep the whole name (`x`).
        data={failing.map((a) => ({ x: a.label, y: a.blocking_failing, label: axisLabel(a.label) }))}
        label="Blocking failing rules per S/4 area"
        // One row per area so the labels never collide, however many areas fail.
        height={Math.max(160, failing.length * 28)}
        onPointClick={(p) => router.push(withScope("/insights/readiness", { run, area: areas.find((a) => a.label === p.x)?.area }))}
      />
      <p className="mt-2 m-text-body">
        <Link href={withScope("/insights/readiness", { run })} className="underline-offset-2 hover:underline">Open waves</Link>
      </p>
    </>
  );
}

/**
 * Each funnel stage as the Fix work filter that lists its records. Fix work has no confidence filter, so the high
 * confidence stage opens every record with a suggested value.
 */
export const CLEANSING_STAGE_FILTER: Record<CleansingStep["key"], FixFilter> = {
  failing: {},
  proposed: { sugg: true },
  high: { sugg: true },
  approved: { st: "approved" },
  applied: { st: "sent" },
};

/** Failing records to applied fixes; each stage opens Fix work at that status. */
export function CleansingFunnel({ steps, run }: { steps: CleansingStep[]; run?: string }) {
  const router = useRouter();
  // A batch is built from fixes someone applies: without `apply` the funnel stays a read (its stages still open Fix work).
  const { can } = useRole();
  if (steps.length === 0 || steps.every((s) => !s.records)) {
    return <p className="m-text-body m-ink-3">No failing records to clean in this scope. <Link href={fixHref({ run })} className="m-ink-accent underline underline-offset-2">Open Fix work</Link></p>;
  }
  return (
    <>
      <div aria-label="Cleansing funnel, failing records to applied fixes" role="group">
        <Funnel
          stages={steps.map((s) => ({ label: s.label, value: s.records }))}
          onStageClick={(st) => {
            const key = steps.find((s) => s.label === st.label)?.key;
            router.push(fixHref({ run, ...(key ? CLEANSING_STAGE_FILTER[key] : {}) }));
          }}
        />
      </div>
      {can("apply") ? (
        <div className="mt-3">
          <Button variant="secondary" render={<Link href={fixHref({ run, sugg: true })}>Create remediation batch</Link>} />
        </div>
      ) : null}
    </>
  );
}
