"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addComment, deleteComment, deleteWatch, putSubscriptions, type CommentKind, type MyWatch, type WatchKind } from "@/lib/api/v2/roles";
import { errorSentence, postUndo } from "@/lib/api/v2/work";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { lcFirst, t } from "@/lib/v2/i18n";
import { refreshV2, useLandscape } from "@/lib/v2/queries";
import { notFound, refreshRoles, useComments, useMyWatches, useSubscriptions, useUnreadMentions } from "@/lib/v2/roles-queries";
import { pushAction, removeAction, type DoneAction } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { Mono, V2Link } from "@/design/v2/parts";
import { Button, Chip, Confirm, Skeleton, useToast } from "../../kit";
import { WatchToggle } from "../../object/tabs/Related";
import "./panels.css";

/** A dash that says why there is no value. */
export function Dash({ why }: { why: string }) {
  return (
    <span className="nx-pn-meta" title={why} aria-label={why}>
      —
    </span>
  );
}

/** The outcome of an action, shown in place of a toast when the result needs reading. */
export interface Outcome {
  tone: "ok" | "fail" | "info";
  title: string;
  detail?: string;
  job?: string;
}

export function useOutcome() {
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<Outcome | null | void>) => {
    setPending(key);
    setOutcome(null);
    try {
      const o = await fn();
      if (o) setOutcome(o);
    } catch (e) {
      setOutcome({ tone: "fail", title: t("It did not go through"), detail: failureText(e) });
    } finally {
      setPending(null);
    }
  }, []);
  return { pending, outcome, setOutcome, run, clear: () => setOutcome(null) };
}

export function Result({ outcome, children }: { outcome: Outcome | null; children?: ReactNode }) {
  const { hrefFor } = useOpenItem();
  if (!outcome) return null;
  return (
    <div className="nx-pn-result" role="status" data-tone={outcome.tone} data-testid="action-result">
      <span className="nx-pn-row">
        {outcome.tone === "info" ? null : <Chip tone={outcome.tone === "ok" ? "good" : "bad"}>{outcome.tone === "ok" ? t("Done") : t("Failed")}</Chip>}
        <strong>{outcome.title}</strong>
      </span>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
      {outcome.job ? <V2Link href={hrefFor({ kind: "job", id: outcome.job })}>{t("Open the job")}</V2Link> : null}
      {children}
    </div>
  );
}

/** A done toast with Undo: the action goes on the undo stack, Undo reverses it on the server. */
export function useDone() {
  const qc = useQueryClient();
  const push = useToast();
  return useCallback(
    (a: DoneAction) => {
      pushAction(a);
      push({
        text: a.label,
        onUndo: () => {
          removeAction(a);
          void (async () => {
            try {
              if (a.undo) await a.undo();
              else for (const id of [...a.ids].reverse()) await postUndo(id);
              await refreshV2(qc);
              clearPatches();
              push({ text: t("Undone: {action}", { action: lcFirst(a.label) }) });
            } catch (err) {
              push({ text: errorSentence(err, t("This change could not be undone.")), tone: "bad" });
            }
          })();
        },
      });
    },
    [qc, push],
  );
}

/** "@a.naidoo" handles from the people the composer can mention: the local part of their e-mail. */
const handleOf = (email: string | null | undefined): string => (email ?? "").split("@")[0].toLowerCase();
const typingHandle = (draft: string): string | null => {
  const m = /(?:^|\s)@([\w.-]*)$/.exec(draft);
  return m ? m[1].toLowerCase() : null;
};

export function CommentsSection({ kind, id }: { kind: CommentKind; id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useComments(kind, id);
  const people = useAssignable(true);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const typing = typingHandle(draft);
  const suggestions = useMemo(
    () => (typing === null ? [] : (people.data ?? []).filter((p) => handleOf(p.email).startsWith(typing) || p.name.toLowerCase().includes(typing)).slice(0, 5)),
    [typing, people.data],
  );
  const canWrite = session.can("view") && !session.shared && !session.viewAs;
  const names = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.name])), [people.data]);
  const pick = (pid: string, email: string) => {
    setDraft((d) => d.replace(/@([\w.-]*)$/, `@${handleOf(email)} `));
    setPicked((p) => [...new Set([...p, pid])]);
  };
  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      await addComment(kind, id, draft.trim(), picked);
      setDraft("");
      setPicked([]);
      await refreshRoles(qc, "comments");
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (cid: string) => {
    setAsking(null);
    try {
      await deleteComment(cid);
      await refreshRoles(qc, "comments");
    } catch (e) {
      setError(failureText(e));
    }
  };
  if (q.isError && notFound(q.error)) {
    return (
      <section className="nx-ib-sec" aria-label={t("Comments")}>
        <h3>{t("Comments")}</h3>
        <Dash why={t("Comments are not available on this server yet")} />
      </section>
    );
  }
  const list = q.data?.comments ?? [];
  const target = list.find((c) => c.id === asking);
  return (
    <section className="nx-ib-sec" aria-label={t("Comments")} data-testid="comments">
      <h3>{t("Comments")}</h3>
      {q.isPending ? (
        <Skeleton lines={2} label={t("Comments")} />
      ) : list.length === 0 ? (
        <p className="nx-pn-meta">{t("No comments yet. Type @ and a name to bring someone in.")}</p>
      ) : (
        <ul className="nx-ib-list">
          {list.map((c) => (
            <li key={c.id} className="nx-ib-row" data-testid="comment">
              <span className="nx-pn-meta">{`${c.author_label}, ${formatDate(c.created_at, "date")}`}</span>
              <span>{c.body}</span>
              {c.mentions.length ? <span className="nx-pn-meta">{t("Mentioned: {names}", { names: c.mentions.map((m) => names.get(m) ?? m).join(", ") })}</span> : null}
              {c.mine && canWrite ? (
                <button type="button" className="nx-pn-linkbtn" onClick={() => setAsking(c.id)} aria-label={t("Remove your comment of {created_at}", { created_at: formatDate(c.created_at, "date") })}>
                  {t("Remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Confirm
        open={Boolean(target)}
        title={t("Remove")}
        consequence={target ? t("Your comment of {created_at} is removed for everyone who reads this item.", { created_at: formatDate(target.created_at, "date") }) : ""}
        confirmLabel={t("Remove")}
        danger
        onConfirm={() => asking && void remove(asking)}
        onCancel={() => setAsking(null)}
      />
      {canWrite ? (
        <div className="nx-pn-form">
          <label className="nx-pn-fld">
            <span>{t("Add a comment")}</span>
            <textarea rows={2} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} placeholder={t("Ask, explain, or @mention someone")} />
          </label>
          {suggestions.length ? (
            <ul className="nx-ib-list" aria-label={t("People to mention")}>
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button type="button" className="nx-pn-linkbtn" onClick={() => pick(p.id, p.email)}>
                    {p.name} <Mono>{`@${handleOf(p.email)}`}</Mono>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <span>
            <Button variant="secondary" size={32} loading={busy} loadingLabel={t("Posting…")} disabled={!draft.trim()} onClick={() => void post()}>
              {t("Post comment")}
            </Button>
          </span>
          {error ? (
            <p className="nx-pn-err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="nx-pn-meta">{session.shared ? t("This is a shared, read-only view.") : t("Viewing as another role: comments are read-only.")}</p>
      )}
    </section>
  );
}

/** Watch and Comments together: the one line an inspector adds. */
export function CollabSections({ kind, id, label }: { kind: CommentKind; id: string; label: string }) {
  return (
    <>
      <section className="nx-ib-sec" aria-label={t("Watch")}>
        <h3>{t("Watch")}</h3>
        <WatchToggle kind={kind} id={id} label={label} />
      </section>
      <CommentsSection kind={kind} id={id} />
    </>
  );
}

/** Which events reach this person, and the way to out of office. */
export function SubscriptionsBlock() {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useSubscriptions();
  const { hrefFor } = useOpenItem();
  const [error, setError] = useState<string | null>(null);
  const readOnly = session.shared || Boolean(session.viewAs);
  const flip = async (event: string, on: boolean) => {
    setError(null);
    try {
      await putSubscriptions({ [event]: on });
      await refreshRoles(qc, "subs");
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <section className="nx-ib-sec" data-testid="subscriptions">
      <h3>{t("What you hear about")}</h3>
      {q.isError ? (
        notFound(q.error) ? (
          <Dash why={t("Subscriptions are not available on this server yet")} />
        ) : (
          <p className="nx-pn-meta">{t("Your subscriptions could not be read.")}</p>
        )
      ) : !q.data ? (
        <Skeleton lines={2} label={t("What you hear about")} />
      ) : (
        <div className="nx-pn-form">
          {q.data.events.map((e) => (
            <label key={e.event} className="nx-pn-opt">
              <input type="checkbox" checked={e.enabled} disabled={readOnly} onChange={(x) => void flip(e.event, x.target.checked)} />
              <span>{e.label}</span>
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p className="nx-pn-err" role="alert">
          {error}
        </p>
      ) : null}
      <p className="nx-pn-meta">
        <V2Link href={hrefFor({ kind: "away", id: "" })}>{t("Out of office")}</V2Link>
        {t(" hands your approvals and assigned work to someone while you are away.")}
      </p>
    </section>
  );
}

/** "2 unread mentions". Nothing when there is none or no endpoint. */
export function MentionCount() {
  const q = useUnreadMentions();
  const n = q.data?.count ?? 0;
  if (!n) return null;
  return (
    <span className="nx-pn-meta" data-testid="mention-count">
      {t("{n} unread {n, plural, one {mention} other {mentions}}", { n })}
    </span>
  );
}

const KIND_WORD: Record<WatchKind, () => string> = {
  record: () => t("Record"),
  rule: () => t("Rule"),
  batch: () => t("Batch"),
  contract: () => t("Contract"),
  wave: () => t("Wave"),
  object: () => t("Object"),
  system: () => t("System"),
};

const watchEventsLine = (events: MyWatch["events"]): string =>
  events.length === 0
    ? t("All events")
    : events.map((e) => ({ comment: t("Comments"), run_finished: t("Runs finishing"), score_dropped: t("Score drops"), critical_breach: t("Critical breaches"), batch_waiting: t("Batches waiting") })[e] ?? e).join(", ");

/** Everything the caller watches, each with Stop watching. */
export function WatchListBlock() {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useMyWatches();
  const landscape = useLandscape(null).data;
  const [error, setError] = useState<string | null>(null);
  const readOnly = session.shared || Boolean(session.viewAs);
  const name = (w: MyWatch): string => {
    if (w.target_kind !== "object") return w.target_id;
    const mod = w.target_id.split(":").pop() ?? w.target_id;
    return landscape?.objects.find((o) => o.module === mod)?.label ?? mod.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  };
  const stop = async (w: MyWatch) => {
    setError(null);
    try {
      await deleteWatch(w.target_kind, w.target_id);
      await refreshRoles(qc, "watch");
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <section className="nx-ib-sec" data-testid="watch-list">
      <h3>{t("What you watch")}</h3>
      {q.isError ? (
        notFound(q.error) ? (
          <Dash why={t("Watching is not available on this server yet")} />
        ) : (
          <p className="nx-pn-meta">{t("Your watches could not be read.")}</p>
        )
      ) : !q.data ? (
        <Skeleton lines={2} label={t("What you watch")} />
      ) : q.data.watches.length === 0 ? (
        <p className="nx-pn-meta">{t("You watch nothing yet. Use Watch on an object, rule or batch to hear about it.")}</p>
      ) : (
        <ul className="nx-ib-list">
          {q.data.watches.map((w) => (
            <li key={`${w.target_kind}:${w.target_id}`} className="nx-ib-row">
              <span>
                <span className="nx-pn-meta">{KIND_WORD[w.target_kind]()}</span> {name(w)}
                <span className="nx-pn-meta"> {watchEventsLine(w.events)}</span>
              </span>
              <Button variant="secondary" size={32} disabled={readOnly} reason={readOnly ? t("Read-only view") : undefined} onClick={() => void stop(w)}>
                {t("Stop watching")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="nx-pn-err" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
