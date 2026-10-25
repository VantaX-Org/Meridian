"use client";

// The bodies of the Root causes, S/4 migration and Cleansing opportunity cards, shared by the one-run overview
// (`RunOverview` in ../page.tsx) and the current-state overview (`CurrentOverview`). `run` pins the links to one run;
// without it they open the current state. A root cause of the current state carries the run it was computed in.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, Button, Funnel, Mono } from "@/design";
import type { CleansingStep, RootCauseCluster } from "@/lib/api/insights";
import type { S4Area } from "@/lib/api/migration";
import { formatModuleName, labelOf } from "@/lib/format";
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
          <li key={c.key} className="m-card-sm flex flex-col gap-1 [background:var(--m-surface)] [border-radius:var(--m-radius-sheet)] [padding:var(--m-space-3)]">
            <span className="font-medium">
              {where
                ? <>{`${formatModuleName(c.module)}: one field fails on ${c.records.toLocaleString()}${c.records_estimated ? " (estimated)" : ""} records `}<Mono>{where}</Mono></>
                : `${formatModuleName(c.module)}: ${c.records.toLocaleString()} records without a known field`}
            </span>
            <span className="m-text-meta m-ink-3">
              {`${c.rules.length} ${c.rules.length === 1 ? "rule" : "rules"}, ${labelOf(c.dimension).toLowerCase()}, ${labelOf(c.severity).toLowerCase()}`}
            </span>
            <span className="m-text-meta m-ink-3">
              {`Impact on score ${c.impact.toLocaleString()}${c.auto_fix_pct != null ? `, ${Math.round(c.auto_fix_pct)}% auto-fixable` : ""}`}
            </span>
            <span className="flex gap-3 m-text-body">
              <Link href={withScope("/insights/rules", { run: at, module: c.module, field: c.field ?? undefined })} className="underline-offset-2 hover:underline">Open rules</Link>
              <Link href={withScope(`/objects/${c.module}`, { tab: "records", run: at, check: c.rules[0] })} className="underline-offset-2 hover:underline">Open records</Link>
            </span>
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
        data={failing.map((a) => ({ x: a.label, y: a.blocking_failing }))}
        label="Blocking failing rules per S/4 area"
        // One row per area so the labels never collide, however many areas fail.
        height={Math.max(160, failing.length * 24)}
        onPointClick={(p) => router.push(withScope("/insights/readiness", { run, area: areas.find((a) => a.label === p.x)?.area }))}
      />
      <p className="mt-2 m-text-body">
        <Link href={withScope("/insights/readiness", { run })} className="underline-offset-2 hover:underline">Open waves</Link>
      </p>
    </>
  );
}

/** Failing records to applied fixes; each stage opens the fix queue at that status. */
export function CleansingFunnel({ steps, run }: { steps: CleansingStep[]; run?: string }) {
  const router = useRouter();
  const fixHref = (extra: Record<string, string>) => withScope("/fix", { run, ...extra });
  if (steps.length === 0 || steps.every((s) => !s.records)) {
    return <p className="m-text-body m-ink-3">No failing records to clean in this scope. <Link href={fixHref({})} className="m-ink-accent underline underline-offset-2">Open the fix queue</Link></p>;
  }
  return (
    <>
      <div aria-label="Cleansing funnel, failing records to applied fixes" role="group">
        <Funnel
          stages={steps.map((s) => ({ label: s.label, value: s.records }))}
          onStageClick={(st) => {
            const key = steps.find((s) => s.label === st.label)?.key;
            router.push(fixHref({ status: key ?? "" }));
          }}
        />
      </div>
      <div className="mt-3">
        <Button variant="secondary" render={<Link href={fixHref({ source: "rule", confidence: "high" })}>Create remediation batch</Link>} />
      </div>
    </>
  );
}
