"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activateDefinition, decideTask, dryRun, getFacts, getWorkflowInstance, listDefinitions, listTasks, type TaskRow, type WorkflowDefinition } from "@/lib/api/v2/requests";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, DetailPanel, Field, Input, Split, Tabs, useToast } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, when } from "../mdm/catalogue/shared";
import { objectText } from "./RequestsScreen";

function DefinitionDetail({ def }: { def: WorkflowDefinition }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("steps");
  const sim = useRead(["wf", "dry", def.id], () => dryRun(def.definition, def.object_kind, {}), tab === "steps");
  const facts = useRead(["wf", "facts"], getFacts, tab === "facts");
  const activate = async () => { try { await activateDefinition(def.id); toast(t("Version activated"), "good"); await qc.invalidateQueries({ queryKey: ["b7b"] }); } catch { toast(t("The version could not be activated"), "bad"); } };
  return (
    <DetailPanel idBase="wfd" label={t("Workflow detail")} tabsLabel={t("Workflow views")}
      header={<><Code code={def.key} description={def.name} />{def.active ? null : <Button variant="primary" onClick={() => void activate()}>{t("Activate this version")}</Button>}</>}
      tabs={[{ id: "steps", label: t("Steps") }, { id: "facts", label: t("Facts and rules") }]} value={tab} onChange={setTab}>
      {tab === "steps" ? (
        <Async q={sim}>
          {(d) => (
            <>
              {d.problems.length ? <p className="mx-muted">{d.problems.join(", ")}</p> : null}
              <DataTable label={t("Steps")} rows={d.steps} rowKey={(s) => String(s.index)} height={300}
                columns={[
                  { key: "n", label: t("Step"), render: (s) => s.name },
                  { key: "a", label: t("Applies"), render: (s) => (s.applies ? t("Yes") : `${t("No")}${s.reason ? `, ${s.reason}` : ""}`) },
                  { key: "q", label: t("Approvals needed"), render: (s) => s.quorum },
                  { key: "s", label: t("SLA hours"), align: "end", render: (s) => num(s.sla_hours) },
                  { key: "as", label: t("Assignees"), render: (s) => s.assignees.map((a) => a.name).join(", ") || s.assignee_note || t("n/a") },
                ]} />
            </>
          )}
        </Async>
      ) : (
        <Async q={facts}>
          {(d) => (
            <Card title={t("What a step can test")}>
              <DataTable label={t("Facts")} rows={Object.keys(d.facts).map((k) => ({ k }))} rowKey={(r) => r.k} height={260}
                columns={[{ key: "k", label: t("Fact"), render: (r) => <Code code={r.k} /> }, { key: "o", label: t("Operators"), render: () => d.ops.join(", ") }]} />
            </Card>
          )}
        </Async>
      )}
    </DetailPanel>
  );
}

function InstanceLookup() {
  const [id, setId] = useState("");
  const [go, setGo] = useState("");
  const q = useRead(["wf", "inst", go], () => getWorkflowInstance(go), !!go);
  return (
    <>
      <Field label={t("Instance id")}><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="WI-1001" /></Field>
      <Button variant="secondary" disabled={!id} onClick={() => setGo(id)}>{t("Open instance")}</Button>
      {go ? (
        <Async q={q}>
          {(d) => (
            <Card title={`${d.definition_key} v${d.definition_version}`} sub={d.status}>
              <DataTable label={t("Instance tasks")} rows={d.tasks} rowKey={(x) => x.id} height={200}
                columns={[
                  { key: "s", label: t("Step"), render: (x) => x.step_name },
                  { key: "st", label: t("Status"), render: (x) => x.status },
                  { key: "b", label: t("Decided by"), render: (x) => x.decided_by_label ?? t("n/a") },
                  { key: "w", label: t("When"), render: (x) => when(x.decided_at) },
                ]} />
              <DataTable label={t("Instance history")} rows={d.history} rowKey={(h) => h.id} height={200}
                columns={[
                  { key: "a", label: t("Action"), render: (h) => h.action },
                  { key: "w", label: t("When"), render: (h) => when(h.created_at) },
                  { key: "u", label: t("By"), render: (h) => h.actor_label ?? t("n/a") },
                ]} />
            </Card>
          )}
        </Async>
      ) : null}
    </>
  );
}

export function WorkflowsScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("definitions");
  const [pick, setPick] = useState("");
  const defs = useRead(["wf", "defs"], listDefinitions);
  const tasks = useRead(["wf", "tasks"], () => listTasks(""), tab === "tasks");
  const list = defs.data?.items ?? [];
  const cur = list.find((d) => d.id === pick) ?? list[0];
  useScreenScope("workflows", t("Workflows"), [
    { prompt: t("Which workflows are active?"), answer: () => ({ text: list.filter((d) => d.active).map((d) => `${d.name} v${d.version}`).join(", ") || t("None") }) },
  ]);
  const decide = async (id: string, decision: "approve" | "reject") => {
    try { await decideTask(id, decision); toast(t("Decision saved"), "good"); await qc.invalidateQueries({ queryKey: ["b7b"] }); } catch { toast(t("The decision could not be saved"), "bad"); }
  };
  return (
    <>
      <Head title={t("Workflows")} actions={<Button variant="secondary" href="/requests">{t("Back to requests")}</Button>} />
      <Tabs idBase="wf" label={t("Workflow lists")} value={tab} onChange={setTab} items={[{ id: "definitions", label: t("Definitions") }, { id: "tasks", label: t("My tasks") }, { id: "instances", label: t("Instances") }]} />
      {tab === "definitions" ? (
        <Split leftLabel={t("Definitions")} rightLabel={t("Workflow detail")}
          left={
            <Async q={defs}>
              {() => list.length ? (
                <DataTable<WorkflowDefinition> label={t("Definitions")} rows={list} rowKey={(d) => d.id} height={420} selected={cur?.id} onSelect={(d) => setPick(d.id)}
                  columns={[
                    { key: "n", label: t("Workflow"), sort: (d) => d.name, render: (d) => <Code code={d.key} description={d.name} /> },
                    { key: "o", label: t("Object"), render: (d) => objectText(d.object_kind) },
                    { key: "v", label: t("Version"), align: "end", render: (d) => `v${d.version}` },
                    { key: "a", label: t("Status"), render: (d) => (d.active ? t("Active") : t("Inactive")) },
                  ]} />
              ) : <Empty heading={t("No workflows defined")} />}
            </Async>
          }
          right={cur ? <DefinitionDetail key={cur.id} def={cur} /> : <Empty heading={t("Pick a workflow")} />} />
      ) : null}
      {tab === "tasks" ? (
        <Async q={tasks}>
          {(d) => d.items.length ? (
            <DataTable<TaskRow> label={t("My tasks")} rows={d.items} rowKey={(x) => x.id} height={420}
              columns={[
                { key: "r", label: t("Request"), render: (x) => <Code code={x.object_id} description={x.title ?? undefined} /> },
                { key: "s", label: t("Step"), render: (x) => x.step_name },
                { key: "u", label: t("Requester"), render: (x) => x.requester_label ?? t("n/a") },
                { key: "d", label: t("Due"), sort: (x) => x.due_at ?? "", render: (x) => when(x.due_at) },
                { key: "x", label: t("Decide"), render: (x) => x.may_decide ? (
                  <><Button variant="primary" onClick={() => void decide(x.id, "approve")}>{t("Approve")}</Button><Button variant="secondary" onClick={() => void decide(x.id, "reject")}>{t("Reject")}</Button></>
                ) : t("n/a") },
              ]} />
          ) : <Empty heading={t("No tasks waiting for you")} />}
        </Async>
      ) : null}
      {tab === "instances" ? <InstanceLookup /> : null}
    </>
  );
}
