"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { useRequest, useRequests, type RequestRow, type RequestState } from "@/lib/api/next/approvals";
import { Chip, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton } from "../kit";
import { ChangeTable } from "../approvals/ChangeTable";
import { DecisionPanel, stateLabel } from "../approvals/DecisionPanel";
import "../approvals/approvals.css";

type Filter = "all" | RequestState;
const TONE = { pending: "warn", approved: "good", rejected: "bad", dry_run: "neutral" } as const;

/** Write-back requests: the list with a state filter, and one request with its before and after and its decision. */
export function Approvals() {
  const id = useSearchParams().get("id");
  return id ? <Detail id={id} /> : <List />;
}

function List() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const q = useRequests(filter === "all" ? undefined : filter);
  const rows = q.data?.items ?? [];
  return (
    <main className="nx-ap" data-testid="approvals-list">
      <header className="nx-ap-head">
        <h1>{t("Approvals")}</h1>
        <p>{t("Every write-back needs a second person. Requests you made wait for someone else.")}</p>
      </header>
      <SegmentedControl<Filter>
        label={t("Show requests")}
        value={filter}
        onChange={setFilter}
        items={[
          { value: "pending", label: t("Waiting") },
          { value: "approved", label: t("Approved") },
          { value: "rejected", label: t("Rejected") },
          { value: "all", label: t("All") },
        ]}
      />
      <DataTable<RequestRow>
        caption={t("Write-back requests")}
        rows={rows}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.check_id ?? r.id}
        loading={q.isLoading}
        error={q.isError ? { sentence: t("The requests could not be read. Check that the API is reachable, then retry."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No requests here."), text: t("A write-back request appears when someone sends a fix for approval.") }}
        onOpenRow={(r) => router.push(`/next/approvals?id=${encodeURIComponent(r.id)}`)}
        columns={[
          { id: "rule", label: t("Rule"), cell: (r) => <><span className="nx-mono">{r.check_id ?? "-"}</span> <span className="nx-ap-text">{r.rule_message}</span></> },
          { id: "state", label: t("State"), cell: (r) => <Chip tone={TONE[r.state]}>{stateLabel(r.state)}</Chip> },
          { id: "by", label: t("Requested by"), cell: (r) => r.requested_by_name ?? t("Unknown") },
          { id: "n", label: t("Records"), align: "end", cell: (r) => formatInt(r.records_updated) },
          { id: "at", label: t("Requested"), cell: (r) => (r.created_at ? r.created_at.slice(0, 10) : "-"), compare: (a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") },
        ]}
      />
    </main>
  );
}

function Detail({ id }: { id: string }) {
  const q = useRequest(id);
  const r = q.data;
  return (
    <main className="nx-ap" data-testid="approvals-detail">
      <V2Link className="nx-btn nx-btn-quiet" href="/approvals">{t("All requests")}</V2Link>
      {q.isError ? <ErrorState error={q.error} fallback={t("The request could not be read.")} onRetry={() => void q.refetch()} />
        : q.isLoading || !r ? <Skeleton lines={6} label={t("Loading the request")} />
        : (
          <>
            <header className="nx-ap-head">
              <h1>{r.rule_message ?? r.check_id ?? t("Write-back request")}</h1>
              <p><span className="nx-mono">{r.check_id}</span> {r.module ? <span className="nx-mono">{r.module}</span> : null}</p>
            </header>
            <DecisionPanel req={r} />
            {r.errors.length ? <ul className="nx-ap-errors">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
            {r.changes.length === 0
              ? <EmptyState icon="inbox" heading={t("No field changes are stored for this request.")}>{t("The finding holds no proposed values.")}</EmptyState>
              : <ChangeTable changes={r.changes} />}
          </>
        )}
    </main>
  );
}
