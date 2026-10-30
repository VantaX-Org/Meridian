"use client";

import "../approvals.css";
import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import { getWork } from "@/lib/api/v2/work";
import { objectHref, objectsLine, roleWord, slaMet, slaWord, workByObject } from "@/lib/v2/people";
import { useBatches, usePeople, usePersonWork } from "@/lib/v2/approvals-queries";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { useOpenItem } from "@/lib/v2/hooks";
import type { RowRef } from "@/lib/v2/work-actions";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { BatchButtons, ReassignMenu, day, money, useBatchControls } from "../screens/batch-parts";
import { ResultFrame, useOutcome } from "./shared";
import { ActivitySection } from "./collab";
import { DelegationBanner } from "./delegation";
import { t } from "@/lib/v2/i18n";

const REASSIGN_MAX = 200;

function PersonBody({ id }: { id: string }) {
  const people = usePeople();
  const p = people.data?.people.find((x) => x.id === id);
  const landscape = useLandscape(null).data;
  const work = usePersonWork(id, Boolean(p?.is_me), Boolean(p));
  const batches = useBatches();
  const { hrefFor } = useOpenItem();
  const { outcome, run, clear } = useOutcome();
  const controls = useBatchControls((o) => {
    clear();
    void run("result", async () => o);
  });
  const byObject = useMemo(() => workByObject(work.data?.items ?? []), [work.data]);
  const label = (module: string) => landscape?.objects.find((o) => o.module === module)?.label ?? module.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (!p) return null;
  const can = controls.can;
  // The batches this person has to approve: drafts they did not build.
  const waiting = batches.rows.filter((b) => b.status === "draft" && b.ownerId !== p.id);
  const met = slaMet(p);
  const rows = async (): Promise<{ rows: RowRef[]; total: number }> => {
    const page = await getWork({ assigned: p.is_me ? "me" : p.id, status: "open", limit: REASSIGN_MAX, sort: "severity" });
    return { rows: page.items, total: page.total };
  };
  const loaded = work.data?.items.length ?? 0;
  const total = work.data?.total ?? p.open_work;
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
        <Fact label="SLA">{slaWord(p.sla_hours) ?? <Dash why={t("No open work, or no policy for its severities")} />}</Fact>
        <Fact label={t("Breaches this month")}>{int(p.breaches_this_month)}</Fact>
        <Fact label={t("Last action")}>{p.last_action_at ? formatDate(p.last_action_at, "datetime") : <Dash why={t("No action is recorded")} />}</Fact>
      </Facts>

      <h3>{t("Their objects")}</h3>
      {p.objects_owned.length === 0 ? (
        <EmptyFrame>{t("{name} owns or stewards no object.", { name: p.name })}</EmptyFrame>
      ) : (
        <ul className="m2-breaches" data-testid="person-objects">
          {p.objects_owned.map((o) => (
            <li key={`${o.module}:${o.as}`}>
              <V2Link href={objectHref(landscape, o.module)}>{o.label}</V2Link>
              <span className="m2-meta">{o.as === "owner" ? t("Owner") : t("Steward")}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>{t("Open work by object")}</h3>
      {work.isLoading ? (
        <Skeleton width="100%" height={64} />
      ) : work.isError ? (
        <ErrorFrame onRetry={() => void work.refetch()}>{t("Their open work could not be read.")}</ErrorFrame>
      ) : byObject.length === 0 ? (
        <EmptyFrame>{p.open_work > 0 ? t("{open_work} records are assigned to {name}, none in the rows read.", { open_work: int(p.open_work), name: p.name }) : t("Nothing is assigned to {name}.", { name: p.name })}</EmptyFrame>
      ) : (
        <>
          <ul className="m2-breaches" data-testid="person-work">
            {byObject.map((o) => (
              <li key={o.module}>
                <V2Link href={`/v2/work?filter=open&module=${o.module}&assigned=${p.is_me ? "me" : encodeURIComponent(p.id)}`}>{label(o.module)}</V2Link>
                <span>{int(o.count)}</span>
              </li>
            ))}
          </ul>
          {total > loaded ? <p className="m2-prov">{t("The first {loaded} of {total} open records are grouped here.", { loaded: int(loaded), total: int(total) })}</p> : null}
        </>
      )}

      <h3>{t("Waiting for their approval")}</h3>
      {p.approvals_waiting === 0 || waiting.length === 0 ? (
        <EmptyFrame>{t("No batch is waiting for {name} to approve.", { name: p.name })}</EmptyFrame>
      ) : (
        <ul className="m2-blist" data-testid="person-approvals">
          {waiting.map((b) => (
            <li key={b.id}>
              <div className="m2-bh">
                <span className="m2-bh-id">
                  <V2Link href={hrefFor({ kind: "batch", id: b.id })}>
                    <Mono>{b.label}</Mono>
                  </V2Link>
                </span>
                <span className="m2-bh-meta">{t("{records} records", { records: int(b.records) })}</span>
                <span className="m2-bh-meta">{money(b.valueAtRisk)}</span>
                <span className="m2-bh-sp" />
                <span className="m2-bh-x">
                  <BatchButtons b={b} c={controls} />
                </span>
              </div>
              <span className="m2-sr">{t("Due {day}", { day: day(b.dueAt) })}</span>
            </li>
          ))}
        </ul>
      )}

      <Actions>
        <V2Link href={`/v2/work?filter=open&assigned=${p.is_me ? "me" : encodeURIComponent(p.id)}`} className="m2-btn m2-strong">
          {t("Open their work")}
        </V2Link>
        <ReassignMenu rows={rows} disabled={!can.assign || p.open_work === 0} subject={p.name} />
      </Actions>
      {!can.assign ? <p className="m2-prov">{t("Reassigning needs the assign permission, which your role does not hold.")}</p> : null}
      <ActivitySection userId={p.id} self={p.is_me} />
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {controls.dialog}
    </>
  );
}

/** `?open=person:<id>`: facts, their objects, their open work by object, their waiting approvals, Reassign. */
export function PersonInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const people = usePeople();
  const p = people.data?.people.find((x) => x.id === id);
  const status = p ? `${roleWord(p.role)}${p.is_me ? t(", you") : ""}` : people.isLoading ? <Skeleton width={120} height={12} /> : t("Not found");
  return (
    <InspectorFrame title={p ? p.name : t("Person")} status={status} onClose={onClose}>
      {p ? (
        <PersonBody id={id} />
      ) : people.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : people.isError ? (
        <ErrorFrame onRetry={() => void people.refetch()}>{t("The people could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("This person is not listed. They may hold no object and no work.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}
