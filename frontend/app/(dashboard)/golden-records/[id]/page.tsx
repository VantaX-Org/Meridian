"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChipTone } from "@/components/aurora";
import {
  Banner, Button, Chip, EmptyState, KeyValue, Mono, PageHeader, SectionCard, Tabs, TableSkeleton, Tally,
} from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { WhyMergedPanel } from "@/components/mdm/why-merged-panel";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord } from "@/lib/api/master-records";
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
const scroll = { overflowX: "auto" } as const;
const NONE = "None";

export default function GoldenRecordDetailPage() {
  const recordId = useParams<{ id: string }>().id;
  const qc = useQueryClient();
  const { can } = useRole();
  const [tab, setTab] = useUrlState("tab", "record");
  const [confirming, setConfirming] = useState(false);

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
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["master-record", recordId] });
      qc.invalidateQueries({ queryKey: ["master-record-history", recordId] });
      qc.invalidateQueries({ queryKey: ["master-records"] });
    },
    onError: () => toast.error("Could not promote to golden. Try again."),
  });

  if (isLoading) return <div className="ui-page"><TableSkeleton rows={6} label="Loading record" /></div>;
  if (!record) {
    return (
      <div className="ui-page">
        <EmptyState action={<Link className="ui-link" href="/golden-records">Open golden records</Link>}>This record no longer exists.</EmptyState>
      </div>
    );
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
  const self = `/golden-records/${recordId}`;
  const canPromote = record.status !== "golden" && record.status !== "superseded" && can("approve");
  const conf = pct(record.overall_confidence);

  return (
    <div className="ui-page">
      <PageCrumb segments={[
        { level: "portfolio", label: "Portfolio", href: "/" },
        { level: "object", label: "Golden records", href: "/golden-records" },
        { level: "record", label: `Record: ${record.sap_object_key}` },
      ]} />
      <Tally level={4} label="This golden record" figures={[
        { label: "Overall confidence", value: conf, unit: "%", tone: record.overall_confidence < 0.6 ? "danger" : record.overall_confidence < 0.85 ? "warning" : undefined,
          verdict: record.overall_confidence >= 0.85 ? "Sources agree on most fields." : "Sources disagree on some fields.", href: `${self}?tab=sources` },
        { label: "Open findings", value: issues.isLoading ? null : open.length, loading: issues.isLoading, tone: open.length ? "high" : undefined,
          verdict: open.length ? "Checks this record still fails." : "This record passes every check.", href: `${self}?tab=findings` },
        { label: "Source systems", value: bySource.size, verdict: bySource.size ? "Contribute fields to this record." : "No sources linked.", href: `${self}?tab=sources` },
        { label: "Suggested merges", value: suggested, tone: suggested ? "warning" : undefined,
          verdict: suggested ? "Fields where the AI prefers another source." : "No better source suggested.", href: `${self}?tab=record` },
      ]} />
      <PageHeader
        title={<Mono>{record.sap_object_key}</Mono>}
        summary={`${formatModuleName(record.domain)}. ${bySource.size} source system${bySource.size === 1 ? "" : "s"}${bySource.size ? ` (${Array.from(bySource.keys()).join(", ")})` : ""}, updated ${relativeTime(record.updated_at)}${record.promoted_at ? `, promoted ${relativeTime(record.promoted_at)}` : ""}.`}
        actions={
          <>
            <Chip tone={STATUS_TONE[record.status] ?? "neutral"}>{record.status.replace("_", " ")}</Chip>
            {canPromote ? <Button onClick={() => setConfirming(true)} disabled={promote.isPending}>Promote to golden</Button> : null}
          </>
        }
      />

      {confirming ? (
        <Banner tone="warning" title={`Promote ${record.sap_object_key} to golden?`}
          action={
            <div className="ui-page-header__actions">
              <Button size="sm" disabled={promote.isPending} onClick={() => promote.mutate()}>{promote.isPending ? "Promoting…" : "Promote record"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Not now</Button>
            </div>}>
          The record becomes the trusted version in Meridian. Nothing is written to SAP.
        </Banner>
      ) : null}

      <Tabs ariaLabel="Golden record sections" value={tab} onValueChange={setTab}
        items={[
          { id: "record", label: "Record", count: fields.length },
          { id: "sources", label: "Sources", count: bySource.size },
          { id: "findings", label: "Findings", count: issues.isLoading ? undefined : open.length },
          { id: "relationships", label: "Relationships", count: relationships.isLoading ? undefined : rels.length },
          { id: "merge", label: "Why merged" },
          { id: "history", label: "History", count: history.isLoading ? undefined : entries.length },
        ]} />

      {tab === "sources" ? (
        <SectionCard title="Source systems" meta={String(bySource.size)} flush={bySource.size > 0}>
          {bySource.size === 0 ? <p className="ui-note">No source system has contributed a field yet.</p> : (
            <div style={scroll}>
              <table className="ui-mini-table">
                <thead><tr><th>Source system</th><th>Fields won</th><th>Average confidence</th><th>Last extracted</th></tr></thead>
                <tbody>
                  {Array.from(bySource.entries()).map(([sys, cs]) => {
                    const avg = cs.reduce((s, c) => s + c.confidence, 0) / cs.length;
                    const last = cs.map((c) => c.extracted_at).sort().at(-1);
                    return (
                      <tr key={sys}>
                        <td>{sys}</td>
                        <td className="aurora-number">{cs.length}</td>
                        <td><Chip tone={confTone(avg)}><span className="aurora-number">{pct(avg)}%</span></Chip></td>
                        <td>{last ? relativeTime(last) : NONE}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : tab === "findings" ? (
        <SectionCard title="Open findings" meta={issues.isLoading ? undefined : String(open.length)} flush={open.length > 0}>
          {issues.isLoading ? <TableSkeleton rows={3} /> : open.length === 0 ? <p className="ui-note">No open findings on this record.</p> : (
            <div style={scroll}>
              <table className="ui-mini-table">
                <thead><tr><th>Severity</th><th>Check</th><th>Field</th><th>Record key</th><th>First seen</th></tr></thead>
                <tbody>
                  {open.map((i) => (
                    <tr key={i.id}>
                      <td><Chip tone={sevTone(i.severity)}>{i.severity}</Chip></td>
                      <td>
                        <Link className="ui-link" href={`/workbench/record/${i.id}`}><Mono>{i.check_id}</Mono></Link>
                        {i.message ? <div className="ui-micro">{i.message}</div> : null}
                      </td>
                      <td><Mono>{i.field ?? NONE}</Mono></td>
                      <td><Mono>{i.record_key}</Mono></td>
                      <td>{relativeTime(i.first_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : tab === "relationships" ? (
        <SectionCard title="Relationships" meta={relationships.isLoading ? undefined : String(rels.length)} flush={rels.length > 0}>
          {relationships.isLoading ? <TableSkeleton rows={3} /> : rels.length === 0 ? <p className="ui-note">No cross-domain relationships found.</p> : (
            <div style={scroll}>
              <table className="ui-mini-table">
                <thead><tr><th>Related record</th><th>Relationship</th><th>Impact</th><th>Basis</th></tr></thead>
                <tbody>
                  {rels.map((r) => {
                    const isFrom = r.from_domain === record.domain && r.from_key === record.sap_object_key;
                    const [d, k] = isFrom ? [r.to_domain, r.to_key] : [r.from_domain, r.from_key];
                    return (
                      <tr key={r.id}>
                        <td><Link className="ui-link" href={`/golden-records?domain=${d}`}>{formatModuleName(d)}, {k}</Link></td>
                        <td>{r.relationship_type.replace(/_/g, " ")}{r.sap_link_table ? `, via ${r.sap_link_table}` : ""}</td>
                        <td className="aurora-number">{r.impact_score != null ? `${pct(r.impact_score)}%` : NONE}</td>
                        <td>
                          {r.ai_inferred
                            ? <Chip tone="warning">Probable{r.ai_confidence != null ? `, ${pct(r.ai_confidence)}%` : ""}</Chip>
                            : <Chip tone="success">SAP link</Chip>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : tab === "merge" ? (
        <WhyMergedPanel recordId={recordId} />
      ) : tab === "history" ? (
        <SectionCard title="History" meta={history.isLoading ? undefined : String(entries.length)} flush={entries.length > 0}>
          {history.isLoading ? <TableSkeleton rows={3} /> : entries.length === 0 ? <p className="ui-note">No history entries.</p> : (
            <div style={scroll}>
              <table className="ui-mini-table">
                <thead><tr><th>When</th><th>Change</th><th>By</th><th>Suggestion</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{relativeTime(e.changed_at)}</td>
                      <td>{CHANGE_LABEL[e.change_type] ?? e.change_type}</td>
                      <td>{e.changed_by ?? "system"}</td>
                      <td>
                        {e.ai_recommendation_accepted != null
                          ? <Chip tone={e.ai_recommendation_accepted ? "success" : "danger"}>{e.ai_recommendation_accepted ? "accepted" : "rejected"}</Chip>
                          : e.ai_was_involved ? "involved" : NONE}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <div className="ui-stack">
          <SectionCard title="Survivorship" meta={`${fields.length} fields`} flush={fields.length > 0}>
            {fields.length === 0 ? <p className="ui-note">No fields yet.</p> : (
              <div style={scroll}>
                <table className="ui-mini-table">
                  <thead><tr><th>Field</th><th>Golden value</th><th>Survived from</th><th>Confidence</th><th>Suggestion</th></tr></thead>
                  <tbody>
                    {fields.map((f) => {
                      const c = contributions[f];
                      const name = glossary?.lookup?.[f]?.business_name;
                      return (
                        <tr key={f}>
                          <td>
                            {name ?? f}
                            {name ? <div className="ui-micro"><Mono>{f}</Mono></div> : null}
                          </td>
                          <td><Mono>{String(record.golden_fields[f] ?? NONE)}</Mono></td>
                          <td>{c ? `${c.source_system}, ${relativeTime(c.extracted_at)}` : "No source"}</td>
                          <td>{c ? <Chip tone={confTone(c.confidence)}><span className="aurora-number">{pct(c.confidence)}%</span></Chip> : NONE}</td>
                          <td>
                            {c?.ai_recommendation ? (
                              <span title={c.ai_reasoning ?? undefined}>
                                Use {c.ai_recommendation}
                                {c.ai_confidence != null ? <span className="aurora-number"> ({pct(c.ai_confidence)}%)</span> : null}
                              </span>
                            ) : NONE}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          <SectionCard title="Record">
            <KeyValue rows={[
              { k: "Object", v: formatModuleName(record.domain) },
              { k: "Record key", v: record.sap_object_key, mono: true },
              { k: "Status", v: record.status.replace("_", " ") },
              { k: "Updated", v: relativeTime(record.updated_at) },
              { k: "Promoted", v: record.promoted_at ? relativeTime(record.promoted_at) : "Never" },
            ]} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}
