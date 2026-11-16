"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuditEntry, AuditListParams, LlmAuditEntry } from "@/lib/api/audit";
import * as api from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { apiErrorMessage } from "@/lib/error";
import { failureText } from "@/lib/v2/errors";
import { formatDate } from "@/lib/format";
import { auditSentence } from "@/lib/v2/audit-sentence";
import { useOpenItem } from "@/lib/v2/hooks";
import { useAudit, useAuditActors } from "@/lib/v2/admin-queries";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Mono } from "@/design/v2/parts";
import { Button, Chip, Code, DataTable, ErrorState, type Column } from "../kit";
import { DataBlock, DataLoaded, DataPage, Dash, Field, NeedsPermission, Pager, since, useCan } from "./data-parts";

const PAGE = 25;
const AI_PAGE = 10;

const auditColumns = (who: (e: AuditEntry) => string): Column<AuditEntry>[] => [
  { id: "when", label: t("When"), cell: (e) => <time dateTime={e.created_at}>{formatDate(e.created_at, "datetime")}</time>, compare: (a, b) => a.created_at.localeCompare(b.created_at) },
  { id: "who", label: t("Who"), cell: (e) => who(e) },
  { id: "what", label: t("What happened"), cell: (e) => auditSentence(e, who(e)) },
  { id: "action", label: t("Action"), cell: (e) => <Mono>{e.action}</Mono> },
  { id: "object", label: t("Target"), cell: (e) => (e.entity_id ? <Code code={e.entity_id} text={e.entity_type ? labelText(e.entity_type) : undefined} /> : <Dash />) },
  { id: "status", label: t("Result"), cell: (e) => (e.status_code >= 400 ? <Chip tone="bad">{t("Refused {status_code}", { status_code: e.status_code })}</Chip> : <Chip tone="good">{t("Done")}</Chip>) },
];

const aiColumns = (): Column<LlmAuditEntry>[] => [
  { id: "when", label: t("When"), cell: (e) => formatDate(e.called_at, "datetime") },
  { id: "service", label: t("Service"), cell: (e) => labelText(e.service_name) },
  { id: "model", label: t("Model"), cell: (e) => e.model_version ?? "—" },
  { id: "tokens", label: t("Tokens"), align: "end", cell: (e) => (e.token_count == null ? "—" : int(e.token_count)) },
  { id: "latency", label: t("Latency"), align: "end", cell: (e) => (e.latency_ms == null ? "—" : t("{latency_ms} ms", { latency_ms: int(e.latency_ms) })) },
  {
    id: "result",
    label: t("Result"),
    cell: (e) => (e.deterministic_hit ? <Chip tone="good">{t("Rule answered")}</Chip> : e.success ? <Chip tone="good">{t("Model answered")}</Chip> : <Chip tone="bad">{e.skip_reason ?? t("Failed")}</Chip>),
  },
];

/** Every call to the language model, ten to a page. */
function AiAudit() {
  const fixture = useFixture();
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["v2", "admin", fixture, "audit", "ai", page], queryFn: () => api.getAiAudit({ limit: AI_PAGE, offset: page * AI_PAGE }), staleTime: 15_000, retry: false });
  return (
    <DataBlock title={t("AI calls")} hint={t("Every call to the language model: which service, how long, and whether a deterministic rule answered first. Prompts and records are never stored here.")} testid="audit-ai">
      <DataLoaded q={q} what={t("The AI audit")} rows={3}>
        {(d) => (
          <>
            <DataTable<LlmAuditEntry>
              caption={t("AI calls")}
              rows={d.entries}
              rowKey={(e) => e.id}
              rowLabel={(e) => labelText(e.service_name)}
              columns={aiColumns()}
              empty={{ heading: t("No AI call has been made. The product answers from its rules first and calls a model only for wording.") }}
            />
            {d.entries.length ? <Pager offset={page * AI_PAGE} limit={AI_PAGE} total={d.total} onPage={(o) => setPage(o / AI_PAGE)} /> : null}
          </>
        )}
      </DataLoaded>
    </DataBlock>
  );
}

/** Admin › Audit log: a permanent record of who changed what, filterable and exportable. */
export function AuditSection() {
  const can = useCan();
  const { openItem } = useOpenItem();
  const allowed = can("view_audit") || can("manage_users");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [object, setObject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = useAuditActors(allowed);
  const filters: AuditListParams = useMemo(
    () => ({ actor_user_id: actor || undefined, action: action.trim() || undefined, entity_type: object || undefined, since: from || undefined, until: to || undefined }),
    [actor, action, object, from, to],
  );
  const q = useAudit({ ...filters, limit: PAGE, offset }, allowed);
  const fixture = useFixture();
  const summary = useQuery({ queryKey: ["v2", "admin", fixture, "audit", "summary"], queryFn: api.getAuditSummary, staleTime: 60_000, retry: false, enabled: allowed });
  const kinds = useMemo(() => [...new Set((summary.data?.summary ?? []).map((r) => r.entity_type).filter((x): x is string => !!x))].sort(), [summary.data]);
  const actors = useMemo(() => people.data?.actors ?? [], [people.data]);
  const columns = useMemo(() => auditColumns((e) => (e.actor_email ? (actors.find((u) => u.id === e.actor_user_id)?.name ?? e.actor_email) : t("The system"))), [actors]);
  if (!allowed) return <NeedsPermission what={t("Reading the audit log")} permission="view_audit" />;
  const filtered = Object.values(filters).some(Boolean);
  const badRange = !!from && !!to && to < from;
  const reset = (fn: () => void) => (fn(), setOffset(0));
  const exportAs = async (format: "csv" | "xlsx") => {
    setExporting(format);
    setError(null);
    try {
      await api.exportAudit(format, filters);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setExporting(null);
    }
  };
  const latest = q.data?.entries[0]?.created_at;
  return (
    <DataPage
      lead={t("{value}A permanent record of who changed what, every call to the language model, and every change to a user. Export it for an auditor.", { value: summary.data?.total != null ? t("{total} events recorded in the last 30 days. ", { total: int(summary.data.total) }) : "" })}
      actions={
        <>
          <Button disabled={exporting !== null || badRange} loading={exporting === "csv"} loadingLabel={t("Exporting…")} onClick={() => void exportAs("csv")} data-testid="audit-export-csv">
            {t("Export CSV")}
          </Button>
          <Button disabled={exporting !== null || badRange} loading={exporting === "xlsx"} loadingLabel={t("Exporting…")} onClick={() => void exportAs("xlsx")}>
            {t("Export Excel")}
          </Button>
        </>
      }
    >
      {error ? <ErrorState sentence={t("The export did not finish. {error}", { error })} onRetry={() => setError(null)} /> : null}
      <DataBlock>
        <div className="nx-data-form" role="search" aria-label={t("Filter the audit log")}>
          <Field label={t("Who")}>
            <select className="nx-input" value={actor} onChange={(e) => reset(() => setActor(e.target.value))} data-testid="audit-who">
              <option value="">{t("Anyone")}</option>
              {actors.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Action contains")}>
            <input className="nx-input" value={action} placeholder="user.invite" onChange={(e) => reset(() => setAction(e.target.value))} />
          </Field>
          <Field label={t("Object kind")}>
            <select className="nx-input" value={object} onChange={(e) => reset(() => setObject(e.target.value))}>
              <option value="">{t("Any")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {labelText(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("From")}>
            <input className="nx-input" type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </Field>
          <Field label={t("To")} error={badRange ? t("Ends before it starts") : null}>
            <input className="nx-input" type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} />
          </Field>
          {filtered ? (
            <div className="nx-data-actions">
              <Button variant="quiet" onClick={() => reset(() => (setActor(""), setAction(""), setObject(""), setFrom(""), setTo("")))}>
                {t("Clear filters")}
              </Button>
            </div>
          ) : null}
        </div>
        <DataTable<AuditEntry>
          caption={t("Audit log")}
          columns={columns}
          rows={q.data?.entries ?? []}
          rowKey={(e) => e.id}
          rowLabel={(e) => e.action}
          total={q.data?.total}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The audit log could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(q.error) }), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: filtered ? t("Nothing matches these filters. Widen the dates or pick someone else.") : t("No events recorded yet.") }}
          onOpenRow={(e) => openItem({ kind: "audit", id: e.id })}
        />
        {q.data ? <Pager offset={offset} limit={PAGE} total={q.data.total} onPage={setOffset} /> : null}
        {latest ? <p className="nx-sub">{t("Latest event {created_at}.", { created_at: since(latest) })}</p> : null}
      </DataBlock>
      <AiAudit />
    </DataPage>
  );
}
