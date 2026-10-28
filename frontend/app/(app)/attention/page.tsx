"use client";

/** To do: everything that needs a person now in the viewer's scope, ranked, with the one action for each. */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, ChoiceGroup, DataTable, ExplorerPage, PageHeader, RowAction, Status, actionColumn, asyncStateOf } from "@/design";
import { useAttention } from "@/hooks/use-attention";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems } from "@/lib/api/connectivity";
import { attentionBadge, type AttentionItem } from "@/lib/api/attention";
import { TIERS, TIER_LABELS, asOfTime, itemObject, kindLabel, scopeSentence } from "@/lib/attention";
import { formatModuleName, relativeTime } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

/** The most the endpoint returns in one call; counts cover everything. */
const LIMIT = 200;
const ALL = "all";

const columns: ColumnDef<AttentionItem>[] = [
  { id: "severity", header: "Severity", accessorFn: (i) => ["critical", "high", "medium", "low"].indexOf(i.severity), enableSorting: false,
    cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  { id: "title", header: "What needs a person", enableSorting: false, cell: ({ row: { original: i } }) => (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium m-ink">{i.title}</span>
      <span className="m-text-meta m-ink-3 line-clamp-2">{i.detail}</span>
    </span>
  ) },
  { id: "where", header: "Object and system", enableSorting: false, meta: { priority: "low" }, cell: ({ row: { original: i } }) => {
    const object = itemObject(i);
    if (!object && !i.system_name) return "—";
    return (
      <span className="flex flex-col">
        {object ? <span>{object}</span> : null}
        {i.system_name ? <span className="m-text-meta m-ink-3">{i.system_name}</span> : null}
      </span>
    );
  } },
  { id: "since", header: "Since", enableSorting: false, meta: { priority: "low" }, cell: ({ row: { original: i } }) => (i.since ? <span className="whitespace-nowrap">{relativeTime(i.since)}</span> : "—") },
  { id: "count", header: "Count", enableSorting: false, meta: { numeric: true, priority: "low" }, cell: ({ row: { original: i } }) => i.count.toLocaleString() },
  actionColumn<AttentionItem>((i) => <RowAction href={i.href} label={`${i.action_label}: ${i.title}`}>{i.action_label}</RowAction>),
];

export default function AttentionPage() {
  const router = useRouter();
  const [tierRaw, setTier] = useUrlState("tier");
  const [kindRaw, setKind] = useUrlState("kind");
  const [object, setObject] = useUrlState("object");
  const tier = /^[1-5]$/.test(tierRaw) ? Number(tierRaw) : null;
  const q = useAttention({ limit: LIMIT, ...(object ? { object } : {}) });
  const permissions = usePermissions();

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const tiers = TIERS.filter((t) => items.some((i) => i.tier === t));
  const kinds = [...new Set(items.map((i) => i.kind))];
  const kind = kinds.includes(kindRaw) ? kindRaw : ALL;
  const shown = items.filter((i) => (tier === null || i.tier === tier) && (kind === ALL || i.kind === kind));

  const empty = q.data !== undefined && items.length === 0;
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: empty && permissions.scopes.length > 0, meta: { ignoreError: true } });
  const systemNames = useMemo(() => new Map((systemsQ.data ?? []).map((s) => [s.id, s.name])), [systemsQ.data]);
  const scopeLine = permissions.loading ? null : `Your scope is ${scopeSentence(permissions.scopes, systemNames)}.`;

  const total = q.data ? q.data.counts.critical + q.data.counts.high + q.data.counts.medium + q.data.counts.low : 0;
  // The index bar's flag counts only the critical and high items of this list: say how many those are.
  const urgent = q.data ? attentionBadge(q.data.counts) : 0;
  const meta = q.data
    ? `${total.toLocaleString()} ${total === 1 ? "item" : "items"} in your scope, ${urgent.toLocaleString()} critical or high, as of ${asOfTime(q.data.generated_at)}`
    : "What needs a person now in your scope";

  return (
    <ExplorerPage
      header={<PageHeader title="To do" meta={meta} />}
      filterBar={items.length ? (
        <div className="flex flex-col gap-2">
          <ChoiceGroup
            label="Priority"
            showLabel
            labelClassName="[min-width:4.5rem]"
            value={tier === null ? ALL : String(tier)}
            onChange={(v) => setTier(v === ALL ? "" : v)}
            options={[{ value: ALL, label: "All" }, ...tiers.map((t) => ({ value: String(t), label: TIER_LABELS[t] ?? `Tier ${t}` }))]}
          />
          {kinds.length > 1 ? (
            <ChoiceGroup
              label="Kind"
              showLabel
              labelClassName="[min-width:4.5rem]"
              value={kind}
              onChange={(v) => setKind(v === ALL ? "" : v)}
              options={[{ value: ALL, label: "All" }, ...kinds.map((k) => ({ value: k, label: kindLabel(k) }))]}
            />
          ) : null}
          {object ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="m-text-meta m-ink-3">Object</span>
              <span className="m-text-body">{formatModuleName(object)}</span>
              <Button variant="ghost" size="sm" onClick={() => setObject("")}>Show all objects</Button>
            </div>
          ) : null}
        </div>
      ) : undefined}
      state={asyncStateOf(q, (d) => d.items.length === 0)}
      emptyProps={{
        title: "Nothing in your scope needs a person now",
        detail: [object ? `Nothing is waiting on ${formatModuleName(object)}.` : null, scopeLine, "A failed connection, a regression or a request waiting on you shows here."].filter(Boolean).join(" "),
        action: <Button variant="secondary" render={<Link href="/objects">Open objects</Link>} />,
        ghost: "list",
      }}
      errorProps={{ error: q.error, onRetry: () => void q.refetch() }}
      table={
        <DataTable
          columns={columns}
          data={shown}
          getRowId={(i) => i.id}
          label="To do"
          hideToolbar
          hideSearch
          height="auto"
          tableId="attention"
          onRowClick={(i) => router.push(i.href)}
          rowHref={(i) => i.href}
          emptyMessage="Nothing matches these filters"
        />
      }
    />
  );
}
