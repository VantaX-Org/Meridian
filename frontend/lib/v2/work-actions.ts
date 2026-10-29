"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/hooks/use-role";
import { fixtureParam } from "@/lib/api/v2/fixture";
import { useToast } from "@/design/v2/Toast";
import type { WorkRow } from "@/lib/api/v2/types";
import { errorSentence, postAcceptAll, postDecide, type Decision } from "@/lib/api/v2/work";
import { useV2Session } from "./hooks";
import { refreshV2 } from "./queries";
import { overrideKey, splitKey } from "./work";
import { clearPatches, dropPatches, setPatches, type Patch } from "./work-overrides";

export type RowRef = Pick<WorkRow, "module" | "record_key" | "version_id" | "checks" | "suggested_value" | "status"> & Partial<Pick<WorkRow, "new_value">>;

export type DecideKind = "accept" | "edit" | "not_an_issue" | "accept_risk" | "assign" | "reopen";

export interface DecideOptions {
  /** The value to use (edit). */
  value?: string;
  /** Why (not an issue, accept risk): the API refuses a sign-off without one. */
  note?: string;
  /** "me", a user id, or "" to unassign. */
  assignee?: string;
  /** A value per row, by `module|record_key` (a pasted column); `value` is used for rows not named. */
  values?: Record<string, string>;
  /** The notice's sentence, when the default does not fit. */
  label?: string;
}

const noun = (n: number) => (n === 1 ? "record" : "records");
const shortKey = (r: Pick<WorkRow, "record_key">) => splitKey(r.record_key)[0]?.value ?? r.record_key;

/** What a decision will do to the row, shown at once. */
const valueOf = (opts: DecideOptions, r: RowRef): string | undefined => opts.values?.[overrideKey(r)] ?? opts.value;

function patchFor(kind: DecideKind, opts: DecideOptions, r: RowRef, me: string | null): Patch {
  switch (kind) {
    case "accept":
      return { status: "proposed", new_value: r.suggested_value ?? null };
    case "edit":
      return { status: "proposed", new_value: valueOf(opts, r) ?? null };
    case "not_an_issue":
      return { status: "not_an_issue", resolution: "false_positive" };
    case "accept_risk":
      return { status: "not_an_issue", resolution: "accepted_risk" };
    case "assign":
      return opts.assignee === "" ? { assigned_to: null, assignee_email: null } : { assigned_to: opts.assignee ?? "me", assignee_email: me ?? opts.assignee ?? "me" };
    case "reopen":
      return { status: "to_fix", resolution: null };
  }
}

function labelFor(kind: DecideKind, opts: DecideOptions, rows: readonly RowRef[]): string {
  if (opts.label) return opts.label;
  const n = rows.length;
  switch (kind) {
    case "accept":
      return `Accepted ${n.toLocaleString("en-US")} suggested ${n === 1 ? "value" : "values"}`;
    case "edit":
      return n === 1 ? `Set ${shortKey(rows[0])} to ${opts.value}` : `Set ${n.toLocaleString("en-US")} ${noun(n)} to ${opts.value}`;
    case "not_an_issue":
      return `Marked ${n.toLocaleString("en-US")} ${noun(n)} as not an issue`;
    case "accept_risk":
      return `Accepted the risk on ${n.toLocaleString("en-US")} ${noun(n)}`;
    case "assign":
      return opts.assignee === "" ? `Unassigned ${n.toLocaleString("en-US")} ${noun(n)}` : `Assigned ${n.toLocaleString("en-US")} ${noun(n)} to you`;
    case "reopen":
      return `Reopened ${n.toLocaleString("en-US")} ${noun(n)}`;
  }
}

/**
 * Every change the ledger and the record inspector make goes through here: it applies the change to the screen at
 * once, calls the API, and then either keeps it (a notice with Undo for six seconds, the counts and the map refetch)
 * or puts the rows back and shows the server's own sentence. One call per run, because a decision names its run.
 */
export function useWorkActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const me = useMemo(() => session.name || null, [session.name]);

  const settle = useCallback(
    async (keys: string[]) => {
      await refreshV2(qc);
      dropPatches(keys);
    },
    [qc],
  );

  const decide = useCallback(
    async (rows: readonly RowRef[], kind: DecideKind, opts: DecideOptions = {}): Promise<boolean> => {
      let use = [...rows];
      if (kind === "accept") use = use.filter((r) => r.suggested_value);
      if (use.length === 0) {
        toast.show(rows.length === 1 ? "This record has no suggested value: enter one in New value." : "None of the chosen records has a suggested value: enter one in New value.", "error");
        return false;
      }
      if (kind === "edit" && use.some((r) => !(valueOf(opts, r) ?? "").trim())) {
        toast.show("Give the value to use.", "error");
        return false;
      }
      const keys = use.map(overrideKey);
      for (const r of use) setPatches([overrideKey(r)], patchFor(kind, opts, r, me));
      const byRun = new Map<string, RowRef[]>();
      for (const r of use) byRun.set(r.version_id ?? "", [...(byRun.get(r.version_id ?? "") ?? []), r]);
      const ids: string[] = [];
      try {
        for (const [run, group] of byRun) {
          const items: Decision[] = group.map((r) => ({
            module: r.module,
            record_key: r.record_key,
            check_id: kind === "assign" ? null : (r.checks[0] ?? null),
            action: kind === "reopen" ? "undo" : kind,
            value: kind === "edit" ? valueOf(opts, r) : undefined,
            note: opts.note,
            assignee: kind === "assign" ? (opts.assignee ?? "me") : undefined,
          }));
          const res = await postDecide(items, run || undefined);
          if (res.action_id) ids.push(res.action_id);
        }
      } catch (err) {
        dropPatches(keys);
        if (ids.length) toast.done({ ids, label: labelFor(kind, opts, use) });
        toast.show(errorSentence(err, "The change could not be saved."), "error");
        void refreshV2(qc);
        return false;
      }
      toast.done({ ids, label: labelFor(kind, opts, use) });
      await settle(keys);
      return true;
    },
    [me, qc, settle, toast],
  );

  /** Accept every suggested value of one rule (POST /work/groups/{check}/accept-all). */
  const acceptRule = useCallback(
    async (check: string, count: number, version: string | undefined, loaded: readonly RowRef[] = []): Promise<boolean> => {
      const rows = loaded.filter((r) => r.checks[0] === check && r.suggested_value && r.status === "to_fix");
      const keys = rows.map(overrideKey);
      for (const r of rows) setPatches([overrideKey(r)], patchFor("accept", {}, r, me));
      try {
        const res = await postAcceptAll(check, version);
        const n = res.accepted ?? count;
        toast.done({ ids: res.action_id ? [res.action_id] : [], label: `Accepted ${n.toLocaleString("en-US")} suggested ${n === 1 ? "value" : "values"} for ${check}` });
      } catch (err) {
        dropPatches(keys);
        toast.show(errorSentence(err, "The suggested values could not be accepted."), "error");
        return false;
      }
      await settle(keys);
      return true;
    },
    [me, settle, toast],
  );

  return { decide, acceptRule, undoLast: toast.undoLast, clear: clearPatches };
}

export interface WorkCan {
  apply: boolean;
  approve: boolean;
  assign: boolean;
  /** Which set of actions the inspector offers: a steward fixes, an owner approves, a viewer only reads. */
  mode: "steward" | "owner" | "viewer";
}

/**
 * What this person may do on the ledger, from the permissions the API grants (useRole). In fixture mode every
 * permission is open; `?role=owner` or `?role=viewer` shows the other two sets of actions.
 */
export function useWorkCan(): WorkCan {
  const session = useV2Session();
  const { role } = useRole();
  return useMemo(() => {
    const asked = session.fixture ? fixtureParam("role") : null;
    const apply = session.can("apply");
    const approve = session.can("approve");
    const assign = session.can("assign");
    if (asked === "viewer") return { apply: false, approve: false, assign: false, mode: "viewer" };
    if (asked === "owner") return { apply: false, approve: true, assign: false, mode: "owner" };
    if (!apply && !approve && !assign) return { apply, approve, assign, mode: "viewer" };
    const owner = !session.fixture && (role === "data_owner" || role === "approver" || (approve && !apply));
    return { apply, approve, assign, mode: owner ? "owner" : "steward" };
  }, [session, role]);
}
