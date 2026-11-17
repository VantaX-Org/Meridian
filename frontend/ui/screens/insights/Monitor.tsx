"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { groupByRun, useFeed } from "@/lib/api/next/monitor";
import { getBackAfterClean, getMonitor, type MonitorItem } from "@/lib/api/remediation";
import { proposeShiftRule, getFieldShifts } from "@/lib/api/v2/anomaly-rules";
import { listRunSchedules } from "@/lib/api/v2/admin";
import { getFirewallSummary } from "@/lib/api/v2/dq-firewall";
import { acknowledgeBreak, expectBreak, explainBreak, getLearnedMonitors, snoozeBreak, type LearnedBreak } from "@/lib/api/v2/learned-monitors";
import { getObjectsMonitor } from "@/lib/api/v2/run-ops";
import { getDriftAlerts, getObjectContracts } from "@/lib/api/v2/step9";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import { BarList, Button, Card, EmptyState, FieldChip, PageHeader, Select, SeverityPill, StatTile, Tabs, TrendArea, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { Gate, InsightsNav, Mod, Tbl, day, n0, n1, pc, sevLabel, sevOf, useQ } from "./shared";

type View = "feed" | "objects" | "after-clean" | "learned" | "shifts" | "config" | "contracts" | "gate" | "schedule";
const VIEWS: View[] = ["feed", "objects", "after-clean", "learned", "shifts", "config", "contracts", "gate", "schedule"];
const viewItems = (): { id: View; label: string }[] => [
  { id: "feed", label: t("Feed") }, { id: "objects", label: t("Objects") }, { id: "after-clean", label: t("After a clean") },
  { id: "learned", label: t("Learned") }, { id: "shifts", label: t("Field shifts") }, { id: "config", label: t("Configuration") },
  { id: "contracts", label: t("Contracts") }, { id: "gate", label: t("Gate") }, { id: "schedule", label: t("Schedule") },
];

function Feed() {
  const [module, setModule] = useState("");
  const [limit, setLimit] = useState(50);
  const q = useFeed({ module: module || undefined, limit });
  const groups = groupByRun(q.data?.items ?? [], q.data?.runs ?? []);
  const mods = Array.from(new Set((q.data?.runs ?? []).map((r) => r.module).filter((m): m is string => !!m)));
  return (
    <Gate q={q} empty={groups.length === 0} emptyHeading={t("Nothing new since the last run")} emptyBody={t("New and regressed findings land here after each run.")}>
      <div className="b8-stack">
        <div className="b8-bar">
          <Select aria-label={t("Object")} value={module} onChange={(e) => setModule(e.target.value)} options={[{ value: "", label: t("All objects") }, ...mods.map((m) => ({ value: m, label: m }))]} />
        </div>
        {groups.map((g) => (
          <Card key={g.version_id} title={`${g.label ?? g.version_id}`} sub={t("{new} new, {reg} regressed, {res} resolved, {at}", { new: n0(g.newCount), reg: n0(g.regressedCount), res: n0(g.resolvedCount), at: day(g.detected_at) })}>
            <Tbl label={t("Findings in {run}", { run: g.version_id })} rows={g.findings} rowKey={(r) => `${r.check_id}/${r.change}`} cols={[
              { key: "s", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
              { key: "c", label: t("Change"), render: (r) => (r.change === "new" ? t("New") : t("Regressed")) },
              { key: "r", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.reason} /> },
              { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
              { key: "n", label: t("Records"), end: true, render: (r) => n0(r.records) },
              { key: "o", label: t("Owner"), render: (r) => r.owner ?? t("n/a") },
            ]} />
          </Card>
        ))}
        {q.data?.next_offset != null ? <Button variant="secondary" onClick={() => setLimit(limit + 50)}>{t("Show more")}</Button> : null}
      </div>
    </Gate>
  );
}

function Objects() {
  const q = useQ("objects-monitor", getObjectsMonitor);
  const rows = q.data?.objects ?? [];
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={t("No objects watched yet")} emptyBody={t("An object appears here after its first run.")}>
      <Tbl label={t("Object cadence, freshness and drift")} rows={rows} rowKey={(r) => `${r.system_id}/${r.module}`} cols={[
        { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
        { key: "f", label: t("Freshness"), render: (r) => r.freshness },
        { key: "last", label: t("Last run"), render: (r) => day(r.last_run_at) },
        { key: "cad", label: t("Cadence"), render: (r) => (r.cadence?.active ? r.cadence.cron : t("Manual")) },
        { key: "next", label: t("Next run"), render: (r) => day(r.next_run_at) },
        { key: "new", label: t("Newly failing"), end: true, render: (r) => n0(r.drift?.newly_failing_rule_count ?? r.drift?.new_failing) },
        { key: "rec", label: t("Recovered"), end: true, render: (r) => n0(r.drift?.recovered_rule_count ?? r.drift?.recovered) },
      ]} />
    </Gate>
  );
}

/** Each system since its last clean: what came in new, what regressed, what the clean resolved. */
function SinceClean() {
  const q = useQ("remediation-monitor", getMonitor);
  const items = q.data?.items ?? [];
  const label = (i: MonitorItem) => i.system_name ?? (i.scope === "upload" ? t("Uploaded file") : i.scope);
  return (
    <Card title={t("Since the last clean")} sub={t("Latest run against the run before the clean")}>
      <Gate q={q} empty={items.length === 0} emptyHeading={t("No clean to watch yet")} emptyBody={t("Once a clean is applied, the next run is compared with the run before it.")}>
        <div className="b8-stack" data-testid="since-clean">
          {items.map((i) => (
            <div key={i.lineage ?? i.scope} className="b8-stack">
              <h3>{label(i)}</h3>
              <dl className="mx-tiles">
                <StatTile label={t("Score before")} value={n1(i.baseline.dqs)} note={day(i.baseline.run_at)} />
                <StatTile label={t("Score now")} value={n1(i.latest.dqs)} note={day(i.latest.run_at)} />
                <StatTile label={t("Resolved")} value={i.monitor ? n0(i.monitor.resolved_records) : "-"} note={i.monitor?.batch_id ? t("Clean {id}", { id: i.monitor.batch_id }) : undefined} />
                <StatTile label={t("New failing records")} value={i.monitor ? n0(i.monitor.new_records) : "-"} />
              </dl>
              {i.monitor && i.monitor.regressed_checks.length > 0 ? (
                <Tbl label={t("Rules that got worse")} rows={i.monitor.regressed_checks} rowKey={(r) => r.check_id} cols={[
                  { key: "r", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.name ?? t("Rule")} /> },
                  { key: "o", label: t("Object"), render: (r) => <Mod code={r.module} /> },
                  { key: "s", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
                  { key: "n", label: t("New failures"), end: true, render: (r) => n0(r.new) },
                ]} />
              ) : i.monitor ? <p className="mx-muted">{t("No rule got worse since the clean.")}</p> : <p className="mx-muted">{t("No run since the clean yet.")}</p>}
            </div>
          ))}
        </div>
      </Gate>
    </Card>
  );
}

function AfterClean() {
  return <div className="b8-stack"><SinceClean /><CameBack /></div>;
}

function CameBack() {
  const q = useQ("back-after-clean", () => getBackAfterClean(12));
  const d = q.data;
  return (
    <Gate q={q} empty={!d || (d.weeks.length === 0 && d.rules.length === 0)} emptyHeading={t("Nothing has come back")} emptyBody={t("After a clean, Meridian watches whether fixed records fail again.")}>
      {d ? (
        <div className="b8-stack">
          <TrendArea label={t("Records that came back, by week")} emptyLabel={t("No weeks yet")} points={d.weeks.map((w) => ({ axis: w.week, title: w.week, value: w.back }))} />
          <div className="b8-grid">
            <Card title={t("By rule")}>
              <Tbl label={t("Rules that came back")} rows={d.rules} rowKey={(r) => r.check_id} cols={[
                { key: "r", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.message ?? t("Rule")} /> },
                { key: "f", label: t("Fixed"), end: true, render: (r) => n0(r.fixed) },
                { key: "b", label: t("Came back"), end: true, render: (r) => n0(r.back) },
                { key: "rc", label: t("Recently"), end: true, render: (r) => n0(r.back_recent) },
              ]} />
            </Card>
            <Card title={t("By clean")}>
              <Tbl label={t("Cleans")} rows={d.batches} rowKey={(r) => String(r.id)} cols={[
                { key: "i", label: t("Clean"), render: (r) => String(r.id) },
                { key: "a", label: t("Date"), render: (r) => day(r.created_at) },
                { key: "f", label: t("Fixed"), end: true, render: (r) => n0(r.fixed) },
                { key: "b", label: t("Came back"), end: true, render: (r) => n0(r.back) },
              ]} />
            </Card>
          </div>
        </div>
      ) : null}
    </Gate>
  );
}

function Learned() {
  const q = useQ("learned", getLearnedMonitors);
  const qc = useQueryClient();
  const toast = useToast();
  const [why, setWhy] = useState<Record<string, string>>({});
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["b8", "learned"] });
  const run = (p: Promise<unknown>) => p.then(() => { toast(t("Saved.")); void refresh(); }).catch(() => toast(t("That could not be saved.")));
  const explain = (b: LearnedBreak) => explainBreak(b.id).then((r) => setWhy((w) => ({ ...w, [b.id]: JSON.stringify(r) }))).catch(() => toast(t("No explanation could be made.")));
  return (
    <Gate q={q} empty={!d || (d.coverage.length === 0 && d.breaks.length === 0)} emptyHeading={t("Still learning")} emptyBody={t("A monitor needs several runs before it can tell a break from normal.")}>
      {d ? (
        <div className="b8-stack">
          <Card title={t("Coverage")} sub={t("An object is watched once it has {n} runs of history", { n: n0(d.min_runs) })}>
            <Tbl label={t("Learned monitor coverage")} rows={d.coverage} rowKey={(r) => r.module} cols={[
              { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
              { key: "s", label: t("State"), render: (r) => (r.state === "active" ? t("Active") : t("Learning")) },
              { key: "b", label: t("Runs seen"), end: true, render: (r) => `${n0(r.baseline_runs)} / ${n0(r.min_runs)}` },
              { key: "k", label: t("Breaks"), end: true, render: (r) => n0(r.breaks) },
            ]} />
          </Card>
          <Card title={t("Breaks")}>
            {d.breaks.length === 0 ? <EmptyState heading={t("No breaks")} body={t("Every watched value sits inside its learned range.")} /> : (
              <Tbl label={t("Learned breaks")} rows={d.breaks} rowKey={(r) => r.id} cols={[
                { key: "s", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
                { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
                { key: "w", label: t("What broke"), render: (r) => (r.subject_code ? <FieldChip code={r.subject_code} description={r.subject_description ?? r.metric} /> : r.metric) },
                { key: "o", label: t("Seen"), end: true, render: (r) => n1(r.observed) },
                { key: "e", label: t("Expected"), end: true, render: (r) => t("{a} to {b}", { a: n1(r.expected_low), b: n1(r.expected_high) }) },
                { key: "st", label: t("Status"), render: (r) => r.status },
                { key: "x", label: t("Why"), render: (r) => why[r.id] ?? r.explanation?.sentences?.[0] ?? "" },
                { key: "a", label: t("Action"), render: (r) => (
                  <span className="b8-seg">
                    <Button variant="ghost" onClick={() => void run(acknowledgeBreak(r.id))}>{t("Acknowledge")}</Button>
                    <Button variant="ghost" onClick={() => void run(expectBreak(r.id, "accept"))}>{t("Expected")}</Button>
                    <Button variant="ghost" onClick={() => void run(snoozeBreak(r.id, 7))}>{t("Snooze 7 days")}</Button>
                    <Button variant="ghost" onClick={() => void explain(r)}>{t("Explain")}</Button>
                  </span>
                ) },
              ]} />
            )}
          </Card>
        </div>
      ) : null}
    </Gate>
  );
}

function Shifts() {
  const q = useQ("shifts", getFieldShifts);
  const toast = useToast();
  const rows = q.data ?? [];
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={t("No field shifts")} emptyBody={t("A shift is a field that suddenly goes blank or takes a code it never had.")}>
      <Tbl label={t("Field shifts")} rows={rows} rowKey={(r) => r.id} cols={[
        { key: "s", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
        { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
        { key: "f", label: t("Field"), render: (r) => <FieldChip code={r.field} description={r.field_description ?? describeField(r.field) ?? ""} /> },
        { key: "k", label: t("Kind"), render: (r) => (r.kind === "null_spike" ? t("Blank spike") : t("Unexpected code")) },
        { key: "b", label: t("Blank now"), end: true, render: (r) => pc(r.current?.blank_pct) },
        { key: "p", label: t("Blank before"), end: true, render: (r) => pc(r.previous?.blank_pct) },
        { key: "d", label: t("Detected"), render: (r) => day(r.detected_at) },
        { key: "a", label: t("Action"), render: (r) => <Button variant="ghost" onClick={() => void proposeShiftRule({ field: r.field, kind: r.kind, version_id: r.version_id }).then(() => toast(t("A draft rule was created."))).catch(() => toast(t("The rule could not be drafted.")))}>{t("Draft a rule")}</Button> },
      ]} />
    </Gate>
  );
}

function Config() {
  const q = useQ("drift", () => getDriftAlerts(50));
  const rows = q.data?.alerts ?? [];
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={t("No configuration drift")} emptyBody={t("Changes to the system's customising show up here.")}>
      <Tbl label={t("Configuration drift")} rows={rows} rowKey={(r) => r.id} cols={[
        { key: "d", label: t("Detected"), render: (r) => day(r.created_at) },
        { key: "s", label: t("System"), render: (r) => r.system_name ?? r.system_id },
        { key: "a", label: t("Areas changed"), render: (r) => r.areas.map((a) => `${a.area} (+${a.added} -${a.removed} ~${a.changed})`).join(", ") },
        { key: "r", label: t("Rules affected"), render: (r) => r.rules.map((x) => <FieldChip key={x.check_id} code={x.check_id} description={x.name ?? undefined} />) },
        { key: "q", label: t("Rescore"), render: (r) => (r.rescore_queued ? t("Queued") : t("No")) },
      ]} />
    </Gate>
  );
}

function Contracts() {
  const mods = useQ("objects-monitor", getObjectsMonitor);
  const codes = Array.from(new Set((mods.data?.objects ?? []).map((o) => o.module)));
  const [picked, setPicked] = useState<string | null>(null);
  const mod = picked ?? codes[0] ?? null;
  const q = useQ("contracts", () => getObjectContracts(mod ?? ""), [mod]);
  const cs = q.data?.contracts ?? [];
  return (
    <div className="b8-stack">
      {codes.length ? <div className="b8-bar"><Select aria-label={t("Object")} value={mod ?? ""} onChange={(e) => setPicked(e.target.value)} options={codes.map((m) => ({ value: m, label: m }))} /></div> : null}
      {mod ? (
        <Gate q={q} empty={cs.length === 0} emptyHeading={t("No contracts for this object")} emptyBody={t("A contract states what a consumer needs from this object's data.")}>
          <Tbl label={t("Data contracts")} rows={cs} rowKey={(r) => r.contract_id} cols={[
            { key: "n", label: t("Contract"), render: (r) => r.name },
            { key: "p", label: t("Producer"), render: (r) => r.producer },
            { key: "c", label: t("Consumer"), render: (r) => r.consumer },
            { key: "e", label: t("Enforced"), render: (r) => (r.enforce ? t("Yes") : t("No")) },
            { key: "b", label: t("Breaches"), render: (r) => (r.breaches.length ? r.breaches.map((b) => `${b.metric} ${n1(b.actual)} / ${n1(b.threshold)}`).join(", ") : t("None")) },
          ]} />
        </Gate>
      ) : <EmptyState heading={t("No object to show")} body={t("Contracts appear once an object has run.")} />}
    </div>
  );
}

function Gatev() {
  const q = useQ("firewall", getFirewallSummary);
  const f = q.data;
  return (
    <Gate q={q} empty={!f} emptyHeading={t("The gate has not been called yet")} emptyBody={t("The gate checks records before they reach SAP.")}>
      {f ? (
        <div className="b8-stack">
          <dl className="mx-tiles">
            <StatTile label={t("Calls in 24 hours")} value={n0(f.calls_24h)} />
            <StatTile label={t("Calls in 7 days")} value={n0(f.calls_7d)} />
            <StatTile label={t("Held for review")} value={n0(f.holds?.held)} note={t("{n} written", { n: n0(f.holds?.written) })} />
            <StatTile label={t("Blocks at severity")} value={sevLabel(f.block_severity)} />
          </dl>
          <div className="b8-grid">
            <Card title={t("Top blocking rules")}>
              <BarList label={t("Top blocking rules")} items={f.top_rules.map((r) => ({ id: r.rule_id, label: `${r.rule_id}, ${r.description}`, value: r.blocked, display: n0(r.blocked) }))} />
            </Card>
            <Card title={t("By object")}>
              <Tbl label={t("Gate by object")} rows={f.by_module} rowKey={(r) => r.module} cols={[
                { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
                { key: "c", label: t("Checked"), end: true, render: (r) => n0(r.checked) },
                { key: "b", label: t("Blocked"), end: true, render: (r) => n0(r.blocked) },
                { key: "p", label: t("Passed"), end: true, render: (r) => n0(r.passed) },
              ]} />
            </Card>
          </div>
        </div>
      ) : null}
    </Gate>
  );
}

function Schedule() {
  const q = useQ("schedules", listRunSchedules);
  const rows = q.data?.schedules ?? [];
  return (
    <div className="b8-stack">
      <Gate q={q} empty={rows.length === 0} emptyHeading={t("No scheduled runs")} emptyBody={t("Add a schedule so runs happen without anyone starting them.")}>
        <Tbl label={t("Run schedules")} rows={rows} rowKey={(r) => r.id} cols={[
          { key: "n", label: t("Schedule"), render: (r) => r.name },
          { key: "s", label: t("System"), render: (r) => r.system_name ?? r.system_id },
          { key: "m", label: t("Objects"), render: (r) => (r.modules ?? []).map((m) => <Mod key={m} code={m} />) },
          { key: "c", label: t("Cadence"), render: (r) => r.cadence?.cron ?? r.schedule_cron ?? t("n/a") },
          { key: "a", label: t("Active"), render: (r) => (r.active ? t("Yes") : t("No")) },
        ]} />
      </Gate>
      <Link href="/admin/schedules" className="mx-link">{t("Manage schedules in admin")}</Link>
    </div>
  );
}

export function Monitor() {
  useInterfaceLang();
  const chat = useAletheia();
  const sp = useSearchParams();
  const start: View = sp.get("open") === "schedule" ? "schedule" : VIEWS.includes(sp.get("view") as View) ? (sp.get("view") as View) : "feed";
  const [view, setView] = useState<View>(start);
  const items = viewItems();
  useAletheiaScope({
    key: `monitor/${view}`,
    label: t("Asking about the monitor, {view}", { view: items.find((i) => i.id === view)?.label ?? "" }),
    suggestions: [t("What changed since the last run?"), t("Which break matters most?"), t("Is anything coming back after a clean?")],
  });
  return (
    <div className="b8-page">
      <PageHeader title={t("Monitor")} context={t("What changed, what came back and what is drifting, after every run.")}
        actions={<><InsightsNav here="monitor" /><Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button></>} />
      <Tabs idBase="b8-mon" label={t("Monitor views")} items={items} value={view} onChange={(id) => setView(id as View)} />
      <div id={`b8-mon-panel-${view}`} role="tabpanel" aria-labelledby={`b8-mon-tab-${view}`} className="b8-stack">
        {view === "feed" ? <Feed /> : null}
        {view === "objects" ? <Objects /> : null}
        {view === "after-clean" ? <AfterClean /> : null}
        {view === "learned" ? <Learned /> : null}
        {view === "shifts" ? <Shifts /> : null}
        {view === "config" ? <Config /> : null}
        {view === "contracts" ? <Contracts /> : null}
        {view === "gate" ? <Gatev /> : null}
        {view === "schedule" ? <Schedule /> : null}
      </div>
    </div>
  );
}
