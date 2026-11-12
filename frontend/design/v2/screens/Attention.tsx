"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { ATTENTION_LIMIT, getAttention, type AttentionItem } from "@/lib/api/v2/attention";
import { formatDate } from "@/lib/format";
import { relTime } from "@/lib/v2/format";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { Consequence, FixHead, FlowSteps, MoreDetail, ObjectRunChip } from "../FixParts";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";
import { TableExport } from "@/design/v2/TableExport";

/**
 * Action centre: everything that needs the viewer, ranked by the backend (api/routes/attention.py) by tier, severity,
 * size and age, and already narrowed to what their role may act on. Each row links to the one screen where it is
 * resolved. The titles and details are the backend's own sentences; the kind beside each is translated here.
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

const kindText = (k: string) => KIND_TEXT[k]?.() ?? k;

export function Attention() {
  const fixture = useFixture();
  const [kind, setKind] = useUrlParam<string>("kind", "");
  const [system, setSystem] = useUrlParam<string>("system", "");
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

  if (q.isPending) return <CcPage title={t("Action centre")}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) {
    return (
      <CcPage title={t("Action centre")}>
        {status(q.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read what needs attention.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("What needs attention could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const { counts, generated_at } = q.data;
  const total = counts.critical + counts.high + counts.medium + counts.low;
  const byKind = new Map<string, number>();
  for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const filtered = kind !== "" || system !== "";

  return (
    <CcPage title={t("Action centre")}>
      <CcBanner
        eyebrow={t("Action centre")}
        headline={total === 0 ? t("Nothing needs you right now") : t("{n} things need you", { n: int(total) })}
        why={total > items.length ? t("The list shows the first {n}, most urgent first.", { n: int(ATTENTION_LIMIT) }) : t("Most urgent first. Checked {when}.", { when: relTime(generated_at) })}
        figs={[
          { label: t("Critical"), value: int(counts.critical) },
          { label: t("High"), value: int(counts.high) },
          { label: t("Medium and low"), value: int(counts.medium + counts.low) },
        ]}
        action={total > 0 ? <V2Link href="/work/triage" className="m2-btn m2-strong" data-testid="attention-primary">{t("Start triage")}</V2Link> : undefined}
        testId="attention-banner"
        label={t("Action centre")}
      />
      <FixHead
        lede={t("Everything that needs you across your systems, most urgent first. Start triage to work through it, or use the button on a row to go straight to it.")}
        means={[
          [t("Severity"), t("How soon the item needs you: critical first, then high, medium and low.")],
          [t("Since"), t("When the item was first raised.")],
          [t("Count"), t("How many records or items it covers.")],
          [t("Where"), t("The system and object it concerns, with the run it stands at now.")],
        ]}
      />
      <form className="m2-rfilters" aria-label={t("Filter what needs attention")} data-testid="attention-filter" onSubmit={(e) => e.preventDefault()}>
        <label>
          {t("Kind")}
          <select className="m2-sel" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("Any kind")}</option>
            {kinds.map((k) => <option key={k} value={k}>{kindText(k)}</option>)}
          </select>
        </label>
        <label>
          {t("System")}
          <select className="m2-sel" value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">{t("Any system")}</option>
            {systems.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </form>
      {items.length === 0 ? (
        <EmptyFrame>{filtered ? t("Nothing of this kind needs attention.") : t("Nothing needs your attention. New items appear here as runs, approvals and checks raise them.")}</EmptyFrame>
      ) : (
        <>
          <FlowSteps label={t("Action centre steps")} current={1} steps={[
            { label: t("See what is most urgent"), count: int(total), hint: t("The list is sorted with the most urgent first.") },
            { label: t("Open an item"), hint: t("The button on a row goes straight to it.") },
            { label: t("Decide there"), hint: t("The item opens where you can act on it.") },
          ]} />
          <Panel title={t("Act on these")} meta={t("Most urgent first")} testId="attention-table">
            <ScrollFrame label={t("Act on these")}>
              <TableExport><table className="m2-tbl m2-cards">
                <caption className="m2-sr">{t("Act on these")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("What")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Where")}</th>
                    <th scope="col">{t("Since")}</th>
                    <th scope="col">{t("Count")}</th>
                    <th scope="col"><span className="m2-sr">{t("Action")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => <Row key={i.id} i={i} />)}
                </tbody>
              </table></TableExport>
            </ScrollFrame>
          </Panel>
          <Consequence>{t("Opening an item changes nothing. Start triage walks the same list one item at a time.")}</Consequence>
          <MoreDetail title={t("Breakdown by kind")}>
          <Panel title={t("What needs attention, by kind")} meta={t("{n} items", { n: int(items.length) })} testId="attention-kinds">
            <CcHBars
              label={t("What needs attention, by kind")}
              rows={[...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: kindText(k), value: n, text: int(n) }))}
            />
          </Panel>
          </MoreDetail>
        </>
      )}
    </CcPage>
  );
}

function Row({ i }: { i: AttentionItem }) {
  return (
    <tr>
      <th scope="row" className="m2-card-lead">
        {i.title}
        <span className="m2-meta"> {kindText(i.kind)}. {i.detail}</span>
      </th>
      <td data-label={t("Severity")}><Sev severity={i.severity} /></td>
      <td data-label={t("Where")}>
        {i.system_name ? <>{i.system_name}{i.object ? ", " : ""}</> : null}
        {i.object ? <ObjectRunChip module={i.object} systemId={i.system_id} /> : i.system_name ? null : <Dash why={t("Not tied to one system")} />}
      </td>
      <td data-label={t("Since")} className="m2-num">{i.since ? formatDate(i.since, "date") : <Dash />}</td>
      <td data-label={t("Count")} className="m2-num">{int(i.count)}</td>
      <td data-label={t("Action")}>
        <V2Link href={i.href} className="m2-btn">{i.action_label}</V2Link>
      </td>
    </tr>
  );
}
