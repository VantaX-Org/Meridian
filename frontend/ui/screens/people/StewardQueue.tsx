"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bulkApproveSteward, escalateStewardItem, listStewardQueue, resolveStewardItem, STEWARD_STATUSES, type StewardItem } from "@/lib/api/v2/stewardship";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Card, Chip, DataTable, EmptyState, Stepper, useToast } from "@/ui/kit";
import { Gate, refreshV2, useQ } from "./common";

/** The steps an item moves through. Rejected counts as the last step; escalated sits between work and the decision. */
const FLOW = ["open", "in_progress", "escalated", "resolved"] as const;
const stepOf = (s: string) => Math.max(0, FLOW.indexOf(s === "rejected" ? "resolved" : (s as (typeof FLOW)[number])));
const conf = (v: number | null) => (v === null ? "" : `${Math.round(v * 100)}%`);
const CLOSED = ["resolved", "rejected"];

/** The steward queue: filter by status, open an item, approve, reject or escalate it, or approve the confident ones together. */
export function StewardQueue() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<string>("open");
  const [sel, setSel] = useState<StewardItem | null>(null);
  const q = useQ(["steward-queue", status], () => listStewardQueue({ status }));
  const done = (msg: string) => { toast(msg, "good"); setSel(null); void refreshV2(qc); };
  const fail = () => toast(t("The change was not saved."), "bad");
  const resolve = useMutation({ mutationFn: (v: { id: string; action: "approve" | "reject" }) => resolveStewardItem(v.id, v.action), onSuccess: (_r, v) => done(v.action === "approve" ? t("Item approved") : t("Item rejected")), onError: fail });
  const escalate = useMutation({ mutationFn: (id: string) => escalateStewardItem(id), onSuccess: () => done(t("Item escalated")), onError: fail });
  const bulk = useMutation({ mutationFn: (ids: string[]) => bulkApproveSteward(ids), onSuccess: (r) => done(t("{n} items approved", { n: r.approved })), onError: fail });
  const busy = resolve.isPending || escalate.isPending || bulk.isPending;
  return (
    <Card title={t("Queue")} sub={t("Items waiting for a decision, with the AI recommendation")}>
      <div className="mx-col">
        <div className="mx-row" role="group" aria-label={t("Filter by status")}>
          {STEWARD_STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => { setStatus(s); setSel(null); }}>{labelText(s)}</Chip>)}
        </div>
        <Gate q={q} label={t("Loading the queue")}>
          {(d) => {
            const sure = d.items.filter((i) => i.ai_recommendation === "approve" && (i.ai_confidence ?? 0) >= 0.85).map((i) => i.id);
            return d.items.length === 0 ? <EmptyState heading={t("No items")} body={t("Nothing waits here. Choose another view.")} /> : (
              <>
                {status === "open" && sure.length > 0 ? (
                  <div className="mx-head-actions">
                    <Button variant="secondary" disabled={busy} onClick={() => bulk.mutate(sure)}>{t("Approve {n} confident items", { n: sure.length })}</Button>
                  </div>
                ) : null}
                <DataTable<StewardItem>
                  label={t("Steward queue")}
                  rows={d.items}
                  rowKey={(i) => i.id}
                  selected={sel?.id}
                  onSelect={setSel}
                  height={280}
                  columns={[
                    { key: "title", label: t("Item"), sort: (i) => i.source_title ?? i.id, render: (i) => i.source_title ?? i.id },
                    { key: "type", label: t("Type"), sort: (i) => i.item_type, render: (i) => labelText(i.item_type) },
                    { key: "domain", label: t("Domain"), render: (i) => labelText(i.domain) },
                    { key: "ai", label: t("AI recommendation"), render: (i) => (i.ai_recommendation ? `${labelText(i.ai_recommendation)} ${conf(i.ai_confidence)}` : t("None")) },
                    { key: "due", label: t("Due"), sort: (i) => i.due_at ?? "", render: (i) => (i.due_at ? relTime(i.due_at) : "") },
                  ]}
                />
              </>
            );
          }}
        </Gate>
        {sel ? (
          <div className="mx-col" aria-label={t("Item detail")}>
            <h3 className="mx-card-t">{sel.source_title ?? sel.id}</h3>
            <Stepper label={t("Where the item stands")} current={stepOf(sel.status)} steps={[
              { id: "open", label: t("Open") }, { id: "in_progress", label: t("In progress") }, { id: "escalated", label: t("Escalated") }, { id: "resolved", label: t("Decided") },
            ]} />
            {CLOSED.includes(sel.status) ? <p className="mx-muted">{labelText(sel.status)}</p> : (
              <div className="mx-head-actions">
                <Button variant="primary" disabled={busy} onClick={() => resolve.mutate({ id: sel.id, action: "approve" })}>{t("Approve")}</Button>
                <Button variant="secondary" disabled={busy} onClick={() => resolve.mutate({ id: sel.id, action: "reject" })}>{t("Reject")}</Button>
                {sel.status !== "escalated" ? <Button variant="ghost" disabled={busy} onClick={() => escalate.mutate(sel.id)}>{t("Escalate")}</Button> : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
