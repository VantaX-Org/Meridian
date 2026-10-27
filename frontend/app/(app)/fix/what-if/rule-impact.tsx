"use client";

/** Fix › What-if: what each rule did in the simulation (per-rule table, per-record drawer) and the fix batch it can become. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, DataTable, Dialog, Drawer, DrillLink, EmptyState, Field, Input, Mono, Pill, Stat, buildDrillHref, type PillTone } from "@/design";
import { createBatchFromSimulation, errorText } from "@/lib/api/remediation";
import type { RuleChange, RuleDelta, SimulatedRecordFix, SimulationCompleted } from "@/lib/api/simulation";
import { formatModuleName } from "@/lib/format";
import { RuleCell } from "@/components/fix/rule-cell";

const CHANGE_TONE: Record<RuleChange, PillTone> = {
  resolved: "go", improved: "go", newly_evaluated: "neutral", unchanged: "neutral", not_evaluated: "neutral",
  regressed: "no-go", newly_failing: "no-go",
};
const CHANGE_LABEL: Record<RuleChange, string> = {
  resolved: "Resolved", improved: "Improved", regressed: "Regressed", newly_failing: "Introduced",
  unchanged: "Unchanged", newly_evaluated: "Newly checked", not_evaluated: "Not checked",
};
const n = (v: number) => v.toLocaleString();
const failing = (c: RuleDelta["before"]) => (c ? n(c.failing) : "—");

function RuleTable({ title, rules, onOpen, versionId, name }: {
  title: string; rules: RuleDelta[]; onOpen: (r: RuleDelta) => void; versionId: string; name: string;
}) {
  const columns = useMemo<ColumnDef<RuleDelta>[]>(() => [
    { id: "rule", header: "Rule", cell: ({ row }) => <RuleCell id={row.original.check_id} /> },
    { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "status", header: "Result", cell: ({ row }) => <Pill tone={CHANGE_TONE[row.original.status]}>{CHANGE_LABEL[row.original.status]}</Pill> },
    { id: "before", header: "Failing before", cell: ({ row }) => failing(row.original.before), meta: { numeric: true } },
    { id: "after", header: "Failing after", cell: ({ row }) => failing(row.original.after), meta: { numeric: true } },
    {
      id: "resolved", header: "Records resolved", meta: { numeric: true },
      cell: ({ row }) => <DrillLink object={row.original.module} ruleId={row.original.check_id} run={versionId}>{n(row.original.records_resolved)}</DrillLink>,
    },
    {
      id: "introduced", header: "Records introduced", meta: { numeric: true },
      cell: ({ row }) => <DrillLink object={row.original.module} ruleId={row.original.check_id} run={versionId}>{n(row.original.records_introduced)}</DrillLink>,
    },
  ], [versionId]);
  return (
    <Card title={title} meta={`${n(rules.length)} rule${rules.length === 1 ? "" : "s"}`}>
      {rules.length === 0 ? (
        <EmptyState variant="inline" title="None" />
      ) : (
        <DataTable columns={columns} data={rules} getRowId={(r) => `${r.module}/${r.check_id}`} onRowClick={onOpen} height={320} tableId={name} exportName={name} />
      )}
    </Card>
  );
}

function RecordDrawer({ rule, result, onClose }: { rule: RuleDelta | null; result: SimulationCompleted; onClose: () => void }) {
  const fixes = useMemo(() => (rule ? (result.record_fixes ?? []).filter((f) => f.check_id === rule.check_id) : []), [rule, result.record_fixes]);
  const columns = useMemo<ColumnDef<SimulatedRecordFix>[]>(() => [
    {
      id: "key", header: "Record",
      cell: ({ row }) => (
        <DrillLink href={`/objects/${row.original.module}/records/${encodeURIComponent(row.original.record_key)}?run=${result.version_id}`}>
          <Mono>{row.original.record_key}</Mono>
        </DrillLink>
      ),
    },
    { id: "current", header: "Current value", cell: ({ row }) => <Mono>{row.original.current_value || "(blank)"}</Mono> },
    { id: "new", header: "Simulated value", cell: ({ row }) => <Mono>{row.original.new_value}</Mono> },
  ], [result.version_id]);
  return (
    <Drawer
      open={rule !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={rule ? `${rule.check_id} in this simulation` : "Rule"}
      subtitle={rule ? <Mono>{rule.field}</Mono> : undefined}
    >
      {rule ? (
        <div className="flex flex-col gap-4">
          <div className="m-stat-grid">
            <Stat label="Failing before" value={failing(rule.before)} href={buildDrillHref({ object: rule.module, ruleId: rule.check_id, run: result.version_id })} />
            <Stat label="Failing after" value={failing(rule.after)} />
            <Stat label="Records resolved" value={n(rule.records_resolved)} />
            <Stat label="Records introduced" value={n(rule.records_introduced)} />
          </div>
          {fixes.length > 0 ? (
            <DataTable columns={columns} data={fixes} getRowId={(f) => `${f.field}/${f.record_key}`} hideToolbar height={360} tableId="what-if-record-fixes" />
          ) : (
            <EmptyState variant="inline" title="No record fixes proposed" detail="This rule changed counts without a proposed value" />
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

export function RuleImpact({ result }: { result: SimulationCompleted }) {
  const [open, setOpen] = useState<RuleDelta | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <RuleTable title="Rules changed by the fixes" rules={result.rules} onOpen={setOpen} versionId={result.version_id} name="what-if-rules" />
      <RuleTable title="Side effects" rules={result.side_effects} onOpen={setOpen} versionId={result.version_id} name="what-if-side-effects" />
      <RecordDrawer rule={open} result={result} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Turns a finished simulation's record fixes into a draft batch, then opens it. */
export function CreateBatchFromSimulation({ simulation }: { simulation: SimulationCompleted }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`What-if fixes ${new Date().toISOString().slice(0, 10)}`);
  const create = useMutation({
    mutationFn: () => createBatchFromSimulation(name.trim(), simulation.simulation_id),
    onSuccess: (b) => {
      toast.success(`Fix batch created with ${n(b.items)} record${b.items === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["remediation"] });
      setOpen(false);
      // A remediation batch opens in the Batches tab drawer; /fix/[batchId] reads cleaning_queue.batch_id, a different id.
      router.push(`/fix?tab=batches&batch=${b.id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!simulation.record_fixes?.length}>Create fix batch from this simulation</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Create fix batch"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={create.isPending}>Not now</Button>
            <Button onClick={() => create.mutate()} pending={create.isPending} disabled={!name.trim()}>Create fix batch</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>The batch starts as a draft holding the record fixes this simulation applied. Nothing is written to SAP until it is approved and applied.</p>
          <Field label="Batch name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
      </Dialog>
    </>
  );
}

