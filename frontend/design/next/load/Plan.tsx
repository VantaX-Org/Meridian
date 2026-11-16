"use client";

/**
 * Load plan, native: the order the migration objects load into the target, derived from the data dictionary. Every
 * dependency names its field, check table and dictionary text, so a reader can check it in SE11. An object that needs
 * a no-go object through a required field is blocked until that object is fixed.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getLoadPlan, type LoadEdge, type LoadEvidence, type LoadObject, type LoadPrerequisite, type LoadStatus, type PrerequisiteKind } from "@/lib/api/v2/load-plan";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLoadEvents, type LoadEvent } from "@/lib/api/v2/migration";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, VERDICT_LABEL } from "@/lib/v2/score";
import { Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, type ChipTone, type Column } from "../kit";
import { About, Banner, HBars, Panel } from "./parts";

const STATUS_TEXT: Record<LoadStatus, () => string> = {
  go: () => VERDICT_LABEL.go,
  no_go: () => VERDICT_LABEL["no-go"],
  not_run: () => t("Not analysed yet"),
};
const STATUS_TONE: Record<LoadStatus, ChipTone> = { go: "good", no_go: "bad", not_run: "neutral" };

const KIND_TEXT: Record<PrerequisiteKind, () => string> = {
  configuration: () => t("Configuration"),
  master_data: () => t("Master data from outside the plan"),
  unclassified: () => t("Not classified in the dictionary"),
};

type EdgeRow = { e: LoadEdge; x: LoadEvidence; first: boolean };
type PrereqRow = { o: LoadObject; p: LoadPrerequisite };

function ObjectCard({ o, names }: { o: LoadObject; names: Map<string, string> }) {
  return (
    <li data-testid={`lp-object-${o.module}`}>
      <div className="nx-ld-list-row">
        <strong>{moduleText(o.module)}</strong>
        <Chip tone={STATUS_TONE[o.status]}>{STATUS_TEXT[o.status]()}</Chip>
      </div>
      <Code code={o.anchor} text={o.anchor_text} />
      {o.status === "no_go" ? <span className="nx-ld-meta">{t("{n, plural, one {# blocking gap} other {# blocking gaps}}", { n: o.blocking })}</span> : null}
      {o.group.length ? <p className="nx-ld-meta">{t("Loads together with {list}", { list: o.group.map((m) => names.get(m) ?? m).join(", ") })}</p> : null}
      {o.blocked_by.length ? (
        <p className="nx-ld-meta" data-testid={`lp-blocked-${o.module}`}>
          {t("Blocked until {list} is fixed", { list: o.blocked_by.map((m) => names.get(m) ?? m).join(", ") })}
        </p>
      ) : null}
    </li>
  );
}

function LoadHistory({ events }: { events: LoadEvent[] | undefined }) {
  const cols: Column<LoadEvent>[] = [
    { id: "when", label: t("When"), cell: (e) => formatDate(e.exported_at, "datetime"), compare: (a, b) => (a.exported_at ?? "").localeCompare(b.exported_at ?? "") },
    { id: "wave", label: t("Wave"), cell: (e) => (e.wave_name ? <Code code={e.wave_stage ?? ""} text={e.wave_name} /> : <span className="nx-ld-meta">{t("No wave")}</span>) },
    { id: "objects", label: t("Objects"), cell: (e) => e.modules.map((m) => <span key={m}><Code code={m} text={moduleText(m)} />{" "}</span>) },
    { id: "file", label: t("File"), cell: (e) => <Code code={e.export_format} text={e.filename} /> },
    { id: "records", label: t("Records"), align: "end", cell: (e) => int(e.record_count), compare: (a, b) => a.record_count - b.record_count },
    { id: "by", label: t("By"), cell: (e) => e.exported_by_label ?? e.exported_by ?? "" },
  ];
  return (
    <Panel title={t("Load history")} meta={t("Every load file downloaded from a migration run. Each download is recorded as a load.")} testId="lp-history">
      <DataTable
        rows={events ?? []}
        columns={cols}
        rowKey={(e) => e.id}
        rowLabel={(e) => e.filename}
        caption={t("Load files downloaded from migration runs")}
        loading={events === undefined}
        empty={{ heading: t("No load file has been downloaded yet.") }}
      />
    </Panel>
  );
}

export function Plan() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["load-plan", fixture], queryFn: () => getLoadPlan(), staleTime: 60_000 });
  const ev = useQuery({ queryKey: ["load-history", fixture], queryFn: () => getLoadEvents(), staleTime: 60_000 });
  const events = ev.data?.items ?? (ev.isError ? [] : undefined);
  const loaded = (events?.length ?? 0) > 0;
  const title = t("Load plan");

  if (q.isPending) return <Skeleton lines={8} label={title} />;
  if (q.isError) return <ErrorState sentence={t("The load plan could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const plan = q.data;
  if (plan.objects.length === 0) return <EmptyState heading={title}>{t("No licensed object can be planned against this dictionary.")}</EmptyState>;

  const names = new Map(plan.objects.map((o) => [o.module, moduleText(o.module)]));
  const noGo = plan.objects.filter((o) => o.status === "no_go").length;
  const blocked = plan.objects.filter((o) => o.blocked_by.length > 0).length;
  const notRun = plan.objects.filter((o) => o.status === "not_run").length;
  const steps = Array.from({ length: plan.steps }, (_, i) => i + 1);
  const verdict = noGo || blocked ? "no-go" : notRun ? "at-risk" : "go";
  const edgeRows: EdgeRow[] = plan.edges.flatMap((e) => e.evidence.map((x, i) => ({ e, x, first: i === 0 })));
  const prereqRows: PrereqRow[] = plan.objects.flatMap((o) => o.prerequisites.map((p) => ({ o, p })));
  const gaps = plan.objects.filter((o) => o.blocking > 0).sort((a, b) => b.blocking - a.blocking);

  const edgeCols: Column<EdgeRow>[] = [
    { id: "before", label: t("Loads first"), cell: (r) => (r.first ? names.get(r.e.before) ?? r.e.before : null) },
    { id: "after", label: t("Then"), cell: (r) => (r.first ? names.get(r.e.after) ?? r.e.after : null) },
    { id: "kind", label: t("Kind"), cell: (r) => (r.first ? (r.e.deferred ? t("Deferred") : r.e.kind === "required" ? t("Required") : t("Reference")) : null) },
    { id: "field", label: t("Field"), cell: (r) => <Code code={r.x.field} text={r.x.text} /> },
    { id: "table", label: t("Check table"), cell: (r) => <Code code={r.x.check_table} text={r.x.check_table_text} /> },
    { id: "why", label: t("Why"), cell: (r) => <span className="nx-ld-meta">{r.x.reason ?? (r.x.required ? t("Required") : t("Reference"))}</span> },
  ];
  const prereqCols: Column<PrereqRow>[] = [
    { id: "object", label: t("Object"), cell: (r) => names.get(r.o.module) },
    { id: "table", label: t("Check table"), cell: (r) => <Code code={r.p.table} text={r.p.text} /> },
    { id: "kind", label: t("Kind"), cell: (r) => KIND_TEXT[r.p.kind]() },
    { id: "fields", label: t("Fields"), cell: (r) => <span className="nx-ld-meta">{r.p.fields.join(", ")}</span> },
  ];

  return (
    <div className="nx-ld-step" data-testid="nx-load-plan">
      <Banner
        testId="load-plan"
        eyebrow={title}
        verdict={verdict}
        headline={t("{n, plural, one {# object loads in {s} steps} other {# objects load in {s} steps}}", { n: plan.objects.length, s: plan.steps })}
        why={t("Each dependency is a field whose check table another object owns. The state of each object is its latest migration analysis.")}
        figs={[
          { label: t("Steps"), value: int(plan.steps) },
          { label: VERDICT_LABEL["no-go"], value: int(noGo), tone: noGo ? "bad" : undefined },
          { label: t("Blocked"), value: int(blocked), hint: t("Objects that need a no-go object through a required field"), tone: blocked ? "warn" : undefined },
          { label: t("Not analysed yet"), value: int(notRun) },
        ]}
        action={<span className="nx-ld-meta">{t("Dictionary: {release}", { release: plan.release })}</span>}
      />
      <About
        shows={t("Shows the order in which the migration objects load, and why, from the data dictionary.")}
        steps={[t("Read the order"), t("Fix the no-go objects"), t("Load step by step"), t("Reconcile after each step")]}
        current={noGo ? 1 : loaded ? 3 : 2}
        means={[
          [t("Required"), t("The target refuses the record without this field, so the other object must load first.")],
          [t("Reference"), t("The record loads, but the reference stays empty or is rejected until the other object is in.")],
          [t("Deferred"), t("A reference inside a cycle. It is loaded as a delta after both objects.")],
          [t("Prerequisite"), t("A check table no object in the plan owns. It must already be in the target.")],
        ]}
        next={
          loaded
            ? <Link className="nx-btn nx-btn-secondary" href="/load/analysis#mig-post-load">{t("Reconcile the load")}</Link>
            : <Link className="nx-btn nx-btn-secondary" href="/load/analysis">{t("Open the migration analysis")}</Link>
        }
      />
      <Panel title={t("Steps")} meta={t("Objects in the same step have no dependency on each other and can load in parallel.")} testId="lp-steps">
        <ol className="nx-ld-steps">
          {steps.map((s) => (
            <li key={s} data-testid={`lp-step-${s}`}>
              <strong>{t("Step {n}", { n: s })}</strong>
              <ul className="nx-ld-list">
                {plan.objects.filter((o) => o.step === s).map((o) => <ObjectCard key={o.module} o={o} names={names} />)}
              </ul>
            </li>
          ))}
        </ol>
        {plan.unknown.length ? <p className="nx-ld-meta" data-testid="lp-unknown">{t("Not planned, no load object in this dictionary: {list}", { list: plan.unknown.map(moduleText).join(", ") })}</p> : null}
        {gaps.length ? (
          <HBars
            label={t("Blocking gaps")}
            testId="lp-gap-bars"
            rows={gaps.map((o) => ({ key: o.module, label: moduleText(o.module), value: o.blocking, text: int(o.blocking), tone: "bad" }))}
          />
        ) : null}
      </Panel>
      <Panel title={t("Dependencies")} meta={t("Every field that makes one object load before another.")} testId="lp-edges">
        {edgeRows.length === 0 ? <p className="nx-ld-meta">{t("These objects do not depend on each other.")}</p> : (
          <DataTable rows={edgeRows} columns={edgeCols} rowKey={(r) => `${r.e.before}-${r.e.after}-${r.x.field}`} rowLabel={(r) => r.x.field} caption={t("Dependencies between migration objects")} />
        )}
      </Panel>
      <Panel title={t("Prerequisites")} meta={t("Check tables no object in the plan owns. Load or transport them before step 1.")} testId="lp-prereq">
        <DataTable rows={prereqRows} columns={prereqCols} rowKey={(r) => `${r.o.module}-${r.p.table}`} rowLabel={(r) => r.p.table} caption={t("Prerequisites of each object")} empty={{ heading: t("Prerequisites") }} />
      </Panel>
      <LoadHistory events={events} />
    </div>
  );
}
