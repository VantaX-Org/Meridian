"use client";

/** F2 checks by view, and F5 the fix path: failing rules grouped by SAP level, closed in bulk once fixed in SAP. */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog } from "@/components/aurora";
import { Button, EmptyState, FieldChip, Mono, SectionCard, StatusBadge, type Status } from "@/components/ui-core";
import { updateIssues } from "@/lib/api/issues";
import type { FailingRule, MaterialFindings } from "@/lib/api/materials";
import { labelOf } from "@/lib/format";
import { levelLabel, sumRuleCounts } from "@/lib/material-views";

const SEV = new Set(["critical", "high", "medium", "low"]);
const GROUPS: ReadonlyArray<{ kind: string; title: string }> = [
  { kind: "client", title: "Client" }, { kind: "plant", title: "Plant" },
  { kind: "sales", title: "Sales organisation" }, { kind: "valuation", title: "Valuation area" },
];
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
const kindOf = (level: string) => level.split(":")[0];

function Field({ field }: { field: string | null }) {
  if (!field) return <>—</>;
  const [t, f] = field.split(".");
  return <FieldChip table={f ? t : undefined} field={f ?? t} />;
}

export function MaterialRules({ f }: { f: MaterialFindings }) {
  const sums = sumRuleCounts(f.by_view);
  return (
    <SectionCard title="Checks by view" meta={`${sums.failing} failing, ${sums.passing} passing, ${sums.notEvaluated} not evaluated of ${sums.total} rules`}>
      <div className="ui-matrix-scroll">
        <table className="ui-mini-table" aria-label="Checks by view">
          <thead><tr><th>View</th><th>Failing</th><th>Passing</th><th>Not evaluated</th></tr></thead>
          <tbody>
            {f.by_view.map((v) => (
              <tr key={v.view}>
                <td>{v.label}</td>
                <td>{v.failing.length}</td><td>{v.passing_count}</td>
                <td title="Rules whose table is not in this extract">{v.not_evaluated.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f.by_view.filter((v) => v.failing.length).map((v) => (
        <div key={v.view}>
          <h3 className="ui-section__title">{v.label}</h3>
          <table className="ui-mini-table" aria-label={`${v.label} failing rules`}>
            <thead><tr><th>Rule</th><th>Severity</th><th>Field</th><th>Level</th><th>Finding</th></tr></thead>
            <tbody>
              {v.failing.map((r) => (
                <tr key={`${r.check_id}${r.record_key}`}>
                  <td><Link className="ui-link" href={`/analyse/rule/${r.check_id}`}><Mono>{r.check_id}</Mono></Link></td>
                  <td><StatusBadge status={(SEV.has(r.severity) ? r.severity : "low") as Status}>{labelOf(r.severity)}</StatusBadge></td>
                  <td><Field field={r.field} /></td>
                  <td>{levelLabel(r.level)}</td>
                  <td>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </SectionCard>
  );
}

export function MaterialFixPath({ f }: { f: MaterialFindings }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ title: string; rules: FailingRule[] } | null>(null);
  const all = f.by_view.flatMap((v) => v.failing);
  const close = useMutation({
    mutationFn: (ids: string[]) => updateIssues({ ids, status: "resolved", resolution: "fixed_in_source" }),
    onSuccess: (r) => {
      toast.success(`${plural(r.updated, "record")} closed`);
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["material"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
    },
    onError: (e) => toast.error((e as Error).message || "The update was refused"),
  });
  const open = (rs: FailingRule[]) => rs.filter((r) => r.issue_id && r.issue_status !== "resolved");

  return (
    <SectionCard title="Fix path" meta={all.length ? `${plural(all.length, "failing record")}` : undefined}>
      {all.length === 0 ? <EmptyState>Nothing to fix. Every evaluated rule passes for this material.</EmptyState> : (
        <>
          {GROUPS.map((g) => {
            const rs = all.filter((r) => kindOf(r.level) === g.kind);
            if (rs.length === 0) return null;
            const ids = open(rs);
            return (
              <div key={g.kind}>
                <h3 className="ui-section__title">{g.title}</h3>
                <table className="ui-mini-table" aria-label={`${g.title} fixes`}>
                  <thead><tr><th>Rule</th><th>Level</th><th>Field</th><th>Fix in SAP</th></tr></thead>
                  <tbody>
                    {rs.map((r) => (
                      <tr key={`${r.check_id}${r.record_key}`}>
                        <td><Link className="ui-link" href={`/analyse/rule/${r.check_id}`}><Mono>{r.check_id}</Mono></Link></td>
                        <td>{levelLabel(r.level)}</td><td><Field field={r.field} /></td><td>{r.record_fix ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button variant="secondary" size="sm" disabled={ids.length === 0}
                  onClick={() => setConfirm({ title: g.title, rules: ids })}>Fixed in SAP</Button>
              </div>
            );
          })}
          <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Mark as fixed in SAP?"
            description={confirm ? `This closes ${plural(confirm.rules.length, "record")} for ${confirm.title.toLowerCase()}. The next run reopens any that still fail.` : undefined}
            footer={(
              <>
                <Button variant="ghost" onClick={() => setConfirm(null)}>Keep open</Button>
                <Button disabled={close.isPending} onClick={() => confirm && close.mutate(confirm.rules.map((r) => r.issue_id as string))}>
                  Close {confirm ? plural(confirm.rules.length, "record") : ""}
                </Button>
              </>
            )} />
        </>
      )}
    </SectionCard>
  );
}
