"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Chip, EmptyState, Stat, type ChipTone } from "@/components/aurora";
import { Record360, Record360Loading, Record360Table, td } from "@/components/meridian/record-360";
import { useRole } from "@/hooks/use-role";
import {
  getMasterRecord,
  getMasterRecordHistory,
  promoteMasterRecord,
  writebackMasterRecord,
} from "@/lib/api/master-records";
import { batchLookupGlossary } from "@/lib/api/glossary";
import { getIssues } from "@/lib/api/issues";
import { getRelationships } from "@/lib/api/relationships";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { MasterRecordStatus, SourceContribution } from "@/types/api";

const STATUS_TONE: Record<MasterRecordStatus, ChipTone> = {
  candidate: "info", pending_review: "warning", golden: "success", superseded: "neutral",
};
const CHANGE_LABEL: Record<string, string> = {
  created: "Record created", updated: "Fields updated", promoted: "Promoted to golden",
};
const pct = (n: number) => Math.round(n * 100);
const confTone = (n: number): ChipTone => (n >= 0.85 ? "success" : n >= 0.6 ? "warning" : "danger");
const sevTone = (s: string): ChipTone => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warning" : "neutral");

export default function GoldenRecordDetailPage() {
  const recordId = useParams<{ id: string }>().id;
  const qc = useQueryClient();
  const { can } = useRole();

  const { data: record, isLoading } = useQuery({
    queryKey: ["master-record", recordId],
    queryFn: () => getMasterRecord(recordId),
  });
  const fieldKeys = record ? Object.keys(record.golden_fields) : [];
  const { data: glossary } = useQuery({
    queryKey: ["glossary-lookup", fieldKeys],
    queryFn: () => batchLookupGlossary(fieldKeys),
    enabled: fieldKeys.length > 0,
    staleTime: 5 * 60_000,
  });
  const history = useQuery({
    queryKey: ["master-record-history", recordId],
    queryFn: () => getMasterRecordHistory(recordId),
  });
  const relationships = useQuery({
    queryKey: ["relationships", record?.domain, record?.sap_object_key],
    queryFn: () => getRelationships({ domain: record!.domain, key: record!.sap_object_key }),
    enabled: !!record,
  });
  // record issues are keyed "FIELD=value|…"; the object key is a substring of its own issues' keys
  const issues = useQuery({
    queryKey: ["issues", "record", record?.domain, record?.sap_object_key],
    queryFn: () => getIssues({ module: record!.domain, search: record!.sap_object_key, limit: 100 }),
    enabled: !!record,
  });

  const promote = useMutation({
    mutationFn: () => promoteMasterRecord(recordId, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["master-record", recordId] });
      qc.invalidateQueries({ queryKey: ["master-record-history", recordId] });
      qc.invalidateQueries({ queryKey: ["master-records"] });
    },
    onError: () => toast.error("Could not promote to golden — please try again"),
  });
  const writeback = useMutation({
    mutationFn: () => writebackMasterRecord(recordId),
    onError: () => toast.error("Could not check write-back status — please try again"),
  });

  if (isLoading) return <Record360Loading what="record" />;
  if (!record) {
    return <EmptyState title="Record not found" actions={<Link className="aurora-link" href="/golden-records">Back to golden records</Link>} />;
  }

  const contributions: Record<string, SourceContribution> = record.source_contributions ?? {};
  const fields = Object.keys(record.golden_fields);
  const contributed = Object.values(contributions).filter((c): c is SourceContribution => !!c && typeof c === "object" && "source_system" in c);
  const bySource = new Map<string, SourceContribution[]>();
  for (const c of contributed) bySource.set(c.source_system, [...(bySource.get(c.source_system) ?? []), c]);
  const suggested = fields.filter((f) => contributions[f]?.ai_recommendation).length;
  const open = (issues.data?.items ?? []).filter((i) => i.status === "open" || i.status === "in_progress");
  const rels = relationships.data?.relationships ?? [];
  const entries = history.data ?? [];

  return (
    <Record360
      backHref="/golden-records"
      backLabel="Golden records"
      eyebrow={`GOLDEN RECORD · ${formatModuleName(record.domain).toUpperCase()}`}
      title={<span className="aurora-number">{record.sap_object_key}</span>}
      support={`${bySource.size} source system${bySource.size === 1 ? "" : "s"}${bySource.size ? `: ${Array.from(bySource.keys()).join(", ")}` : ""} · updated ${relativeTime(record.updated_at)}${record.promoted_at ? ` · promoted ${relativeTime(record.promoted_at)}` : ""}`}
      chips={<Chip tone={STATUS_TONE[record.status] ?? "neutral"}>{record.status.replace("_", " ")}</Chip>}
      actions={
        <>
          <Link className="aurora-link" href={`/golden-records/${recordId}/merge`}>Why merged</Link>
          {record.status !== "golden" && record.status !== "superseded" && can("approve") ? (
            <Button onClick={() => promote.mutate()} disabled={promote.isPending}>
              {promote.isPending ? "Promoting…" : "Promote to golden"}
            </Button>
          ) : null}
          {record.status === "golden" && can("apply") ? (
            <Button variant="secondary" onClick={() => writeback.mutate()} disabled={writeback.isPending}>
              {writeback.isPending ? "Checking…" : "Write back to SAP"}
            </Button>
          ) : null}
        </>
      }
      notice={
        // Not a write: SAP write-back is finding-driven via the 4-eyes flow; route the steward there.
        writeback.isSuccess && writeback.data ? (
          <Banner tone="warning" action={<Link className="aurora-link" href="/findings">Open findings</Link>}>
            {writeback.data.message}
          </Banner>
        ) : null
      }
      kpis={
        <>
          <Stat label="Overall confidence" value={pct(record.overall_confidence)} unit="%" tone={confTone(record.overall_confidence)} />
          <Stat label="Fields" value={fields.length} />
          <Stat label="Sources" value={bySource.size} />
          <Stat label="Open findings" value={issues.isLoading ? "…" : open.length} tone={open.length ? "danger" : "success"} />
          <Stat label="Suggested merges" value={suggested} tone={suggested ? "warning" : "neutral"} />
        </>
      }
      sources={{
        count: bySource.size,
        empty: "No source system has contributed a field yet.",
        body: (
          <Record360Table head={["Source system", "Fields won", "Avg confidence", "Last extracted"]}>
            {Array.from(bySource.entries()).map(([sys, cs]) => {
              const avg = cs.reduce((s, c) => s + c.confidence, 0) / cs.length;
              const last = cs.map((c) => c.extracted_at).sort().at(-1);
              return (
                <tr key={sys}>
                  <td className={td}>{sys}</td>
                  <td className={`${td} aurora-number`}>{cs.length}</td>
                  <td className={td}><Chip tone={confTone(avg)}><span className="aurora-number">{pct(avg)}%</span></Chip></td>
                  <td className={td}>{last ? relativeTime(last) : "—"}</td>
                </tr>
              );
            })}
          </Record360Table>
        ),
      }}
      survivorship={{
        count: fields.length,
        empty: "No fields yet.",
        body: (
          <Record360Table head={["Field", "Golden value", "Survived from", "Confidence", "Suggestion"]}>
            {fields.map((f) => {
              const c = contributions[f];
              const name = glossary?.lookup?.[f]?.business_name;
              return (
                <tr key={f}>
                  <td className={td}>
                    {name ?? f}
                    {name ? <div className="font-mono text-[11px] text-[var(--aurora-fg-tertiary)]">{f}</div> : null}
                  </td>
                  <td className={`${td} font-mono`}>{String(record.golden_fields[f] ?? "—")}</td>
                  <td className={td}>{c ? `${c.source_system} · ${relativeTime(c.extracted_at)}` : "No source"}</td>
                  <td className={td}>{c ? <Chip tone={confTone(c.confidence)}><span className="aurora-number">{pct(c.confidence)}%</span></Chip> : "—"}</td>
                  <td className={td}>
                    {c?.ai_recommendation ? (
                      <span title={c.ai_reasoning ?? undefined}>
                        Use {c.ai_recommendation}
                        {c.ai_confidence != null ? <span className="aurora-number"> ({pct(c.ai_confidence)}%)</span> : null}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </Record360Table>
        ),
      }}
      findings={{
        count: open.length,
        loading: issues.isLoading,
        empty: "No open findings on this record.",
        body: (
          <Record360Table head={["Severity", "Check", "Field", "Record key", "First seen"]}>
            {open.map((i) => (
              <tr key={i.id}>
                <td className={td}><Chip tone={sevTone(i.severity)}>{i.severity}</Chip></td>
                <td className={td}>
                  <Link className="aurora-link font-mono" href={`/workbench/report?issue=${i.id}`}>{i.check_id}</Link>
                  {i.message ? <div className="text-[var(--aurora-fg-tertiary)]">{i.message}</div> : null}
                </td>
                <td className={`${td} font-mono`}>{i.field ?? "—"}</td>
                <td className={`${td} font-mono`}>{i.record_key}</td>
                <td className={td}>{relativeTime(i.first_seen_at)}</td>
              </tr>
            ))}
          </Record360Table>
        ),
      }}
      extra={[{
        id: "relationships",
        label: "Relationships",
        count: relationships.isLoading ? undefined : rels.length,
        body: rels.length === 0 ? (
          <EmptyState title={relationships.isLoading ? "Loading…" : "No cross-domain relationships found."} />
        ) : (
          <Record360Table head={["Related record", "Relationship", "Impact", "Basis"]}>
            {rels.map((r) => {
              const isFrom = r.from_domain === record.domain && r.from_key === record.sap_object_key;
              const [d, k] = isFrom ? [r.to_domain, r.to_key] : [r.from_domain, r.from_key];
              return (
                <tr key={r.id}>
                  <td className={td}>
                    <Link className="aurora-link" href={`/golden-records?domain=${d}`}>{formatModuleName(d)} / {k}</Link>
                  </td>
                  <td className={td}>{r.relationship_type.replace(/_/g, " ")}{r.sap_link_table ? ` · via ${r.sap_link_table}` : ""}</td>
                  <td className={`${td} aurora-number`}>{r.impact_score != null ? `${pct(r.impact_score)}%` : "—"}</td>
                  <td className={td}>
                    {r.ai_inferred ? (
                      <Chip tone="warning">Probable{r.ai_confidence != null ? ` · ${pct(r.ai_confidence)}%` : ""}</Chip>
                    ) : <Chip tone="success">SAP link</Chip>}
                  </td>
                </tr>
              );
            })}
          </Record360Table>
        ),
      }]}
      history={{
        count: entries.length,
        loading: history.isLoading,
        empty: "No history entries.",
        body: (
          <Record360Table head={["When", "Change", "By", "Suggestion"]}>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className={td}>{relativeTime(e.changed_at)}</td>
                <td className={td}>{CHANGE_LABEL[e.change_type] ?? e.change_type}</td>
                <td className={td}>{e.changed_by ?? "system"}</td>
                <td className={td}>
                  {e.ai_recommendation_accepted != null ? (
                    <Chip tone={e.ai_recommendation_accepted ? "success" : "danger"}>
                      {e.ai_recommendation_accepted ? "accepted" : "rejected"}
                    </Chip>
                  ) : e.ai_was_involved ? "involved" : "—"}
                </td>
              </tr>
            ))}
          </Record360Table>
        ),
      }}
    />
  );
}
