"use client";

/**
 * Steward inbox: every open stewardship task in one list. Ports the legacy
 * workbench inbox's data wiring (views, sorts, assign, resolve, escalate,
 * bulk approve, AI feedback) onto @/design. Replaces the
 * legacy A/R/E/N/X/. keymap with j/k row focus + enter to open the fix sheet
 * (spec 6.2); the actions themselves move to buttons so nothing is dropped.
 * The keys are listed once, in `INBOX_SHORTCUTS` (lib/shortcuts.ts); `?` opens
 * the shell's shortcut sheet with the Inbox group first, so this page keeps no list of its own.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Card, ConfirmDialog, Drawer, ErrorState, ExplorerPage, Field, FilterChip, IconButton, IconMore, Menu, Notice, PageHeader, Pill, Select, Skeleton, Tabs, Textarea, toast, type MenuItemDef, type PillTone, Input, Mono, Status } from "@/design";
import { ProposalCell, proposalOf } from "@/components/fix/proposal";
import { Fact, Workbench, type WorkbenchItem, type WorkbenchTone } from "@/components/inbox/workbench";
import { ExceptionThread } from "@/components/inbox/exception-thread";
import { QuickFilters } from "@/components/inbox/quick-filters";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { assignItem, bulkApprove, escalateItem, getMetrics, getQueueItems, resolveItem, submitAiFeedback } from "@/lib/api/stewardship";
import { bulkTriage } from "@/lib/api/triage";
import { getAssignableUsers, getUsers } from "@/lib/api/users";
import { getCleaningItem, type CleaningQueueItem } from "@/lib/api/cleaning";
import { getContracts } from "@/lib/api/contracts";
import { getGlossaryTerm } from "@/lib/api/glossary";
import { getMasterRecord } from "@/lib/api/master-records";
import { getReviewPair, type ReviewPair } from "@/lib/api/match-review";
import { getException } from "@/lib/api/exceptions";
import { getRule } from "@/lib/api/rules";
import { type RuleNameOf, useRuleNames } from "@/lib/rule-name";
import { getCostModel } from "@/lib/api/settings";
import type { RootCauseType } from "@/lib/api/config-intelligence";
import { HIGH_CONFIDENCE_LABEL } from "@/lib/api/remediation";
import {
  assignException,
  createExceptionRule,
  escalateException,
  getExceptionMetrics,
  getExceptionRules,
  getExceptions,
  resolveException,
  updateExceptionRule,
} from "@/lib/api/exceptions";
import { apiErrorMessage, apiErrorState, isNotFound } from "@/lib/error";
import { MODULE_LABELS, formatDate, formatInt, formatModuleName, formatMoney, labelOf, relativeTime } from "@/lib/format";
import { inboxKeyHandler, keyBelongsElsewhere } from "@/lib/inbox-keys";
import { queryKeys } from "@/lib/query-keys";
import { ApprovalsPanel, SapMonitorPanel } from "./inbox-panels";
import { EXC_PAGE, RECORD_ISSUES_HREF, exceptionObject, exceptionTaskName, taskObject, taskSourceLink } from "./task-source";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import type { Exception, ExceptionRule, ExceptionStatus, Severity, StewardshipQueueItem, StewardshipStatus } from "@/types/api";

const HOUR = 3_600_000;
// Every status still waiting on a steward; the list endpoint filters one status at a time.
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const STATUS_TONE: Record<StewardshipStatus, PillTone> = { open: "neutral", in_progress: "at-risk", escalated: "no-go", resolved: "go" };
const EXC_STATUS_TONE: Record<ExceptionStatus, PillTone> = { open: "neutral", investigating: "at-risk", pending_approval: "at-risk", resolved: "go", verified: "go", closed: "neutral" };
/** The tabs. Exceptions are a view of Tasks (the Show filter); record issues are worked in Fix work (RECORD_ISSUES_HREF). */
const KINDS = [
  { value: "task", label: "Tasks" },
  { value: "approvals", label: "Approvals" },
  { value: "sap", label: "SAP signals" },
];
/** Every kind a URL may name. */
const KIND_VALUES = ["task", "exception", "approvals", "sap"] as const;
/** The Tasks tab's two lists: the stewardship queue and the exceptions the exception rules raised. */
const SHOW = [{ value: "task", label: "Queue tasks" }, { value: "exception", label: "Exceptions" }];
/** Who holds the task. Stacks with WHEN and the priority filter. */
const WHO = [{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }, { value: "unassigned", label: "Unassigned" }] as const;
/** How urgent it is: past due (red), due inside the next 24 hours (amber), or escalated. */
const WHEN = [{ value: "any", label: "Any time" }, { value: "overdue", label: "Overdue" }, { value: "soon", label: "Due in 24 hours" }, { value: "escalated", label: "Escalated" }] as const;
type Who = (typeof WHO)[number]["value"];
type When = (typeof WHEN)[number]["value"];
/** Older links put the urgency in `view`; they still land on the same list. */
const LEGACY: Record<string, When> = { breached: "overdue", today: "soon", escalated: "escalated" };
/** Own keys only, so ?view=constructor or __proto__ never reads a prototype member. */
const legacyWhen = (v: string): When | undefined => (Object.hasOwn(LEGACY, v) ? LEGACY[v] : undefined);
const WHO_CHIP: Record<Who, string> = { all: "", mine: "Mine", unassigned: "Unassigned" };
const WHEN_CHIP: Record<When, string> = { any: "", overdue: "Overdue", soon: "Due in 24 hours", escalated: "Escalated" };
const PURPOSE: Record<string, string> = {
  task: "Fixes and matches waiting for a steward. Claim one, check it, then approve or reject it",
  exception: "Business exceptions raised by your exception rules. Assign, escalate or resolve each one",
  sap: "Live signals from SAP, such as failed jobs and locked records. Open one to see what happened",
  approvals: "Fix batches and SAP write-backs that wait for a second person. Approve the ones you did not request",
};
/** How many tasks per status the list loads at a time (the API's ceiling, api/routes/stewardship.py); "Load more" adds the next page. */
const PAGE = 200;
/** The exception engine's rule kinds (api/services/exception_engine.py). */
const RULE_TYPES = [
  { value: "field_condition", label: "Field condition" }, { value: "threshold", label: "Threshold" },
  { value: "temporal", label: "Temporal" }, { value: "relationship", label: "Relationship" },
];
const OBJECT_OPTIONS = Object.keys(MODULE_LABELS).sort().map((m) => ({ value: m, label: formatModuleName(m) }));
const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
];
/** The resolution kinds the exceptions API bills (api/routes/exceptions.py billing_map). */
const RESOLUTION_TYPES = [
  { value: "steward_resolved", label: "Resolved by a steward" }, { value: "auto_resolved", label: "Resolved itself" },
  { value: "dedup", label: "Resolved by a merge" }, { value: "custom_rule", label: "Resolved by a custom rule" },
];
/** The root-cause vocabulary the config-intelligence API uses for findings. */
const ROOT_CAUSES: { value: RootCauseType | "other"; label: string }[] = [
  { value: "bad_data", label: "Bad data" }, { value: "bad_config", label: "Bad configuration" },
  { value: "bad_data_and_config", label: "Bad data and bad configuration" }, { value: "process_gap", label: "Process gap" }, { value: "other", label: "Other" },
];
/** Stands in for "no due date" so those tasks sort last. */
const NO_DUE = Number.MAX_SAFE_INTEGER;
const BULK_CONFIDENCE = 0.85;
const DAY = 24 * HOUR;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const priorityLabel = (p: number) => (p === 1 ? "Priority 1 (highest)" : `Priority ${p}`);

/** 45m, 5h, 3d */
function span(ms: number): string {
  const h = Math.abs(ms) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  return h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

type Sla = { state: "none" | "ok" | "risk" | "breached"; remaining: number | null };

/** Time left against the task's due date (or created + SLA hours): overdue once past it, due soon inside the last 24 hours. */
function slaOf(t: StewardshipQueueItem, now: number): Sla {
  const due = t.due_at ? Date.parse(t.due_at) : t.sla_hours ? Date.parse(t.created_at) + t.sla_hours * HOUR : null;
  if (due === null || Number.isNaN(due)) return { state: "none", remaining: null };
  const remaining = due - now;
  if (remaining < 0) return { state: "breached", remaining };
  return { state: remaining < DAY ? "risk" : "ok", remaining };
}

const SLA_TONE: Record<Sla["state"], PillTone> = { none: "neutral", ok: "go", risk: "at-risk", breached: "no-go" };
const slaText = (s: Sla) => (s.remaining === null ? "No due date" : s.remaining < 0 ? `${span(s.remaining)} overdue` : `Due in ${span(s.remaining)}`);

/** The severity bar of a task row: its SLA state on the severity scale, so the list ranks by what is about to breach. */
const SLA_BAR: Record<Sla["state"], WorkbenchTone> = { breached: "critical", risk: "medium", ok: "low", none: "low" };

/** SLA pill of an exception: over, inside its last day, or comfortable. */
function excSla(deadline: string | null, now: number): { tone: PillTone; text: string; bar: WorkbenchTone } {
  if (!deadline) return { tone: "neutral", text: "No due date", bar: "low" };
  const remaining = Date.parse(deadline) - now;
  if (remaining < 0) return { tone: "no-go", text: `${span(remaining)} overdue`, bar: "critical" };
  return { tone: remaining < DAY ? "at-risk" : "go", text: `Due in ${span(remaining)}`, bar: remaining < DAY ? "medium" : "low" };
}

/** Run one call per task; report how many went through rather than failing the batch on the first error. */
async function each(ids: string[], fn: (id: string) => Promise<unknown>): Promise<{ ok: number; failed: number }> {
  const r = await Promise.allSettled(ids.map(fn));
  const ok = r.filter((x) => x.status === "fulfilled").length;
  return { ok, failed: r.length - ok };
}

/**
 * "Merge decision in Material master"; an exception task is named by its check, "Custom Rule: Blank material group
 * in Material master" (its exception's title, else the queue's source title, else its check's name), never a bare
 * "Exception" when anything names it. Just the name when the object is unknown, never "in Unknown".
 */
const taskTitle = (t: StewardshipQueueItem, exc?: Exception | null, ruleName?: RuleNameOf) => {
  const what = exceptionTaskName(t, exc, ruleName) ?? labelOf(t.item_type);
  const d = taskObject(t, exc);
  return d ? `${what} in ${formatModuleName(d)}` : what;
};
/** The checks the catalogue has to name: an exception task with no title of its own is named by its check. */
const unnamedChecks = (items: readonly StewardshipQueueItem[]) =>
  items.filter((t) => t.item_type === "exception" && !t.source_title && !!t.source_check_id).map((t) => t.source_check_id);
/** An exception named by its check and object, as its task is. */
const exceptionTitle = (e: Exception) => {
  const d = exceptionObject(e);
  return d ? `${e.title} in ${formatModuleName(d)}` : e.title;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type QueueCache = { items: StewardshipQueueItem[] };
type QueueSnapshot = [readonly unknown[], QueueCache][];

export default function InboxPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  const { user } = useAuth();
  const { can } = useRole();
  const dayOne = useDayOne();
  // Backend guards (api/routes/stewardship.py): resolve, assign and bulk approve need `approve`; escalate needs `view`.
  const canApprove = can("approve");
  const canSeeTeam = can("assign");
  const canManageRules = can("manage_rules");
  // Reassigning to another person goes through the triage bulk endpoint, which needs `assign`.
  const canReassign = can("assign");
  const [viewRaw, setView] = useUrlState("view", "all");
  const [whenRaw, setWhen] = useUrlState("due", "any");
  const [prioRaw, setPrio] = useUrlState("prio", "");
  const [typeRaw, setType] = useUrlState("type", "all");
  const [assigneeRaw, setAssignee] = useUrlState("assignee", "");
  const [kindRaw, setKind] = useUrlState("kind", "task");
  // Approvals needs `approve` (to decide) or `view_audit` (to read the four-eyes evidence), as the pages it replaces did.
  const canSeeApprovals = canApprove || can("view_audit");
  const view: Who = oneOf(viewRaw, WHO.map((v) => v.value), "all");
  const when: When = legacyWhen(viewRaw) ?? oneOf(whenRaw, WHEN.map((v) => v.value), "any");
  // A deep link to Approvals by anyone else falls back to Tasks.
  const kind = oneOf(kindRaw, KIND_VALUES.filter((k) => k !== "approvals" || canSeeApprovals), "task");
  const isExceptions = kind === "exception";
  // The retired Issues tab: its records are worked in Fix work, on the viewer's own list.
  useEffect(() => { if (kindRaw === "issues") router.replace(RECORD_ISSUES_HREF); }, [kindRaw, router]);
  // In the URL, so a search survives a reload and can be shared.
  const [search, setSearch] = useUrlState("q", "");
  // One replace: separate useUrlState setters would each rebuild the query from the same stale string.
  const showAll = (alsoSearch: boolean) => {
    const params = new URLSearchParams(urlParams.toString());
    for (const k of ["view", "type", "due", "prio", "assignee", ...(alsoSearch ? ["q"] : [])]) params.delete(k);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  // An older link (?view=breached) is rewritten once to the stacked filters, so the pills can change it afterwards.
  useEffect(() => {
    const legacy = legacyWhen(viewRaw);
    if (!legacy) return;
    const params = new URLSearchParams(urlParams.toString());
    params.delete("view");
    params.set("due", legacy);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [viewRaw, urlParams, pathname, router]);
  const [rawFocusedIndex, setFocusedIndex] = useState(0);
  // `?focus=` (a link from MDM or a notification) lands on that task once the list holds it.
  const focusId = urlParams.get("focus");
  const [focusDone, setFocusDone] = useState<string | null>(null);
  const [rollbackNote, setRollbackNote] = useState<string | null>(null);
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [resolutionType, setResolutionType] = useState("steward_resolved");
  const [rootCause, setRootCause] = useState("other");
  const [escalateIds, setEscalateIds] = useState<string[] | null>(null);
  const [approveIds, setApproveIds] = useState<string[] | null>(null);
  /** The one task the detail pane's Approve asks about. There is no un-approve endpoint, so it confirms first. */
  const [approveOne, setApproveOne] = useState<StewardshipQueueItem | null>(null);
  /** The task `r` armed; Enter approves it (the keyboard's confirm step). There is no un-approve endpoint, so no undo toast. */
  const [armed, setArmed] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState({ name: "", description: "", rule_type: "field_condition", object_type: "", condition: "", severity: "medium" as Severity });
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [pages, setPages] = useState(1);
  const [excPages, setExcPages] = useState(1);

  // One query per status and page, by offset: "Load more" adds the next page and keeps the rows already on screen
  // (the API takes at most PAGE a call, so widening one limit would be refused). Page-major, so new pages append.
  const queues = useQueries({
    queries: Array.from({ length: pages }, (_, i) => i * PAGE).flatMap((offset) => LIVE.map((status) => ({
      queryKey: queryKeys.inbox({ status, limit: PAGE, offset }),
      queryFn: () => getQueueItems({ status, limit: PAGE, offset }),
      placeholderData: keepPreviousData,
      refetchInterval: 60_000,
      enabled: !isExceptions,
    }))),
  });
  // Amounts print in the tenant's currency code (the cost model); without it the number stands alone.
  const costModel = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel, enabled: isExceptions, retry: false, meta: { ignoreError: true }, staleTime: 300_000 });
  const metricsQ = useQuery({ queryKey: queryKeys.stewardshipMetrics(), queryFn: getMetrics, refetchInterval: 60_000, enabled: !isExceptions });
  // The user list needs `manage_users`; without it assignees show as "You" or an id prefix.
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: can("manage_users") });
  // People a task can be handed to; needs `assign`, and also names assignees for roles without `manage_users`.
  const assignableQ = useQuery({ queryKey: ["users", "assignable"], queryFn: getAssignableUsers, enabled: canReassign, staleTime: 300_000 });

  // The exceptions API pages at most 100 a call; "Load more" adds the next page.
  const excPageQs = useQueries({
    queries: Array.from({ length: excPages }, (_, i) => ({
      queryKey: queryKeys.inbox({ kind: "exception", per_page: EXC_PAGE, page: i + 1 }),
      queryFn: () => getExceptions({ per_page: EXC_PAGE, page: i + 1 }),
      refetchInterval: 60_000,
      enabled: isExceptions,
    })),
  });
  const excQ = excPageQs[0]!;
  // Exception tasks are titled by their exception's check and object: the first page of exceptions names them
  // (the same query and cache entry as the Exceptions list); the detail pane reads any other one by id.
  const hasExcTasks = queues.some((q) => q.data?.items?.some((t) => t.item_type === "exception"));
  const excIndexQ = useQuery({
    queryKey: queryKeys.inbox({ kind: "exception", per_page: EXC_PAGE, page: 1 }),
    queryFn: () => getExceptions({ per_page: EXC_PAGE, page: 1 }),
    enabled: !isExceptions && hasExcTasks,
    meta: { ignoreError: true },
  });
  const excById = useMemo(() => new Map((excIndexQ.data?.exceptions ?? []).map((e) => [e.id, e])), [excIndexQ.data]);
  const excOf = useCallback((t: StewardshipQueueItem) => (t.item_type === "exception" ? excById.get(t.source_id) ?? null : null), [excById]);
  // A task whose exception has no title is named by its linked check: the catalogue names it.
  const ruleNameOf: RuleNameOf = useRuleNames(queues.flatMap((q) => unnamedChecks(q.data?.items ?? [])));
  const excLoaded = useMemo(() => excPageQs.flatMap((q) => q.data?.exceptions ?? []), [excPageQs]);
  const excTotal = excQ.data?.total ?? 0;
  const excMetricsQ = useQuery({ queryKey: queryKeys.exceptionMetrics(), queryFn: () => getExceptionMetrics(), enabled: isExceptions });
  const excRulesQ = useQuery({ queryKey: queryKeys.exceptionRules(), queryFn: getExceptionRules, enabled: isExceptions && rulesOpen });

  // Only the first page decides "loading": a page being added never blanks the list already shown.
  const isLoading = queues.slice(0, LIVE.length).some((q) => q.isLoading);
  const queueFetching = queues.some((q) => q.isFetching);
  // A 404 means no queue yet: that is the empty state, not an error.
  const failedQueue = queues.find((q) => q.isError && !isNotFound(q.error));
  const isError = !!failedQueue;
  const excFailed = excQ.isError && !isNotFound(excQ.error);
  const firstError = isExceptions ? excQ.error : failedQueue?.error;
  // SLA maths runs against the last fetch time, so it stays pure and refreshes with the data.
  const now = isExceptions ? excQ.dataUpdatedAt : Math.max(0, ...queues.map((q) => q.dataUpdatedAt));
  // Deduplicated: a task decided between two page loads shifts the offsets, so one may arrive on two pages.
  const all = useMemo(() => [...new Map(queues.flatMap((q) => q.data?.items ?? []).map((t) => [t.id, t])).values()], [queues]);
  // The server's count of every open task, from the first page of each status, however many pages are loaded.
  const queueTotal = queues.slice(0, LIVE.length).reduce((n, q) => n + (q.data?.total ?? 0), 0);
  /** More tasks are open than are loaded, so counts taken from the loaded rows cover only the newest ones. */
  const partial = queueTotal > all.length;

  // Guarded: an unexpected payload must not take the whole inbox down.
  const assignable = useMemo(() => (Array.isArray(assignableQ.data) ? assignableQ.data : []), [assignableQ.data]);
  const directory = useMemo(() => [...assignable, ...(Array.isArray(usersQ.data?.users) ? usersQ.data.users : [])], [usersQ.data, assignable]);
  const names = useMemo(() => new Map(directory.map((u) => [u.id, u.name || u.email])), [directory]);
  const people = useMemo(
    () => assignable.filter((u) => u.id !== user?.id).map((u) => ({ value: u.id, label: u.name || u.email })),
    [assignable, user?.id],
  );
  // `?assignee=` comes from the owners view's "Open inbox" (a user id); a display name or an email also matches.
  const assignee = assigneeRaw.trim();
  const assigneeIds = useMemo(() => {
    if (!assignee) return null;
    const a = assignee.toLowerCase();
    const ids = new Set(directory.filter((u) => (u.name ?? "").toLowerCase() === a || (u.email ?? "").toLowerCase() === a).map((u) => u.id));
    ids.add(assignee);
    if (user && (user.email?.toLowerCase() === a || user.name?.toLowerCase() === a)) ids.add(user.id);
    return ids;
  }, [assignee, directory, user]);
  const who = useCallback(
    (id: string | null) => (!id ? "Unassigned" : id === user?.id ? "You" : names.get(id) ?? "Unknown user"),
    [names, user?.id],
  );

  // The Owner chip names the person: `?assignee=` may be a user id (the owners view's "Open inbox"), never shown raw.
  const assigneeLabel = !assignee ? "" : assignee === user?.id || names.has(assignee) ? who(assignee) : UUID_RE.test(assignee) ? "Unknown user" : assignee;

  // A type is only a filter when the loaded tasks carry it; unknown values apply nothing.
  const type = useMemo(() => oneOf(typeRaw, [...new Set(all.map((t) => t.item_type))], "all"), [typeRaw, all]);
  const priorities = useMemo(() => [...new Set(all.map((t) => t.priority))].sort((a, b) => a - b), [all]);
  const prio = priorities.includes(Number(prioRaw)) ? Number(prioRaw) : null;
  const matchesWho = useCallback((t: StewardshipQueueItem, w: Who) =>
    w === "all" || (w === "mine" ? t.assigned_to === user?.id : !t.assigned_to), [user?.id]);
  const matchesWhen = useCallback((t: StewardshipQueueItem, w: When) => {
    if (w === "any") return true;
    if (w === "escalated") return t.status === "escalated";
    const s = slaOf(t, now).state;
    return w === "overdue" ? s === "breached" : s === "risk";
  }, [now]);
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter((t) => {
      if (type !== "all" && t.item_type !== type) return false;
      if (prio !== null && t.priority !== prio) return false;
      if (assigneeIds && !(t.assigned_to && assigneeIds.has(t.assigned_to))) return false;
      if (!matchesWho(t, view) || !matchesWhen(t, when)) return false;
      return !q || [t.id, t.source_id, t.domain, t.item_type, who(t.assigned_to), taskTitle(t, excOf(t), ruleNameOf)].some((v) => v.toLowerCase().includes(q));
    });
    const due = (t: StewardshipQueueItem) => slaOf(t, now).remaining ?? NO_DUE;
    return rows.sort((x, y) => due(x) - due(y) || x.priority - y.priority);
  }, [all, type, prio, view, when, search, now, who, matchesWho, matchesWhen, assigneeIds, excOf, ruleNameOf]);

  const excItems = useMemo(() => {
    const excAll = excLoaded;
    const q = search.trim().toLowerCase();
    const rows = excAll.filter((e) => !q || [e.id, exceptionTitle(e), e.category, e.type, e.status, who(e.assigned_to)].some((v) => v.toLowerCase().includes(q)));
    const due = (e: Exception) => (e.sla_deadline ? Date.parse(e.sla_deadline) : NO_DUE);
    return [...rows].sort((a, b) => due(a) - due(b));
  }, [excLoaded, search, who]);

  // Clamped at read time (not in an effect) so a shrinking list never points past its last row.
  const rowCount = isExceptions ? excItems.length : items.length;
  const focusedIndex = Math.min(rawFocusedIndex, Math.max(rowCount - 1, 0));
  // State adjusted during render (the React-documented pattern): the linked task is focused once, when it first appears.
  if (focusId && focusDone !== focusId) {
    const at = (isExceptions ? excItems : items).findIndex((x) => x.id === focusId);
    if (at >= 0) { setFocusDone(focusId); setFocusedIndex(at); }
  }

  const typeOptions = useMemo(
    () => [{ value: "", label: "All types" }, ...[...new Set(all.map((t) => t.item_type))].sort().map((t) => ({ value: t, label: labelOf(t) }))],
    [all],
  );

  // Each row's counts honour the other row's choice, so the numbers on the pills are what a click would show.
  const counts = useMemo(() => {
    const byWho = all.filter((t) => matchesWhen(t, when));
    const byWhen = all.filter((t) => matchesWho(t, view));
    return {
      who: Object.fromEntries(WHO.map((w) => [w.value, byWho.filter((t) => matchesWho(t, w.value)).length])) as Record<Who, number>,
      when: Object.fromEntries(WHEN.map((w) => [w.value, byWhen.filter((t) => matchesWhen(t, w.value)).length])) as Record<When, number>,
      overdue: all.filter((t) => matchesWhen(t, "overdue")).length,
      soon: all.filter((t) => matchesWhen(t, "soon")).length,
    };
  }, [all, view, when, matchesWho, matchesWhen]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    void qc.invalidateQueries({ queryKey: queryKeys.stewardshipMetrics() });
    void qc.invalidateQueries({ queryKey: queryKeys.exceptionMetrics() });
    void qc.invalidateQueries({ queryKey: queryKeys.unreadNotifications() });
    // The rail's Inbox count and the steward home's top tasks read the same queue.
    void qc.invalidateQueries({ queryKey: queryKeys.shellCounts() });
    void qc.invalidateQueries({ queryKey: ["home-inbox-top"] });
  }, [qc]);
  const done = useCallback((verb: string, r: { ok: number; failed: number }) => {
    if (r.ok) toast(`${verb} ${plural(r.ok, "task")}`);
    if (r.failed) toast.error(`${plural(r.failed, "task")} not ${verb.toLowerCase()}`);
    refresh();
  }, [refresh]);

  /** Optimistic edit of every cached queue page; returns the snapshot so a failure can restore it. */
  const patchQueue = useCallback(async (ids: string[], fn: (t: StewardshipQueueItem) => StewardshipQueueItem | null): Promise<QueueSnapshot> => {
    await qc.cancelQueries({ queryKey: ["inbox"] });
    const snap: QueueSnapshot = [];
    for (const [key, data] of qc.getQueriesData<QueueCache>({ queryKey: ["inbox"] })) {
      if (!data || !Array.isArray(data.items)) continue;
      snap.push([key, data]);
      qc.setQueryData<QueueCache>(key, { ...data, items: data.items.flatMap((t) => (ids.includes(t.id) ? [fn(t)].filter((x): x is StewardshipQueueItem => x !== null) : [t])) });
    }
    return snap;
  }, [qc]);
  const rollback = useCallback((snap: QueueSnapshot | undefined, msg: string) => {
    snap?.forEach(([key, data]) => qc.setQueryData(key, data));
    setRollbackNote(msg);
  }, [qc]);

  const approve = useMutation({
    onMutate: async (ids: string[]) => { setRollbackNote(null); return { snap: await patchQueue(ids, () => null) }; },
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? resolveItem(ids[0], "approve").then(() => ({ approved: 1, asked: 1 })) : bulkApprove(ids, BULK_CONFIDENCE).then((d) => ({ approved: d.approved, asked: ids.length })),
    onSuccess: ({ approved, asked }) => {
      setApproveIds(null);
      setApproveOne(null);
      toast(`Approved ${plural(approved, "task")}`);
      if (asked > approved) toast(`${asked - approved} below ${HIGH_CONFIDENCE_LABEL} or already closed, left for manual review`);
      refresh();
    },
    // The server may have closed the task (a stale write-back is resolved with a 409): put the snapshot back, say
    // the server's reason and refetch, so the inbox never offers a task that is already closed.
    onError: (e, _ids, ctx) => { setApproveIds(null); setApproveOne(null); rollback(ctx?.snap, `Not approved: ${apiErrorMessage(e)}`); refresh(); },
  });
  // Rejecting overrides the model's recommendation: the correction reason is recorded on the task
  // and fed to the AI-feedback loop that proposes new match rules (/ai/rules).
  const reject = useMutation({
    onMutate: async ({ ids }: { ids: string[]; reason: string }) => { setRollbackNote(null); return { snap: await patchQueue(ids, () => null) }; },
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) =>
      each(ids, async (id) => {
        await resolveItem(id, "reject", why);
        const t = all.find((x) => x.id === id);
        if (t) await submitAiFeedback({ queue_item_id: id, steward_decision: "reject", correction_reason: why, domain: t.domain });
      }),
    onSuccess: (r) => { setRejectIds(null); setReason(""); done("Rejected", r); },
    onError: (e, _v, ctx) => { rollback(ctx?.snap, `Not rejected: ${apiErrorMessage(e)}`); refresh(); },
  });
  const escalate = useMutation({
    mutationFn: (ids: string[]) => each(ids, escalateItem),
    onSuccess: (r) => done("Escalated", r),
    onError: (e) => toast.error(`Not escalated: ${apiErrorMessage(e)}`),
  });
  const assign = useMutation({
    onMutate: async ({ ids, userId }: { ids: string[]; userId: string }) => { setRollbackNote(null); return { snap: await patchQueue(ids, (t) => ({ ...t, assigned_to: userId })) }; },
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => each(ids, (id) => assignItem(id, userId)),
    onSuccess: (r) => done("Claimed", r),
    onError: (e, _v, ctx) => rollback(ctx?.snap, `Not claimed: ${apiErrorMessage(e)}`),
  });
  // Release: back to the unassigned pool (same `approve` guard as Claim); a claimed task reopens.
  const release = useMutation({
    onMutate: async (ids: string[]) => { setRollbackNote(null); return { snap: await patchQueue(ids, (t) => ({ ...t, assigned_to: null, status: t.status === "in_progress" ? "open" : t.status })) }; },
    mutationFn: (ids: string[]) => each(ids, (id) => assignItem(id, null)),
    onSuccess: (r) => done("Released", r),
    onError: (e, _v, ctx) => rollback(ctx?.snap, `Not released: ${apiErrorMessage(e)}`),
  });
  // Hand tasks to someone else in one call; the server records each change and restarts the SLA clock.
  const reassign = useMutation({
    onMutate: async ({ ids, userId }: { ids: string[]; userId: string }) => { setRollbackNote(null); return { snap: await patchQueue(ids, (t) => ({ ...t, assigned_to: userId })) }; },
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => bulkTriage({ kind: "queue", ids, action: "reassign", user_id: userId }),
    onSuccess: (r, { ids, userId }) => done(`Reassigned to ${who(userId)}:`, { ok: r.updated, failed: ids.length - r.updated }),
    onError: (e, _v, ctx) => rollback(ctx?.snap, `Not reassigned: ${apiErrorMessage(e)}`),
  });

  // Exception mutations: same intent (assign/escalate/resolve) as the stewardship ones above, but
  // the exceptions API (lib/api/exceptions.ts) takes structured bodies with different field names —
  // reconciled here rather than in a second table, per the task brief.
  const excAssign = useMutation({
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => each(ids, (id) => assignException(id, { user_id: userId, user_name: names.get(userId) })),
    onSuccess: (r) => done("Assigned", r),
    onError: (e) => toast.error(`Not assigned: ${apiErrorMessage(e)}`),
  });
  const excEscalate = useMutation({
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) => each(ids, (id) => escalateException(id, { reason: why })),
    onSuccess: (r) => { setEscalateIds(null); setReason(""); done("Escalated", r); },
    onError: (e) => toast.error(`Not escalated: ${apiErrorMessage(e)}`),
  });
  const excResolve = useMutation({
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) =>
      each(ids, (id) => resolveException(id, { resolution_type: resolutionType, resolution_notes: why, root_cause_category: rootCause })),
    onSuccess: (r) => { setRejectIds(null); setReason(""); done("Resolved", r); },
    onError: (e) => toast.error(`Not resolved: ${apiErrorMessage(e)}`),
  });
  const busy = isExceptions
    ? excAssign.isPending || excEscalate.isPending || excResolve.isPending
    : approve.isPending || reject.isPending || escalate.isPending || assign.isPending || release.isPending || reassign.isPending;

  // Enter opens what the task points at: its id is a pair, golden record, proposal, exception, contract or term id,
  // never an SAP record key, so the target follows the task type (a proposal opens its record by its key).
  const openRecord = useCallback((index: number) => {
    if (isExceptions) return false; // exceptions have no object/record to open — the row carries its own detail.
    const t = items[index];
    if (!t) return false;
    void resolveTaskLink(qc, t).then((link) => { if (link) router.push(link.href); });
    return true;
  }, [isExceptions, items, router, qc]);

  // The keys belong to the task and exception workbenches only; the other tabs own their tables.
  const keysLive = kind === "task" || kind === "exception";
  useEffect(() => {
    if (!keysLive) return;
    const onKey = (ev: KeyboardEvent) => {
      // Fields, dialogs, menus and other buttons keep their keys; Enter on a queue row still opens the record.
      if (keyBelongsElsewhere(ev, "[data-tour=inbox-queue] li")) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = isExceptions ? null : items[focusedIndex];
      const e = isExceptions ? excItems[focusedIndex] : null;
      // `r` arms the focused task; the next Enter approves it and any other key disarms it.
      if (armed) {
        setArmed(null);
        if (ev.key === "Enter" && t && t.id === armed && canApprove && !busy) { ev.preventDefault(); approve.mutate([t.id]); return; }
      }
      switch (ev.key) {
        case "Escape": setRejectIds(null); setEscalateIds(null); setApproveIds(null); setApproveOne(null); setRulesOpen(false); return;
        case "a": if (t && canApprove && !busy && user) { ev.preventDefault(); assign.mutate({ ids: [t.id], userId: user.id }); } else if (e && canSeeTeam && !busy && user) { ev.preventDefault(); excAssign.mutate({ ids: [e.id], userId: user.id }); } return;
        // The keyboard's confirm step: `r` says what Enter will approve, in the same words as the Approve dialog.
        case "r": if (t && canApprove && !busy) { ev.preventDefault(); setArmed(t.id); toast(`Press Enter to ${approveCopy(t, qc.getQueryData<CleaningQueueItem>(proposalKey(t.source_id)) ?? null, qc.getQueryData<ReviewPair>(pairKey(t.source_id)) ?? null).action}`); } else if (e && canApprove && !busy) { ev.preventDefault(); setRejectIds([e.id]); } return;
        case "x": if (t && canApprove) { ev.preventDefault(); setRejectIds([t.id]); } return;
        default: inboxKeyHandler(ev, { focusedIndex, rowCount, setFocus: setFocusedIndex, onOpen: openRecord });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysLive, armed, focusedIndex, rowCount, openRecord, isExceptions, items, excItems, canApprove, canSeeTeam, busy, user, assign, approve, excAssign, qc]);

  const createRule = useMutation({
    mutationFn: () => createExceptionRule({ ...ruleDraft, auto_assign_to: undefined }),
    onSuccess: () => {
      toast("Exception rule created");
      setRuleDraft({ name: "", description: "", rule_type: "field_condition", object_type: "", condition: "", severity: "medium" });
      void qc.invalidateQueries({ queryKey: queryKeys.exceptionRules() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => updateExceptionRule(id, { is_active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.exceptionRules() }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const taskRows = useMemo<WorkbenchItem[]>(() => items.map((t) => {
    const sla = slaOf(t, now);
    return {
      id: t.id,
      label: `${taskTitle(t, excOf(t), ruleNameOf)}, raised ${formatDate(t.created_at, "datetime")}`,
      title: taskTitle(t, excOf(t), ruleNameOf),
      // Separate sentences: who holds it, how urgent, how old.
      meta: `${who(t.assigned_to)}. Priority ${t.priority}. Raised ${span(now - Date.parse(t.created_at))} ago.`,
      aside: <Pill tone={SLA_TONE[sla.state]}>{slaText(sla)}</Pill>,
      tone: SLA_BAR[sla.state],
    };
  }), [items, now, who, excOf, ruleNameOf]);
  const excRows = useMemo<WorkbenchItem[]>(() => excItems.map((e) => {
    const sla = excSla(e.sla_deadline, now);
    return {
      id: e.id,
      label: exceptionTitle(e),
      title: exceptionTitle(e),
      meta: `${labelOf(e.category)}. ${labelOf(e.status)}. ${who(e.assigned_to)}.`,
      aside: <Pill tone={sla.tone}>{sla.text}</Pill>,
      tone: e.severity === "critical" || e.severity === "high" || e.severity === "medium" || e.severity === "low" ? e.severity : "low",
    };
  }), [excItems, now, who]);
  const onCheck = useCallback((id: string, on: boolean) => setChecked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const onCheckAll = useCallback((on: boolean) => setChecked(new Set(on ? (isExceptions ? excItems : items).map((r) => r.id) : [])), [isExceptions, excItems, items]);
  const selectedTask = isExceptions ? undefined : items[focusedIndex];
  const selectedExc = isExceptions ? excItems[focusedIndex] : undefined;

  // Hold "empty" for the all-tasks view until useDayOne() has resolved too —
  // otherwise the generic "Inbox zero." copy flashes before the day-one step
  // (which decides the real empty-state detail/action) is known.
  const state: "loading" | "empty" | "error" | undefined = isExceptions
    ? excQ.isLoading ? "loading" : excFailed ? "error" : excItems.length === 0 ? "empty" : undefined
    : isLoading ? "loading" : isError ? "error" : items.length === 0 ? (dayOne.status === "loading" ? "loading" : "empty") : undefined;

  const kindToggle = (
    <Tabs items={KINDS.filter((k) => k.value !== "approvals" || canSeeApprovals).map((k) => ({ value: k.value, label: k.label, content: null }))} value={isExceptions ? "task" : kind} onValueChange={setKind} />
  );
  // Open and overdue are the server's totals; an older server sends no task overdue count, so the loaded rows are
  // counted and the header says which part.
  const serverOverdue = metricsQ.data?.overdue_count;
  const aiAcceptance = metricsQ.data?.ai_acceptance_rate ?? null;
  // Suggestion acceptance across all queues, for roles that assign work.
  const acceptance = !isExceptions && canSeeTeam && aiAcceptance != null ? ` Suggestion acceptance: ${Math.round(aiAcceptance * 100)}%.` : "";
  const overdue = isExceptions ? excMetricsQ.data?.overdue_count ?? 0 : serverOverdue ?? counts.overdue;
  const openCount = isExceptions ? excMetricsQ.data?.open_count ?? excItems.length : queueTotal;
  const overdueScope = !isExceptions && partial && serverOverdue == null ? ` in the newest ${formatInt(all.length)}` : "";
  // Counts belong to the tasks and exceptions lists, and only once the list has loaded: a list that failed (or is still
  // loading) states no "0 open, 0 overdue" above its error panel. The other tabs say only what they are for.
  const counted = (kind === "task" || kind === "exception") && state !== "error" && state !== "loading";
  const header = (
    <PageHeader
      title="Inbox"
      // Each part its own sentence: counts, then what the list is for, then the suggestion acceptance.
      meta={counted ? `${formatInt(openCount)} open, ${formatInt(overdue)} overdue${overdueScope}. ${PURPOSE[kind]}.${acceptance}` : PURPOSE[kind]}
      tabs={kindToggle}
      actions={
        isExceptions
          ? canManageRules ? <Button variant="secondary" onClick={() => setRulesOpen(true)}>Exception rules</Button> : undefined
          : undefined
      }
    />
  );

  // The retired Issues tab shows nothing while it hands over to Fix work.
  if (kindRaw === "issues") return <ExplorerPage header={header} state="loading" table={null} />;

  if (kind === "sap" || kind === "approvals") {
    // These views own their data; the hooks above already ran, so returning early is safe.
    const Panel = kind === "sap" ? SapMonitorPanel : ApprovalsPanel;
    return <ExplorerPage header={header} table={<Panel />} />;
  }

  return (
    <ExplorerPage
      header={header}
      state={state}
      emptyProps={
        isExceptions
          ? (excQ.data?.exceptions.length ?? 0) === 0
            ? {
                title: "No exceptions",
                detail: canManageRules
                  ? "Exceptions are raised when a new finding matches an exception rule. Add a rule to start"
                  : "Exceptions are raised when a new finding matches an exception rule. Ask an admin to add one",
                action: canManageRules
                  ? <Button variant="secondary" onClick={() => setRulesOpen(true)}>Exception rules</Button>
                  : <Button variant="secondary" onClick={() => setKind("task")}>Open tasks</Button>,
              }
            : { title: "No exceptions in this view", detail: "Clear the search to see all exceptions", action: <Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button> }
          : all.length === 0
          ? {
              title: "Inbox is clear",
              detail: dayOne.step?.detail ?? "Tasks arrive when findings are assigned or proposals need review.",
              action: <DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />,
            }
          : { title: "No tasks match these filters", detail: "Show all tasks to see the rest of the queue", action: <Button variant="secondary" onClick={() => showAll(true)}>Show all</Button> }
      }
      errorProps={{ error: firstError, onRetry: refresh }}
      // The header carries the open and overdue counts and the When chips carry overdue and due soon, so the only
      // summary is the "Load more" note when the list is partial.
      summary={
        !isExceptions && !isLoading && partial ? (
          <Notice action={<Button variant="secondary" disabled={queueFetching} onClick={() => setPages((n) => n + 1)}>Load more</Button>}>
            Newest {all.length.toLocaleString()} of {queueTotal.toLocaleString()} loaded
          </Notice>
        ) : isExceptions && !excQ.isLoading && excTotal > excLoaded.length ? (
          <Notice action={<Button variant="secondary" disabled={excPageQs.some((q) => q.isFetching)} onClick={() => setExcPages((n) => n + 1)}>Load more</Button>}>
            {excLoaded.length.toLocaleString()} of {excTotal.toLocaleString()} exceptions loaded
          </Notice>
        ) : undefined
      }
      filterBar={
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-2">
            <QuickFilters label="Show" value={isExceptions ? "exception" : "task"} onChange={setKind} options={SHOW} />
          {!isExceptions && (
            <>
              <QuickFilters label="Who" value={view} onChange={(v) => setView(v === "all" ? "" : v)}
                options={WHO.map((w) => ({ value: w.value, label: w.label, count: counts.who[w.value] }))} />
              <QuickFilters label="When" value={when} onChange={(v) => setWhen(v === "any" ? "" : v)}
                options={WHEN.map((w) => ({ value: w.value, label: w.label, count: counts.when[w.value] }))} />
            </>
          )}
          </div>
          {!isExceptions && (
            <Field label="Type">
              <Select value={type === "all" ? "" : type} onValueChange={(v) => setType(v || "all")} options={typeOptions} placeholder="All types" />
            </Field>
          )}
          {!isExceptions && priorities.length > 1 && (
            <Field label="Priority">
              <Select value={prio === null ? "" : String(prio)} onValueChange={setPrio} placeholder="Any priority"
                options={[{ value: "", label: "Any priority" }, ...priorities.map((p) => ({ value: String(p), label: priorityLabel(p) }))]} />
            </Field>
          )}
          <Field label="Search">
            <Input
              aria-label={isExceptions ? "Search exceptions" : "Search tasks"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          {!isExceptions && (view !== "all" || when !== "any" || type !== "all" || prio !== null || !!assignee) && (
            <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
              {view !== "all" && <FilterChip label="Who" value={WHO_CHIP[view]} onRemove={() => setView("")} />}
              {when !== "any" && <FilterChip label="When" value={WHEN_CHIP[when]} onRemove={() => setWhen("")} />}
              {type !== "all" && <FilterChip label="Type" value={labelOf(type)} onRemove={() => setType("")} />}
              {prio !== null && <FilterChip label="Priority" value={priorityLabel(prio)} onRemove={() => setPrio("")} />}
              {assignee && <FilterChip label="Owner" value={assigneeLabel} onRemove={() => setAssignee("")} />}
              <Button variant="ghost" size="sm" onClick={() => showAll(false)}>Clear filters</Button>
            </div>
          )}
          {rollbackNote && <Notice tone="danger">{rollbackNote}</Notice>}
        </div>
      }
      table={
        isExceptions ? (
          <Workbench
            items={excRows}
            selectedId={selectedExc?.id ?? null}
            onSelect={(id) => setFocusedIndex(excItems.findIndex((e) => e.id === id))}
            checked={checked}
            onCheck={onCheck}
            listLabel="Exceptions"
            onCheckAll={onCheckAll}
            bulk={(ids) => (
              <>
                {canSeeTeam && user && <Button variant="secondary" size="sm" disabled={busy} onClick={() => excAssign.mutate({ ids, userId: user.id })}>Claim</Button>}
                {canSeeTeam && people.length > 0 && <ReassignSelect people={people} disabled={busy} onPick={(userId) => excAssign.mutate({ ids, userId })} />}
                {canApprove && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEscalateIds(ids)}>Escalate</Button>}
                {canApprove && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRejectIds(ids)}>Resolve with notes</Button>}
              </>
            )}
            detail={selectedExc ? (
              <ExceptionDetail
                e={selectedExc}
                now={now}
                assignee={who(selectedExc.assigned_to)}
                busy={busy}
                canResolve={canApprove}
                canAssign={canSeeTeam && !!user}
                currency={costModel.data?.currency}
                people={canSeeTeam ? people : []}
                onResolve={() => setRejectIds([selectedExc.id])}
                onEscalate={() => setEscalateIds([selectedExc.id])}
                onAssign={(userId) => excAssign.mutate({ ids: [selectedExc.id], userId: userId ?? user?.id ?? "" })}
              />
            ) : null}
          />
        ) : (
          <Workbench
            items={taskRows}
            selectedId={selectedTask?.id ?? null}
            onSelect={(id) => setFocusedIndex(items.findIndex((t) => t.id === id))}
            checked={checked}
            onCheck={onCheck}
            listLabel="Tasks"
            onCheckAll={onCheckAll}
            bulk={(ids) => (
              <>
                {canApprove && user && <Button variant="secondary" size="sm" disabled={busy} onClick={() => assign.mutate({ ids, userId: user.id })}>Claim</Button>}
                {canApprove && <Button variant="secondary" size="sm" disabled={busy} onClick={() => release.mutate(ids)}>Release</Button>}
                {canReassign && people.length > 0 && <ReassignSelect people={people} disabled={busy} onPick={(userId) => reassign.mutate({ ids, userId })} />}
                {canApprove && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setApproveIds(ids)}>Approve {ids.length.toLocaleString()} at {HIGH_CONFIDENCE_LABEL}</Button>}
                {canApprove && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRejectIds(ids)}>Reject with reason</Button>}
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => escalate.mutate(ids)}>Escalate</Button>
              </>
            )}
            detail={selectedTask ? (
              <TaskDetail
                t={selectedTask}
                exc={excOf(selectedTask)}
                sla={slaOf(selectedTask, now)}
                now={now}
                assignee={who(selectedTask.assigned_to)}
                busy={busy}
                canApprove={canApprove}
                canAssign={canApprove && !!user && selectedTask.assigned_to !== user.id}
                canRelease={canApprove && !!selectedTask.assigned_to}
                people={canReassign ? people : []}
                onApprove={() => setApproveOne(selectedTask)}
                onReject={() => setRejectIds([selectedTask.id])}
                onEscalate={() => escalate.mutate([selectedTask.id])}
                onAssign={() => user && assign.mutate({ ids: [selectedTask.id], userId: user.id })}
                onReassign={(userId) => reassign.mutate({ ids: [selectedTask.id], userId })}
                onRelease={() => release.mutate([selectedTask.id])}
              />
            ) : null}
          />
        )
      }
      drawer={
        <>
          <Drawer
            open={rejectIds !== null}
            onOpenChange={(open) => { if (!open) { setRejectIds(null); setReasonTouched(false); } }}
            title={isExceptions ? "Resolve exception" : "Reject with reason"}
          >
            <div className="flex flex-col gap-3">
              <p className="m-text-body m-ink-2">
                {isExceptions
                  ? "Say what was done, so the next person can see how it was closed."
                  : "Say why the suggestion is wrong. The reason is kept on the task and helps Meridian suggest better next time."}
              </p>
              {isExceptions ? (
                <>
                  <Field label="Resolution">
                    <Select value={resolutionType} onValueChange={setResolutionType} options={RESOLUTION_TYPES} />
                  </Field>
                  <Field label="Root cause">
                    <Select value={rootCause} onValueChange={setRootCause} options={ROOT_CAUSES} />
                  </Field>
                </>
              ) : null}
              <Field label={isExceptions ? "Notes" : "Reason"} error={reasonTouched && !reason.trim() ? "Write a reason first" : undefined}>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setReasonTouched(true)}
                  rows={4}
                />
              </Field>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setRejectIds(null)}>{isExceptions ? "Keep open" : "Keep task open"}</Button>
                <Button
                  variant="primary"
                  disabled={!reason.trim() || reject.isPending || excResolve.isPending}
                  onClick={() =>
                    rejectIds &&
                    (isExceptions ? excResolve.mutate({ ids: rejectIds, reason }) : reject.mutate({ ids: rejectIds, reason }))
                  }
                >
                  {isExceptions ? "Resolve" : "Reject"}
                </Button>
              </div>
            </div>
          </Drawer>
          <Drawer
            open={escalateIds !== null}
            onOpenChange={(open) => !open && setEscalateIds(null)}
            title="Escalate exception"
          >
            <div className="flex flex-col gap-3">
              <Field label="Reason">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
              </Field>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setEscalateIds(null)}>Keep as is</Button>
                <Button variant="primary" disabled={!reason.trim() || excEscalate.isPending} onClick={() => escalateIds && excEscalate.mutate({ ids: escalateIds, reason })}>
                  Escalate
                </Button>
              </div>
            </div>
          </Drawer>
          <ConfirmDialog
            open={approveIds !== null}
            onOpenChange={(open) => !open && setApproveIds(null)}
            title={`Approve ${plural(approveIds?.length ?? 0, "task")}?`}
            body={`Each task whose model suggestion is at ${HIGH_CONFIDENCE_LABEL} is approved. The rest stay open for a manual decision.`}
            confirmLabel={`Approve ${(approveIds?.length ?? 0).toLocaleString()}`}
            cancelLabel="Keep open"
            pending={approve.isPending}
            onConfirm={() => approveIds && approve.mutate(approveIds)}
          />
          {approveOne ? (
            <ApproveTaskDialog
              t={approveOne}
              onOpenChange={(open) => !open && setApproveOne(null)}
              pending={approve.isPending}
              onConfirm={() => approve.mutate([approveOne.id])}
            />
          ) : null}
          <Drawer open={rulesOpen} onOpenChange={setRulesOpen} title="Exception rules">
            <div className="flex flex-col gap-4">
              <p className="m-text-body m-ink-2">A rule raises an exception when a new finding matches its condition. Turn a rule off to stop new exceptions from it.</p>
              <div className="flex flex-col gap-2">
                {excRulesQ.isLoading ? <Skeleton height={80} /> : null}
                {excRulesQ.isError ? <ErrorState {...apiErrorState(excRulesQ.error)} onRetry={() => void excRulesQ.refetch()} /> : null}
                {(excRulesQ.data?.rules ?? []).map((r: ExceptionRule) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 border-b py-2">
                    <div className="flex flex-col">
                      <span className="m-text-body font-medium">{r.name}</span>
                      <span className="m-text-body m-ink-3">{formatModuleName(r.object_type)}, {labelOf(r.rule_type)}</span>
                    </div>
                    {canManageRules ? (
                      <Button variant="secondary" size="sm" disabled={toggleRule.isPending} onClick={() => toggleRule.mutate({ id: r.id, is_active: !r.is_active })}>
                        {r.is_active ? "Turn off" : "Turn on"}
                      </Button>
                    ) : <Pill tone={r.is_active ? "go" : "neutral"}>{r.is_active ? "On" : "Off"}</Pill>}
                  </div>
                ))}
                {excRulesQ.data && excRulesQ.data.rules.length === 0 && (
                  <span className="m-text-body m-ink-3">No exception rules yet. Add one below.</span>
                )}
              </div>
              {canManageRules ? <div className="flex flex-col gap-2">
                <span className="m-text-body font-medium">New rule</span>
                <Field label="Name (required)">
                  <Input
                    value={ruleDraft.name}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })}
                  />
                </Field>
                <Field label="Rule type">
                  <Select value={ruleDraft.rule_type} options={RULE_TYPES} onValueChange={(v) => setRuleDraft({ ...ruleDraft, rule_type: v })} />
                </Field>
                <Field label="Object (required)">
                  <Select value={ruleDraft.object_type} options={OBJECT_OPTIONS} placeholder="Choose an object" onValueChange={(v) => setRuleDraft({ ...ruleDraft, object_type: v })} />
                </Field>
                <Field label="Severity">
                  <Select value={ruleDraft.severity} options={SEVERITY_OPTIONS} onValueChange={(v) => setRuleDraft({ ...ruleDraft, severity: v as Severity })} />
                </Field>
                <Field label="Condition (required)">
                  <Input
                    value={ruleDraft.condition}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, condition: e.target.value })}
                  />
                </Field>
                <p className="m-text-meta m-ink-3">A field condition such as MARA.MATKL = &apos;&apos;, a threshold such as count &gt; 100, a temporal window or a relationship between two fields</p>
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    disabled={!ruleDraft.name.trim() || !ruleDraft.object_type || !ruleDraft.condition.trim() || createRule.isPending}
                    onClick={() => createRule.mutate()}
                  >
                    Create rule
                  </Button>
                </div>
              </div> : null}
            </div>
          </Drawer>
        </>
      }
    />
  );
}

const proposalKey = (id: string) => ["cleaning", "item", id] as const;

/** The cleaning proposal a write-back task approves; it carries the SAP record key the task itself does not. */
function useProposal(t: StewardshipQueueItem) {
  return useQuery({
    queryKey: proposalKey(t.source_id),
    queryFn: () => getCleaningItem(t.source_id),
    enabled: t.item_type === "writeback_approval",
    retry: false,
    meta: { ignoreError: true },
  });
}

/** The link for Enter: a proposal is fetched (or read from the cache) first, for its record key. */
async function resolveTaskLink(qc: QueryClient, t: StewardshipQueueItem) {
  if (t.item_type !== "writeback_approval") return taskSourceLink(t, null);
  const proposal = await qc.fetchQuery({ queryKey: proposalKey(t.source_id), queryFn: () => getCleaningItem(t.source_id), retry: false }).catch((): CleaningQueueItem | null => null);
  return taskSourceLink(t, proposal);
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

const pairKey = (id: string) => ["mdm", "match-review", "pair", id] as const;

/** The match pair a merge decision approves (the same query TaskSource reads, so it comes from the cache). */
function usePair(t: StewardshipQueueItem) {
  return useQuery({ queryKey: pairKey(t.source_id), queryFn: () => getReviewPair(t.source_id), enabled: t.item_type === "merge_decision", retry: false, meta: { ignoreError: true } });
}

/**
 * What approving one task does, in the words of its type: the write-back names the field, value and record,
 * the merge names both records. `action` completes "Press Enter to …" and the dialog's body.
 * Approving a write-back marks the proposal applied in Meridian (api/routes/stewardship.py: no SAP write happens
 * there); the value reaches SAP only in the cleaning export (an LSMW, BAPI or IDoc file) that is loaded into SAP.
 */
function approveCopy(t: StewardshipQueueItem, proposal: CleaningQueueItem | null, pair: ReviewPair | null): {
  title: string; confirmLabel: string; action: string; body: React.ReactNode;
} {
  if (t.item_type === "writeback_approval") {
    const p = proposal ? proposalOf(proposal) : null;
    if (proposal && p) {
      const value = p.value || "(blank)";
      const before = p.before ? p.before : "blank";
      const field = p.field ? ` ${p.field}` : "";
      return {
        title: "Approve this write-back?",
        confirmLabel: "Approve write-back",
        action: `approve changing${field} from ${before} to ${value} on ${proposal.record_key}`,
        body: <>Approves changing{p.field ? <> <Mono>{p.field}</Mono></> : null} from {p.before ? <Mono>{before}</Mono> : before} to <Mono>{value}</Mono> on <Mono>{proposal.record_key}</Mono>. It is applied in the export to SAP; nothing is written to SAP from here.</>,
      };
    }
    return { title: "Approve this write-back?", confirmLabel: "Approve write-back", action: "approve the proposed value", body: "Approves the proposed value. It is applied in the export to SAP; nothing is written to SAP from here." };
  }
  if (t.item_type === "golden_writeback") {
    return {
      title: "Approve this SAP write-back?",
      confirmLabel: "Approve write-back",
      action: "approve writing the golden values to SAP",
      body: "Writes the golden record's values to SAP for the fields its simulation showed as changing. You cannot approve a write-back you requested.",
    };
  }
  if (t.item_type === "merge_decision") {
    if (pair) {
      return {
        title: "Approve this merge?",
        confirmLabel: "Approve merge",
        action: `merge ${pair.a} and ${pair.b}`,
        body: <>Merges <Mono>{pair.a}</Mono> and <Mono>{pair.b}</Mono> (match score {pct(pair.total)}) into one golden record. An approved merge cannot be undone here.</>,
      };
    }
    return { title: "Approve this merge?", confirmLabel: "Approve merge", action: "approve the merge", body: "The two records are merged into one golden record. An approved merge cannot be undone here." };
  }
  const what = labelOf(t.item_type).toLowerCase();
  return { title: `Approve this ${what}?`, confirmLabel: "Approve", action: `approve this ${what}`, body: "The task closes as approved. It cannot be reopened here." };
}

/** The detail pane's single Approve: one ConfirmDialog worded by the task's type, as bulk approve has. */
function ApproveTaskDialog({ t, pending, onOpenChange, onConfirm }: {
  t: StewardshipQueueItem; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void;
}) {
  const proposal = useProposal(t);
  const pair = usePair(t);
  const copy = approveCopy(t, proposal.data ?? null, pair.data ?? null);
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      cancelLabel="Keep open"
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}

/** What the task decides on, from the source it points at: the proposal, the pair, the golden record, the exception, the contract or the term. */
function TaskSource({ t }: { t: StewardshipQueueItem }) {
  const proposal = useProposal(t);
  const opts = { retry: false, meta: { ignoreError: true } } as const;
  const exception = useQuery({ queryKey: ["exceptions", "detail", t.source_id], queryFn: () => getException(t.source_id), enabled: t.item_type === "exception", ...opts });
  const pair = usePair(t);
  const golden = useQuery({ queryKey: ["master-records", t.source_id], queryFn: () => getMasterRecord(t.source_id), enabled: t.item_type === "golden_record_review", ...opts });
  const term = useQuery({ queryKey: ["glossary", "term", t.source_id], queryFn: () => getGlossaryTerm(t.source_id), enabled: t.item_type === "glossary_review", ...opts });
  const contracts = useQuery({ queryKey: ["contracts", "active"], queryFn: () => getContracts("active"), enabled: t.item_type === "contract_breach", staleTime: 60_000, ...opts });
  const ruleId = proposal.data?.rule_id ?? null;
  const rule = useQuery({ queryKey: queryKeys.ruleDetail(ruleId ?? ""), queryFn: () => getRule(ruleId as string), enabled: !!ruleId, staleTime: 300_000, meta: { ignoreError: true } });
  const loading = [proposal, exception, pair, golden, term, contracts].some((q) => q.isLoading);
  if (loading) return <Skeleton height={64} />;
  const facts = (children: React.ReactNode) => (
    <dl className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]" data-testid="task-source">{children}</dl>
  );
  if (t.item_type === "writeback_approval") {
    if (!proposal.data) return null;
    const p = proposalOf(proposal.data);
    // A rules row is named "<check id>: <message>"; ruleId is its UUID, which no steward reads.
    const name = ruleId ? rule.data?.name : undefined;
    const split = name ? name.indexOf(":") : -1;
    const checkId = name ? (split >= 0 ? name.slice(0, split).trim() : name) : null;
    const message = name && split >= 0 ? name.slice(split + 1).trim() : null;
    return facts(<>
      <Fact label="Record"><Mono>{proposal.data.record_key}</Mono></Fact>
      {ruleId ? (
        <Fact label="Rule">
          <span className="inline-flex flex-wrap items-baseline gap-2">
            <Link href={`/rules/${encodeURIComponent(ruleId)}`} className="m-ink-accent underline underline-offset-2">{checkId ? <Mono>{checkId}</Mono> : "Open the rule"}</Link>
            {message ? <span>{message}</span> : null}
          </span>
        </Fact>
      ) : null}
      {p?.field ? <Fact label="Field"><Mono>{p.field}</Mono></Fact> : null}
      <Fact label="Current value">{p?.before ? <Mono>{p.before}</Mono> : "blank"}</Fact>
      <Fact label="Proposed value"><ProposalCell proposal={p} /></Fact>
    </>);
  }
  if (t.item_type === "exception") {
    if (!exception.data) return null;
    return (
      <div className="flex flex-col gap-1" data-testid="task-source">
        <p className="m-text-body font-medium">{exception.data.title}</p>
        {exception.data.description ? <p className="m-text-body m-ink-2">{exception.data.description}</p> : null}
      </div>
    );
  }
  if (t.item_type === "merge_decision") {
    if (!pair.data) return null;
    return facts(<>
      <Fact label="Records"><span className="inline-flex flex-wrap items-baseline gap-2"><Mono>{pair.data.a}</Mono><span className="m-ink-3">and</span><Mono>{pair.data.b}</Mono></span></Fact>
      <Fact label="Match score">{pct(pair.data.total)}</Fact>
    </>);
  }
  if (t.item_type === "golden_record_review") {
    if (!golden.data) return null;
    return facts(<>
      <Fact label="Record"><Mono>{golden.data.sap_object_key}</Mono></Fact>
      <Fact label="Confidence">{pct(golden.data.overall_confidence)}</Fact>
      <Fact label="Golden record status">{labelOf(golden.data.status)}</Fact>
    </>);
  }
  if (t.item_type === "glossary_review") {
    if (!term.data) return null;
    return facts(<>
      <Fact label="Term">{term.data.business_name}</Fact>
      <Fact label="Field"><Mono>{`${term.data.sap_table}.${term.data.sap_field}`}</Mono></Fact>
      <Fact label="Last reviewed">{term.data.last_reviewed_at ? formatDate(term.data.last_reviewed_at) : "Never"}</Fact>
      <Fact label="Review every">{`${term.data.review_cycle_days.toLocaleString()} days`}</Fact>
    </>);
  }
  if (t.item_type === "contract_breach") {
    const c = contracts.data?.contracts.find((x) => x.id === t.source_id);
    if (!c) return null;
    return facts(<>
      <Fact label="Contract">{c.name}</Fact>
      <Fact label="Producer">{c.producer}</Fact>
      <Fact label="Consumer">{c.consumer}</Fact>
      <Fact label="Last checked">{c.last_checked ? relativeTime(c.last_checked) : "Not checked yet"}</Fact>
    </>);
  }
  return null;
}

/** The one link out of a task, to the page that holds what it decides on. */
function TaskOpen({ t }: { t: StewardshipQueueItem }) {
  const proposal = useProposal(t);
  const link = taskSourceLink(t, proposal.data ?? null);
  if (!link) return null;
  return <div><Button variant="secondary" render={<Link href={link.href} />}>{link.label}</Button></div>;
}

/** The model's recommendation as a verb Meridian can do from here ("escalate: critical severity requires attention"), with its reason. */
const SUGGESTED_MOVES = ["escalate", "approve", "reject"] as const;
function suggestedMove(recommendation: string | null | undefined): { move: (typeof SUGGESTED_MOVES)[number]; reason: string } | null {
  if (!recommendation) return null;
  const [head, ...rest] = recommendation.split(/:\s*/);
  const move = SUGGESTED_MOVES.find((m) => m === head.trim().toLowerCase());
  return move ? { move, reason: rest.join(": ").trim() } : null;
}

/** The selected task: what it is, where it stands against its SLA, the model's suggestion and the one decision. */
function TaskDetail({ t, exc, sla, now, assignee, busy, canApprove, canAssign, canRelease, people, onApprove, onReject, onEscalate, onAssign, onRelease, onReassign }: {
  t: StewardshipQueueItem; exc: Exception | null; sla: Sla; now: number; assignee: string; busy: boolean; canApprove: boolean; canAssign: boolean; canRelease: boolean;
  people: { value: string; label: string }[];
  onApprove: () => void; onReject: () => void; onEscalate: () => void; onAssign: () => void; onRelease: () => void; onReassign: (userId: string) => void;
}) {
  const claimFirst = canAssign && !t.assigned_to;
  const suggested = suggestedMove(t.ai_recommendation);
  // Approve and Reject are already buttons here; Escalate otherwise waits in the menu, so a suggestion to escalate is surfaced as its own button.
  const suggestEscalate = suggested?.move === "escalate" && canApprove && t.status !== "escalated";
  // An exception beyond the list's first page is read by id (the same query TaskSource makes), for its title and object.
  const excDetail = useQuery({ queryKey: ["exceptions", "detail", t.source_id], queryFn: () => getException(t.source_id), enabled: t.item_type === "exception" && !exc, retry: false, meta: { ignoreError: true } });
  const source = exc ?? excDetail.data ?? null;
  const object = taskObject(t, source);
  const ruleNameOf: RuleNameOf = useRuleNames(unnamedChecks([t]), !source?.title);
  // The rarer moves wait in the menu: taking over someone else's task, handing it back, escalating.
  const more: MenuItemDef[] = [
    ...(canAssign && !claimFirst ? [{ label: "Claim", onSelect: onAssign }] : []),
    ...(canRelease ? [{ label: "Release", onSelect: onRelease }] : []),
    ...(t.status !== "escalated" && !suggestEscalate ? [{ label: "Escalate", onSelect: onEscalate }] : []),
  ];
  return (
    <Card
      title={taskTitle(t, source, ruleNameOf)}
      meta={<Pill tone={SLA_TONE[sla.state]}>{slaText(sla)}</Pill>}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* The primary follows the task's state: an unowned task is claimed first, an owned one decided. */}
          {claimFirst && <Button variant="primary" disabled={busy} onClick={onAssign}>Claim</Button>}
          {canApprove && <Button variant={claimFirst ? "secondary" : "primary"} disabled={busy} onClick={onApprove}>Approve</Button>}
          {canApprove && <Button variant="secondary" disabled={busy} onClick={onReject}>Reject</Button>}
          {people.length > 0 && <ReassignSelect people={people} disabled={busy} onPick={onReassign} />}
          {more.length > 0 && (
            busy
              ? <IconButton size="sm" aria-label="More actions" disabled><IconMore size={16} /></IconButton>
              : <Menu trigger={<IconButton size="sm" aria-label="More actions"><IconMore size={16} /></IconButton>} items={more} />
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
          {/* No "Not named" placeholder: a task whose source names no object leaves the fact out. */}
          {object ? <Fact label="Object">{formatModuleName(object)}</Fact> : null}
          <Fact label="Priority">{priorityLabel(t.priority)}</Fact>
          <Fact label="Status"><Pill tone={STATUS_TONE[t.status]}>{labelOf(t.status)}</Pill></Fact>
          <Fact label="Assignee">{assignee}</Fact>
          <Fact label="Age">{span(now - Date.parse(t.created_at))}</Fact>
          <Fact label="Raised">{formatDate(t.created_at, "datetime")}</Fact>
          <Fact label="Due">{t.due_at ? formatDate(t.due_at, "datetime") : t.sla_hours ? `${t.sla_hours}h after it was raised` : "No due date"}</Fact>
        </dl>
        <TaskSource t={t} />
        {t.ai_recommendation ? (
          <div className="flex flex-col items-start gap-2">
            <p className="m-text-body m-ink-2">
              Meridian suggests: {suggested ? labelOf(suggested.move) : labelOf(t.ai_recommendation)}
              {t.ai_confidence != null ? `, ${Math.round(t.ai_confidence * 100)}% sure` : ""}
              {suggested?.reason ? `. ${suggested.reason.charAt(0).toUpperCase()}${suggested.reason.slice(1)}` : ""}. Check it before you decide.
            </p>
            {suggestEscalate ? <Button variant="secondary" size="sm" disabled={busy} onClick={onEscalate}>Escalate</Button> : null}
          </div>
        ) : null}
        <TaskOpen t={t} />
      </div>
    </Card>
  );
}

/** The selected exception: severity, SLA, what happened and the one decision. */
function ExceptionDetail({ e, now, assignee, busy, canResolve, canAssign, currency, people, onResolve, onEscalate, onAssign }: {
  e: Exception; now: number; assignee: string; busy: boolean; canResolve: boolean; canAssign: boolean; currency?: string | null;
  people: { value: string; label: string }[];
  onResolve: () => void; onEscalate: () => void; onAssign: (userId?: string) => void;
}) {
  const sla = excSla(e.sla_deadline, now);
  const open = e.status !== "resolved" && e.status !== "closed";
  return (
    <Card
      title={exceptionTitle(e)}
      meta={<Pill tone={sla.tone}>{sla.text}</Pill>}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canResolve && open && <Button variant="primary" disabled={busy} onClick={onResolve}>Resolve</Button>}
          {canAssign && !e.assigned_to && <Button variant="ghost" disabled={busy} onClick={() => onAssign()}>Claim</Button>}
          {open && people.length > 0 && <ReassignSelect people={people} disabled={busy} onPick={(id) => onAssign(id)} />}
          {canResolve && <Button variant="ghost" disabled={busy || e.escalation_tier > 0} onClick={onEscalate}>Escalate</Button>}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
          <Fact label="Severity"><Status kind="severity" value={e.severity} /></Fact>
          <Fact label="Status"><Pill tone={EXC_STATUS_TONE[e.status]}>{labelOf(e.status)}</Pill></Fact>
          <Fact label="Category">{labelOf(e.category)}</Fact>
          <Fact label="Assignee">{assignee}</Fact>
          <Fact label="Raised">{relativeTime(e.created_at)}</Fact>
          {e.source_system ? <Fact label="Source">{e.source_system}</Fact> : null}
          {e.estimated_impact_zar != null ? <Fact label="Estimated impact">{formatMoney(e.estimated_impact_zar, currency)}</Fact> : null}
        </dl>
        {e.description ? <p className="m-text-body m-ink-2">{e.description}</p> : null}
        <ExceptionThread id={e.id} />
      </div>
    </Card>
  );
}

/** One pick hands the selected work to that person: the select resets so the same name can be picked again. */
function ReassignSelect({ people, disabled, onPick }: { people: { value: string; label: string }[]; disabled: boolean; onPick: (userId: string) => void }) {
  if (disabled) return <Button variant="ghost" size="sm" disabled>Reassign</Button>;
  return <Select label="Reassign to" value="" placeholder="Reassign to…" options={people} onValueChange={(v) => { if (v) onPick(v); }} />;
}
