"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Freshness, ObjectMonitor } from "@/lib/api/v2/run-ops";
import { getObjectMonitor, getObjectsMonitor } from "@/lib/api/v2/run-ops";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { describeCron } from "@/lib/v2/cron";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { useRuleList } from "@/lib/v2/sys-queries";
import { VerdictMark } from "../marks";
import { Coded, Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { duration } from "../shell/StatusStrip";
import { ScrollFrame } from "./object/ScrollFrame";

export function useObjectsMonitor() {
  const fixture = useFixture();
  return useQuery({ queryKey: ["v2", "objects-monitor", fixture] as const, queryFn: getObjectsMonitor, staleTime: 30_000, retry: false });
}

/** One object. The API answers 404 for an object no run has measured yet. */
export function useObjectMonitor(module: string) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["v2", "object-monitor", fixture, module] as const, queryFn: () => getObjectMonitor(module), staleTime: 30_000, retry: false });
}

const FRESH_WORD = {
  get fresh() { return t("Fresh"); },
  get due() { return t("Due"); },
  get stale() { return t("Stale"); },
  get failed() { return t("Last run failed"); },
  get paused() { return t("Paused"); },
  get manual() { return t("Run by hand"); },
} as Record<Freshness, string>;

const TRIGGER_WORD: Record<string, string> = {
  get scheduled() { return t("Scheduled"); },
  get manual() { return t("By hand"); },
  get recheck() { return t("Recheck"); },
  get upload() { return t("Upload"); },
};

export const freshnessWord = (f: Freshness): string => FRESH_WORD[f] ?? f;

export function FreshnessMark({ freshness }: { freshness: Freshness }) {
  const verdict = freshness === "fresh" ? "go" : freshness === "due" ? "at-risk" : freshness === "stale" || freshness === "failed" ? "no-go" : null;
  return (
    <span>
      {verdict ? <VerdictMark verdict={verdict} /> : null} {freshnessWord(freshness)}
    </span>
  );
}

export function cadenceText(m: ObjectMonitor): string | null {
  const { cron, interval_seconds: every, active } = m.cadence;
  if (!cron && !every) return null;
  const base = cron ? describeCron(cron) : t("Every {n}", { n: duration(every ?? 0) });
  return active === false ? t("{cadence}, paused", { cadence: base }) : base;
}

export const triggerText = (m: ObjectMonitor): string | null => (m.trigger ? TRIGGER_WORD[m.trigger] ?? m.trigger : null);

export function baselineText(m: ObjectMonitor): string | null {
  const { kind, run_at: at } = m.baseline;
  if (!kind) return null;
  const when = at ? formatDate(at, "date") : null;
  const word = kind === "pinned" ? t("Pinned run") : t("Previous run");
  return when ? t("{kind} of {when}", { kind: word, when }) : word;
}

/** Rules named by id with the rule's name beside it, from the rules library (the id alone until it has loaded). */
export function useRuleNames(enabled: boolean): (id: string) => string | undefined {
  const rules = useRuleList();
  const names = useMemo(() => new Map((rules.data?.rules ?? []).map((r) => [r.id, r.name])), [rules.data]);
  return (id) => (enabled ? names.get(id) : undefined);
}

export function DriftRules({ m, nameOf }: { m: ObjectMonitor; nameOf: (id: string) => string | undefined }) {
  const { hrefFor } = useOpenItem();
  const d = m.drift;
  if (d.newly_failing_rules.length === 0 && d.recovered_rules.length === 0) return <Dash why={t("No rule changed since the baseline")} />;
  return (
    <>
      {d.newly_failing_rules.slice(0, 3).map((r) => (
        <div key={`n-${r.check_id}`}>
          <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
            <Coded code={r.check_id} text={nameOf(r.check_id)} />
          </V2Link>{" "}
          <span className="m2-meta">{t("{n} records now failing", { n: int(r.new) })}</span>
        </div>
      ))}
      {d.newly_failing_rule_count > 3 ? <div className="m2-meta">{t("and {n} more", { n: int(d.newly_failing_rule_count - 3) })}</div> : null}
      {d.recovered_rules.slice(0, 3).map((r) => (
        <div key={`r-${r.check_id}`}>
          <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
            <Coded code={r.check_id} text={nameOf(r.check_id)} />
          </V2Link>{" "}
          <span className="m2-meta">{t("recovered")}</span>
        </div>
      ))}
      {d.recovered_rule_count > 3 ? <div className="m2-meta">{t("and {n} more", { n: int(d.recovered_rule_count - 3) })}</div> : null}
    </>
  );
}

/** Per measured object: how often it runs, how fresh it is, what started the last run, the baseline and the drift since. */
export function ObjectsMonitor() {
  const q = useObjectsMonitor();
  const land = useLandscape(null);
  const objects = q.data?.objects ?? [];
  const nameOf = useRuleNames(objects.some((o) => o.drift.newly_failing_rules.length + o.drift.recovered_rules.length > 0));
  const labelOf = (m: string) => land.data?.objects.find((o) => o.module === m)?.label ?? m;
  return (
    <section className="m2-sec" aria-label={t("Objects")} data-testid="objects-monitor">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Objects")}</h2>
        <span className="m2-sub">{t("How often each object is measured, how fresh it is, and what changed since its baseline")}</span>
      </div>
      {q.isPending ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The object monitor could not be read.")}</ErrorFrame>
      ) : objects.length === 0 ? (
        <EmptyFrame>{t("No object has been measured yet.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Objects")}>
          <table className="m2-tbl" data-testid="objects-monitor-table">
            <thead>
              <tr>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Freshness")}</th>
                <th scope="col">{t("Cadence")}</th>
                <th scope="col">{t("Last run")}</th>
                <th scope="col">{t("Started by")}</th>
                <th scope="col">{t("Baseline")}</th>
                <th scope="col" className="m2-r">{t("Newly failing")}</th>
                <th scope="col" className="m2-r">{t("Recovered")}</th>
                <th scope="col">{t("Rules that changed")}</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={`${o.system_id ?? ""}:${o.module}`} data-testid="objects-monitor-row" data-freshness={o.freshness}>
                  <th scope="row">{labelOf(o.module)}</th>
                  <td><FreshnessMark freshness={o.freshness} /></td>
                  <td>
                    {cadenceText(o) ?? <Dash why={t("This object has no schedule")} />}
                    {o.next_run_at ? <div className="m2-meta">{t("Next {when}", { when: formatDate(o.next_run_at, "datetime") })}</div> : null}
                  </td>
                  <td>{o.last_run_at ? formatDate(o.last_run_at, "datetime") : <Dash why={t("No run yet")} />}</td>
                  <td>
                    {triggerText(o) ?? <Dash why={t("Not recorded")} />}
                    {o.requested_by_label ? <div className="m2-meta">{o.requested_by_label}</div> : null}
                  </td>
                  <td>{baselineText(o) ?? <Dash why={t("No baseline yet")} />}</td>
                  <td className="m2-r">{int(o.drift.new_failing)}</td>
                  <td className="m2-r">{int(o.drift.recovered)}</td>
                  <td><DriftRules m={o} nameOf={nameOf} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </section>
  );
}
