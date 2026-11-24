"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { exportBpmn, exportSignavio, getCase, getCases, getCatalogue, getConformance, getDfg, getDiscoveryRuns, getVariants, startDiscovery, type CaseRow, type CatalogueEntry, type NodeStats, type RunSummary, type Variant } from "@/lib/api/v2/discovery";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, DetailPanel, Split, TabPanel, Tabs, useToast, ExportMenu } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, useSystemPick, when } from "./shared";
import { FlowGraph } from "./FlowGraph";
import { HealthCard, ModelView } from "./DiscoveryHealth";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? t("n/a") : `${Math.round(n * 100)}%`);
const secs = (n: number | null | undefined) => (n === null || n === undefined ? t("n/a") : n >= 86400 ? `${(n / 86400).toFixed(1)} ${t("days")}` : n >= 3600 ? `${(n / 3600).toFixed(1)} ${t("hours")}` : `${Math.round(n / 60)} ${t("minutes")}`);

const stepName = (nodes: readonly NodeStats[], id: string) => nodes.find((n) => n.id === id)?.name ?? t("No description");

function RunDetail({ runId }: { runId: string }) {
  const [tab, setTab] = useState("map");
  const [node, setNode] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | undefined>();
  const [path, setPath] = useState<readonly string[] | null>(null);
  const [caseId, setCaseId] = useState("");
  const dfg = useRead(["pd", "dfg", runId, node], () => getDfg(runId, node), tab === "map");
  const vars = useRead(["pd", "vars", runId], () => getVariants(runId), tab === "variants");
  const conf = useRead(["pd", "conf", runId], () => getConformance(runId), tab === "conformance");
  const cases = useRead(["pd", "cases", runId, variant], () => getCases(runId, variant), tab === "cases");
  const ev = useRead(["pd", "case", runId, caseId], () => getCase(runId, caseId), !!caseId && tab === "cases");
  return (
    <DetailPanel idBase="pd" label={t("Run detail")} tabsLabel={t("Process views")}
      header={<ExportMenu formats={[{ id: "signavio", label: t("Signavio"), hint: t("All processes in the run") }, ...(node ? [{ id: "bpmn", label: t("BPMN 2.0"), hint: t("The selected process") }] : [])]} onExport={(f) => f === "bpmn" ? exportBpmn(runId, node ?? "") : exportSignavio(runId)} />}
      tabs={[{ id: "map", label: t("Process map") }, { id: "variants", label: t("Variants") }, { id: "conformance", label: t("Conformance") }, { id: "cases", label: t("Cases") }]}
      value={tab} onChange={setTab}>
      {tab === "map" ? (
        <Async q={dfg}>
          {(d) => (
            <>
              <Card title={d.node.name} sub={`${num(d.node.case_count)} ${t("cases")}`} action={node ? <Button variant="ghost" onClick={() => setNode(null)}>{t("Back to the top")}</Button> : undefined}>
                <DataTable<NodeStats> label={t("Steps")} rows={d.nodes} rowKey={(n) => n.id} height={260} onSelect={(n) => setNode(n.id)}
                  columns={[
                    { key: "n", label: t("Step"), sort: (n) => n.name, render: (n) => <Code code={n.id} description={n.name} /> },
                    { key: "c", label: t("Cases"), align: "end", sort: (n) => n.case_count, render: (n) => num(n.case_count) },
                    { key: "m", label: t("Median time"), render: (n) => secs(n.median_seconds) },
                    { key: "f", label: t("Fitness"), align: "end", render: (n) => pct(n.fitness) },
                  ]} />
              </Card>
              <Card title={t("Process map")}>
                <FlowGraph dfg={d} variant={path} onOpen={(n) => setNode(n.id)} testId="pd-flow" />
              </Card>
              <Card title={t("Flows between steps")}>
                <DataTable label={t("Flows")} rows={d.edges} rowKey={(e) => `${e.source}>${e.target}`} height={220}
                  columns={[
                    { key: "a", label: t("From"), render: (e) => <Code code={e.source} description={stepName(d.nodes, e.source)} /> },
                    { key: "b", label: t("To"), render: (e) => <Code code={e.target} description={stepName(d.nodes, e.target)} /> },
                    { key: "c", label: t("Cases"), align: "end", sort: (e) => e.count, render: (e) => num(e.count) },
                    { key: "m", label: t("Median time"), render: (e) => secs(e.median_seconds) },
                  ]} />
              </Card>
            </>
          )}
        </Async>
      ) : null}
      {tab === "variants" ? (
        <Async q={vars}>
          {(d) => d.items.length ? (
            <DataTable<Variant> label={t("Variants")} rows={d.items} rowKey={(v) => v.hash} height={420} onSelect={(v) => { setVariant(v.hash); setPath(v.activities); setTab("cases"); }}
              columns={[
                { key: "p", label: t("Path"), render: (v) => v.activities.map((a) => <Code key={a} code={a} />) },
                { key: "c", label: t("Cases"), align: "end", sort: (v) => v.case_count, render: (v) => num(v.case_count) },
                { key: "s", label: t("Share"), align: "end", render: (v) => pct(v.share) },
                { key: "m", label: t("Median time"), render: (v) => secs(v.median_seconds) },
                { key: "f", label: t("Fitness"), align: "end", render: (v) => pct(v.fitness) },
              ]} />
          ) : <Empty heading={t("No variants")} />}
        </Async>
      ) : null}
      {tab === "conformance" ? (
        <Async q={conf} lines={3}>
          {(c) => (
            <>
              <Card title={t("Fitness against the reference")} sub={pct(c.fitness)}>
                <DataTable label={t("Step fitness")} rows={c.steps} rowKey={(s) => s.activity} height={260}
                  columns={[
                    { key: "a", label: t("Step"), render: (s) => <Code code={s.activity} /> },
                    { key: "f", label: t("Fitness"), align: "end", sort: (s) => s.step_fitness, render: (s) => pct(s.step_fitness) },
                    { key: "o", label: t("Out of order"), align: "end", render: (s) => num(s.out_of_order) },
                  ]} />
              </Card>
              <Card title={t("Steps outside the reference")}>
                <DataTable label={t("Extra steps")} rows={c.extra} rowKey={(s) => s.activity} height={200}
                  columns={[
                    { key: "a", label: t("Step"), render: (s) => <Code code={s.activity} /> },
                    { key: "c", label: t("Cases"), align: "end", render: (s) => num(s.cases) },
                    { key: "s", label: t("Share"), align: "end", render: (s) => pct(s.share) },
                  ]} />
              </Card>
            </>
          )}
        </Async>
      ) : null}
      {tab === "model" ? <ModelView runId={runId} /> : null}
      {tab === "cases" ? (
        <>
          {variant ? <Button variant="ghost" onClick={() => setVariant(undefined)}>{t("All variants")}</Button> : null}
          <Async q={cases}>
            {(d) => d.items.length ? (
              <DataTable<CaseRow> label={t("Cases")} rows={d.items} rowKey={(c) => c.case_id} height={260} onSelect={(c) => setCaseId(c.case_id)}
                columns={[
                  { key: "i", label: t("Case"), sort: (c) => c.case_id, render: (c) => c.case_id },
                  { key: "f", label: t("Started"), render: (c) => when(c.first_ts) },
                  { key: "l", label: t("Ended"), render: (c) => when(c.last_ts) },
                  { key: "e", label: t("Events"), align: "end", render: (c) => num(c.events) },
                ]} />
            ) : <Empty heading={t("No cases")} />}
          </Async>
          {caseId ? (
            <Async q={ev}>
              {(c) => (
                <Card title={`${t("Case")} ${c.case_id}`}>
                  <DataTable label={t("Case events")} rows={c.events} rowKey={(e) => String(e.seq)} height={240}
                    columns={[
                      { key: "a", label: t("Step"), render: (e) => <Code code={e.activity} description={e.source_table ?? undefined} /> },
                      { key: "t", label: t("When"), render: (e) => when(e.ts) },
                      { key: "r", label: t("By"), render: (e) => e.resource ?? (e.automated ? t("Automated") : t("n/a")) },
                    ]} />
                </Card>
              )}
            </Async>
          ) : null}
        </>
      ) : null}
    </DetailPanel>
  );
}

const RUN_STATUS: Record<RunSummary["status"], () => string> = {
  queued: () => t("Queued"),
  waiting: () => t("Waiting"),
  extracting: () => t("Extracting"),
  building: () => t("Building the event log"),
  mining: () => t("Mining"),
  completed: () => t("Completed"),
  failed: () => t("Failed"),
};
const runStatusText = (s: RunSummary["status"]): string => RUN_STATUS[s]?.() ?? s;

export function ProcessesScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const sys = useSystemPick();
  const [l1, setL1] = useState("");
  const [run, setRun] = useState("");
  const [tab, setTab] = useState("catalogue");
  const cat = useRead(["pd", "cat", sys.id], () => getCatalogue(sys.id), !!sys.id);
  const rows = cat.data ?? [];
  const cur = rows.find((r) => r.l1 === l1) ?? rows[0];
  const runs = useRead(["pd", "runs", sys.id, cur?.l1], () => getDiscoveryRuns(sys.id, cur?.l1), !!sys.id && !!cur);
  const runRows = runs.data ?? [];
  const curRun = runRows.find((r) => r.id === run)?.id ?? cur?.last_run?.id ?? runRows[0]?.id ?? "";
  useScreenScope("processes", t("Process discovery"), [
    { prompt: t("Which processes have the lowest fitness?"), answer: () => ({ text: [...rows].filter((r) => r.last_run?.fitness != null).sort((a, b) => a.last_run!.fitness! - b.last_run!.fitness!).slice(0, 3).map((r) => `${r.name} ${pct(r.last_run!.fitness)}`).join(", ") || t("None") }) },
  ]);
  const start = async () => {
    if (!cur) return;
    try { await startDiscovery(sys.id, [cur.l1], "full"); toast(t("Discovery started"), "good"); await qc.invalidateQueries({ queryKey: ["b7b"] }); }
    catch { toast(t("Discovery could not be started"), "bad"); }
  };
  return (
    <>
      <Head title={t("Process discovery")} actions={<Button variant="primary" disabled={!cur || !!cur.reason} onClick={() => void start()}>{t("Discover this process")}</Button>} />
      <Split leftLabel={t("Processes")} rightLabel={t("Run detail")}
        left={
          <>
            {sys.control}
            <Tabs idBase="pdl" label={t("Process lists")} value={tab} onChange={setTab} items={[{ id: "catalogue", label: t("Systems catalogue") }, { id: "runs", label: t("Runs") }, { id: "health", label: t("Health") }]} />
            <TabPanel idBase="pdl" value={tab} className="mx-col">
            {tab === "catalogue" ? (
              <Async q={cat}>
                {() => rows.length ? (
                  <DataTable<CatalogueEntry> label={t("Systems catalogue")} rows={rows} rowKey={(r) => r.l1} height={440} selected={cur?.l1} onSelect={(r) => { setL1(r.l1); setRun(""); }}
                    columns={[
                      { key: "n", label: t("Process"), sort: (r) => r.name, render: (r) => <Code code={r.l1} description={r.name} /> },
                      { key: "c", label: t("Cases"), align: "end", render: (r) => num(r.last_run?.cases) },
                      { key: "f", label: t("Fitness"), align: "end", sort: (r) => r.last_run?.fitness ?? -1, render: (r) => pct(r.last_run?.fitness) },
                      { key: "d", label: t("Data defects"), align: "end", render: (r) => num(r.dq_defects) },
                    ]} />
                ) : <Empty heading={t("No processes in this system")} />}
              </Async>
            ) : tab === "health" ? (
              <HealthCard systemId={sys.id} />
            ) : (
              <Async q={runs}>
                {() => runRows.length ? (
                  <DataTable<RunSummary> label={t("Runs")} rows={runRows} rowKey={(r) => r.id} height={440} selected={curRun} onSelect={(r) => setRun(r.id)}
                    columns={[
                      { key: "s", label: t("Started"), sort: (r) => r.started_at ?? "", render: (r) => when(r.started_at) },
                      { key: "m", label: t("Mode"), render: (r) => (r.mode === "full" ? t("Full") : t("Incremental")) },
                      { key: "st", label: t("Status"), render: (r) => runStatusText(r.status) },
                    ]} />
                ) : <Empty heading={t("No runs yet")} />}
              </Async>
            )}
            </TabPanel>
          </>
        }
        right={curRun ? <RunDetail key={curRun} runId={curRun} /> : <Empty heading={t("Pick a process with a run")} />} />
    </>
  );
}
