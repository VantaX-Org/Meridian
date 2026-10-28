"use client";

import Link from "next/link";
import { Button, Card, RowAction, Skeleton, Status } from "@/design";
import { useAttention } from "@/hooks/use-attention";
import type { AttentionItem } from "@/lib/api/attention";
import { itemObject } from "@/lib/attention";
import { relativeTime } from "@/lib/format";

/** How many items the card shows; the rest open from "All N". */
export const CARD_ITEMS = 5;

export const ATTENTION_HREF = "/attention";

/** One to-do row: severity, the sentence, where it is and the one action. */
export function AttentionRow({ item, withObject = true }: { item: AttentionItem; withObject?: boolean }) {
  const object = withObject ? itemObject(item) : null;
  const where = [[object, item.system_name].filter(Boolean).join(" on "), item.since ? relativeTime(item.since) : ""].filter(Boolean).join(", ");
  return (
    <li data-testid="attention-row" data-attention-id={item.id} className="flex items-start gap-3 py-2">
      <span className="shrink-0 pt-0.5"><Status kind="severity" value={item.severity} /></span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="m-text-body font-medium m-ink">{item.title}</span>
        <span className="m-text-meta m-ink-3">{item.detail}</span>
        {where ? <span className="m-text-meta m-ink-3">{where}</span> : null}
      </div>
      <RowAction href={item.href} label={`${item.action_label}: ${item.title}`}>{item.action_label}</RowAction>
    </li>
  );
}

/**
 * The viewer's top five to-do items, each with its one action; "All N" opens /attention. With `object` it lists only
 * that object's items and stays out of the way when there are none; on a home it says nothing is waiting. It renders a
 * skeleton until the list arrives (never "nothing to do" before the data) and nothing when the list cannot be read.
 */
export function AttentionCard({ object, systemId, limit = CARD_ITEMS }: { object?: string; systemId?: string; limit?: number }) {
  const q = useAttention({ limit, ...(object ? { object } : {}), ...(systemId ? { system_id: systemId } : {}) });
  if (q.isError) return null;
  if (q.isLoading || !q.data) {
    return (
      <Card title="To do" padding="sm">
        <div data-testid="attention-loading" aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}
        </div>
      </Card>
    );
  }
  const { items, counts } = q.data;
  const total = counts.critical + counts.high + counts.medium + counts.low;
  if (!items.length) {
    if (object) return null;
    return (
      <Card title="To do" padding="sm">
        <p className="m-text-body m-ink-2">Nothing in your scope needs a person now</p>
      </Card>
    );
  }
  const href = object ? `${ATTENTION_HREF}?object=${encodeURIComponent(object)}` : ATTENTION_HREF;
  return (
    <Card
      title="To do"
      padding="sm"
      meta={`${total.toLocaleString()} in your scope`}
      actions={<Button variant="ghost" render={<Link href={href} aria-label={`All ${total.toLocaleString()} to-do items`}>{`All ${total.toLocaleString()}`}</Link>} />}
    >
      <ul data-testid="attention-card" className="m-0 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:[border-color:var(--m-line)]">
        {items.slice(0, limit).map((i) => <AttentionRow key={i.id} item={i} withObject={!object} />)}
      </ul>
    </Card>
  );
}
