"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { ATTENTION_LIMIT, getAttention, type AttentionItem } from "@/lib/api/v2/attention";
import { formatDate } from "@/lib/format";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Chip, DataTable, EmptyState, PartBar, StatCard, type Column } from "../kit";
import { KeepLink } from "../more/states";
import "./queue.css";

/**
 * Action centre, native: everything that needs the viewer, ranked by the backend (api/routes/attention.py) and
 * narrowed to what their role may act on. Each row links to the one screen where it is resolved. The filters are
 * local state, not address params, so picking one never turns the ledger into the filtered work queue.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

/** What each kind the attention service raises is about (api/services/attention.py KINDS). */
const KIND_TEXT: Record<string, () => string> = {
  approvals: () => t("Fixes waiting for approval"),
  connection: () => t("System cannot be reached"),
  regression: () => t("Records failing again"),
  fitness_drop: () => t("Process fitness fell"),
  stale_object: () => t("Object not checked recently"),
  schedule_missed: () => t("Scheduled run missed"),
  schedule_failed: () => t("Scheduled run failed"),
  job_failed: () => t("Job failed"),
  discovery_failed: () => t("Process discovery failed"),
  discovery_due: () => t("Process discovery due"),
  config_missing: () => t("Configuration not read"),
  config_drift: () => t("Configuration changed"),
  sla_breach: () => t("Stewardship items overdue"),
  overdue_records: () => t("Records past their fix date"),
  object_no_go: () => t("Object not ready for go-live"),
  rule_review: () => t("Rules waiting for review"),
  contract_breach: () => t("Data contract broken"),
  access_requests: () => t("Access requests"),
  invites_pending: () => t("Invitations not accepted"),
  seats: () => t("Licence seats"),
  grants_expiring: () => t("Access grants expiring"),
  dormant_users: () => t("Dormant users"),
  api_key_expiring: () => t("API keys expiring"),
};
export const kindText = (k: string) => KIND_TEXT[k]?.() ?? k;

const SEV: Record<string, { tone: "bad" | "warn" | "neutral"; text: () => string }> = {
  critical: { tone: "bad", text: () => t("Critical") },
  high: { tone: "bad", text: () => t("High") },
  medium: { tone: "warn", text: () => t("Medium") },
  low: { tone: "neutral", text: () => t("Low") },
};

export function WorkAttention() {
  const fixture = useFixture();
  const [kind, setKind] = useState("");
  const [system, setSystem] = useState("");
  const q = useQuery({
    queryKey: ["attention", fixture, kind, system],
    queryFn: () => getAttention({ kinds: kind, system_id: system }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry,
  });
  // The kinds and systems to pick from, kept once seen so a filter never empties its own list.
  const [seen, setSeen] = useState<{ kinds: string[]; systems: [string, string][] }>({ kinds: [], systems: [] });
  const items = q.data?.items ?? [];
  const kinds = [...new Set([...seen.kinds, ...items.map((i) => i.kind)])];
  const systems = [...new Map([...seen.systems, ...items.flatMap((i): [string, string][] => (i.system_id ? [[i.system_id, i.system_name ?? i.system_id]] : []))])];
  if (kinds.length !== seen.kinds.length || systems.length !== seen.systems.length) setSeen({ kinds, systems });

  if (q.isError && status(q.error) === 403) {
    return <section className="nx-wq" data-testid="attention"><EmptyState heading={t("Your role cannot read what needs attention.")} /></section>;
  }
  const counts = q.data?.counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const total = counts.critical + counts.high + counts.medium + counts.low;
  const byKind = new Map<string, number>();
  for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const filtered = kind !== "" || system !== "";

  const columns: Column<AttentionItem>[] = [
    {
      id: "what",
      label: t("What"),
      cell: (i) => (
        <span className="nx-wq-cell">
          <strong>{i.title}</strong>
          <small>{kindText(i.kind)}. {i.detail}</small>
        </span>
      ),
    },
    { id: "severity", label: t("Severity"), cell: (i) => <Chip tone={SEV[i.severity]?.tone ?? "neutral"}>{SEV[i.severity]?.text() ?? i.severity}</Chip>, compare: (a, b) => a.tier - b.tier },
    { id: "where", label: t("Where"), cell: (i) => [i.system_name, i.object ? moduleText(i.object) : null].filter(Boolean).join(", ") || t("Not tied to one system") },
    { id: "since", label: t("Since"), cell: (i) => (i.since ? formatDate(i.since, "date") : ""), compare: (a, b) => (a.since ?? "").localeCompare(b.since ?? "") },
    { id: "count", label: t("Count"), align: "end", cell: (i) => int(i.count), compare: (a, b) => a.count - b.count },
    { id: "action", label: t("Action"), cell: (i) => <KeepLink className="nx-wq-link" href={i.href}>{i.action_label}</KeepLink> },
  ];

  return (
    <section className="nx-wq" aria-label={t("Action centre")} data-testid="attention">
      <h2 className="nx-wq-h">{total === 0 ? t("Nothing needs you right now") : t("{n} things need you", { n: int(total) })}</h2>
      {q.data ? (
        <p className="nx-wq-meta">
          {total > items.length ? t("The list shows the first {n}, most urgent first.", { n: int(ATTENTION_LIMIT) }) : t("Most urgent first. Checked {when}.", { when: relTime(q.data.generated_at) })}
        </p>
      ) : null}
      <div className="nx-wq-stats">
        <StatCard label={t("Critical")} value={counts.critical} />
        <StatCard label={t("High")} value={counts.high} />
        <StatCard label={t("Medium and low")} value={counts.medium + counts.low} />
      </div>
      <div className="nx-wq-bar" role="group" aria-label={t("Filter what needs attention")}>
        <label>{t("Kind")}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("Any kind")}</option>
            {kinds.map((k) => <option key={k} value={k}>{kindText(k)}</option>)}
          </select>
        </label>
        <label>{t("System")}
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">{t("Any system")}</option>
            {systems.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {total > 0 ? <KeepLink className="nx-wq-link" href="/work/triage" data-testid="attention-primary">{t("Start triage")}</KeepLink> : null}
      </div>
      <DataTable<AttentionItem>
        key={`${kind}-${system}`}
        rows={items}
        columns={columns}
        rowKey={(i) => i.id}
        rowLabel={(i) => i.title}
        caption={t("Act on these")}
        loading={q.isPending}
        error={q.isError ? { sentence: t("What needs attention could not be read."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: filtered ? t("Nothing of this kind needs attention.") : t("Nothing needs your attention. New items appear here as runs, approvals and checks raise them.") }}
      />
      {byKind.size > 0 ? (
        <PartBar
          label={t("What needs attention, by kind")}
          format={int}
          segments={[...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: kindText(k), value: n }))}
        />
      ) : null}
    </section>
  );
}
