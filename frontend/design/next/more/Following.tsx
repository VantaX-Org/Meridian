"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { deleteWatch, putSubscriptions, type MyWatch, type WatchKind } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { notFound, refreshRoles, useMyWatches, useSubscriptions, useUnreadMentions } from "@/lib/v2/roles-queries";
import { Button, Chip, Sheet, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { QueryView } from "./states";
import "./journey.css";

const watchEventsLine = (events: MyWatch["events"]): string =>
  events.length === 0
    ? t("All events")
    : events.map((e) => ({ comment: t("Comments"), run_finished: t("Runs finishing"), score_dropped: t("Score drops"), critical_breach: t("Critical breaches"), batch_waiting: t("Batches waiting") })[e] ?? e).join(", ");

/**
 * What a person hears about (GET/PUT /subscriptions), their unread mentions (GET /mentions/unread) and
 * what they watch (GET /watches/mine, DELETE /watches). Sheet kind "following", from People.
 */

const KIND_WORD: Record<WatchKind, () => string> = {
  record: () => t("Record"),
  rule: () => t("Rule"),
  batch: () => t("Batch"),
  contract: () => t("Contract"),
  wave: () => t("Wave"),
  object: () => t("Object"),
  system: () => t("System"),
};

export function Following() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const subs = useSubscriptions();
  const watches = useMyWatches();
  const mentions = useUnreadMentions();
  const [busy, setBusy] = useState<string | null>(null);
  const readOnly = session.shared || Boolean(session.viewAs);
  const n = mentions.data?.count ?? 0;
  const guard = async (key: string, job: () => Promise<unknown>, part: string) => {
    setBusy(key);
    try {
      await job();
      await refreshRoles(qc, part);
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    } finally {
      setBusy(null);
    }
  };
  const list = watches.data?.watches ?? [];
  return (
    <div className="nx-form">
      {n ? <Chip tone="accent">{t("{n} unread {n, plural, one {mention} other {mentions}}", { n })}</Chip> : null}
      <section className="nx-form" data-testid="subscriptions">
        <h3 className="nx-jh">{t("What you hear about")}</h3>
        {subs.isError && notFound(subs.error) ? (
          <p className="nx-sub">{t("Subscriptions are not available on this server yet")}</p>
        ) : (
          <QueryView loading={subs.isPending} error={subs.isError ? t("Your subscriptions could not be read.") : null} onRetry={() => void subs.refetch()} empty={false} emptyHeading="" label={t("What you hear about")}>
            <ul className="nx-pick">
              {(subs.data?.events ?? []).map((e) => (
                <li key={e.event}>
                  <label className="nx-row">
                    <input className="nx-check" type="checkbox" checked={e.enabled} disabled={readOnly || busy === e.event} onChange={(x) => void guard(e.event, () => putSubscriptions({ [e.event]: x.target.checked }), "subs")} />
                    <span className="nx-row-main">{e.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </QueryView>
        )}
      </section>
      <section className="nx-form" data-testid="watch-list">
        <h3 className="nx-jh">{t("What you watch")}</h3>
        {watches.isError && notFound(watches.error) ? (
          <p className="nx-sub">{t("Watching is not available on this server yet")}</p>
        ) : (
          <QueryView loading={watches.isPending} error={watches.isError ? t("Your watches could not be read.") : null} onRetry={() => void watches.refetch()} empty={list.length === 0} emptyHeading={t("You watch nothing yet. Use Watch on an object, rule or batch to hear about it.")} label={t("What you watch")}>
            <ul className="nx-pick">
              {list.map((w: MyWatch) => {
                const key = `${w.target_kind}:${w.target_id}`;
                return (
                  <li key={key} className="nx-row">
                    <div className="nx-row-main">
                      <div>{`${KIND_WORD[w.target_kind]()}: ${w.target_id}`}</div>
                      <div className="nx-sub">{watchEventsLine(w.events)}</div>
                    </div>
                    <Button variant="quiet" size={32} disabled={readOnly} loading={busy === key} onClick={() => void guard(key, () => deleteWatch(w.target_kind, w.target_id), "watch")}>{t("Stop watching")}</Button>
                  </li>
                );
              })}
            </ul>
          </QueryView>
        )}
      </section>
    </div>
  );
}

export function FollowingSheet({ ctx }: { ctx: SheetCtx }) {
  return (
    <Sheet open onClose={ctx.close} title={t("What you follow")} size="medium" under={ctx.under} secondary={<Button variant="secondary" onClick={ctx.close}>{t("Done")}</Button>}>
      <Following />
    </Sheet>
  );
}
