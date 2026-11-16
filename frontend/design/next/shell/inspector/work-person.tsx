"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { getWork } from "@/lib/api/v2/work";
import { errorSentence } from "@/lib/api/v2/client";
import { objectHref, objectsLine, roleWord, slaMet, slaWord, stewardSeries, workByObject } from "@/lib/v2/people";
import { useBatches, usePeople, usePersonWork, useStewardMetrics } from "@/lib/v2/approvals-queries";
import { useBatchActions, useBatchCan } from "@/lib/v2/batch-actions";
import { approveBlock, type BatchRow } from "@/lib/v2/batches";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { useOpenItem } from "@/lib/v2/hooks";
import type { RowRef } from "@/lib/v2/work-actions";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Button, EmptyState, ErrorState, Skeleton } from "../../kit";
import { PointSpark } from "../../kit/viz";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Note, OutcomeLine, Sec, useOutcome, type Outcome } from "./work-common";
import { DelegationBanner } from "./work-delegation";
import { ReassignMenu, day, money } from "./work-batch";

const REASSIGN_MAX = 200;

/** Approve on a waiting draft. Send back and the blank-value retry live in the batch inspector, linked beside it. */
function ApproveButton({ b, report }: { b: BatchRow; report: (o: Outcome) => void }) {
  const can = useBatchCan();
  const actions = useBatchActions();
  const [busy, setBusy] = useState(false);
  const block = approveBlock(b, can, can.me);
  const approve = async () => {
    setBusy(true);
    try {
      await actions.approve(b.id, b.label, false);
    } catch (e) {
      report({ tone: "fail", title: t("It did not go through"), detail: errorSentence(e, t("The batch could not be approved.")) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="primary" size={32} aria-label={t("Approve batch {label}", { label: b.label })} disabled={block !== null || busy} reason={block ?? undefined} loading={busy} loadingLabel={t("Approving…")} onClick={() => void approve()}>
      {t("Approve")}
    </Button>
  );
}

function PersonBody({ id }: { id: string }) {
  const people = usePeople();
  const p = people.data?.people.find((x) => x.id === id);
  const landscape = useLandscape(null).data;
  const work = usePersonWork(id, Boolean(p?.is_me), Boolean(p));
  const batches = useBatches();
  const metrics = useStewardMetrics(id, Boolean(p));
  const series = useMemo(() => stewardSeries(metrics.data?.periods ?? []), [metrics.data]);
  const { hrefFor } = useOpenItem();
  const { outcome, run, clear } = useOutcome();
  const report = (o: Outcome) => { clear(); void run("result", async () => o); };
  const can = useBatchCan();
  const byObject = useMemo(() => workByObject(work.data?.items ?? []), [work.data]);
  const label = (module: string) => landscape?.objects.find((o) => o.module === module)?.label ?? module.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (!p) return null;
  // The batches this person has to approve: drafts they did not build.
  const waiting = batches.rows.filter((b) => b.status === "draft" && b.ownerId !== p.id);
  const met = slaMet(p);
  const rows = async (): Promise<{ rows: RowRef[]; total: number }> => {
    const page = await getWork({ assigned: p.is_me ? "me" : p.id, status: "open", limit: REASSIGN_MAX, sort: "severity" });
    return { rows: page.items, total: page.total };
  };
  const loaded = work.data?.items.length ?? 0;
  const total = work.data?.total ?? p.open_work;
  const assigned = p.is_me ? "me" : encodeURIComponent(p.id);
  return (
    <>
      <DelegationBanner personId={p.id} />
      <Facts>
        <Fact label={t("Role")}>{roleWord(p.role)}</Fact>
        <Fact label={t("Email")}>{p.email ?? <Dash />}</Fact>
        <Fact label={t("Objects")}>{objectsLine(p) ?? <Dash why={t("Owns or stewards no object")} />}</Fact>
        <Fact label={t("Open work")}>{int(p.open_work)}</Fact>
        <Fact label={t("Approvals waiting")}>{int(p.approvals_waiting)}</Fact>
        <Fact label={t("Overdue")}>{int(p.overdue)}</Fact>
        <Fact label={t("SLA met")}>{met == null ? <Dash why={t("No open work")} /> : `${met}%`}</Fact>
        <Fact label={t("SLA")}>{slaWord(p.sla_hours) ?? <Dash why={t("No open work, or no policy for its severities")} />}</Fact>
        <Fact label={t("Breaches this month")}>{int(p.breaches_this_month)}</Fact>
        <Fact label={t("Last action")}>{p.last_action_at ? formatDate(p.last_action_at, "datetime") : <Dash why={t("No action is recorded")} />}</Fact>
      </Facts>

      <Sec title={t("Throughput and approval rate")}>
        {metrics.isLoading ? (
          <Skeleton lines={3} label={t("Throughput and approval rate")} />
        ) : metrics.isError ? (
          <ErrorState sentence={t("Their throughput could not be read.")} onRetry={() => void metrics.refetch()} />
        ) : series.length === 0 || !metrics.data ? (
          <Note>{t("No throughput is recorded for {name} yet.", { name: p.name })}</Note>
        ) : (
          <div data-testid="person-throughput">
            <Facts>
              <Fact label={t("Records processed")}>{int(metrics.data.summary.total_processed)}</Fact>
              <Fact label={t("Approval rate")}>{`${metrics.data.summary.approval_rate}%`}</Fact>
              <Fact label={t("Average review time")}>{t("{hours} hours", { hours: metrics.data.summary.avg_review_hours })}</Fact>
            </Facts>
            <PointSpark points={series.map((s) => ({ label: s.period, value: s.processed }))} label={t("Records processed per period")} />
            <PointSpark
              points={series.flatMap((s) => (s.rate == null ? [] : [{ label: s.period, value: s.rate }]))}
              label={t("Share of decided records approved, per period")}
            />
          </div>
        )}
      </Sec>

      <Sec title={t("Their objects")}>
        {p.objects_owned.length === 0 ? (
          <Note>{t("{name} owns or stewards no object.", { name: p.name })}</Note>
        ) : (
          <ul className="nx-ib-list" data-testid="person-objects">
            {p.objects_owned.map((o) => (
              <li key={`${o.module}:${o.as}`} className="nx-ib-row">
                <V2Link href={objectHref(landscape, o.module)}>{o.label}</V2Link>
                <span className="nx-ib-meta">{o.as === "owner" ? t("Owner") : t("Steward")}</span>
              </li>
            ))}
          </ul>
        )}
      </Sec>

      <Sec title={t("Open work by object")}>
        {work.isLoading ? (
          <Skeleton lines={2} label={t("Open work by object")} />
        ) : work.isError ? (
          <ErrorState sentence={t("Their open work could not be read.")} onRetry={() => void work.refetch()} />
        ) : byObject.length === 0 ? (
          <Note>{p.open_work > 0 ? t("{open_work} records are assigned to {name}, none in the rows read.", { open_work: int(p.open_work), name: p.name }) : t("Nothing is assigned to {name}.", { name: p.name })}</Note>
        ) : (
          <>
            <ul className="nx-ib-list" data-testid="person-work">
              {byObject.map((o) => (
                <li key={o.module} className="nx-ib-row">
                  <V2Link href={`/work?filter=open&module=${o.module}&assigned=${assigned}`}>{label(o.module)}</V2Link>
                  <span className="nx-wk-num">{int(o.count)}</span>
                </li>
              ))}
            </ul>
            {total > loaded ? <Note>{t("The first {loaded} of {total} open records are grouped here.", { loaded: int(loaded), total: int(total) })}</Note> : null}
          </>
        )}
      </Sec>

      <Sec title={t("Waiting for their approval")}>
        {p.approvals_waiting === 0 || waiting.length === 0 ? (
          <Note>{t("No batch is waiting for {name} to approve.", { name: p.name })}</Note>
        ) : (
          <ul className="nx-ib-list" data-testid="person-approvals">
            {waiting.map((b) => (
              <li key={b.id} className="nx-ib-row">
                <span>
                  <V2Link href={hrefFor({ kind: "batch", id: b.id })} className="nx-wk-mono">{b.label}</V2Link>
                  <span className="nx-ib-meta">
                    {" "}{t("{records} records", { records: int(b.records) })}{" "}{money(b.valueAtRisk)}{" "}{t("Due {day}", { day: day(b.dueAt) })}
                  </span>
                </span>
                <ApproveButton b={b} report={report} />
              </li>
            ))}
          </ul>
        )}
      </Sec>

      <Actions>
        <V2Link href={`/work?filter=open&assigned=${assigned}`}>{t("Open their work")}</V2Link>
        <ReassignMenu rows={rows} disabled={!can.assign || p.open_work === 0} subject={p.name} />
      </Actions>
      {!can.assign ? <Note>{t("Reassigning needs the assign permission, which your role does not hold.")}</Note> : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </>
  );
}

/** `?open=person:<id>`: facts, their objects, their open work by object, their waiting approvals, Reassign. */
export function PersonBodyView({ id, onClose }: BodyProps) {
  const people = usePeople();
  const p = people.data?.people.find((x) => x.id === id);
  const status = p ? `${roleWord(p.role)}${p.is_me ? t(", you") : ""}` : people.isLoading ? null : t("Not found");
  return (
    <InspectorFrame title={p ? p.name : t("Person")} status={status} onClose={onClose}>
      {p ? (
        <PersonBody id={id} />
      ) : people.isLoading ? (
        <Skeleton lines={6} label={t("Person")} />
      ) : people.isError ? (
        <ErrorState sentence={t("The people could not be read.")} onRetry={() => void people.refetch()} />
      ) : (
        <EmptyState heading={t("Not found")}>{t("This person is not listed. They may hold no object and no work.")}</EmptyState>
      )}
    </InspectorFrame>
  );
}
