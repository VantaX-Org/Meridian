"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { labelText, moduleText } from "@/lib/v2/labels";
import { relTime } from "@/lib/v2/format";
import { useFixture } from "@/lib/api/v2/fixture";
import { CHAIN_STAGES, getAutomationChain, type ChainSchedule, type ChainStage, type ChainStageRow, type ChainTask } from "@/lib/api/v2/automation";
import { Chip, Code, DataTable, PartBar, Stepper, type Column, type StepState } from "../kit";
import { ChartCard, cardState, compact } from "./ChartCard";
import { QueryView } from "./states";

const STAGE_LABEL: Record<ChainStage | "platform", () => string> = {
  extract: () => t("Extract"),
  checks: () => t("Checks"),
  agents: () => t("Agents"),
  report: () => t("Report"),
  monitoring: () => t("Monitoring"),
  platform: () => t("Platform upkeep"),
};
const FAILED = new Set(["failed", "agents_failed", "error"]);
const RUNNING = new Set(["running", "in_progress", "queued", "extracting"]);

const DOW = [() => t("Sunday"), () => t("Monday"), () => t("Tuesday"), () => t("Wednesday"), () => t("Thursday"), () => t("Friday"), () => t("Saturday")];
const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

/** A five-field cron in words for the common shapes; anything else keeps the cron alone. */
export function cronText(cron: string | null): string {
  if (!cron) return t("On an interval");
  const [mi, h, dom, mon, dow] = cron.split(/\s+/);
  const num = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);
  const every = /^\*\/(\d+)$/;
  if (every.test(mi) && h === "*" && dom === "*" && mon === "*" && dow === "*") return t("Every {n} minutes", { n: mi.replace("*/", "") });
  if (num(mi) && every.test(h) && dom === "*" && mon === "*" && dow === "*") return t("Every {n} hours", { n: h.replace("*/", "") });
  if (num(mi) && h === "*" && dom === "*" && mon === "*" && dow === "*") return t("Every hour at minute {m}", { m: mi });
  if (num(mi) && num(h) && dom === "*" && mon === "*" && dow === "*") return t("Daily at {time}", { time: hhmm(h, mi) });
  if (num(mi) && num(h) && dom === "*" && mon === "*" && num(dow)) return t("Every {day} at {time}", { day: (DOW[Number(dow) % 7])(), time: hhmm(h, mi) });
  if (num(mi) && num(h) && num(dom) && mon === "*" && dow === "*") return t("Monthly on day {d} at {time}", { d: dom, time: hhmm(h, mi) });
  return t("Custom schedule");
}

/** The last segment of a Celery task name in words: workers.tasks.health_samples.sample_health is "Sample health". */
const taskText = (task: string) => {
  const s = (task.split(".").pop() ?? task).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const when = (iso: string | null | undefined, none: string) => (iso ? `${relTime(iso)} (${formatDate(iso, "datetime")})` : none);

function stepState(s: ChainStageRow): StepState {
  if (s.last_status && FAILED.has(s.last_status)) return "failed";
  if (s.last_status && RUNNING.has(s.last_status)) return "running";
  return s.last_at ? "done" : "future";
}

/** One line of figures for a stage, from the counts the API sends for it. */
function stageFigures(s: ChainStageRow): string {
  const parts: string[] = [];
  if (s.rows != null) parts.push(t("{n} records", { n: compact(s.rows) }));
  if (s.runs_7d != null) parts.push(t("{n} runs in 7 days", { n: int(s.runs_7d) }));
  if (s.failed_7d) parts.push(t("{n} failed", { n: int(s.failed_7d) }));
  if (s.queue_open != null) parts.push(t("{n} queue items open", { n: int(s.queue_open) }));
  if (s.queue_overdue) parts.push(t("{n} overdue", { n: int(s.queue_overdue) }));
  if (s.escalated) parts.push(t("{n} exceptions escalated", { n: int(s.escalated) }));
  if (s.regressed_checks != null) parts.push(t("{n} rules regressed", { n: int(s.regressed_checks) }));
  if (s.new_records != null) parts.push(t("{n} new failing records", { n: compact(s.new_records) }));
  if (s.deliveries_7d != null) parts.push(t("{n} alerts sent in 7 days", { n: int(s.deliveries_7d) }));
  return parts.join(", ");
}

/**
 * What runs on its own: the chain extract, checks, agents, report, monitoring with each stage's last result and next
 * run, every scheduled task with its timing, and the tenant's run schedules. Read-only.
 */
export function Automation() {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["automation", "chain", fx], queryFn: getAutomationChain, staleTime: 30_000, retry: false });
  const d = q.data;
  const stages = CHAIN_STAGES.map((id) => d?.stages.find((s) => s.stage === id)).filter((s): s is ChainStageRow => Boolean(s));
  const state = cardState(q, !d || (d.tasks.length === 0 && stages.every((s) => !s.last_at)));
  const runs = stages.filter((s) => s.runs_7d != null).map((s) => ({ label: STAGE_LABEL[s.stage](), value: s.runs_7d ?? 0 }));
  const fails = stages.reduce((n, s) => n + (s.failed_7d ?? 0), 0);
  const byStage = (["platform", ...CHAIN_STAGES] as const).map((k) => ({ label: STAGE_LABEL[k](), value: d?.tasks.filter((x) => x.stage === k).length ?? 0 }));
  const soonest = d?.tasks.find((x) => x.next_run_at);

  const taskCols: Column<ChainTask>[] = [
    { id: "task", label: t("Task"), cell: (x) => <Code code={x.key} text={taskText(x.task)} /> },
    { id: "stage", label: t("Stage"), compare: (a, b) => a.stage.localeCompare(b.stage), cell: (x) => <Chip tone={x.stage === "platform" ? "neutral" : "accent"}>{STAGE_LABEL[x.stage]()}</Chip> },
    { id: "cron", label: t("Runs"), cell: (x) => (x.cron ? <Code code={x.cron} text={cronText(x.cron)} /> : cronText(null)) },
    { id: "next", label: t("Next run"), compare: (a, b) => (a.next_run_at ?? "~").localeCompare(b.next_run_at ?? "~"), cell: (x) => when(x.next_run_at, t("Not scheduled")) },
  ];
  const schedCols: Column<ChainSchedule>[] = [
    {
      id: "name", label: t("Schedule"),
      cell: (s) => (
        <span className="nx-cell-stack">
          <span>{s.name ?? moduleText(s.domain)}</span>
          <span className="nx-sub">{[s.system_name, s.modules.map(moduleText).join(", ")].filter(Boolean).join(", ")}</span>
        </span>
      ),
    },
    { id: "cron", label: t("Runs"), cell: (s) => (s.schedule_cron ? <Code code={s.schedule_cron} text={cronText(s.schedule_cron)} /> : t("Manual only")) },
    { id: "status", label: t("Status"), cell: (s) => <Chip tone={s.active ? "good" : "neutral"}>{s.active ? labelText(s.status) : t("Paused")}</Chip> },
    { id: "last", label: t("Last run"), cell: (s) => when(s.last_run_at, t("Never run")) },
    { id: "next", label: t("Next run"), cell: (s) => (s.active ? when(s.next_run_at, t("Not scheduled")) : t("Paused")) },
  ];

  return (
    <div className="nx-body" data-testid="automation-page">
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Loading the automation chain")}>
        <div className="nx-chartcards">
          <ChartCard
            title={t("Runs in the last 7 days")} state={state} testId="automation-runs"
            chart={<PartBar segments={runs} label={t("Runs in the last 7 days")} format={compact} />}
            figure={compact(runs.reduce((n, s) => n + s.value, 0))}
            line={fails ? t("{n} failed in 7 days", { n: int(fails) }) : t("No failure in 7 days")}
            emptyLine={t("Nothing has run yet.")} onRetry={() => void q.refetch()}
          />
          <ChartCard
            title={t("Scheduled tasks by stage")} state={state} testId="automation-tasks"
            chart={<PartBar segments={byStage} label={t("Scheduled tasks by stage")} format={compact} />}
            figure={compact(d?.tasks.length ?? 0)}
            line={soonest ? t("Next: {task} {when}", { task: taskText(soonest.task), when: relTime(soonest.next_run_at as string) }) : undefined}
            emptyLine={t("No task is scheduled.")} onRetry={() => void q.refetch()}
          />
        </div>
        <section aria-labelledby="automation-chain-h">
          <h2 id="automation-chain-h" className="nx-rn-h3">{t("The chain")}</h2>
          <Stepper
            label={t("Automation chain")}
            orientation="vertical"
            steps={stages.map((s) => ({
              id: s.stage,
              label: STAGE_LABEL[s.stage](),
              state: stepState(s),
              detail: (
                <span className="nx-cell-stack" data-testid={`automation-stage-${s.stage}`}>
                  <span>{s.last_at ? t("Last {when}: {status}", { when: relTime(s.last_at), status: labelText(s.last_status ?? "") }) : t("Has not run yet")}</span>
                  <span className="nx-sub">{t("Next run {when}", { when: when(s.next_run_at, t("not scheduled")) })}</span>
                  {stageFigures(s) ? <span className="nx-sub">{stageFigures(s)}</span> : null}
                </span>
              ),
            }))}
          />
        </section>
        <DataTable rows={d?.tasks ?? []} columns={taskCols} rowKey={(x) => x.key} rowLabel={(x) => x.key} caption={t("Scheduled tasks")} empty={{ heading: t("No task is scheduled.") }} />
        <DataTable
          rows={d?.schedules ?? []} columns={schedCols} rowKey={(s) => s.id} rowLabel={(s) => s.name ?? s.id} caption={t("Run schedules")}
          empty={{ heading: t("No run schedule yet"), text: t("Add one on a system to pull its data on a timetable.") }}
        />
        <p className="nx-sub">{t("Times are in your time zone. Scheduled tasks are shared by the platform; results and run schedules are your organisation's only.")}</p>
      </QueryView>
    </div>
  );
}
