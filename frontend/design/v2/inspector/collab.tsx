"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addComment, deleteComment, deleteWatch, putSubscriptions, putWatch, type CommentKind, type WatchKind } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useActivity, useComments, useSubscriptions, useUnreadMentions, useWatch } from "@/lib/v2/roles-queries";
import { Dash, Mono, Skeleton, V2Link } from "../parts";
import "../roles.css";

/**
 * The collaboration sections every inspector shares (step 6c): Watch (hear about runs, score drops, new breaches,
 * comments and batches on this thing), Comments with @mentions, and a person's Activity. Each reads its own endpoint,
 * so dropping one into an inspector is one line: `<CollabSections kind="record" id={id} />`.
 */

/** "@a.naidoo" handles from the people the composer can mention: the local part of their e-mail. */
export const handleOf = (email: string | null | undefined): string => (email ?? "").split("@")[0].toLowerCase();

/** The handle being typed at the end of the draft ("@a.na" -> "a.na"), or null. */
export function typingHandle(draft: string): string | null {
  const m = /(?:^|\s)@([\w.-]*)$/.exec(draft);
  return m ? m[1].toLowerCase() : null;
}

export function WatchToggle({ kind, id, label }: { kind: WatchKind; id: string; label: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useWatch(kind, id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isError && notFound(q.error)) return <Dash why="Watching is not available on this server yet" />;
  const watching = q.data?.watching ?? false;
  const readOnly = session.shared || Boolean(session.viewAs);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (watching) await deleteWatch(kind, id);
      else await putWatch(kind, id, []);
      await refreshRoles(qc, "watch");
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="m2-watch" data-testid="watch">
      <button type="button" className="m2-btn m2-sm" aria-pressed={watching} disabled={busy || !q.data || readOnly} onClick={() => void toggle()} title={readOnly ? "Read-only view" : undefined}>
        {watching ? "Watching" : "Watch"}
      </button>
      <span className="m2-meta">{watching ? `You hear about runs, score drops, new critical breaches and comments on ${label}.` : `Hear about runs, score drops and comments on ${label}.`}</span>
      {error ? (
        <span className="m2-err" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function CommentsSection({ kind, id }: { kind: CommentKind; id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useComments(kind, id);
  const people = useAssignable(true);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    try {
      await deleteComment(cid);
      await refreshRoles(qc, "comments");
    } catch (e) {
      setError(failureText(e));
    }
  };
  if (q.isError && notFound(q.error)) {
    return (
      <section className="m2-rsec" aria-label="Comments">
        <h3>Comments</h3>
        <p className="m2-meta">
          <Dash why="Comments are not available on this server yet" />
        </p>
      </section>
    );
  }
  const list = q.data?.comments ?? [];
  return (
    <section className="m2-rsec" aria-label="Comments" data-testid="comments">
      <h3>Comments</h3>
      {q.isPending ? (
        <Skeleton width="70%" height={12} />
      ) : list.length === 0 ? (
        <p className="m2-meta">No comments yet. Type @ and a name to bring someone in.</p>
      ) : (
        <ul className="m2-rows m2-comments">
          {list.map((c) => (
            <li key={c.id} data-testid="comment">
              <span className="m2-meta">{`${c.author_label}, ${formatDate(c.created_at, "date")}`}</span>
              <span>{c.body}</span>
              {c.mentions.length ? <span className="m2-meta">{`Mentioned: ${c.mentions.map((m) => names.get(m) ?? m).join(", ")}`}</span> : null}
              {c.mine && canWrite ? (
                <button type="button" className="m2-linkbtn2" onClick={() => void remove(c.id)} aria-label={`Remove your comment of ${formatDate(c.created_at, "date")}`}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="m2-compose">
          <label className="m2-fld m2-wide">
            <span className="m2-lbl">Add a comment</span>
            <textarea rows={2} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} placeholder="Ask, explain, or @mention someone" />
          </label>
          {suggestions.length ? (
            <ul className="m2-mention-list" aria-label="People to mention">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button type="button" className="m2-linkbtn2" onClick={() => pick(p.id, p.email)}>
                    {p.name} <Mono>{`@${handleOf(p.email)}`}</Mono>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="m2-btn m2-sm" disabled={busy || !draft.trim()} onClick={() => void post()}>
            {busy ? "Posting…" : "Post comment"}
          </button>
          {error ? (
            <span className="m2-err" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="m2-meta">{session.shared ? "This is a shared, read-only view." : "Viewing as another role: comments are read-only."}</p>
      )}
    </section>
  );
}

/** Watch and Comments together: the one line an inspector adds. */
export function CollabSections({ kind, id, label }: { kind: CommentKind; id: string; label: string }) {
  return (
    <>
      <section className="m2-rsec" aria-label="Watch">
        <h3>Watch</h3>
        <WatchToggle kind={kind} id={id} label={label} />
      </section>
      <CommentsSection kind={kind} id={id} />
    </>
  );
}

/** A person's audit trail: their own always, anyone's with view_audit or manage_users. */
export function ActivitySection({ userId, self }: { userId: string; self: boolean }) {
  const session = useV2Session();
  const allowed = self || session.can("view_audit") || session.can("manage_users");
  const q = useActivity(userId, allowed);
  return (
    <section className="m2-rsec" aria-label="Activity" data-testid="activity">
      <h3>Activity</h3>
      {!allowed ? (
        <p className="m2-meta">{"Reading someone else's activity needs the view audit permission."}</p>
      ) : q.isError ? (
        <p className="m2-meta">{notFound(q.error) ? <Dash why="Activity is not available on this server yet" /> : "The activity could not be read."}</p>
      ) : !q.data ? (
        <Skeleton width="60%" height={12} />
      ) : q.data.entries.length === 0 ? (
        <p className="m2-meta">No changes recorded.</p>
      ) : (
        <ul className="m2-hist">
          {q.data.entries.slice(0, 12).map((e) => (
            <li key={e.id}>
              <span className="m2-meta">{formatDate(e.created_at, "date")}</span>
              <span>
                {e.action.replace(/[._]/g, " ")}
                {e.entity_id ? (
                  <>
                    {" "}
                    <Mono>{e.entity_id}</Mono>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Preferences: which events reach this person (per-event subscriptions), and out of office. */
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
    <div data-testid="subscriptions">
      <h3>What you hear about</h3>
      {q.isError ? (
        <p className="m2-meta">{notFound(q.error) ? <Dash why="Subscriptions are not available on this server yet" /> : "Your subscriptions could not be read."}</p>
      ) : !q.data ? (
        <Skeleton width="60%" height={12} />
      ) : (
        <div className="m2-aform">
          {q.data.events.map((e) => (
            <label key={e.event} className="m2-sw" style={{ display: "flex", gap: 8 }}>
              <input type="checkbox" checked={e.enabled} disabled={readOnly} onChange={(x) => void flip(e.event, x.target.checked)} />
              <span>{e.label}</span>
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p className="m2-err" role="alert">
          {error}
        </p>
      ) : null}
      <p className="m2-prov">
        <V2Link href={hrefFor({ kind: "away", id: "" })}>Out of office</V2Link>
        {" hands your approvals and assigned work to someone while you are away."}
      </p>
    </div>
  );
}

/** The inbox's count of unread mentions: "2 unread mentions". Nothing when there is none or no endpoint. */
export function MentionCount() {
  const q = useUnreadMentions();
  const n = q.data?.count ?? 0;
  if (!n) return null;
  return (
    <span className="m2-meta" data-testid="mention-count">
      {`${n} unread ${n === 1 ? "mention" : "mentions"}`}
    </span>
  );
}
